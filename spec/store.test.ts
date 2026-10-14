import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { heights } from "../src/board.ts";
import { isActive, N, openStore, TILES, type Store } from "../src/db.ts";
import { LEASE_MS } from "../src/economy.ts";

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
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
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

// docs/adr/0004, as ADR 5 counts it: a building with all 8 neighbours
// occupied becomes a landmark, recorded once and kept. A 3x3 block of nine
// people round an interior centre.
const cell = (r: number, c: number): number => r * N + c;
const block = (r: number, c: number): number[] => {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(cell(r + dr, c + dc));
  return out;
};
const pidAt = (id: number): string => `p${id}`;
const nameAt = (id: number): string => `N${id}`;
// Claims each tile for its own person, then looks for landmarks, as the
// server does after every change; returns the cells raised along the way.
const fill = (s: Store, ids: number[], at: Date): number[] => {
  const raised: number[] = [];
  for (const id of ids) {
    expect(s.claim(id, pidAt(id), nameAt(id), at)).toBe("claimed");
    raised.push(...s.raise(at).map((l) => l.cellId));
  }
  return raised;
};

describe("landmarks", () => {
  it("records exactly one when a building's 8th neighbour arrives, naming the holder first and the eight round it, by label", () => {
    const s = memory();
    const centre = cell(5, 5);
    const ring = block(5, 5).filter((id) => id !== centre);
    expect(fill(s, [centre, ...ring.slice(0, 7)], T0)).toEqual([]);
    expect(s.landmarks()).toEqual([]);

    expect(s.claim(ring[7], pidAt(ring[7]), nameAt(ring[7]), later(1000))).toBe("claimed"); // the eighth neighbour
    const expected = {
      cellId: centre,
      label: nameAt(centre),
      raisers: [centre, ...ring].map(nameAt),
      raisedAt: later(1000).toISOString(),
    };
    // returned once, for the server to announce, and kept
    expect(s.raise(later(1000))).toEqual([expected]);
    expect(s.raise(later(2000))).toEqual([]);
    expect(s.landmarks()).toEqual([expected]);
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
    expect(s.landmarks()).toHaveLength(1);
    expect(s.landmarks().map((l) => l.raisedAt)).toEqual([T0.toISOString()]);
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
    expect(s.raise(later(LEASE_MS + 1000)).map((l) => l.cellId)).toEqual([centre]);
  });

  it("doesn't raise a building whose own lease has ended, even with eight round it", () => {
    const s = memory();
    const centre = cell(5, 5);
    fill(s, [centre], T0);
    const now = later(LEASE_MS);
    fill(s, block(5, 5).filter((id) => id !== centre), now);
    expect(heights(s.tiles(), now)[centre]).toBe(0); // it's free now
    expect(s.landmarks()).toEqual([]);
  });

  it("can never raise one on an edge or a corner: they have 5 and 3 neighbours, so a full board raises only the 100 inside", () => {
    const s = memory();
    fill(s, Array.from({ length: TILES }, (_, i) => i), T0);
    const raised = s.landmarks().map((l) => l.cellId).sort((a, b) => a - b);
    const inside = Array.from({ length: TILES }, (_, i) => i).filter((i) => {
      const r = Math.floor(i / N);
      const c = i % N;
      return r > 0 && r < N - 1 && c > 0 && c < N - 1;
    });
    expect(inside).toHaveLength(100);
    expect(raised).toEqual(inside);
  });
});

describe("landmarks agree with heights()", () => {
  it("raises exactly the held buildings with 8 occupied neighbours, on random dense boards with ended leases", () => {
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
      const expected = tiles.filter((t) => isActive(t, now) && hs[t.id] === (t.level ?? 1) + 8).map((t) => t.id);
      expect(s.raise(now).map((l) => l.cellId)).toEqual(expected);
      raisedTotal += expected.length;
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
      expect(s.raise(new Date()).map((l) => l.cellId)).toEqual([cell(5, 5)]);
      s.close();
      opened.pop();

      const again = openStore(path);
      opened.push(again);
      expect(again.landmarks()).toHaveLength(1);
      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
