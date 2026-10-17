import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { heights } from "../src/board.ts";
import { isActive, type Landmark, N, openStore, TILES, type Store } from "../src/db.ts";
import { LANDMARK_TIERS, LEASE_MS } from "../src/economy.ts";

// The store on its own, with a clock the test controls: a lease needs a day
// to end and the migration needs a crit-8 database, and neither can be
// arranged over HTTP against a running app. The economy itself (income,
// upgrades, moves, renewals, help, migration 4) is in economy.test.ts.
const T0 = new Date("2026-10-01T10:00:00.000Z");
const later = (ms: number): Date => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;

const ALICE = "alice-pid";
const BOB = "bob-pid";

const opened: Store[] = [];
const memory = (): Store => {
  const s = openStore(":memory:");
  opened.push(s);
  return s;
};
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

const holder = (s: Store, id: number): string | null => s.tiles()[id].claimerId;

describe("migration from crit 8", () => {
  it("upgrades a crit-8 database in place, keeping every claim", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what crit 8 created: the table and index, no user_version.
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE cells (id INTEGER PRIMARY KEY, claimer_id TEXT, label TEXT, claimed_at TEXT);
        CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      old.prepare("UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ? WHERE id = ?").run(
        ALICE,
        "Alice",
        T0.toISOString(),
        42,
      );
      old.close();

      const s = openStore(path);
      opened.push(s);
      const tiles = s.tiles();
      expect(tiles).toHaveLength(TILES);
      // kept, as a level-1 building on a fresh lease (migration 4)
      expect(tiles[42]).toMatchObject({ claimerId: ALICE, label: "Alice", level: 1 });
      expect(isActive(tiles[42], new Date())).toBe(true);
      expect(tiles.filter((t) => t.claimerId !== null)).toHaveLength(1);
      s.close();
      opened.pop();

      // Opening again runs nothing twice.
      const again = openStore(path);
      opened.push(again);
      expect(again.tiles()[42].claimerId).toBe(ALICE);
      const v = new DatabaseSync(path);
      // every step since, too: crit 8 straight to the latest
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(8);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Replaced by ADR 5: the "dormancy" and "displacement" tests went with
// dormant tiles. A lease ending on the clock is held in economy.test.ts
// ("leases ending"), and here for claims:
describe("a lease ending", () => {
  it("keeps a plot for the whole lease, and frees it at the end for anyone", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    expect(s.claim(5, BOB, "Bob", later(LEASE_MS - 1))).toBe("taken");
    expect(holder(s, 5)).toBe(ALICE);
    expect(s.claim(5, BOB, "Bob", later(LEASE_MS))).toBe("claimed");
    expect(holder(s, 5)).toBe(BOB);
  });

  it("leaves the old holder free to claim again, for nothing, with no cooldown", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    expect(s.claim(7, ALICE, "Alice", later(LEASE_MS + HOUR))).toBe("claimed");
    expect(s.tiles().filter((t) => t.claimerId === ALICE).map((t) => t.id)).toEqual([7]);
    expect(s.me(ALICE, later(LEASE_MS + HOUR)).coins).toBe(100);
  });
});

describe("a lost claim changes nothing", () => {
  it("keeps the loser's own tile when their move is refused", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.claim(9, BOB, "Bob", T0);
    expect(s.claim(5, BOB, "Bob", later(HOUR))).toBe("taken");
    expect(holder(s, 9)).toBe(BOB);
  });
});

// docs/adr/0004, as ADR 5 counts it and ADR 6 tiers it: a building with all
// 8 neighbours occupied earns gold, recorded once and kept (bronze at 3 and
// silver at 5 are held below). A 3x3 block of nine people round an interior
// centre.
const cell = (r: number, c: number): number => r * N + c;
const block = (r: number, c: number): number[] => {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(cell(r + dr, c + dc));
  return out;
};
const pidAt = (id: number): string => `p${id}`;
const nameAt = (id: number): string => `N${id}`;
// Claims each tile for its own person, then looks for landmarks, as the
// server does after every change; returns the cells raised to gold along the
// way (every tier: `tiersOf`).
const golds = (ls: Landmark[]): Landmark[] => ls.filter((l) => l.tier === "gold");
const fill = (s: Store, ids: number[], at: Date): number[] => {
  const raised: number[] = [];
  for (const id of ids) {
    expect(s.claim(id, pidAt(id), nameAt(id), at)).toBe("claimed");
    raised.push(...golds(s.raise(at)).map((l) => l.cellId));
  }
  return raised;
};
const tiersOf = (ls: Landmark[], id: number): string[] => ls.filter((l) => l.cellId === id).map((l) => l.tier);

describe("landmarks", () => {
  it("records exactly one when a building's 8th neighbour arrives, naming the holder first and the eight round it, by label", () => {
    const s = memory();
    const centre = cell(5, 5);
    const ring = block(5, 5).filter((id) => id !== centre);
    expect(fill(s, [centre, ...ring.slice(0, 7)], T0)).toEqual([]);
    expect(golds(s.landmarks())).toEqual([]);

    expect(s.claim(ring[7], pidAt(ring[7]), nameAt(ring[7]), later(1000))).toBe("claimed"); // the eighth neighbour
    const expected = {
      cellId: centre,
      tier: "gold",
      label: nameAt(centre),
      raisers: [centre, ...ring].map(nameAt),
      raisedAt: later(1000).toISOString(),
    };
    // returned once, for the server to announce, and kept
    expect(golds(s.raise(later(1000)))).toEqual([expected]);
    expect(s.raise(later(2000))).toEqual([]);
    expect(golds(s.landmarks())).toEqual([expected]);
    expect(JSON.stringify(s.landmarks())).not.toMatch(/"p\d+"/); // labels, never a pid
  });

  it("doesn't record a second when the same building loses a neighbour and fills again", () => {
    const s = memory();
    const centre = cell(5, 5);
    expect(fill(s, block(5, 5), T0)).toEqual([centre]);
    const corner = cell(4, 4);
    const away = later(1000);
    const back = later(31 * 60 * 1000); // past the 30-minute moving cooldown
    expect(s.claim(cell(9, 9), pidAt(corner), nameAt(corner), away)).toBe("moved"); // 7 neighbours
    expect(heights(s.tiles(), away)[centre]).toBe(1 + 7);
    expect(s.raise(away)).toEqual([]);
    expect(s.claim(corner, pidAt(corner), nameAt(corner), back)).toBe("moved"); // and back: 8
    expect(heights(s.tiles(), back)[centre]).toBe(1 + 8);
    expect(s.raise(back)).toEqual([]);
    expect(golds(s.landmarks())).toHaveLength(1);
    expect(golds(s.landmarks()).map((l) => l.raisedAt)).toEqual([T0.toISOString()]);
  });

  it("doesn't count a neighbour whose lease has ended, and records it once someone settles there", () => {
    const s = memory();
    const centre = cell(5, 5);
    const gone = cell(4, 4);
    fill(s, [gone], T0);
    const now = later(LEASE_MS); // the first neighbour's lease has just ended
    expect(fill(s, block(5, 5).filter((id) => id !== gone), now)).toEqual([]);
    expect(heights(s.tiles(), now)[centre]).toBe(1 + 7);
    expect(s.claim(gone, "newcomer", "New", later(LEASE_MS + 1000))).toBe("claimed");
    expect(golds(s.raise(later(LEASE_MS + 1000))).map((l) => l.cellId)).toEqual([centre]);
  });

  it("doesn't raise a building whose own lease has ended, even with eight round it", () => {
    const s = memory();
    const centre = cell(5, 5);
    fill(s, [centre], T0);
    const now = later(LEASE_MS);
    fill(s, block(5, 5).filter((id) => id !== centre), now);
    expect(heights(s.tiles(), now)[centre]).toBe(0); // it's free now
    expect(tiersOf(s.landmarks(), centre)).toEqual([]);
  });

  it("can never raise gold on an edge or a corner: they have 5 and 3 neighbours, so a full board raises only the 100 inside", () => {
    const s = memory();
    fill(s, Array.from({ length: TILES }, (_, i) => i), T0);
    const raised = golds(s.landmarks()).map((l) => l.cellId).sort((a, b) => a - b);
    const inside = Array.from({ length: TILES }, (_, i) => i).filter((i) => {
      const r = Math.floor(i / N);
      const c = i % N;
      return r > 0 && r < N - 1 && c > 0 && c < N - 1;
    });
    expect(inside).toHaveLength(100);
    expect(raised).toEqual(inside);
    // and every cell has exactly the tiers its room allows: a corner bronze,
    // an edge bronze and silver, the inside all three
    const all = s.landmarks();
    expect(tiersOf(all, 0)).toEqual(["bronze"]);
    expect(tiersOf(all, cell(0, 5))).toEqual(["bronze", "silver"]);
    expect(tiersOf(all, cell(5, 5))).toEqual(["bronze", "silver", "gold"]);
    expect(all).toHaveLength(4 * 1 + 40 * 2 + 100 * 3);
  });
});

// docs/adr/0006: bronze at 3 occupied neighbours, silver at 5, gold at 8,
// each (cell, tier) once, lower tiers with a higher one.
describe("landmark tiers", () => {
  const centre = cell(5, 5);
  const ring = block(5, 5).filter((id) => id !== centre);
  const claimAll = (s: Store, ids: number[], at: Date): void => {
    for (const id of ids) expect(s.claim(id, pidAt(id), nameAt(id), at)).toBe("claimed");
  };

  it("records bronze at the 3rd neighbour and silver at the 5th, each once, naming who was there", () => {
    const s = memory();
    claimAll(s, [centre, ring[0], ring[1]], T0);
    expect(tiersOf(s.raise(T0), centre)).toEqual([]);
    claimAll(s, [ring[2]], later(1000));
    const bronze = s.raise(later(1000)).filter((l) => l.cellId === centre);
    expect(bronze).toEqual([
      { cellId: centre, tier: "bronze", label: nameAt(centre), raisers: [centre, ...ring.slice(0, 3)].map(nameAt), raisedAt: later(1000).toISOString() },
    ]);
    claimAll(s, [ring[3]], later(2000));
    expect(tiersOf(s.raise(later(2000)), centre)).toEqual([]);
    claimAll(s, [ring[4]], later(3000));
    expect(tiersOf(s.raise(later(3000)), centre)).toEqual(["silver"]);
    expect(tiersOf(s.landmarks(), centre)).toEqual(["bronze", "silver"]);
    expect(s.raise(later(4000))).toEqual([]);
  });

  it("records every lower tier with it when a tower is found already at 8, lowest first", () => {
    const s = memory();
    claimAll(s, block(5, 5), T0); // no raise between claims, as at boot
    const raised = s.raise(T0).filter((l) => l.cellId === centre);
    expect(raised.map((l) => l.tier)).toEqual(["bronze", "silver", "gold"]);
    for (const l of raised) expect(l.raisers).toHaveLength(9); // who was there when it was found
    expect(s.raise(T0)).toEqual([]);
  });

  it("doesn't record a tier again after dropping below it and climbing back", () => {
    const s = memory();
    claimAll(s, [centre, ...ring.slice(0, 3)], T0);
    expect(tiersOf(s.raise(T0), centre)).toEqual(["bronze"]);
    // the third neighbour moves away: down to 2
    expect(s.claim(cell(10, 10), pidAt(ring[2]), nameAt(ring[2]), later(1000))).toBe("moved");
    expect(tiersOf(s.raise(later(1000)), centre)).toEqual([]);
    expect(tiersOf(s.landmarks(), centre)).toEqual(["bronze"]); // kept, though the tower dropped
    // someone else fills the gap: back to 3, and nothing new
    expect(s.claim(ring[2], "filler", "Filler", later(2000))).toBe("claimed");
    expect(tiersOf(s.raise(later(2000)), centre)).toEqual([]);
    expect(s.landmarks().filter((l) => l.cellId === centre).map((l) => l.raisedAt)).toEqual([T0.toISOString()]);
  });

  it("refuses a second row for the same cell and tier in the database itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      openStore(path).close();
      const v = new DatabaseSync(path);
      const put = v.prepare("INSERT INTO landmarks (cell_id, tier, label, raisers, raised_at) VALUES (?, ?, 'X', '[]', 't')");
      put.run(5, "bronze");
      put.run(5, "silver");
      expect(() => put.run(5, "bronze")).toThrow(/UNIQUE/);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("landmarks agree with heights()", () => {
  it("raises exactly the tiers each held building's occupied neighbours reach, on random dense boards with ended leases", () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let raisedTotal = 0;
    for (let round = 0; round < 40; round++) {
      const s = memory();
      const now = later(LEASE_MS + HOUR);
      const old = new Set<number>();
      for (let id = 0; id < TILES; id++) if (rand() < 0.1) old.add(id);
      // first the leases that will have ended, then everyone else
      for (const id of old) s.claim(id, pidAt(id), nameAt(id), T0);
      for (let id = 0; id < TILES; id++) {
        if (!old.has(id) && rand() < 0.85) s.claim(id, pidAt(id), nameAt(id), now);
      }
      const tiles = s.tiles();
      const hs = heights(tiles, now);
      // each held building, at every tier its occupied neighbours reach
      const expected = tiles
        .filter((t) => isActive(t, now))
        .flatMap((t) =>
          LANDMARK_TIERS.filter((x) => hs[t.id] - (t.level ?? 1) >= x.neighbours).map((x) => `${t.id}:${x.tier}`),
        );
      expect(s.raise(now).map((l) => `${l.cellId}:${l.tier}`)).toEqual(expected);
      raisedTotal += expected.filter((k) => k.endsWith(":gold")).length;
    }
    expect(raisedTotal).toBeGreaterThan(20); // not a pass on empty lists
  });
});

describe("migration 3 (landmarks)", () => {
  it("upgrades a crit-10 database in place, keeping every claim", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what crit 10 held: migrations 1 and 2, user_version 2, with a
      // whole finished tower already standing on it.
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE cells (id INTEGER PRIMARY KEY, claimer_id TEXT, label TEXT, claimed_at TEXT);
        CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL;
        ALTER TABLE cells ADD COLUMN last_seen_at TEXT;
        CREATE TABLE displaced (claimer_id TEXT PRIMARY KEY, label TEXT NOT NULL, cell_id INTEGER NOT NULL, displaced_at TEXT NOT NULL);
        PRAGMA user_version = 2;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const put = old.prepare("UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, last_seen_at = ? WHERE id = ?");
      const tower = block(5, 5);
      for (const id of [...tower, 0]) put.run(pidAt(id), nameAt(id), T0.toISOString(), T0.toISOString(), id);
      old.prepare("INSERT INTO displaced VALUES (?, ?, ?, ?)").run(ALICE, "Alice", 3, T0.toISOString());
      old.close();

      const s = openStore(path);
      opened.push(s);
      const held = s.tiles().filter((t) => t.claimerId !== null);
      expect(held.map((t) => t.id).sort((a, b) => a - b)).toEqual([0, ...tower].sort((a, b) => a - b));
      for (const t of held) expect(t).toMatchObject({ claimerId: pidAt(t.id), label: nameAt(t.id), level: 1 });
      // Nothing is backfilled by the migration itself; the tower standing at
      // 8 is recorded on the first raise (the server calls it at start).
      expect(s.landmarks()).toEqual([]);
      expect(golds(s.raise(new Date())).map((l) => l.cellId)).toEqual([cell(5, 5)]);
      s.close();
      opened.pop();

      const again = openStore(path);
      opened.push(again);
      expect(golds(again.landmarks())).toHaveLength(1);
      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(8);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("migration 5 (landmark tiers) from a version-4 database", () => {
  it("keeps every landmark as gold, writes in its silver and bronze, keeps every plot, and allows one row per (cell, tier)", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what production held after the city economy: migrations 1-4,
      // user_version 4, with two landmarks (one per cell, raised at 8), a
      // live plot and a wallet.
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE cells (id INTEGER PRIMARY KEY, claimer_id TEXT, label TEXT, claimed_at TEXT);
        CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL;
        ALTER TABLE cells ADD COLUMN last_seen_at TEXT;
        CREATE TABLE displaced (claimer_id TEXT PRIMARY KEY, label TEXT NOT NULL, cell_id INTEGER NOT NULL, displaced_at TEXT NOT NULL);
        CREATE TABLE landmarks (id INTEGER PRIMARY KEY, cell_id INTEGER, label TEXT, raisers TEXT, raised_at TEXT);
        CREATE UNIQUE INDEX one_landmark_each ON landmarks(cell_id);
        CREATE TABLE players (
          pid TEXT PRIMARY KEY, label TEXT,
          coins INTEGER NOT NULL DEFAULT 100 CHECK (coins >= 0),
          unclaimed_cents INTEGER NOT NULL DEFAULT 0 CHECK (unclaimed_cents >= 0),
          created_at TEXT, last_relocated_at TEXT, last_helped_at TEXT,
          earned_cents INTEGER NOT NULL DEFAULT 0, seen_at TEXT,
          seen_earned_cents INTEGER NOT NULL DEFAULT 0, lease_lost_at TEXT
        );
        ALTER TABLE cells ADD COLUMN level INTEGER;
        ALTER TABLE cells ADD COLUMN lease_ends_at TEXT;
        ALTER TABLE cells ADD COLUMN owned_since TEXT;
        ALTER TABLE cells ADD COLUMN pending_cents INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE cells ADD COLUMN settled_at TEXT;
        CREATE TABLE events (id INTEGER PRIMARY KEY, type TEXT, text TEXT, cell_id INTEGER, at TEXT);
        PRAGMA user_version = 4;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const until = later(LEASE_MS).toISOString();
      old
        .prepare("UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, level = 3, lease_ends_at = ?, owned_since = ?, settled_at = ?, pending_cents = 700 WHERE id = ?")
        .run(ALICE, "Alice", T0.toISOString(), until, T0.toISOString(), T0.toISOString(), 42);
      old.prepare("INSERT INTO players (pid, label, coins) VALUES (?, ?, ?)").run(ALICE, "Alice", 321);
      const nine = ["Mia", "Kai", "Zoe", "Ari", "Bo", "Cy", "Di", "Ed", "Flo"];
      const mark = old.prepare("INSERT INTO landmarks (cell_id, label, raisers, raised_at) VALUES (?, ?, ?, ?)");
      mark.run(77, "Mia", JSON.stringify(nine), "2026-10-10T00:00:00.000Z");
      mark.run(30, "Kai", JSON.stringify(nine.slice(1)), "2026-10-11T00:00:00.000Z");
      old.close();

      const s = openStore(path);
      opened.push(s);
      const tiers = (id: number): string[] => s.landmarks().filter((l) => l.cellId === id).map((l) => l.tier).sort();
      // the old rows survive as gold, with their names and time; the tiers
      // below are written in alongside them
      expect(s.landmarks().filter((l) => l.tier === "gold")).toEqual([
        { cellId: 77, tier: "gold", label: "Mia", raisers: nine, raisedAt: "2026-10-10T00:00:00.000Z" },
        { cellId: 30, tier: "gold", label: "Kai", raisers: nine.slice(1), raisedAt: "2026-10-11T00:00:00.000Z" },
      ]);
      expect(tiers(77)).toEqual(["bronze", "gold", "silver"]);
      expect(tiers(30)).toEqual(["bronze", "gold", "silver"]);
      for (const l of s.landmarks()) expect(l.raisedAt).toBe(l.cellId === 77 ? "2026-10-10T00:00:00.000Z" : "2026-10-11T00:00:00.000Z");
      // plots and wallets are untouched
      expect(s.tiles()[42]).toMatchObject({ claimerId: ALICE, label: "Alice", level: 3, pendingCents: 700, leaseEndsAt: until });
      expect(s.me(ALICE, T0).coins).toBe(321);
      // nothing standing on the board, so nothing new is raised
      expect(s.raise(T0)).toEqual([]);
      s.close();
      opened.pop();

      // opening again runs nothing twice
      const again = openStore(path);
      opened.push(again);
      expect(again.landmarks()).toHaveLength(6);
      again.close();
      opened.pop();
      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(8);
      // the unique index is (cell_id, tier) now: a new tier on a cell is
      // allowed, the same tier twice is not
      const put = v.prepare("INSERT INTO landmarks (cell_id, tier, label, raisers, raised_at) VALUES (?, ?, 'X', '[]', 't')");
      put.run(50, "bronze");
      put.run(50, "silver");
      expect(() => put.run(77, "gold")).toThrow(/UNIQUE/);
      // a row written without a tier is gold, as every earlier row was
      v.prepare("INSERT INTO landmarks (cell_id, label, raisers, raised_at) VALUES (51, 'Y', '[]', 't')").run();
      expect(v.prepare("SELECT tier FROM landmarks WHERE cell_id = 51").get()).toEqual({ tier: "gold" });
      expect(v.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'one_landmark_each'").get()).toEqual({ n: 0 });
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
