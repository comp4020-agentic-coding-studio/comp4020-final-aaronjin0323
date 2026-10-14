import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// The board is N×N, row-major: tile id = row * N + col.
export const N = 12;
export const TILES = N * N;

// A tile whose holder hasn't visited for this long is dormant: still theirs
// and still standing, but anyone may settle there
// (docs/adr/0003-faded-tiles-lift-nobody.md).
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

// A tower that reached height 8, recorded for good (docs/adr/0004). The
// raisers are labels, holder first, then the eight neighbours in board order:
// never a pid, since the row outlives everyone in it and is shown to anyone.
export type Landmark = { cellId: number; label: string; raisers: string[]; raisedAt: string };

// A tile at this height has all 8 neighbours held by people who are around.
export const LANDMARK_HEIGHT = 8;

export type Store = {
  tiles(): Tile[];
  claim(tileId: number, claimerId: string, label: string, now: Date): ClaimResult;
  // Marks a visit. True if it woke the visitor's tile from dormancy.
  touch(claimerId: string, now: Date): boolean;
  // The visitor's pending "someone settled on your tile" notice, read once.
  takeDisplacement(claimerId: string): Displacement | null;
  // Every landmark raised so far, oldest first.
  landmarks(): Landmark[];
  // Records a landmark for every held, non-dormant tile standing at height 8
  // whose cell has never had one, and returns those just recorded. Run after
  // any change that can lift a tower: a claim, a visit, the clock.
  raise(now: Date): Landmark[];
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

  // 3. Crit 10 (week 11): landmarks, docs/adr/0004. Nothing to backfill: a
  // tower already standing at 8 is recorded by the first raise(). One row
  // per cell ever, held by the unique index as well as the code.
  `CREATE TABLE landmarks (
     id        INTEGER PRIMARY KEY,
     cell_id   INTEGER,
     label     TEXT,
     raisers   TEXT,
     raised_at TEXT
   );
   CREATE UNIQUE INDEX one_landmark_each ON landmarks(cell_id);`,
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
  // Prepared on first use: tests open stores by the thousand and most never
  // look at a landmark. OR IGNORE on the unique cell: a tower that drops and
  // reaches 8 again records nothing new.
  const lazy = (sql: string) => {
    let stmt: ReturnType<DatabaseSync["prepare"]> | undefined;
    return () => (stmt ??= db.prepare(sql));
  };
  const selectLandmarks = lazy(
    "SELECT cell_id AS cellId, label, raisers, raised_at AS raisedAt FROM landmarks ORDER BY id",
  );
  const recordLandmark = lazy(
    "INSERT OR IGNORE INTO landmarks (cell_id, label, raisers, raised_at) VALUES (?, ?, ?, ?)",
  );

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

    landmarks: () =>
      (selectLandmarks().all() as { cellId: number; label: string; raisers: string; raisedAt: string }[]).map((r) => ({
        cellId: r.cellId,
        label: r.label,
        raisers: JSON.parse(r.raisers) as string[],
        raisedAt: r.raisedAt,
      })),

    // Not inside claim() and touch(): a claim stays three statements, which
    // the page's preview test makes by the hundred thousand. The server runs
    // this straight after every change, in the same synchronous turn, so no
    // other request can come between the two. Heights are heights(tiles,
    // now)'s rule: a tile's claimed, non-dormant neighbours, so a faded
    // neighbour lifts nobody, and a faded holder isn't around to raise one.
    raise(now) {
      const tiles = selectAll.all() as Tile[];
      const around = (t: Tile | undefined): t is Tile => t !== undefined && t.claimerId !== null && !isDormant(t, now);
      const raised: Landmark[] = [];
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const tile of tiles) {
          if (!around(tile)) continue;
          const row = Math.floor(tile.id / N);
          const col = tile.id % N;
          const neighbours: Tile[] = [];
          for (let r = row - 1; r <= row + 1; r++) {
            for (let c = col - 1; c <= col + 1; c++) {
              if ((r === row && c === col) || r < 0 || r >= N || c < 0 || c >= N) continue;
              if (around(tiles[r * N + c])) neighbours.push(tiles[r * N + c]);
            }
          }
          if (neighbours.length < LANDMARK_HEIGHT) continue;
          const landmark: Landmark = {
            cellId: tile.id,
            label: tile.label ?? "",
            raisers: [tile, ...neighbours].map((t) => t.label ?? ""),
            raisedAt: now.toISOString(),
          };
          const added = recordLandmark().run(tile.id, landmark.label, JSON.stringify(landmark.raisers), landmark.raisedAt);
          if (Number(added.changes) === 1) raised.push(landmark);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return raised;
    },

    close: () => db.close(),
  };
}
