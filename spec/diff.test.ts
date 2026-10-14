import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { boardView, heights, neighbourCounts, renderBoard } from "../src/board.ts";
import { type Landmark, type Me, openStore, type Store, type Tile } from "../src/db.ts";
import { ECONOMY as SERVER_ECONOMY, rate as serverRate } from "../src/economy.ts";
import {
  accepts,
  arrivals,
  canHelp,
  dashParts,
  describeTile,
  diffBoards,
  ECONOMY,
  eventText,
  goal,
  goalParts,
  helpsWith,
  inspect,
  leaseSoon,
  pendingNow,
  preview,
  raisedText,
  rateOf,
  relocateInfo,
  renewOptions,
  tileAria,
  timeLeft,
  upgradeInfo,
  upgrades,
  welcomeText,
  // @ts-expect-error: a plain browser module with no type declarations
} from "../public/diff.js";

// The page's pure module, fed real boards from the real store and the
// server's own boardView, so a change to what the server sends and a change
// to how the page reads it can't drift apart.
const NOW = new Date("2026-10-01T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const ME = "me-pid";
const MIA = "mia-pid";
const KAI = "kai-pid";
const ZOE = "zoe-pid";

// Tile ids on the 12×12 board: row r, column c (both from 0).
const at = (r: number, c: number): number => r * 12 + c;

type View = ReturnType<typeof boardView>;
function scene(): { store: Store; view: (pid?: string, now?: Date) => View } {
  const store = openStore(":memory:");
  return {
    store,
    view: (pid = ME, now = NOW) => boardView(store.tiles(), pid, now, store.landmarks(), { me: store.me(pid, now), events: store.events(8) }),
  };
}
// A view with my wallet changed, for the money rules (the store is the
// authority on coins; these tests only read what the page does with them).
const withMe = (v: View, me: Partial<Me> & { welcome?: number; expired?: true }): View => ({ ...v, me: { ...v.me, ...me } });

describe("the game's numbers", () => {
  it("are the server's, field by field", () => {
    expect(ECONOMY).toEqual(SERVER_ECONOMY);
  });

  it("give the server's income for every level and neighbour count", () => {
    for (let level = 1; level <= 5; level++) for (let n = 0; n <= 8; n++) expect(rateOf(level, n), `level ${level}, ${n} neighbours`).toBe(serverRate(level, n));
  });
});

describe("narration: my own building only", () => {
  it("says the land is claimed, and whose income my arrival raised", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 5), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(3, 4), ME, "Me", NOW);
    const [msg] = diffBoards(before, view()).messages;
    expect(msg).toEqual({ key: "claimed", text: "Land claimed! Your building is now generating income. Mia and Kai now earn more." });
  });

  it("says exactly the claim line when I settle alone", () => {
    const { store, view } = scene();
    const before = view();
    store.claim(at(0, 0), ME, "Me", NOW);
    expect(diffBoards(before, view()).messages).toEqual([{ key: "claimed", text: "Land claimed! Your building is now generating income." }]);
  });

  it("tells me who built next to me, that my income rose, and my neighbour count", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    store.claim(at(5, 4), ZOE, "Zoe", NOW);
    store.claim(at(4, 4), "x", "X", NOW);
    const before = view();
    store.claim(at(6, 6), MIA, "Alex", NOW);
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "arrived", text: "Alex built next to you. Your income increased! Your building now has 4 neighbours." },
    ]);
  });

  it("tells me a neighbour relocated and my income changed", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const before = view();
    expect(store.claim(at(0, 0), MIA, "Mia", NOW)).toBe("moved");
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "left", text: "Your neighbour relocated. Your income has changed. Your building now has 0 neighbours." },
    ]);
  });

  it("tells me a neighbour's lease ended, as distinct from a move", () => {
    const { store, view } = scene();
    store.claim(at(5, 6), MIA, "Mia", new Date(NOW.getTime() - 23 * HOUR));
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    const later = new Date(NOW.getTime() + 2 * HOUR); // Mia's 24 h lease ended
    expect(diffBoards(before, view(ME, later)).messages.map((m: { text: string }) => m.text)).toEqual([
      "Your neighbour's lease ended. Your income has changed. Your building now has 0 neighbours.",
    ]);
  });

  it("says nothing about changes away from my building, or when nothing changed", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    store.claim(at(0, 0), MIA, "Mia", NOW);
    expect(diffBoards(before, view()).messages).toEqual([]);
    expect(diffBoards(view(), view())).toEqual({ rises: [], messages: [] });
  });

  it("says my move and my new income", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    store.claim(at(1, 1), KAI, "Kai", NOW);
    const mid = view();
    store.claim(at(1, 2), ME, "Me", NOW);
    expect(diffBoards(mid, view()).messages[0]).toEqual({ key: "claimed", text: "Moved to row 2, column 3. Your income is now 12 coins/min. Kai now earns more." });
    expect(before).toBeTruthy();
  });

  it("floats +1/−1 on buildings that kept their holder, never on a new one", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 5), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(3, 4), ZOE, "Zoe", NOW);
    const { rises } = diffBoards(before, view());
    expect(rises.sort((a: { id: number }, b: { id: number }) => a.id - b.id)).toEqual([
      { id: at(3, 3), delta: 1 },
      { id: at(3, 5), delta: 1 },
    ]);
  });
});

describe("the returning player's notices", () => {
  it("say what was earned away, and that a lease ended", () => {
    expect(welcomeText({ welcome: 340 })).toBe("Welcome back! Your building earned 340 coins while you were away.");
    expect(welcomeText({})).toBeNull();
    const doc = (me: object) => new JSDOM(renderBoard(withMe(scene().view(), me), "")).window.document;
    expect(doc({ welcome: 12 }).querySelector('[data-notice="welcome"]')?.textContent).toBe("Welcome back! Your building earned 12 coins while you were away.");
    expect(doc({ expired: true }).querySelector('[data-notice="expired"]')?.textContent).toBe(
      "Your land lease has expired. Choose a new plot to continue building.",
    );
    expect(doc({}).querySelectorAll("[data-notice]")).toHaveLength(0);
  });
});

describe("upgrading", () => {
  it("shows level, next level, cost and both incomes, and why it's refused", () => {
    const { store, view } = scene();
    expect(upgradeInfo(view())).toMatchObject({ ok: false, reason: "no-land" });
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const v = view();
    expect(upgradeInfo(v)).toMatchObject({ ok: false, reason: "coins", level: 1, next: 2, nextName: "Townhouse", cost: 150, rate: 1200, nextRate: 2400, why: "You need 50 more coins." });
    expect(upgradeInfo(withMe(v, { coins: 150 }))).toMatchObject({ ok: true, reason: null });
    expect(upgradeInfo(withMe(v, { coins: 150 }), { busy: true })).toMatchObject({ ok: false, reason: "busy" });
    const top = { ...v, tiles: v.tiles.map((t) => (t.state === "mine" ? { ...t, level: 5 } : t)) };
    expect(upgradeInfo(withMe(top, { coins: 9999 }))).toMatchObject({ ok: false, reason: "max-level", why: "A Skyscraper is the top level." });
  });

  it("notices a building going up a level", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    const before = view();
    const after = { ...before, tiles: before.tiles.map((t) => (t.id === at(5, 5) ? { ...t, level: 2, height: 2 } : t)) };
    expect(upgrades(before, after)).toEqual([at(5, 5)]);
    expect(upgrades(before, before)).toEqual([]);
  });
});

describe("renewing", () => {
  it("offers 6, 12 and 24 hours, refusing any past 48 h from the claim", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const rich = withMe(view(), { coins: 1000 });
    expect(renewOptions(rich, NOW).map((o: { ok: boolean }) => o.ok)).toEqual([true, true, true]);
    // 40 h of lease from a claim: 24 h would pass 48, 6 wouldn't
    const late = withMe(rich, { leaseEndsAt: new Date(NOW.getTime() + 40 * HOUR).toISOString() });
    expect(renewOptions(late, NOW).map((o: { reason: string | null }) => o.reason)).toEqual([null, "max-lease", "max-lease"]);
    expect(renewOptions(late, NOW)[2].why).toBe("Past the 48 h limit");
    expect(renewOptions(view(), NOW).map((o: { reason: string | null }) => o.reason)).toEqual([null, "coins", "coins"]);
  });
});

describe("relocating", () => {
  it("shows from, to, cost, both incomes and the lease kept, or the cooldown", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.claim(at(1, 1), KAI, "Kai", NOW);
    const v = view();
    expect(relocateInfo(v, at(1, 2), NOW)).toMatchObject({ ok: true, from: at(5, 5), to: at(1, 2), cost: 50, rate: 1200, nextRate: 1200, lease: "24 h 0 m" });
    expect(relocateInfo(v, at(1, 1), NOW)).toBeNull(); // someone's building
    const cooling = withMe(v, { relocateAt: new Date(NOW.getTime() + 12 * MIN).toISOString() });
    expect(relocateInfo(cooling, at(1, 2), NOW)).toMatchObject({ ok: false, reason: "cooldown", why: "You can move again in 12 m." });
    expect(relocateInfo(withMe(v, { coins: 10 }), at(1, 2), NOW)).toMatchObject({ ok: false, reason: "coins" });
    expect(describeTile(v, at(1, 2), NOW)).toMatchObject({ kind: "move", action: "Move here · 50 coins", open: true });
  });
});

describe("helping", () => {
  it("is offered only at someone else's building beside mine, and says when it cools down", () => {
    const { store, view } = scene();
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.claim(at(5, 8), KAI, "Kai", NOW);
    expect(canHelp(view(), at(5, 6), NOW)).toBeNull(); // I hold nothing yet
    store.claim(at(5, 5), ME, "Me", NOW);
    expect(canHelp(view(), at(5, 6), NOW)).toEqual({ id: at(5, 6), label: "Mia", ok: true, wait: null });
    expect(canHelp(view(), at(5, 8), NOW)).toBeNull();
    expect(canHelp(view(), at(5, 5), NOW)).toBeNull();
    expect(canHelp(view(), at(6, 6), NOW)).toBeNull();
    const cooling = withMe(view(), { helpAt: new Date(NOW.getTime() + 40 * MIN).toISOString() });
    expect(canHelp(cooling, at(5, 6), NOW)).toMatchObject({ ok: false, wait: "40 m" });
  });
});

describe("money on the page", () => {
  it("counts uncollected income up from the last board, to the cap and the lease end", () => {
    const me = { pending: 500, rate: 1200, leaseEndsAt: new Date(NOW.getTime() + 10 * MIN).toISOString() };
    expect(pendingNow(me, NOW, new Date(NOW.getTime() + 30_000))).toBe(1100);
    expect(pendingNow(me, NOW, new Date(NOW.getTime() + 60 * MIN))).toBe(500 + 12_000); // stops at the lease end
    const long = { pending: 0, rate: 1000, leaseEndsAt: new Date(NOW.getTime() + 48 * HOUR).toISOString() };
    expect(pendingNow(long, NOW, new Date(NOW.getTime() + 10 * HOUR))).toBe(1000 * 240);
    expect(pendingNow(null, NOW, NOW)).toBe(0);
  });

  it("says time left in hours and minutes, and marks a lease ending within the hour", () => {
    expect(timeLeft(new Date(NOW.getTime() + 90 * MIN).toISOString(), NOW)).toBe("1 h 30 m");
    expect(timeLeft(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe("under a minute");
    expect(timeLeft(new Date(NOW.getTime() - 1).toISOString(), NOW)).toBe("ended");
    const t = (ms: number) => ({ state: "held", leaseEndsAt: new Date(NOW.getTime() + ms).toISOString() });
    expect(leaseSoon(t(59 * MIN), NOW)).toBe(true);
    expect(leaseSoon(t(61 * MIN), NOW)).toBe(false);
    expect(leaseSoon(t(-1), NOW)).toBe(false);
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

// A stored row, built directly: the server's height and income rules are
// pure functions of these, so random boards need no store.
const row = (id: number, pid: string | null, level = 1, leaseMs = 10 * HOUR): Tile => ({
  id,
  claimerId: pid,
  label: pid ? pid.toUpperCase() : null,
  claimedAt: pid ? NOW.toISOString() : null,
  level: pid ? level : null,
  leaseEndsAt: pid ? new Date(NOW.getTime() + leaseMs).toISOString() : null,
  ownedSince: pid ? NOW.toISOString() : null,
  pendingCents: 0,
  settledAt: pid ? NOW.toISOString() : null,
});

type Preview = { id: number; level: number; neighbours: number; height: number; rate: number; heights: number[]; rates: number[]; lifted: number[]; dropped: number[]; from: number | null };

describe("the placement preview", () => {
  // Random boards of buildings at random levels, some with leases already
  // ended (free on read), and maybe one of them mine. Every free plot is
  // previewed, then built on for real on a copy of the rows (a move keeps my
  // level and frees my old plot), and the preview must match the server's
  // heights and incomes for the whole board, and name exactly the buildings
  // whose income went up or down.
  it("agrees with the server's heights and income on random boards", () => {
    let checked = 0;
    let moves = 0;
    let lifts = 0;
    let expiredSeen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const density = 0.15 + rand() * 0.6;
      const mineAt = rand() < 0.7 ? Math.floor(rand() * 144) : -1;
      const rows: Tile[] = [];
      for (let id = 0; id < 144; id++) {
        const level = 1 + Math.floor(rand() * 5);
        if (id === mineAt) rows.push(row(id, ME, level));
        else if (rand() < density) rows.push(row(id, `p${id}`, level, rand() < 0.1 ? -HOUR : 10 * HOUR));
        else rows.push(row(id, null));
      }
      expiredSeen += rows.filter((r) => r.claimerId && r.leaseEndsAt! < NOW.toISOString()).length;
      const before = boardView(rows, ME, NOW);
      const mine = rows.find((r) => r.claimerId === ME);
      for (const t of before.tiles) {
        const p: Preview | null = preview(before, t.id);
        if (t.state !== "free") {
          expect(p, `tile ${t.id} (${t.state})`).toBeNull();
          continue;
        }
        const after = rows.map((r) =>
          r.id === t.id ? row(r.id, ME, mine?.level ?? 1) : r.claimerId === ME ? row(r.id, null) : r,
        );
        const hs = heights(after, NOW);
        const ns = neighbourCounts(after, NOW);
        const live = boardView(after, ME, NOW).tiles;
        expect(p!.heights, `seed ${seed}, plot ${t.id}`).toEqual(hs);
        expect(p!.rates, `seed ${seed}, plot ${t.id} rates`).toEqual(live.map((x) => x.rate));
        expect(p!.neighbours).toBe(ns[t.id]);
        expect(p!.rate).toBe(serverRate(mine?.level ?? 1, ns[t.id]));
        const held = (i: number) => before.tiles[i].state === "held";
        expect(p!.lifted).toEqual(live.filter((x) => held(x.id) && x.rate > before.tiles[x.id].rate).map((x) => x.id));
        expect(p!.dropped).toEqual(live.filter((x) => held(x.id) && x.rate < before.tiles[x.id].rate).map((x) => x.id));
        checked++;
        if (p!.from !== null) moves++;
        if (p!.lifted.length) lifts++;
      }
    }
    // Not a vacuous pass: the boards really did cover the cases.
    expect(checked).toBeGreaterThan(1000);
    expect(moves).toBeGreaterThan(300);
    expect(lifts).toBeGreaterThan(300);
    expect(expiredSeen).toBeGreaterThan(20);
  }, 30_000);

  it("says what building there would earn and whose income it raises", () => {
    const { store, view } = scene();
    store.claim(at(1, 1), MIA, "Mia", NOW);
    store.claim(at(1, 3), KAI, "Kai", NOW);
    expect(describeTile(view(), at(1, 2), NOW).title).toBe(
      "Earns 14 coins/min here, with 2 neighbours. Raises Mia and Kai's income. Building here brings Mia's building to 1 of 8 neighbours.",
    );
    expect(describeTile(view(), at(9, 9), NOW).title).toBe("Earns 10 coins/min here, with 0 neighbours.");
  });

  it("doesn't change the board it's given", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const board = view();
    const copy = structuredClone(board);
    preview(board, at(4, 4));
    expect(board).toEqual(copy);
  });
});

describe("the inspector", () => {
  it("shows owner, building, neighbours, income and lease", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    expect(inspect(view(), at(5, 5), new Date(NOW.getTime() + 90 * MIN))).toEqual({
      title: "Mia: row 6, column 6",
      facts: [
        ["Owner", "Mia"],
        ["Building", "Small House, level 1"],
        ["Neighbours", "1 of 8"],
        ["Income", "12 coins/min"],
        ["Lease", "22 h 30 m left"],
      ],
    });
    expect(inspect(view(), at(5, 5), new Date(NOW.getTime() + 23.5 * HOUR)).facts).toContainEqual(["Lease", "30 m left, ending soon"]);
  });
});

describe("someone else's fresh building", () => {
  it("marks plots that became built or changed hands, never mine", () => {
    const { store, view } = scene();
    const before = view();
    store.claim(at(9, 9), MIA, "Mia", NOW);
    store.claim(at(2, 4), ME, "Me", NOW);
    expect(arrivals(before, view())).toEqual([at(9, 9)]);
  });
});

describe("which board to show", () => {
  it("keeps the newest board, and drops a repeat or an older one", () => {
    expect(accepts(100, 101)).toBe(true);
    expect(accepts(100, 100)).toBe(false);
    expect(accepts(100, 99)).toBe(false);
  });

  it("takes a restarted server's first board even when its version is lower", () => {
    expect(accepts(5000, 4000, 5000)).toBe(true);
    expect(accepts(101, 100, 100)).toBe(false);
  });
});

// --- the room's goal: landmarks, now all 8 neighbours occupied ---

const line = (board: unknown): string => {
  const p = goalParts(goal(board));
  return `${p.count} ${p.noun} raised · ${p.lead}${p.who}${p.tail}${p.unit}`;
};
const landmark = (cellId: number, raisers: string[]): Landmark => ({ cellId, label: raisers[0], raisers, raisedAt: NOW.toISOString() });
const NINE = ["Mia", "Kai", "Zoe", "Ari", "Bo", "Cy", "Di", "Ed", "Flo"];

describe("the goal line", () => {
  it("names the building with the most neighbours, counted as neighbours, not height", () => {
    const { store } = scene();
    store.claim(at(4, 4), MIA, "Mia", NOW);
    store.claim(at(4, 5), KAI, "Kai", NOW);
    store.claim(at(5, 4), ZOE, "Zoe", NOW);
    const v = boardView(store.tiles(), ME, NOW, [landmark(at(9, 9), NINE)]);
    expect(line(v)).toBe("1 landmark raised · Closest: Mia's building, 2 of 8 neighbours");
    // a higher level makes Kai taller, not closer
    const taller = { ...v, tiles: v.tiles.map((t) => (t.id === at(4, 5) ? { ...t, level: 5, height: 7 } : t)) };
    expect(line(taller)).toBe("1 landmark raised · Closest: Mia's building, 2 of 8 neighbours");
  });

  it("says how to start one when nobody has a neighbour", () => {
    const { store, view } = scene();
    expect(line(view())).toBe("0 landmarks raised · Start one: build beside someone");
    store.claim(at(5, 5), MIA, "Mia", NOW);
    expect(goal(view()).helps.sort((a: number, b: number) => a - b)).toEqual([at(4, 4), at(4, 5), at(4, 6), at(5, 4), at(5, 6), at(6, 4), at(6, 5), at(6, 6)]);
  });

  it("glows the last gap round a building and says it completes a landmark", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    let n = 0;
    for (const id of [at(4, 4), at(4, 5), at(4, 6), at(5, 4), at(5, 6), at(6, 4), at(6, 5)]) store.claim(id, `n${n}`, `N${n++}`, NOW);
    expect(helpsWith(view(), at(6, 6))).toMatchObject({ id: at(5, 5), landmark: true });
    expect(goal(view()).helps).toContain(at(6, 6));
    expect(describeTile(view(), at(6, 6), NOW).title).toMatch(/ Building here completes a landmark!$/);
  });
});

describe("the page the server renders", () => {
  it("draws the goal line, glow and crown the way the page does", () => {
    const { store } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    const v = boardView(store.tiles(), ME, NOW, [landmark(at(5, 6), NINE)]);
    const doc = new JSDOM(renderBoard(v, "")).window.document;
    expect(doc.querySelector("[data-goal]")!.textContent!.replace(/\s+/g, " ")).toBe("1 landmark raised · Closest: Mia's building, 1 of 8 neighbours");
    const glowing = [...doc.querySelectorAll<HTMLButtonElement>("button.tile[data-helps]")].map((b) => Number(b.value));
    expect(glowing.length).toBeGreaterThan(0);
    expect(glowing.sort((a, b) => a - b)).toEqual(goal(v).helps.sort((a: number, b: number) => a - b));
    const crowned = doc.querySelector<HTMLButtonElement>(`button.tile[value="${at(5, 6)}"]`)!;
    expect(crowned.querySelector(":scope > .crown")).not.toBeNull();
    expect(crowned.getAttribute("aria-label")).toMatch(/\. Landmark raised by Mia, Kai, .* and Flo$/);
    expect(raisedText({ cellId: at(3, 3), label: "Mia", raisers: NINE })).toBe("Landmark raised at row 4, column 4 by Mia, Kai, Zoe, Ari, Bo, Cy, Di, Ed and Flo!");
    expect(tileAria("x", null)).toBe("x");
  });

  // Each state the dashboard can be in renders, with every action a real
  // form button posting to its route, enabled or disabled with its reason.
  const dashOf = (v: View) => {
    const doc = new JSDOM(renderBoard(v, "Me", { now: NOW })).window.document;
    const button = (act: string) => doc.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
    const why = (act: string) => doc.querySelector(`[data-why="${act}"]`)!.textContent;
    return { doc, button, why, text: (k: string) => doc.querySelector(`[data-dash-${k}]`)!.textContent };
  };

  it("renders the dashboard for someone with no land", () => {
    const { button, why, text } = dashOf(scene().view());
    expect(text("coins")).toBe("100");
    expect(text("building")).toBe("No building yet");
    for (const act of ["collect", "upgrade", "renew", "relocate"]) expect(button(act).disabled, act).toBe(true);
    expect(why("upgrade")).toBe("Claim a plot first, then upgrade its building.");
  });

  it("renders it for a level-1 owner short of coins, with the upgrade's reason", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const { doc, button, why, text } = dashOf(view());
    expect(text("building")).toBe("Small House · Lv 1");
    expect(text("rate")).toBe("10 coins/min");
    expect(button("upgrade").disabled).toBe(true);
    expect(button("upgrade").getAttribute("formaction")).toBe("/upgrade");
    expect(button("collect").getAttribute("formaction")).toBe("/collect");
    expect(why("upgrade")).toBe("Small House → Townhouse (level 1 → 2) for 150 coins. Income 10 → 20 coins/min. You need 50 more coins.");
    expect(doc.querySelector('[data-act-sub="upgrade"]')!.textContent).toBe("need 50");
    expect(button("relocate").disabled).toBe(false);
    // the renewals are form buttons too: 6 h affordable, 12 and 24 not
    const renew = [...doc.querySelectorAll<HTMLButtonElement>('button[formaction="/renew"]')];
    expect(renew.map((b) => [b.value, b.disabled])).toEqual([["6", false], ["12", true], ["24", true]]);
  });

  it("renders it for an owner who can afford the upgrade, and with something to collect", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const { button, text } = dashOf(withMe(view(), { coins: 400, pending: 1234 }));
    expect(button("upgrade").disabled).toBe(false);
    expect(button("collect").disabled).toBe(false);
    expect(text("pending")).toBe("12");
  });

  it("renders it for a Skyscraper owner: upgrade disabled at the top level", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const v = view();
    const top = withMe({ ...v, tiles: v.tiles.map((t) => (t.state === "mine" ? { ...t, level: 5, height: 5, rate: 5000 } : t)) }, { coins: 5000, level: 5 });
    const { doc, button, why, text } = dashOf(top);
    expect(text("building")).toBe("Skyscraper · Lv 5");
    expect(button("upgrade").disabled).toBe(true);
    expect(why("upgrade")).toBe("A Skyscraper is the top level.");
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("data-level")).toBe("5");
  });

  it("lists the city log, short", () => {
    const { store, view } = scene();
    for (let i = 0; i < 12; i++) store.claim(i, `p${i}`, `P${i}`, NOW);
    const doc = new JSDOM(renderBoard(view(), "")).window.document;
    const items = [...doc.querySelectorAll("[data-events] li")].map((li) => li.textContent);
    expect(items).toHaveLength(8);
    expect(items[0]).toBe("P11 built a Small House at row 1, column 12");
    expect(eventText({ type: "upgrade", label: "Mia", level: 3, cellId: 0 })).toBe("Mia upgraded to Apartment at row 1, column 1");
  });

  it("marks a lease ending within the hour on the plot, not by colour alone", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", new Date(NOW.getTime() - 23.5 * HOUR));
    const doc = new JSDOM(renderBoard(view(), "", { now: NOW })).window.document;
    const tile = doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!;
    expect(tile.getAttribute("data-lease")).toBe("soon");
    expect(tile.getAttribute("aria-label")).toMatch(/lease ending soon$/);
  });

  it("dashParts never throws on a board with no `me`", () => {
    const v = scene().view();
    expect(() => dashParts({ ...v, me: undefined }, NOW)).not.toThrow();
  });
});
