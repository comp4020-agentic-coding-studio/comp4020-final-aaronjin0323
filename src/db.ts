import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  accrue,
  buildingName,
  HELP_COOLDOWN_MS,
  HELP_GIFT,
  HELP_REWARD,
  LEASE_MS,
  MAX_LEVEL,
  rate,
  RELOCATE_COOLDOWN_MS,
  RELOCATE_COST,
  renewal,
  renewOptions,
  STARTING_COINS,
  upgradeCost,
  WELCOME_AFTER_MS,
} from "./economy.ts";

// The board is N×N, row-major: tile id = row * N + col.
export const N = 12;
export const TILES = N * N;

// A plot as stored. A plot is held while `claimerId` is set and its lease
// hasn't ended; one whose lease has ended is free on every read (isActive),
// whether or not settle() has cleared the row yet (docs/adr/0005).
export type Tile = {
  id: number;
  claimerId: string | null;
  label: string | null;
  claimedAt: string | null;
  level: number | null;
  leaseEndsAt: string | null;
  ownedSince: string | null;
  pendingCents: number;
  settledAt: string | null;
};

// A tower with all 8 neighbours occupied, recorded for good (docs/adr/0004,
// as amended by ADR 5). The raisers are labels, holder first, then the eight
// neighbours in board order: never a pid, since the row outlives everyone in
// it and is shown to anyone.
export type Landmark = { cellId: number; label: string; raisers: string[]; raisedAt: string };

// Occupied neighbours a building needs to be a landmark.
export const LANDMARK_NEIGHBOURS = 8;

// A public line in the city log. No pid, ever.
export type CityEvent = { id: number; type: string; text: string; cellId: number | null; at: string };

// A lease that ended, as settle() found it: for the server to log.
export type Expiry = { cellId: number; pid: string; label: string; at: string; pendingCents: number };

// Your own wallet and building, as only your page is sent it. Money is
// coins, except `pending` and `rate`, which are hundredths of a coin (rate a
// minute). `pending` is everything a collect would pay: your building's
// uncollected income plus any left from an ended lease.
export type Me = {
  coins: number;
  pending: number;
  rate: number;
  cellId: number | null;
  level: number | null;
  leaseEndsAt: string | null;
  ownedSince: string | null;
  relocateAt: string | null; // when you may move again; null if you never have
  helpAt: string | null; // when you may help again; null if you never have
};

// What a visit tells you once: coins your building earned while you were
// away, and that your lease ended since you were last here.
export type Visit = { welcome: number | null; expired: boolean };

export type ClaimResult = "claimed" | "moved" | "renamed" | "taken" | "coins" | "cooldown";
export type CollectResult = { paid: number };
export type UpgradeResult = "upgraded" | "no-land" | "max-level" | "coins";
export type RenewResult = "renewed" | "hours" | "no-land" | "max-lease" | "coins";
export type HelpResult = "helped" | "no-land" | "not-neighbour" | "cooldown";

export type Store = {
  // Every row, as stored. Use isActive(tile, now) for whether it's held.
  tiles(): Tile[];
  // Settles every building's income up to `now` and frees every plot whose
  // lease ended by then (docs/adr/0005). Every action below runs it first, in
  // its own transaction; the sweep runs it on its own.
  settle(now: Date): void;
  // Leases settle() has ended since the last call, oldest first.
  takeExpired(): Expiry[];
  // A free plot when you hold none (free); your own plot again (a rename);
  // or a move when you hold land (RELOCATE_COST, cooldown).
  claim(tileId: number, pid: string, label: string, now: Date): ClaimResult;
  collect(pid: string, now: Date): CollectResult;
  upgrade(pid: string, now: Date): UpgradeResult;
  renew(pid: string, hours: number, now: Date): RenewResult;
  help(pid: string, cellId: number, now: Date): HelpResult;
  // Your wallet as of `now`, income counted to the minute without writing.
  me(pid: string, now: Date): Me;
  // A visit: returns the once-only notices and marks you seen.
  visit(pid: string, now: Date): Visit;
  // Marks you seen without telling you anything (your page is open).
  seen(pid: string, now: Date): void;
  // The name on your wallet, if you have one.
  label(pid: string): string | null;
  // The latest `limit` public events, newest first.
  events(limit: number): CityEvent[];
  landmarks(): Landmark[];
  // Records a landmark for every held building with all 8 neighbours
  // occupied whose cell has never had one, and returns those just recorded.
  raise(now: Date): Landmark[];
  close(): void;
};

// Timestamps are toISOString() output (and strftime('%Y-%m-%dT%H:%M:%fZ') in
// migration 4, the same shape), which sorts as text in time order.
const iso = (ms: number): string => new Date(ms).toISOString();

export const isActive = (t: Tile, now: Date): boolean =>
  t.claimerId !== null && t.leaseEndsAt !== null && t.leaseEndsAt > now.toISOString();

// 8-neighbours: one step in any direction, never wrapping round an edge.
export function neighbourIds(id: number): number[] {
  const row = Math.floor(id / N);
  const col = id % N;
  const out: number[] = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if ((r !== row || c !== col) && r >= 0 && r < N && c >= 0 && c < N) out.push(r * N + c);
    }
  }
  return out;
}
export const adjacent = (a: number, b: number): boolean =>
  a !== b && Math.abs(Math.floor(a / N) - Math.floor(b / N)) <= 1 && Math.abs((a % N) - (b % N)) <= 1;

// "row 3, column 5", as the page says it. The city log uses the same.
export const place = (id: number): string => `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;

// --- income, integrated piecewise ---

type Building = { id: number; pid: string; label: string; level: number; end: number; pending: number; settled: number };
type Projection = {
  pending: Map<number, number>; // still standing at `now`
  expired: (Expiry & { endMs: number })[];
  earned: Map<string, number>; // cents earned per pid over the interval
};

// Every building's income from its settled_at up to `now`. Rates depend on
// who is next to whom, and that changes only when a lease ends, so the time
// is cut at each lease end in (settled_at, now]: each piece is earned at the
// rates that held over it, then the leases ending there are let go. A
// building stops earning at its own lease end and at the 4-hour cap. Pure:
// the caller writes the result (settle) or only reads it (me).
export function integrate(buildings: Building[], now: number): Projection {
  const live = new Map(buildings.map((b) => [b.id, b]));
  const pending = new Map(buildings.map((b) => [b.id, b.pending]));
  const earned = new Map<string, number>();
  const expired: Projection["expired"] = [];
  if (buildings.length === 0) return { pending, expired, earned };

  // Lets go of every lease ended at or before `x` (a lease ending exactly
  // now has ended), in the order they ended.
  const endBy = (x: number): void => {
    for (const b of [...live.values()].filter((b) => b.end <= x).sort((p, q) => p.end - q.end || p.id - q.id)) {
      live.delete(b.id);
      expired.push({ cellId: b.id, pid: b.pid, label: b.label, at: iso(b.end), endMs: b.end, pendingCents: pending.get(b.id)! });
      pending.delete(b.id);
    }
  };
  let t = Math.min(...buildings.map((b) => b.settled));
  endBy(t);
  const cuts = [...new Set(buildings.map((b) => b.end).filter((e) => e > t && e < now)), now].sort((a, b) => a - b);
  for (const cut of cuts) {
    if (cut > t) {
      // Over [t, cut] nobody arrives or leaves, so every rate is fixed.
      for (const b of live.values()) {
        const from = Math.max(t, b.settled);
        if (from >= cut) continue;
        const n = neighbourIds(b.id).filter((id) => live.has(id)).length;
        const before = pending.get(b.id)!;
        const after = accrue(before, rate(b.level, n), cut - from);
        pending.set(b.id, after);
        earned.set(b.pid, (earned.get(b.pid) ?? 0) + after - before);
      }
      t = cut;
    }
    endBy(cut);
  }
  return { pending, expired, earned };
}

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

  // 4. The city economy, docs/adr/0005. Players get wallets, plots get a
  // building and a lease, and a public city log begins.
  //
  // Live data: every plot held when this runs becomes a level-1 building
  // whose ownership, settlement and 24-hour lease start now, so nobody loses
  // a plot on deploy (a tile that was dormant is simply held again). Each
  // holder gets a wallet of 100 coins under their label. The numbers here are
  // written out, not read from src/economy.ts: this step is a record of what
  // was done once, and must not change if the game's numbers do.
  //
  // Kept but unused from here on, rather than dropped: cells.last_seen_at
  // (dormancy is gone; nothing reads or writes it) and the displaced table
  // (nobody is displaced any more). Dropping either gains nothing and would
  // lose history from production.
  //
  // players: earned_cents counts every cent a building ever earned its
  // owner, and seen_at/seen_earned_cents what it was when they were last
  // here, so a visit can say what they earned while away. lease_lost_at is
  // set when a lease ends and cleared once they've been told.
  `CREATE TABLE players (
     pid               TEXT PRIMARY KEY,
     label             TEXT,
     coins             INTEGER NOT NULL DEFAULT 100 CHECK (coins >= 0),
     unclaimed_cents   INTEGER NOT NULL DEFAULT 0 CHECK (unclaimed_cents >= 0),
     created_at        TEXT,
     last_relocated_at TEXT,
     last_helped_at    TEXT,
     earned_cents      INTEGER NOT NULL DEFAULT 0,
     seen_at           TEXT,
     seen_earned_cents INTEGER NOT NULL DEFAULT 0,
     lease_lost_at     TEXT
   );
   ALTER TABLE cells ADD COLUMN level INTEGER;
   ALTER TABLE cells ADD COLUMN lease_ends_at TEXT;
   ALTER TABLE cells ADD COLUMN owned_since TEXT;
   ALTER TABLE cells ADD COLUMN pending_cents INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE cells ADD COLUMN settled_at TEXT;
   CREATE TABLE events (
     id      INTEGER PRIMARY KEY,
     type    TEXT,
     text    TEXT,
     cell_id INTEGER,
     at      TEXT
   );
   UPDATE cells SET
     level = 1,
     owned_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     lease_ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours'),
     pending_cents = 0
   WHERE claimer_id IS NOT NULL;
   INSERT OR IGNORE INTO players (pid, label, coins, created_at, seen_at)
     SELECT claimer_id, label, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     FROM cells WHERE claimer_id IS NOT NULL;`,
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

type PlayerRow = {
  pid: string;
  label: string | null;
  coins: number;
  unclaimedCents: number;
  lastRelocatedAt: string | null;
  lastHelpedAt: string | null;
  earnedCents: number;
  seenAt: string | null;
  seenEarnedCents: number;
  leaseLostAt: string | null;
};

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);

  // Every tile exists as a row, so a claim is always an UPDATE.
  const seed = db.prepare("INSERT OR IGNORE INTO cells (id) VALUES (?)");
  for (let id = 0; id < TILES; id++) seed.run(id);

  // Prepared on first use: tests open stores by the thousand and most never
  // use most of these.
  const lazy = (sql: string) => {
    let stmt: ReturnType<DatabaseSync["prepare"]> | undefined;
    return () => (stmt ??= db.prepare(sql));
  };

  const COLUMNS = `id, claimer_id AS claimerId, label, claimed_at AS claimedAt, level,
    lease_ends_at AS leaseEndsAt, owned_since AS ownedSince, pending_cents AS pendingCents, settled_at AS settledAt`;
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM cells ORDER BY id`);
  const selectHeld = lazy(`SELECT ${COLUMNS} FROM cells WHERE claimer_id IS NOT NULL ORDER BY id`);
  const selectCell = db.prepare(`SELECT ${COLUMNS} FROM cells WHERE id = ?`);
  const selectMine = db.prepare(`SELECT ${COLUMNS} FROM cells WHERE claimer_id = ?`);
  // Nothing to settle: no time has passed for anyone and no lease has ended.
  // Checked first, so claims made all at one moment (the page's preview tests
  // make them by the hundred thousand) stay cheap.
  const settleBounds = db.prepare(
    "SELECT MIN(settled_at) AS settled, MIN(lease_ends_at) AS ends, COUNT(*) AS held FROM cells WHERE claimer_id IS NOT NULL",
  );
  const writePending = lazy("UPDATE cells SET pending_cents = ?, settled_at = ? WHERE id = ?");
  const free = db.prepare(
    `UPDATE cells SET claimer_id = NULL, label = NULL, claimed_at = NULL, last_seen_at = NULL, level = NULL,
       lease_ends_at = NULL, owned_since = NULL, pending_cents = 0, settled_at = NULL WHERE id = ?`,
  );
  // The WHERE is the rule: a plot nobody holds (settle() has already freed
  // every ended lease), and its change count says whether this claim won.
  const take = db.prepare(
    `UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, level = ?, lease_ends_at = ?, owned_since = ?,
       pending_cents = ?, settled_at = ? WHERE id = ? AND claimer_id IS NULL`,
  );
  const relabelCell = db.prepare("UPDATE cells SET label = ? WHERE claimer_id = ?");
  const setLevel = lazy("UPDATE cells SET level = ? WHERE id = ?");
  const setLease = lazy("UPDATE cells SET lease_ends_at = ? WHERE id = ?");
  const zeroPending = lazy("UPDATE cells SET pending_cents = 0 WHERE id = ?");

  const PLAYER = `pid, label, coins, unclaimed_cents AS unclaimedCents, last_relocated_at AS lastRelocatedAt,
    last_helped_at AS lastHelpedAt, earned_cents AS earnedCents, seen_at AS seenAt,
    seen_earned_cents AS seenEarnedCents, lease_lost_at AS leaseLostAt`;
  const selectPlayer = db.prepare(`SELECT ${PLAYER} FROM players WHERE pid = ?`);
  // A player is a row from their first action on, with the starting coins.
  // A label typed with a claim is kept on the wallet too.
  const upsertPlayer = db.prepare(
    `INSERT INTO players (pid, label, coins, created_at, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(pid) DO UPDATE SET label = COALESCE(excluded.label, players.label)`,
  );
  const addCoins = lazy("UPDATE players SET coins = coins + ? WHERE pid = ?");
  const loseLease = lazy(
    "UPDATE players SET unclaimed_cents = unclaimed_cents + ?, lease_lost_at = ? WHERE pid = ?",
  );
  const addEarned = lazy("UPDATE players SET earned_cents = earned_cents + ? WHERE pid = ?");
  const payOut = lazy("UPDATE players SET coins = coins + ?, unclaimed_cents = ? WHERE pid = ?");
  const relocated = lazy("UPDATE players SET coins = coins - ?, last_relocated_at = ? WHERE pid = ?");
  const helped = lazy("UPDATE players SET coins = coins + ?, last_helped_at = ? WHERE pid = ?");
  const clearLost = lazy("UPDATE players SET lease_lost_at = NULL WHERE pid = ?");
  const markSeen = lazy(
    "UPDATE players SET seen_at = ?, seen_earned_cents = earned_cents, lease_lost_at = NULL WHERE pid = ?",
  );

  const insertEvent = db.prepare("INSERT INTO events (type, text, cell_id, at) VALUES (?, ?, ?, ?)");
  const selectEvents = lazy(
    "SELECT id, type, text, cell_id AS cellId, at FROM events ORDER BY at DESC, id DESC LIMIT ?",
  );

  const selectLandmarks = lazy(
    "SELECT cell_id AS cellId, label, raisers, raised_at AS raisedAt FROM landmarks ORDER BY id",
  );
  // OR IGNORE on the unique cell: a tower that drops and fills again records
  // nothing new.
  const recordLandmark = lazy(
    "INSERT OR IGNORE INTO landmarks (cell_id, label, raisers, raised_at) VALUES (?, ?, ?, ?)",
  );

  let expiredSince: Expiry[] = [];

  const buildingsOf = (rows: Tile[]): Building[] =>
    rows.map((t) => ({
      id: t.id,
      pid: t.claimerId!,
      label: t.label ?? "",
      level: t.level ?? 1,
      // a held row with no lease (none should exist after migration 4) has ended
      end: t.leaseEndsAt ? Date.parse(t.leaseEndsAt) : 0,
      pending: t.pendingCents,
      settled: t.settledAt ? Date.parse(t.settledAt) : t.leaseEndsAt ? Date.parse(t.leaseEndsAt) : 0,
    }));

  // In a transaction the caller holds.
  function settleIn(now: Date): void {
    const ms = now.getTime();
    const b = settleBounds.get() as { settled: string | null; ends: string | null; held: number };
    if (b.held === 0) return;
    if (b.settled !== null && Date.parse(b.settled) >= ms && b.ends !== null && Date.parse(b.ends) > ms) return;

    const held = buildingsOf(selectHeld().all() as Tile[]);
    const p = integrate(held, ms);
    // settled_at never moves backwards, even for a clock that does
    const settled = new Map(held.map((h) => [h.id, h.settled]));
    for (const [id, cents] of p.pending) writePending().run(cents, iso(Math.max(ms, settled.get(id)!)), id);
    for (const [pid, cents] of p.earned) if (cents > 0) addEarned().run(cents, pid);
    for (const e of p.expired) {
      free.run(e.cellId);
      upsertPlayer.run(e.pid, e.label, STARTING_COINS, e.at, e.at);
      loseLease().run(e.pendingCents, e.at, e.pid);
      insertEvent.run("expire", `${e.label}'s lease ended at ${place(e.cellId)}`, e.cellId, e.at);
      expiredSince.push({ cellId: e.cellId, pid: e.pid, label: e.label, at: e.at, pendingCents: e.pendingCents });
    }
  }

  // One BEGIN IMMEDIATE per action: settle, check, change. A refusal still
  // commits the settlement (it's true either way) but changes nothing else.
  function tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const ensure = (pid: string, label: string | null, now: Date): void => {
    const at = now.toISOString();
    upsertPlayer.run(pid, label, STARTING_COINS, at, at);
  };
  const playerOf = (pid: string): PlayerRow | undefined => selectPlayer.get(pid) as PlayerRow | undefined;
  const mineOf = (pid: string): Tile | undefined => selectMine.get(pid) as Tile | undefined;
  const label = (pid: string, cell: Tile): string => cell.label ?? playerOf(pid)?.label ?? "";
  const ago = (when: string | null, now: Date): number => (when === null ? Infinity : now.getTime() - Date.parse(when));

  return {
    tiles: () => selectAll.all() as Tile[],

    settle: (now) => tx(() => settleIn(now)),

    takeExpired() {
      const out = expiredSince;
      expiredSince = [];
      return out;
    },

    claim(tileId, pid, newLabel, now) {
      return tx((): ClaimResult => {
        settleIn(now);
        const at = now.toISOString();
        const mine = mineOf(pid);
        if (mine && mine.id === tileId) {
          ensure(pid, newLabel, now);
          relabelCell.run(newLabel, pid);
          return "renamed";
        }
        const target = selectCell.get(tileId) as Tile;
        if (target.claimerId !== null) return "taken";
        ensure(pid, newLabel, now);
        if (!mine) {
          clearLost().run(pid); // they've chosen a new plot, so "your lease ended" is old news
          take.run(pid, newLabel, at, 1, iso(now.getTime() + LEASE_MS), at, 0, at, tileId);
          insertEvent.run("claim", `${newLabel} built a ${buildingName(1)} at ${place(tileId)}`, tileId, at);
          return "claimed";
        }
        // A move: the building goes with you, level, lease, ownership start
        // and uncollected income all kept.
        const player = playerOf(pid)!;
        if (ago(player.lastRelocatedAt, now) < RELOCATE_COOLDOWN_MS) return "cooldown";
        if (player.coins < RELOCATE_COST) return "coins";
        free.run(mine.id);
        take.run(pid, newLabel, mine.claimedAt, mine.level, mine.leaseEndsAt, mine.ownedSince, mine.pendingCents, at, tileId);
        relocated().run(RELOCATE_COST, at, pid);
        insertEvent.run(
          "relocate",
          `${newLabel} moved their ${buildingName(mine.level ?? 1)} to ${place(tileId)}`,
          tileId,
          at,
        );
        return "moved";
      });
    },

    // Your building's uncollected income plus anything left from an ended
    // lease, paid as whole coins; the leftover hundredths are kept for next
    // time. A second collect straight after pays nothing.
    collect(pid, now) {
      return tx((): CollectResult => {
        settleIn(now);
        const player = playerOf(pid);
        if (!player) return { paid: 0 };
        const mine = mineOf(pid);
        const total = (mine?.pendingCents ?? 0) + player.unclaimedCents;
        const paid = Math.floor(total / 100);
        if (paid === 0) return { paid: 0 };
        if (mine) zeroPending().run(mine.id);
        payOut().run(paid, total % 100, pid);
        return { paid };
      });
    },

    upgrade(pid, now) {
      return tx((): UpgradeResult => {
        settleIn(now);
        const mine = mineOf(pid);
        if (!mine) return "no-land";
        const level = mine.level ?? 1;
        const cost = upgradeCost(level);
        if (cost === null || level >= MAX_LEVEL) return "max-level";
        const player = playerOf(pid);
        if (!player || player.coins < cost) return "coins";
        addCoins().run(-cost, pid);
        setLevel().run(level + 1, mine.id);
        insertEvent.run(
          "upgrade",
          `${label(pid, mine)} upgraded to a ${buildingName(level + 1)} at ${place(mine.id)}`,
          mine.id,
          now.toISOString(),
        );
        return "upgraded";
      });
    },

    renew(pid, hours, now) {
      return tx((): RenewResult => {
        settleIn(now);
        const option = renewal(hours);
        if (!option) return "hours";
        const mine = mineOf(pid);
        if (!mine || !mine.leaseEndsAt || !mine.ownedSince) return "no-land";
        const choice = renewOptions(new Date(mine.leaseEndsAt), new Date(mine.ownedSince)).find((o) => o.hours === hours)!;
        if (!choice.allowed) return "max-lease";
        const player = playerOf(pid);
        if (!player || player.coins < choice.cost) return "coins";
        addCoins().run(-choice.cost, pid);
        setLease().run(choice.endsAt.toISOString(), mine.id);
        insertEvent.run(
          "renew",
          `${label(pid, mine)} renewed their lease at ${place(mine.id)} by ${hours} hours`,
          mine.id,
          now.toISOString(),
        );
        return "renewed";
      });
    },

    help(pid, cellId, now) {
      return tx((): HelpResult => {
        settleIn(now);
        const mine = mineOf(pid);
        if (!mine) return "no-land";
        const them = selectCell.get(cellId) as Tile | undefined;
        if (!them || them.claimerId === null || them.claimerId === pid || !adjacent(mine.id, cellId)) {
          return "not-neighbour";
        }
        const player = playerOf(pid)!;
        if (ago(player.lastHelpedAt, now) < HELP_COOLDOWN_MS) return "cooldown";
        const at = now.toISOString();
        ensure(them.claimerId, them.label, now);
        addCoins().run(HELP_GIFT, them.claimerId);
        helped().run(HELP_REWARD, at, pid);
        insertEvent.run("help", `${label(pid, mine)} helped ${them.label ?? ""} at ${place(cellId)}`, cellId, at);
        return "helped";
      });
    },

    me(pid, now) {
      const player = playerOf(pid);
      const blank: Me = {
        coins: STARTING_COINS,
        pending: 0,
        rate: 0,
        cellId: null,
        level: null,
        leaseEndsAt: null,
        ownedSince: null,
        relocateAt: null,
        helpAt: null,
      };
      if (!player) return blank;
      const held = selectHeld().all() as Tile[];
      const p = integrate(buildingsOf(held), now.getTime());
      const lost = p.expired.filter((e) => e.pid === pid).reduce((sum, e) => sum + e.pendingCents, 0);
      const mine = held.find((t) => t.claimerId === pid && p.pending.has(t.id));
      const live = new Set(p.pending.keys());
      const n = mine ? neighbourIds(mine.id).filter((id) => live.has(id)).length : 0;
      const after = (when: string | null, ms: number): string | null => (when === null ? null : iso(Date.parse(when) + ms));
      return {
        coins: player.coins,
        pending: (mine ? p.pending.get(mine.id)! : 0) + player.unclaimedCents + lost,
        rate: mine ? rate(mine.level ?? 1, n) : 0,
        cellId: mine ? mine.id : null,
        level: mine ? (mine.level ?? 1) : null,
        leaseEndsAt: mine?.leaseEndsAt ?? null,
        ownedSince: mine?.ownedSince ?? null,
        relocateAt: after(player.lastRelocatedAt, RELOCATE_COOLDOWN_MS),
        helpAt: after(player.lastHelpedAt, HELP_COOLDOWN_MS),
      };
    },

    visit(pid, now) {
      return tx((): Visit => {
        settleIn(now);
        const player = playerOf(pid);
        if (!player) return { welcome: null, expired: false };
        const away = ago(player.seenAt, now);
        const coins = Math.floor((player.earnedCents - player.seenEarnedCents) / 100);
        markSeen().run(now.toISOString(), pid);
        return {
          welcome: away >= WELCOME_AFTER_MS && coins > 0 ? coins : null,
          expired: player.leaseLostAt !== null,
        };
      });
    },

    seen(pid, now) {
      tx(() => {
        settleIn(now);
        markSeen().run(now.toISOString(), pid);
      });
    },

    label: (pid) => playerOf(pid)?.label ?? null,

    events: (limit) => selectEvents().all(limit) as CityEvent[],

    landmarks: () =>
      (selectLandmarks().all() as { cellId: number; label: string; raisers: string; raisedAt: string }[]).map((r) => ({
        cellId: r.cellId,
        label: r.label,
        raisers: JSON.parse(r.raisers) as string[],
        raisedAt: r.raisedAt,
      })),

    // Not inside each action: the server runs this straight after every
    // change, in the same synchronous turn, so no other request can come
    // between the two. A building counts as occupied while its lease runs.
    raise(now) {
      const tiles = selectAll.all() as Tile[];
      const around = (t: Tile | undefined): t is Tile => t !== undefined && isActive(t, now);
      const raised: Landmark[] = [];
      return tx(() => {
        for (const tile of tiles) {
          if (!around(tile)) continue;
          const neighbours = neighbourIds(tile.id).map((id) => tiles[id]).filter(around);
          if (neighbours.length < LANDMARK_NEIGHBOURS) continue;
          const landmark: Landmark = {
            cellId: tile.id,
            label: tile.label ?? "",
            raisers: [tile, ...neighbours].map((t) => t.label ?? ""),
            raisedAt: now.toISOString(),
          };
          const added = recordLandmark().run(tile.id, landmark.label, JSON.stringify(landmark.raisers), landmark.raisedAt);
          if (Number(added.changes) === 1) raised.push(landmark);
        }
        return raised;
      });
    },

    close: () => db.close(),
  };
}
