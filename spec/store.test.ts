import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { boardView, heights } from "../src/board.ts";
import { DORMANT_AFTER_MS, N, openStore, TILES, type Store } from "../src/db.ts";

// The store on its own, with a clock the test controls: dormancy needs a day
// to pass and the migration needs a crit-8 database, and neither can be
// arranged over HTTP against a running app.
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
      expect(tiles[42]).toMatchObject({ claimerId: ALICE, label: "Alice", lastSeenAt: T0.toISOString() });
      expect(tiles.filter((t) => t.claimerId !== null)).toHaveLength(1);
      s.close();
      opened.pop();

      // Opening again runs nothing twice.
      const again = openStore(path);
      opened.push(again);
      expect(again.tiles()[42].claimerId).toBe(ALICE);
      const v = new DatabaseSync(path);
      // every step since, too: crit 8 straight to the latest
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dormancy", () => {
  it("keeps a tile safe for the first 24 hours", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    expect(s.claim(5, BOB, "Bob", later(DORMANT_AFTER_MS - 1))).toBe("taken");
    expect(holder(s, 5)).toBe(ALICE);
  });

  it("lets someone settle on a tile whose holder has been away over a day", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    expect(s.claim(5, BOB, "Bob", later(25 * HOUR))).toBe("claimed");
    expect(holder(s, 5)).toBe(BOB);
  });

  it("counts a visit: a holder who came back isn't dormant", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.touch(ALICE, later(20 * HOUR));
    expect(s.claim(5, BOB, "Bob", later(25 * HOUR))).toBe("taken");
  });

  it("reports when a visit wakes a dormant tile", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    expect(s.touch(ALICE, later(1 * HOUR))).toBe(false);
    expect(s.touch(ALICE, later(30 * HOUR))).toBe(true);
    expect(s.touch(BOB, later(30 * HOUR))).toBe(false); // holds nothing
  });

  it("shows a dormant tile as dormant to others, and as mine to its holder", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    const now = later(25 * HOUR);
    expect(boardView(s.tiles(), BOB, now).tiles[5].state).toBe("dormant");
    expect(boardView(s.tiles(), ALICE, now).tiles[5].state).toBe("mine");
  });

  it("stops counting a dormant tile toward its neighbours' height, and counts it again once it wakes", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.claim(6, BOB, "Bob", later(25 * HOUR));
    const view = boardView(s.tiles(), BOB, later(25 * HOUR));
    expect(view.tiles[5].state).toBe("dormant");
    expect(view.tiles[6].height).toBe(0);
    expect(view.tiles[5].height).toBe(1); // a dormant tile still stands, lifted by Bob
    s.touch(ALICE, later(26 * HOUR));
    expect(boardView(s.tiles(), BOB, later(26 * HOUR)).tiles[6].height).toBe(1);
  });

  it("lowers the neighbours of a tile that expired while the server was off, on the first read", () => {
    // A database file left alone for a day: nothing ran in between, so only
    // the read-time rule can see the change.
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      const before = openStore(path);
      before.claim(5, ALICE, "Alice", T0);
      before.claim(6, BOB, "Bob", later(20 * HOUR));
      expect(boardView(before.tiles(), "x", later(20 * HOUR)).tiles[6].height).toBe(1);
      before.close();

      const after = openStore(path);
      opened.push(after);
      const view = boardView(after.tiles(), "x", later(25 * HOUR));
      expect(view.tiles[5].state).toBe("dormant");
      expect(view.tiles[6]).toMatchObject({ state: "held", height: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("displacement", () => {
  it("tells the old holder once, and only them", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.claim(5, BOB, "Bob", later(25 * HOUR));
    expect(s.takeDisplacement(BOB)).toBeNull();
    expect(s.takeDisplacement(ALICE)).toMatchObject({ label: "Alice", cellId: 5 });
    expect(s.takeDisplacement(ALICE)).toBeNull();
  });

  it("isn't recorded when someone moves off their own tile", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.claim(9, ALICE, "Alice", later(HOUR));
    expect(s.takeDisplacement(ALICE)).toBeNull();
  });

  it("leaves the displaced person free to claim again", () => {
    const s = memory();
    s.claim(5, ALICE, "Alice", T0);
    s.claim(5, BOB, "Bob", later(25 * HOUR));
    expect(s.claim(7, ALICE, "Alice", later(26 * HOUR))).toBe("claimed");
    expect(s.tiles().filter((t) => t.claimerId === ALICE).map((t) => t.id)).toEqual([7]);
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

// docs/adr/0004: a tower at height 8 becomes a landmark, recorded once and
// kept. A 3x3 block of nine people round an interior centre.
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
  it("records exactly one when a tower reaches 8, naming the holder first and the eight round it, by label", () => {
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

  it("doesn't record a second when the same tower drops below 8 and reaches it again", () => {
    const s = memory();
    const centre = cell(5, 5);
    expect(fill(s, block(5, 5), T0)).toEqual([centre]);
    const corner = cell(4, 4);
    s.claim(cell(9, 9), pidAt(corner), nameAt(corner), later(1000)); // a neighbour moves away: 7
    expect(heights(s.tiles(), later(1000))[centre]).toBe(7);
    expect(s.raise(later(1000))).toEqual([]);
    s.claim(corner, pidAt(corner), nameAt(corner), later(2000)); // and back: 8 again
    expect(heights(s.tiles(), later(2000))[centre]).toBe(8);
    expect(s.raise(later(2000))).toEqual([]);
    expect(s.landmarks()).toHaveLength(1);
    expect(s.landmarks().map((l) => l.raisedAt)).toEqual([T0.toISOString()]);
  });

  it("doesn't count a faded neighbour, and records it once that neighbour comes back", () => {
    const s = memory();
    const centre = cell(5, 5);
    const faded = cell(4, 4);
    fill(s, [faded], T0);
    const now = later(25 * HOUR); // the first neighbour has been away over a day
    expect(
      fill(
        s,
        block(5, 5).filter((id) => id !== faded),
        now,
      ),
    ).toEqual([]);
    expect(heights(s.tiles(), now)[centre]).toBe(7);
    expect(s.landmarks()).toEqual([]);

    expect(s.touch(pidAt(faded), later(26 * HOUR))).toBe(true); // they wake it
    expect(s.raise(later(26 * HOUR)).map((l) => l.cellId)).toEqual([centre]);
    expect(s.landmarks().map((l) => l.cellId)).toEqual([centre]);
  });

  it("doesn't raise a faded holder's tower, even with eight people round it", () => {
    const s = memory();
    const centre = cell(5, 5);
    fill(s, [centre], T0);
    const now = later(25 * HOUR);
    fill(
      s,
      block(5, 5).filter((id) => id !== centre),
      now,
    );
    expect(heights(s.tiles(), now)[centre]).toBe(8); // it stands at 8 ...
    expect(s.landmarks()).toEqual([]); // ... but nobody's there to hold it
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
  it("raises exactly the held, non-faded tiles that heights() puts at 8, on random dense boards with faded tiles", () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let raisedTotal = 0;
    for (let round = 0; round < 40; round++) {
      const s = memory();
      const now = later(25 * HOUR);
      for (let id = 0; id < TILES; id++) {
        if (rand() < 0.85) s.claim(id, pidAt(id), nameAt(id), rand() < 0.1 ? T0 : now);
      }
      const tiles = s.tiles();
      const hs = heights(tiles, now);
      const expected = tiles
        .filter((t) => t.claimerId !== null && hs[t.id] === 8 && t.lastSeenAt === now.toISOString())
        .map((t) => t.id);
      expect(s.raise(now).map((l) => l.cellId)).toEqual(expected);
      raisedTotal += expected.length;
    }
    expect(raisedTotal).toBeGreaterThan(20); // not a pass on empty lists
  });
});

describe("migration 3 (landmarks)", () => {
  it("upgrades a crit-10 database in place, keeping every claim and displacement", () => {
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
      for (const t of held) expect(t).toMatchObject({ claimerId: pidAt(t.id), label: nameAt(t.id), lastSeenAt: T0.toISOString() });
      expect(s.takeDisplacement(ALICE)).toMatchObject({ label: "Alice", cellId: 3 });
      // Nothing is backfilled by the migration itself; the tower standing at
      // 8 is recorded on the first raise (the server calls it at start).
      expect(s.landmarks()).toEqual([]);
      expect(s.raise(later(1000)).map((l) => l.cellId)).toEqual([cell(5, 5)]);
      s.close();
      opened.pop();

      const again = openStore(path);
      opened.push(again);
      expect(again.landmarks()).toHaveLength(1);
      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
