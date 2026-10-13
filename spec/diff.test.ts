import { describe, expect, it } from "vitest";
import { boardView } from "../src/board.ts";
import { openStore, type Store } from "../src/db.ts";
// @ts-expect-error: a plain browser module with no type declarations
import { describeTile, diffBoards } from "../public/diff.js";

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
    expect(messages.map((m) => m.text)).toEqual(["Kai settled beside you.", "Mia moved away from beside you."]);
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
    // My tile swapped one claimed neighbour (5,7) for another (5,6), so its
    // height didn't change and it floats nothing either.
    expect(rises).toEqual([]);
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
