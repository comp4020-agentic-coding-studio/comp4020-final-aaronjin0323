import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// The board is N×N, row-major: tile id = row * N + col.
export const N = 12;
export const TILES = N * N;

// A tile whose holder hasn't visited for this long is dormant: still theirs
// and still standing, but anyone may settle there
// (docs/adr/0001-dormant-tiles.md).
export const DORMANT_AFTER_MS = 24 * 60 * 60 * 1000;

export type Tile = {
  id: number;
  claimerId: string | null;
  label: string | null;
  claimedAt: string | null;
  lastSeenAt: string | null;
};

export type ClaimResult = "claimed" | "taken";

export type Displacement = { label: string; cellId: number; displacedAt: string };

export type Store = {
  tiles(): Tile[];
  claim(tileId: number, claimerId: string, label: string, now: Date): ClaimResult;
  // Marks a visit. True if it woke the visitor's tile from dormancy.
  touch(claimerId: string, now: Date): boolean;
  // The visitor's pending "someone settled on your tile" notice, read once.
  takeDisplacement(claimerId: string): Displacement | null;
  close(): void;
};

// Timestamps are toISOString() output, which sorts as text in time order,
// so SQL compares them directly.
const cutoff = (now: Date): string => new Date(now.getTime() - DORMANT_AFTER_MS).toISOString();

// Mirrors the SQL test `last_seen_at < cutoff`, NULL included.
export const isDormant = (tile: Tile, now: Date): boolean =>
  tile.claimerId !== null && tile.lastSeenAt !== null && tile.lastSeenAt < cutoff(now);

// Each step runs once, in order, in its own transaction, and PRAGMA
// user_version records how many have run. Production holds real claims, so a
// step runs against whatever is there, never an empty file. Never edit a
// committed step: add a new one.
const MIGRATIONS = [
  // 1. Crit 8's schema. IF NOT EXISTS because crit 8 created it without
  // recording a version, so production arrives here at version 0 with the
  // table already in place.
  `CREATE TABLE IF NOT EXISTS cells (
     id         INTEGER PRIMARY KEY,
     claimer_id TEXT,
     label      TEXT,
     claimed_at TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS one_tile_each ON cells(claimer_id)
     WHERE claimer_id IS NOT NULL;`,

  // 2. Crit 9: dormancy and displacement. Existing claims count as last seen
  // when they were made.
  `ALTER TABLE cells ADD COLUMN last_seen_at TEXT;
   UPDATE cells SET last_seen_at = claimed_at WHERE claimer_id IS NOT NULL;
   CREATE TABLE displaced (
     claimer_id   TEXT PRIMARY KEY,
     label        TEXT NOT NULL,
     cell_id      INTEGER NOT NULL,
     displaced_at TEXT NOT NULL
   );`,
];

function migrate(db: DatabaseSync): void {
  const { user_version: from } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (from > MIGRATIONS.length) {
    throw new Error(`database is at version ${from}, but this code only knows ${MIGRATIONS.length}`);
  }
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);

  // Every tile exists as a row, so a claim is always an UPDATE.
  const seed = db.prepare("INSERT OR IGNORE INTO cells (id) VALUES (?)");
  for (let id = 0; id < TILES; id++) seed.run(id);

  const selectAll = db.prepare(
    `SELECT id, claimer_id AS claimerId, label, claimed_at AS claimedAt, last_seen_at AS lastSeenAt
     FROM cells ORDER BY id`,
  );
  const holderOf = db.prepare(
    "SELECT claimer_id AS claimerId, label, last_seen_at AS lastSeenAt FROM cells WHERE id = ?",
  );
  const relabel = db.prepare("UPDATE cells SET label = ?, last_seen_at = ? WHERE id = ? AND claimer_id = ?");
  const release = db.prepare(
    "UPDATE cells SET claimer_id = NULL, label = NULL, claimed_at = NULL, last_seen_at = NULL WHERE claimer_id = ?",
  );
  // Free, or dormant: the WHERE is the rule, and its change count says
  // whether this claim won.
  const take = db.prepare(
    `UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, last_seen_at = ?
     WHERE id = ? AND (claimer_id IS NULL OR last_seen_at < ?)`,
  );
  const recordDisplaced = db.prepare(
    "INSERT OR REPLACE INTO displaced (claimer_id, label, cell_id, displaced_at) VALUES (?, ?, ?, ?)",
  );
  const lastSeenOf = db.prepare("SELECT last_seen_at AS lastSeenAt FROM cells WHERE claimer_id = ?");
  const markSeen = db.prepare("UPDATE cells SET last_seen_at = ? WHERE claimer_id = ?");
  const displacementOf = db.prepare(
    "SELECT label, cell_id AS cellId, displaced_at AS displacedAt FROM displaced WHERE claimer_id = ?",
  );
  const forget = db.prepare("DELETE FROM displaced WHERE claimer_id = ?");

  type Holder = { claimerId: string | null; label: string | null; lastSeenAt: string | null };

  return {
    tiles: () => selectAll.all() as Tile[],

    // First claim wins, and a dormant tile counts as open. Claiming your own
    // tile again updates its label; claiming another releases yours in the
    // same transaction, so nobody is ever seen holding two tiles or none
    // mid-move. Settling on a dormant tile leaves its holder a notice.
    claim(tileId, claimerId, label, now) {
      const at = now.toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const holder = holderOf.get(tileId) as Holder;
        if (holder.claimerId === claimerId) {
          relabel.run(label, at, tileId, claimerId);
          db.exec("COMMIT");
          return "claimed";
        }
        release.run(claimerId);
        const won = Number(take.run(claimerId, label, at, at, tileId, cutoff(now)).changes) === 1;
        if (!won) {
          db.exec("ROLLBACK");
          return "taken";
        }
        if (holder.claimerId !== null) {
          recordDisplaced.run(holder.claimerId, holder.label ?? "", tileId, at);
        }
        db.exec("COMMIT");
        return "claimed";
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    touch(claimerId, now) {
      const row = lastSeenOf.get(claimerId) as { lastSeenAt: string | null } | undefined;
      if (!row) return false;
      markSeen.run(now.toISOString(), claimerId);
      return row.lastSeenAt !== null && row.lastSeenAt < cutoff(now);
    },

    takeDisplacement(claimerId) {
      const row = displacementOf.get(claimerId) as Displacement | undefined;
      if (!row) return null;
      forget.run(claimerId);
      return { label: row.label, cellId: row.cellId, displacedAt: row.displacedAt };
    },

    close: () => db.close(),
  };
}
