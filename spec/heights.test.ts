import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardView, heights } from "../src/board.ts";
import { DORMANT_AFTER_MS, N, openStore, TILES, type Tile } from "../src/db.ts";

// The pure rules under the board, with no app running: how high a tile
// stands, when a held tile stops being safe, and the database's backstop
// against one person holding two tiles.

const T0 = new Date("2026-10-01T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

// A board where exactly the listed tiles are held, each by its own person.
function boardOf(claimed: Iterable<number>, lastSeenAt = T0.toISOString()): Tile[] {
  const set = new Set(claimed);
  return Array.from({ length: TILES }, (_, id) =>
    set.has(id)
      ? { id, claimerId: `p${id}`, label: `L${id}`, claimedAt: lastSeenAt, lastSeenAt }
      : { id, claimerId: null, label: null, claimedAt: null, lastSeenAt: null },
  );
}
const id = (r: number, c: number): number => r * N + c;
const everything = Array.from({ length: TILES }, (_, i) => i);

describe("heights()", () => {
  it("is 3 at every corner, 5 along every edge and 8 inside on a full board of active tiles", () => {
    const hs = heights(boardOf(everything), T0);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const edges = Number(r === 0 || r === N - 1) + Number(c === 0 || c === N - 1);
        const expected = edges === 2 ? 3 : edges === 1 ? 5 : 8;
        expect(hs[id(r, c)], `r${r}c${c}`).toBe(expected);
      }
    }
  });

  it("counts diagonal neighbours as well as orthogonal ones", () => {
    const centre = id(5, 5);
    const hs = heights(boardOf([centre, id(4, 4), id(4, 6), id(6, 4), id(6, 6)]), T0); // four diagonals
    expect(hs[centre]).toBe(4);
    expect(heights(boardOf([centre, id(4, 5), id(6, 5), id(5, 4), id(5, 6)]), T0)[centre]).toBe(4); // four orthogonals
    expect(hs[id(4, 4)]).toBe(1); // a diagonal pair lifts both ways
  });

  it("doesn't wrap around an edge: the last column isn't beside the next row's first", () => {
    const hs = heights(boardOf([id(0, N - 1), id(1, 0)]), T0); // adjacent ids, opposite sides
    expect(hs[id(0, N - 1)]).toBe(0);
    expect(hs[id(1, 0)]).toBe(0);
    const corner = heights(boardOf([id(N - 1, N - 1), id(0, 0)]), T0);
    expect(corner[id(N - 1, N - 1)]).toBe(0);
  });

  it("leaves a free tile at 0 even when surrounded", () => {
    const centre = id(3, 3);
    const hs = heights(boardOf(everything.filter((i) => i !== centre)), T0);
    expect(hs[centre]).toBe(0);
    expect(hs[id(3, 4)]).toBe(7); // and its neighbours lose that floor
  });

  it("is deterministic: the same board always gives the same heights", () => {
    const tiles = boardOf([0, 1, 13, 50, 51, 62, 143]);
    expect(heights(tiles, T0)).toEqual(heights(structuredClone(tiles), T0));
  });

  const away = (tiles: Tile[], ...ids: number[]): Tile[] => {
    for (const i of ids) tiles[i].lastSeenAt = new Date(T0.getTime() - 30 * HOUR).toISOString();
    return tiles;
  };

  it("doesn't count a dormant neighbour", () => {
    const tiles = away(boardOf([id(2, 2), id(2, 3)]), id(2, 2));
    const view = boardView(tiles, "nobody", T0);
    expect(view.tiles[id(2, 2)].state).toBe("dormant");
    expect(view.tiles[id(2, 3)].height).toBe(0);
    expect(heights(tiles, T0)[id(2, 3)]).toBe(0);
  });

  it("gives a dormant tile its own height, from its active neighbours only", () => {
    // centre dormant, two active neighbours and one dormant one
    const tiles = away(boardOf([id(5, 5), id(4, 5), id(5, 6), id(6, 6)]), id(5, 5), id(6, 6));
    const hs = heights(tiles, T0);
    expect(hs[id(5, 5)]).toBe(2);
    expect(hs[id(6, 6)]).toBe(1); // lifted by the active (5,6), not the dormant centre
    expect(hs[id(4, 5)]).toBe(1); // (5,6) is diagonal to it; the centre doesn't count
  });

  it("drops a full board's interior to 7 around one dormant tile", () => {
    const tiles = away(boardOf(everything), id(5, 5));
    const hs = heights(tiles, T0);
    expect(hs[id(5, 5)]).toBe(8);
    for (const n of [id(4, 4), id(4, 5), id(4, 6), id(5, 4), id(5, 6), id(6, 4), id(6, 5), id(6, 6)]) expect(hs[n]).toBe(7);
    expect(hs[id(3, 3)]).toBe(8);
  });

  it("restores the height when a dormant neighbour wakes, and goes by the clock it's given", () => {
    const s = openStore(":memory:");
    try {
      s.claim(id(2, 2), "ana", "Ana", T0);
      s.claim(id(2, 3), "ben", "Ben", T0);
      const day = new Date(T0.getTime() + 25 * HOUR);
      s.touch("ben", day);
      expect(heights(s.tiles(), new Date(T0.getTime() + HOUR))[id(2, 3)]).toBe(1); // before Ana fades
      expect(heights(s.tiles(), day)[id(2, 3)]).toBe(0); // Ana dormant
      s.touch("ana", day);
      expect(heights(s.tiles(), day)[id(2, 3)]).toBe(1); // Ana back
    } finally {
      s.close();
    }
  });
});

describe("safeUntil", () => {
  it("is the holder's last visit plus a day on a held tile, and null on free, mine and dormant", () => {
    const seen = new Date(T0.getTime() - 3 * HOUR);
    const tiles = boardOf([10, 20, 30], seen.toISOString());
    tiles[30].lastSeenAt = new Date(T0.getTime() - 25 * HOUR).toISOString(); // dormant
    const view = boardView(tiles, "p20", T0);
    expect(view.tiles[10].state).toBe("held");
    expect(view.tiles[10].safeUntil).toBe(new Date(seen.getTime() + DORMANT_AFTER_MS).toISOString());
    expect(view.tiles[20].state).toBe("mine");
    expect(view.tiles[20].safeUntil).toBeNull();
    expect(view.tiles[30].state).toBe("dormant");
    expect(view.tiles[30].safeUntil).toBeNull();
    expect(view.tiles[0].state).toBe("free");
    expect(view.tiles[0].safeUntil).toBeNull();
  });

  it("moves forward when the holder visits", () => {
    const s = openStore(":memory:");
    try {
      s.claim(7, "ana", "Ana", T0);
      const before = boardView(s.tiles(), "obs", T0).tiles[7].safeUntil;
      s.touch("ana", new Date(T0.getTime() + 2 * HOUR));
      const after = boardView(s.tiles(), "obs", new Date(T0.getTime() + 2 * HOUR)).tiles[7].safeUntil;
      expect(before).toBe(new Date(T0.getTime() + DORMANT_AFTER_MS).toISOString());
      expect(after).toBe(new Date(T0.getTime() + 2 * HOUR + DORMANT_AFTER_MS).toISOString());
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
