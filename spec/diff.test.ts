import { describe, expect, it } from "vitest";
import { boardView, heights } from "../src/board.ts";
import { openStore, type Store } from "../src/db.ts";
// @ts-expect-error: a plain browser module with no type declarations
import { accepts, arrivals, describeTile, diffBoards, inspect, preview, safeFor } from "../public/diff.js";

// The page's diff, fed real boards from the real store: so a change to what
// the server sends and a change to how the page reads it can't drift apart.
const NOW = new Date("2026-10-01T10:00:00.000Z");
const ME = "me-pid";
const MIA = "mia-pid";
const KAI = "kai-pid";
const ZOE = "zoe-pid";

type Rise = { id: number; delta: number };
type Message = { key: string; text: string };
const diff = (prev: unknown, next: unknown): { rises: Rise[]; messages: Message[] } => diffBoards(prev, next);

// Tile ids on the 12×12 board: row r, column c (both from 0).
const at = (r: number, c: number): number => r * 12 + c;

function scene(): { store: Store; view: (pid?: string) => ReturnType<typeof boardView> } {
  const store = openStore(":memory:");
  return { store, view: (pid = ME) => boardView(store.tiles(), pid, NOW) };
}

describe("rises", () => {
  it("floats +1 on each neighbour a new claim lifts, and nothing on the new tile", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 5), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(3, 4), ZOE, "Zoe", NOW);
    const { rises } = diff(before, view());
    expect(rises).toEqual(
      expect.arrayContaining([
        { id: at(3, 3), delta: 1 },
        { id: at(3, 5), delta: 1 },
      ]),
    );
    expect(rises.map((r) => r.id)).not.toContain(at(3, 4));
    expect(rises).toHaveLength(2);
  });

  it("floats -1 on the neighbours left behind by a move", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 4), ZOE, "Zoe", NOW);
    const before = view();
    store.claim(at(9, 9), ZOE, "Zoe", NOW);
    expect(diff(before, view()).rises).toEqual([{ id: at(3, 3), delta: -1 }]);
  });

  it("reports nothing when nothing changed", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    expect(diff(view(), view())).toEqual({ rises: [], messages: [] });
  });
});

describe("my own claim", () => {
  it("says who I lifted", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 5), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(3, 4), ME, "Me", NOW);
    const [msg] = diff(before, view()).messages;
    expect(msg.key).toBe("claimed");
    expect(msg.text).toBe("Claimed row 4, column 5. You lifted Mia and Kai.");
  });

  it("says I'll rise later when I settle alone", () => {
    const { store, view } = scene();
    const before = view();
    store.claim(at(0, 0), ME, "Me", NOW);
    expect(diff(before, view()).messages[0].text).toMatch(/^Claimed row 1, column 1\. Nobody beside you yet/);
  });

  it("on a move, names who dropped, and doesn't count a neighbour of both tiles", () => {
    const { store, view } = scene();
    store.claim(at(3, 2), MIA, "Mia", NOW); // beside my old tile only
    store.claim(at(2, 4), KAI, "Kai", NOW); // beside both old and new
    store.claim(at(3, 6), ZOE, "Zoe", NOW); // beside my new tile only
    store.claim(at(3, 3), ME, "Me", NOW);
    const before = view();
    store.claim(at(3, 5), ME, "Me", NOW);
    const [msg] = diff(before, view()).messages;
    expect(msg.text).toBe("Moved to row 4, column 6. You lifted Zoe. Mia dropped a floor when you left.");
  });
});

describe("my neighbourhood", () => {
  it("tells me who settled beside me and my new height", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    store.claim(at(5, 6), MIA, "Mia", NOW);
    expect(diff(before, view()).messages).toEqual([{ key: "arrived", text: "Mia settled beside you. You're up to height 1." }]);
  });

  it("tells me who moved away", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const before = view();
    store.claim(at(0, 0), MIA, "Mia", NOW);
    expect(diff(before, view()).messages).toEqual([{ key: "left", text: "Mia moved away from beside you. You're down to height 0." }]);
  });

  it("says nothing about claims away from my tile", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    store.claim(at(0, 0), MIA, "Mia", NOW);
    expect(diff(before, view()).messages).toEqual([]);
  });

  it("treats someone settling on a faded neighbour as an arrival, not a rise", () => {
    const { store, view } = scene();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    store.claim(at(5, 6), MIA, "Mia", old); // Mia's tile is dormant by NOW
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    store.claim(at(5, 6), KAI, "Kai", NOW);
    const { rises, messages } = diff(before, view());
    expect(rises.map((r) => r.id)).not.toContain(at(5, 6));
    // Mia's faded tile lifted nobody; Kai's does, so I rise.
    expect(messages.map((m) => m.text)).toEqual(["Kai settled beside you. You're up to height 1.", "Mia moved away from beside you."]);
  });
});

describe("a change of holder is never a rise", () => {
  it("floats nothing on a tile that changed hands, even when its height changed", () => {
    const { store, view } = scene();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    store.claim(at(5, 6), MIA, "Mia", old); // faded
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 7), KAI, "Kai", NOW);
    const before = view();
    expect(before.tiles[at(5, 6)]).toMatchObject({ state: "dormant", height: 2 });

    store.claim(at(5, 6), KAI, "Kai", NOW); // Kai steps onto Mia's faded tile
    const after = view();
    expect(after.tiles[at(5, 6)]).toMatchObject({ state: "held", label: "Kai", height: 1 });

    const { rises } = diff(before, after);
    expect(rises.map((r) => r.id)).not.toContain(at(5, 6));
    // A faded tile lifts nobody, so Kai waking it up lifts me: that's a
    // rise on a tile that kept its holder.
    expect(rises).toEqual([{ id: at(5, 5), delta: 1 }]);
  });
});

describe("the phone confirm bar", () => {
  it("names who holds a tile", () => {
    const { store, view } = scene();
    store.claim(at(1, 1), MIA, "Mia", NOW);
    expect(describeTile(view(), at(1, 1))).toEqual({ title: "Mia holds row 2, column 2", action: null, open: false });
  });

  it("says how many neighbours a free tile would lift", () => {
    const { store, view } = scene();
    store.claim(at(1, 1), MIA, "Mia", NOW);
    store.claim(at(1, 3), KAI, "Kai", NOW);
    expect(describeTile(view(), at(1, 2))).toMatchObject({ title: "Would lift 2 neighbours.", action: "Claim row 2, column 3" });
    expect(describeTile(view(), at(9, 9)).title).toBe("No neighbours yet.");
  });

  it("doesn't count my own tile as someone I'd lift", () => {
    const { store, view } = scene();
    store.claim(at(1, 1), ME, "Me", NOW);
    expect(describeTile(view(), at(1, 2)).title).toBe("No neighbours yet.");
  });
});

describe("a neighbour fading or coming back", () => {
  it("says whose tile faded and my new height", () => {
    const { store } = scene();
    const dayAgo = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", dayAgo); // safe at NOW, faded 2 h later
    const before = boardView(store.tiles(), ME, NOW);
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    store.touch(ME, later);
    const after = boardView(store.tiles(), ME, later);
    expect(after.tiles[at(5, 6)].state).toBe("dormant");
    const { rises, messages } = diff(before, after);
    expect(messages).toEqual([{ key: "faded", text: "Mia's tile faded after a day away. You're down to height 0." }]);
    expect(rises).toEqual([{ id: at(5, 5), delta: -1 }]);
  });

  it("says who is back when a faded neighbour wakes", () => {
    const { store } = scene();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", old);
    const before = boardView(store.tiles(), ME, NOW);
    store.touch(MIA, NOW);
    expect(diff(before, boardView(store.tiles(), ME, NOW)).messages).toEqual([
      { key: "back", text: "Mia is back beside you. You're up to height 1." },
    ]);
  });

  it("doesn't count a faded neighbour as someone my claim lifted", () => {
    const { store, view } = scene();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    store.claim(at(5, 6), MIA, "Mia", old);
    store.claim(at(5, 4), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(5, 5), ME, "Me", NOW);
    expect(diff(before, view()).messages[0].text).toBe("Claimed row 6, column 6. You lifted Kai.");
  });
});

// A small seeded generator, so a failing board can be rebuilt from its seed.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

type Preview = { id: number; height: number; heights: number[]; lifted: number[]; dropped: number[]; from: number | null };
const previewOf = (board: unknown, id: number): Preview | null => preview(board, id);

describe("the placement preview", () => {
  const OLD = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

  // A random board: some tiles free, some held, some dormant, and maybe one
  // of them mine. Then every tile I could claim is previewed and claimed for
  // real on a copy, and the preview must match the server's heights() for the
  // whole board, and its lifted/dropped must be exactly the active tiles
  // whose height went up or down.
  function randomBoard(seed: number): Store {
    const rand = rng(seed);
    const store = openStore(":memory:");
    const density = 0.15 + rand() * 0.6;
    const mineAt = rand() < 0.7 ? Math.floor(rand() * 144) : -1;
    for (let id = 0; id < 144; id++) {
      if (id === mineAt) store.claim(id, ME, "Me", NOW);
      else if (rand() < density) store.claim(id, `p${id}`, `P${id}`, rand() < 0.3 ? OLD : NOW);
    }
    return store;
  }
  const snapshot = (store: Store) => store.tiles().map((t) => ({ ...t }));

  it("agrees with the server's heights for every claimable tile on random boards", () => {
    let checked = 0;
    const corners = new Set([at(0, 0), at(0, 11), at(11, 0), at(11, 11)]);
    let cornersSeen = 0;
    let movesSeen = 0;
    let dormantTargets = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rows = snapshot(randomBoard(seed));
      const before = boardView(rows, ME, NOW);
      for (const t of before.tiles) {
        const p = previewOf(before, t.id);
        if (t.state === "held" || t.state === "mine") {
          expect(p, `tile ${t.id} (${t.state}) can't be previewed`).toBeNull();
          continue;
        }
        // Claim it for real, on a fresh store rebuilt from the same rows.
        const store = openStore(":memory:");
        for (const r of rows) if (r.claimerId) store.claim(r.id, r.claimerId, r.label ?? "", new Date(r.lastSeenAt ?? NOW));
        expect(store.claim(t.id, ME, "Me", NOW), `seed ${seed} tile ${t.id}`).toBe("claimed");
        const real = heights(store.tiles(), NOW);
        const after = boardView(store.tiles(), ME, NOW);

        expect(p!.heights, `seed ${seed}, claiming tile ${t.id}`).toEqual(real);
        expect(p!.height).toBe(real[t.id]);
        const activeBefore = (i: number) => before.tiles[i].state === "held";
        const rose = after.tiles.filter((x) => activeBefore(x.id) && x.height > before.tiles[x.id].height).map((x) => x.id);
        const fell = after.tiles.filter((x) => activeBefore(x.id) && x.height < before.tiles[x.id].height).map((x) => x.id);
        expect(p!.lifted, `seed ${seed} tile ${t.id} lifted`).toEqual(rose);
        expect(p!.dropped, `seed ${seed} tile ${t.id} dropped`).toEqual(fell);

        checked++;
        if (corners.has(t.id)) cornersSeen++;
        if (p!.from !== null && p!.dropped.length) movesSeen++;
        if (t.state === "dormant") dormantTargets++;
      }
    }
    // Not a vacuous pass: the boards really did cover the cases.
    expect(checked).toBeGreaterThan(1000);
    expect(cornersSeen).toBeGreaterThan(10);
    expect(movesSeen).toBeGreaterThan(10);
    expect(dormantTargets).toBeGreaterThan(50);
  });

  it("names the lifted neighbours, diagonals and edges included", () => {
    const { store, view } = scene();
    store.claim(at(0, 1), MIA, "Mia", NOW); // edge, beside the corner
    store.claim(at(1, 1), KAI, "Kai", NOW); // diagonal from the corner
    store.claim(at(1, 0), ZOE, "Zoe", OLD); // faded: stands, lifts nobody, isn't lifted
    const p = previewOf(view(), at(0, 0))!;
    expect(p).toMatchObject({ height: 2, lifted: [at(0, 1), at(1, 1)], dropped: [], from: null });
  });

  it("drops my old neighbours when I'd move away", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    expect(previewOf(view(), at(9, 9))).toMatchObject({ height: 0, lifted: [], dropped: [at(5, 6)], from: at(5, 5) });
  });

  it("doesn't change the board it's given", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const board = view();
    const copy = structuredClone(board);
    previewOf(board, at(4, 4));
    expect(board).toEqual(copy);
  });

  it("feeds the confirm bar's wording", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    expect(describeTile(view(), at(9, 9)).title).toBe("No neighbours yet. Moving drops 1.");
    store.claim(at(1, 1), KAI, "Kai", NOW);
    expect(describeTile(view(), at(1, 2)).title).toBe("Would lift 1 neighbour. Moving drops 1.");
  });
});

describe("the tile inspector", () => {
  it("shows holder, height, claimed neighbours and the protection left", () => {
    const { store, view } = scene();
    const earlier = new Date(NOW.getTime() - (60 + 48) * 60 * 1000); // 1 h 48 m ago
    store.claim(at(5, 5), MIA, "Mia", earlier);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    expect(inspect(view(), at(5, 5), NOW)).toEqual({
      title: "Mia: row 6, column 6",
      facts: [
        ["Holder", "Mia"],
        ["Height", "1"],
        ["Claimed neighbours", "1 of 8"],
        ["Protection", "safe for 22 h 12 m"],
      ],
    });
  });

  it("says a faded tile is open, my own is mine, and what settling would do", () => {
    const { store, view } = scene();
    store.claim(at(0, 0), MIA, "Mia", new Date(NOW.getTime() - 25 * 60 * 60 * 1000));
    store.claim(at(0, 1), ME, "Me", NOW);
    const faded = inspect(view(), at(0, 0), NOW);
    expect(faded.facts).toContainEqual(["Protection", "faded — open to settle"]);
    expect(faded.facts).toContainEqual(["Claimed neighbours", "1 of 3"]);
    expect(faded.facts).toContainEqual(["If you settle here", "height 0. No neighbours yet."]);
    expect(inspect(view(), at(0, 1), NOW).facts).toContainEqual(["Protection", "yours"]);
    expect(inspect(view(), at(0, 1), NOW).facts).toContainEqual(["Claimed neighbours", "0 of 5, plus 1 faded"]);
  });

  it("counts down", () => {
    const until = "2026-10-01T12:00:00.000Z";
    expect(safeFor(until, new Date("2026-10-01T10:30:00.000Z"))).toBe("safe for 1 h 30 m");
    expect(safeFor(until, new Date("2026-10-01T11:59:00.000Z"))).toBe("safe for 1 m");
    expect(safeFor(until, new Date("2026-10-01T11:59:30.000Z"))).toBe("safe for under a minute");
    expect(safeFor(until, new Date("2026-10-01T12:00:01.000Z"))).toBe("fading now");
  });
});

describe("someone else's fresh claim", () => {
  it("marks tiles that became claimed or changed hands, never mine or a rise", () => {
    const { store, view } = scene();
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    store.claim(at(2, 2), MIA, "Mia", old);
    store.claim(at(2, 3), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(2, 2), ZOE, "Zoe", NOW); // takes Mia's faded tile
    store.claim(at(9, 9), MIA, "Mia", NOW); // Mia comes back elsewhere
    store.claim(at(2, 4), ME, "Me", NOW); // mine: not marked
    expect(arrivals(before, view()).sort((a: number, b: number) => a - b)).toEqual([at(2, 2), at(9, 9)]);
  });
});

describe("which board to show", () => {
  it("keeps the newest board, and drops a repeat or an older one", () => {
    expect(accepts(100, 101)).toBe(true);
    expect(accepts(100, 100)).toBe(false);
    expect(accepts(100, 99)).toBe(false);
  });

  it("takes a restarted server's first board even when its version is lower", () => {
    // The old process got to 5000 (a burst of claims ran past its clock); the
    // new one starts from its clock at 4000.
    expect(accepts(5000, 4000, 5000)).toBe(true);
  });

  it("but not a reconnect's first board that is merely older than my claim's reply", () => {
    // Same server: the stream last sent 100, my claim's reply showed 101, and
    // the reconnect's first board is still 100.
    expect(accepts(101, 100, 100)).toBe(false);
  });
});
