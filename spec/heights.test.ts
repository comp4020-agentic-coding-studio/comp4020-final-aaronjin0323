import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardView, heights } from "../src/board.ts";
import { N, openStore, TILES, type Tile } from "../src/db.ts";
import { LEASE_MS, rate } from "../src/economy.ts";

// The pure rules under the board, with no app running: how high a building
// stands (level + occupied neighbours, ADR 5), what each tile tells everyone,
// and the database's backstop against one person holding two plots.

const T0 = new Date("2026-10-01T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

// A board where exactly the listed tiles are held, each by its own person,
// as level-1 buildings on a lease from T0.
function boardOf(claimed: Iterable<number>, start = T0): Tile[] {
  const set = new Set(claimed);
  const since = start.toISOString();
  const ends = new Date(start.getTime() + LEASE_MS).toISOString();
  return Array.from({ length: TILES }, (_, id) =>
    set.has(id)
      ? { id, claimerId: `p${id}`, label: `L${id}`, claimedAt: since, level: 1, leaseEndsAt: ends, ownedSince: since, pendingCents: 0, settledAt: since }
      : { id, claimerId: null, label: null, claimedAt: null, level: null, leaseEndsAt: null, ownedSince: null, pendingCents: 0, settledAt: null },
  );
}
const id = (r: number, c: number): number => r * N + c;
const everything = Array.from({ length: TILES }, (_, i) => i);

describe("heights()", () => {
  it("is 1 + 3 at every corner, 1 + 5 along every edge and 1 + 8 inside on a full board of level-1 buildings", () => {
    const hs = heights(boardOf(everything), T0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const edges = Number(r === 0 || r === N - 1) + Number(c === 0 || c === N - 1);
        const expected = 1 + (edges === 2 ? 3 : edges === 1 ? 5 : 8);
        expect(hs[id(r, c)], `r${r}c${c}`).toBe(expected);
      }
    }
  });

  it("adds the building's level to its occupied neighbours", () => {
    const tiles = boardOf([id(5, 5), id(5, 6), id(4, 4)]);
    tiles[id(5, 5)].level = 4;
    const hs = heights(tiles, T0);
    expect(hs[id(5, 5)]).toBe(4 + 2);
    expect(hs[id(5, 6)]).toBe(1 + 1); // a neighbour counts once, whatever its level
    expect(hs[id(4, 4)]).toBe(1 + 1);
  });

  it("counts diagonal neighbours as well as orthogonal ones", () => {
    const centre = id(5, 5);
    const hs = heights(boardOf([centre, id(4, 4), id(4, 6), id(6, 4), id(6, 6)]), T0); // four diagonals
    expect(hs[centre]).toBe(1 + 4);
    expect(heights(boardOf([centre, id(4, 5), id(6, 5), id(5, 4), id(5, 6)]), T0)[centre]).toBe(1 + 4); // four orthogonals
    expect(hs[id(4, 4)]).toBe(1 + 1); // a diagonal pair lifts both ways
  });

  it("doesn't wrap around an edge: the last column isn't beside the next row's first", () => {
    const hs = heights(boardOf([id(0, N - 1), id(1, 0)]), T0); // adjacent ids, opposite sides
    expect(hs[id(0, N - 1)]).toBe(1);
    expect(hs[id(1, 0)]).toBe(1);
    const corner = heights(boardOf([id(N - 1, N - 1), id(0, 0)]), T0);
    expect(corner[id(N - 1, N - 1)]).toBe(1);
  });

  it("leaves a free tile at 0 even when surrounded", () => {
    const centre = id(3, 3);
    const hs = heights(boardOf(everything.filter((i) => i !== centre)), T0);
    expect(hs[centre]).toBe(0);
    expect(hs[id(3, 4)]).toBe(1 + 7); // and its neighbours lose that floor
  });

  it("is deterministic: the same board always gives the same heights", () => {
    const tiles = boardOf([0, 1, 13, 50, 51, 62, 143]);
    expect(heights(tiles, T0)).toEqual(heights(structuredClone(tiles), T0));
  });

  it("treats a lease that has ended as free, on read, before anything clears the row", () => {
    const tiles = boardOf([id(2, 2), id(2, 3)]);
    tiles[id(2, 2)].leaseEndsAt = new Date(T0.getTime() + HOUR).toISOString();
    const later = new Date(T0.getTime() + 2 * HOUR);
    expect(tiles[id(2, 2)].claimerId).not.toBeNull(); // the row still names its holder
    const view = boardView(tiles, "nobody", later);
    expect(view.tiles[id(2, 2)]).toMatchObject({ state: "free", height: 0, level: null, rate: 0, leaseEndsAt: null, label: null });
    expect(view.tiles[id(2, 3)]).toMatchObject({ state: "held", height: 1, neighbours: 0 });
    expect(heights(tiles, later)[id(2, 3)]).toBe(1);
    expect(heights(tiles, T0)[id(2, 3)]).toBe(2); // before it ended
  });
});

describe("what a tile tells everyone", () => {
  it("carries state, label, hue, level, neighbours, height, income rate and lease end, and no pid", () => {
    const tiles = boardOf([id(5, 5), id(5, 6), id(5, 7)]);
    tiles[id(5, 6)].level = 3;
    const view = boardView(tiles, "p66", T0);
    expect(view.tiles[id(5, 6)]).toMatchObject({
      state: "mine",
      label: "L66",
      level: 3,
      neighbours: 2,
      height: 5,
      rate: rate(3, 2),
      leaseEndsAt: new Date(T0.getTime() + LEASE_MS).toISOString(),
    });
    expect(view.tiles[id(5, 5)]).toMatchObject({ state: "held", level: 1, neighbours: 1, height: 2, rate: 1200 });
    expect(view.tiles[0]).toMatchObject({ state: "free", level: null, neighbours: 0, height: 0, rate: 0, leaseEndsAt: null });
    expect(typeof view.tiles[id(5, 5)].hue).toBe("number");
    expect(JSON.stringify(view)).not.toMatch(/"p\d+"/);
  });

  it("goes by the clock it's given: a store's leases end at 24 hours", () => {
    const s = openStore(":memory:");
    try {
      s.claim(id(2, 2), "ana", "Ana", T0);
      s.claim(id(2, 3), "ben", "Ben", new Date(T0.getTime() + HOUR));
      expect(heights(s.tiles(), new Date(T0.getTime() + 2 * HOUR))[id(2, 3)]).toBe(2);
      expect(heights(s.tiles(), new Date(T0.getTime() + LEASE_MS))[id(2, 3)]).toBe(1); // Ana's lease ended
    } finally {
      s.close();
    }
  });
});

describe("one tile each, in the database itself", () => {
  it("refuses a second row for the same person even if the code forgot to release the first", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-idx-"));
    const path = join(dir, "app.db");
    try {
      const s = openStore(path);
      s.claim(1, "ana", "Ana", T0);
      s.close();
      const db = new DatabaseSync(path);
      try {
        expect(() => db.prepare("UPDATE cells SET claimer_id = 'ana' WHERE id = 2").run()).toThrow(/UNIQUE/);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
