import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// The board is N×N, row-major: tile id = row * N + col.
export const N = 12;
export const TILES = N * N;

export type Tile = {
  id: number;
  claimerId: string | null;
  label: string | null;
  claimedAt: string | null;
};

export type ClaimResult = "claimed" | "taken";

const path = process.env.DB_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS cells (
    id         INTEGER PRIMARY KEY,
    claimer_id TEXT,
    label      TEXT,
    claimed_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_tile_each ON cells(claimer_id)
    WHERE claimer_id IS NOT NULL;
`);

// Every tile exists as a row, so a claim is always an UPDATE.
const seed = db.prepare("INSERT OR IGNORE INTO cells (id) VALUES (?)");
for (let id = 0; id < TILES; id++) seed.run(id);

const selectAll = db.prepare(
  "SELECT id, claimer_id AS claimerId, label, claimed_at AS claimedAt FROM cells ORDER BY id",
);
const holderOf = db.prepare("SELECT claimer_id AS claimerId FROM cells WHERE id = ?");
const relabel = db.prepare("UPDATE cells SET label = ? WHERE id = ? AND claimer_id = ?");
const release = db.prepare(
  "UPDATE cells SET claimer_id = NULL, label = NULL, claimed_at = NULL WHERE claimer_id = ?",
);
const take = db.prepare(
  "UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ? WHERE id = ? AND claimer_id IS NULL",
);

export function allTiles(): Tile[] {
  return selectAll.all() as Tile[];
}

// First claim wins. Claiming your own tile again just updates its label;
// claiming a free one releases whatever you held before, in one transaction,
// so nobody is ever seen holding two tiles or none mid-move.
export function claim(tileId: number, claimerId: string, label: string): ClaimResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const holder = (holderOf.get(tileId) as { claimerId: string | null }).claimerId;
    let result: ClaimResult;
    if (holder === claimerId) {
      relabel.run(label, tileId, claimerId);
      result = "claimed";
    } else if (holder !== null) {
      result = "taken";
    } else {
      release.run(claimerId);
      take.run(claimerId, label, new Date().toISOString(), tileId);
      result = "claimed";
    }
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
