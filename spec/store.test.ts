import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { boardView } from "../src/board.ts";
import { DORMANT_AFTER_MS, openStore, TILES, type Store } from "../src/db.ts";

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
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
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
