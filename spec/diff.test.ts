import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { boardView, heights, NOTICES, neighbourCounts, renderBoard } from "../src/board.ts";
import { type Landmark, type Me, openStore, type Park, type Store, type Tile } from "../src/db.ts";
import { ECONOMY as SERVER_ECONOMY, rate as serverRate } from "../src/economy.ts";
import {
  accepts,
  arrivals,
  canHelp,
  canPark,
  describeTile,
  diffBoards,
  doneText,
  ECONOMY,
  eventText,
  goal,
  goalParts,
  goalShown,
  heldText,
  helpButtonText,
  helpsWith,
  hudParts,
  inspect,
  leaseSoon,
  pendingNow,
  preview,
  raisedText,
  rateOf,
  refusalText,
  relocateInfo,
  renewOptions,
  returnGlow,
  returnTarget,
  rezoneOptions,
  tileAria,
  timeLeft,
  upgradeInfo,
  upgrades,
  welcomeSaid,
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
    view: (pid = ME, now = NOW) =>
      boardView(store.tiles(), pid, now, store.landmarks(), { me: store.me(pid, now), events: store.events(8), parks: store.parks() }),
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

  it("give the server's income with zone terms, floor included (docs/adr/0009)", () => {
    for (let level = 1; level <= 5; level++) {
      for (let n = 0; n <= 8; n++) {
        for (const bonus of [-80, -30, -10, 0, 15, 30, 35, 65]) expect(rateOf(level, n, bonus), `level ${level}, ${n}, ${bonus}`).toBe(serverRate(level, n, bonus));
      }
    }
  });
});

describe("narration: one short line about my own building, and a sentence to speak", () => {
  it("says my building is up, its income, and whose income my arrival raised", () => {
    const { store, view } = scene();
    store.claim(at(3, 3), MIA, "Mia", NOW);
    store.claim(at(3, 5), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(3, 4), ME, "Me", NOW);
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "claimed", text: "Your building is up! +14/min · Mia and Kai +20%", said: "Your building is up, earning 14 coins a minute. Mia and Kai now earn more." },
    ]);
  });

  it("says exactly the short line when I settle alone", () => {
    const { store, view } = scene();
    const before = view();
    store.claim(at(0, 0), ME, "Me", NOW);
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "claimed", text: "Your building is up! +10/min", said: "Your building is up, earning 10 coins a minute." },
    ]);
  });

  it("tells me who built beside me and what it did to my income", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    const before = view();
    store.claim(at(6, 6), MIA, "Alex", NOW);
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "arrived", text: "Alex built beside you · +20%", said: "Alex built beside you. Your income is up 20%." },
    ]);
  });

  it("tells me a neighbour moved away, and my income fell", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const before = view();
    expect(store.claim(at(0, 0), MIA, "Mia", NOW)).toBe("moved");
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "left", text: "Mia moved away · \u221220%", said: "Mia moved away. Your income is down 20%." },
    ]);
  });

  it("tells me a neighbour's lease ended, as distinct from a move", () => {
    const { store, view } = scene();
    store.claim(at(5, 6), MIA, "Mia", new Date(NOW.getTime() - 23 * HOUR));
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    const later = new Date(NOW.getTime() + 2 * HOUR); // Mia's 24 h lease ended
    expect(diffBoards(before, view(ME, later)).messages).toEqual([
      { key: "left", text: "Mia's lease ended · \u221220%", said: "Mia's lease ended. Your income is down 20%." },
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
    store.claim(at(1, 1), KAI, "Kai", NOW);
    const mid = view();
    store.claim(at(1, 2), ME, "Me", NOW);
    expect(diffBoards(mid, view()).messages).toEqual([
      { key: "claimed", text: "Moved! +12/min · Kai +20%", said: "Moved to row 2, column 3. You earn 12 coins a minute. Kai now earns more." },
    ]);
  });

  it("says my lease ended, once, in a few words", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const before = view();
    expect(diffBoards(before, view(ME, new Date(NOW.getTime() + 25 * HOUR))).messages).toEqual([
      { key: "expired", text: "Your lease ended. Pick a new plot.", said: "Your lease ended. Pick a new plot." },
    ]);
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

describe("what each action's answer says", () => {
  it("is one short line, with a full sentence for the live region", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const v = withMe(view(), { rate: 2000, level: 2, leaseEndsAt: new Date(NOW.getTime() + 30 * HOUR + 5 * MIN).toISOString() });
    expect(doneText("collected", { paid: 34 }, v, NOW)).toEqual({ text: "+34 collected", said: "Collected 34 coins." });
    expect(doneText("nothing-to-collect", {}, v, NOW)).toEqual({ text: "Nothing to collect yet", said: "Nothing to collect yet." });
    expect(doneText("upgraded", { level: 2 }, v, NOW)).toEqual({ text: "Townhouse! +20/min", said: "Upgraded to a Townhouse, earning 20 coins a minute." });
    expect(doneText("renewed", {}, v, NOW)).toEqual({ text: "Lease renewed · 30 h left", said: "Lease renewed: 30 h 5 m left." });
    expect(doneText("helped")).toEqual({ text: "Helped! +50 to them, +20 to you", said: "You helped your neighbour: 50 coins to them, 20 to you." });
    expect(doneText("renamed", { label: "Mo" })).toEqual({ text: "You're Mo", said: "Name saved: you're Mo." });
  });

  it("names each refusal in a few words", () => {
    expect(refusalText({ error: "coins", status: 402 })).toEqual({ text: "Not enough coins", said: "Not enough coins." });
    expect(refusalText({ status: 409 })).toEqual({ text: "Someone got there first", said: "Someone got there first." });
    expect(refusalText({ status: 403 })).toEqual({ text: "Refused: reload and try again", said: "Refused: reload and try again." });
    expect(refusalText({ error: "cooldown" }).text).toBe("Not yet: cooling down");
    expect(refusalText({ error: "label" }).text).toBe("Name: 1 to 24 characters");
    expect(refusalText({ error: "hours" }).text).toBe("Renew 6, 12 or 24 h");
    expect(refusalText({ network: true }, { claim: true }).text).toBe("Can't reach the server: nothing claimed");
    expect(refusalText({ network: true }).text).toBe("Can't reach the server: nothing changed");
    expect(refusalText({ status: 500 }).text).toBe("That didn't work (error 500)");
    expect(refusalText({ error: "constructor", status: 400 }).text).toBe("That didn't work (error 400)");
  });

  it("says whose a building is when it's clicked", () => {
    const { store, view } = scene();
    store.claim(at(2, 2), MIA, "Mia", NOW);
    expect(heldText(view(), at(2, 2))).toEqual({ text: "Mia's Small House", said: "Mia's Small House, row 3, column 3. Pick a free plot." });
  });

  it("keeps the server's notices to a short line each", () => {
    expect(NOTICES).toEqual({
      claimed: "Your building is up!",
      taken: "Someone got there first.",
      label: "Name: 1 to 24 characters.",
      cell: "No such plot.",
      moved: "Moved!",
      renamed: "Renamed.",
      collected: "Collected!",
      "nothing-to-collect": "Nothing to collect yet.",
      upgraded: "Upgraded!",
      renewed: "Lease renewed!",
      helped: "Helped! +50 to them, +20 to you",
      returned: "Helped back! +30 each",
      parked: "Park open!",
      rezoned: "Rezoned!",
      zone: "No such zone.",
      "same-zone": "Already that zone.",
      "park-limit": "2 parks at most.",
      coins: "Not enough coins.",
      cooldown: "Not yet: cooling down.",
      "max-level": "Already a Skyscraper.",
      "max-lease": "Lease is at the 48 h limit.",
      "no-land": "Pick a plot first.",
      "not-neighbour": "Only buildings next to yours.",
      hours: "Renew 6, 12 or 24 h.",
    });
    for (const text of Object.values(NOTICES)) expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(8);
  });
});

describe("the returning player's notices", () => {
  it("say what was earned away, and that a lease ended, in a line", () => {
    expect(welcomeText({ welcome: 340 })).toBe("Welcome back! +340 earned");
    expect(welcomeSaid({ welcome: 340 })).toBe("Welcome back! Your building earned 340 coins while you were away.");
    expect(welcomeText({})).toBeNull();
    const doc = (me: object) => new JSDOM(renderBoard(withMe(scene().view(), me), "")).window.document;
    expect(doc({ welcome: 12 }).querySelector('[data-notice="welcome"]')?.textContent).toBe("Welcome back! +12 earned");
    expect(doc({ expired: true }).querySelector('[data-notice="expired"]')?.textContent).toBe("Your lease ended. Pick a new plot.");
    // one line at a time: a lease that ended wins over a welcome
    expect(doc({ welcome: 12, expired: true }).querySelectorAll("[data-notice]")).toHaveLength(1);
    expect(doc({}).querySelectorAll("[data-notice]")).toHaveLength(0);
  });
});

describe("upgrading", () => {
  it("knows the next building, its cost and both incomes, and when it's out of reach", () => {
    const { store, view } = scene();
    expect(upgradeInfo(view())).toEqual({ ok: false, reason: "no-land" });
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    const v = view();
    expect(upgradeInfo(v)).toEqual({ ok: false, reason: "coins", level: 1, name: "Small House", rate: 1200, next: 2, nextName: "Townhouse", cost: 150, nextRate: 2400 });
    expect(upgradeInfo(withMe(v, { coins: 150 }))).toMatchObject({ ok: true, reason: null });
    const top = { ...v, tiles: v.tiles.map((t) => (t.state === "mine" ? { ...t, level: 5 } : t)) };
    expect(upgradeInfo(withMe(top, { coins: 9999 }))).toMatchObject({ ok: false, reason: "max-level" });
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
  it("knows 6, 12 and 24 hours, refusing any past 48 h from the claim", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const rich = withMe(view(), { coins: 1000 });
    expect(renewOptions(rich, NOW).map((o: { ok: boolean }) => o.ok)).toEqual([true, true, true]);
    // 40 h of lease from a claim: 24 h would pass 48, 6 wouldn't
    const late = withMe(rich, { leaseEndsAt: new Date(NOW.getTime() + 40 * HOUR).toISOString() });
    expect(renewOptions(late, NOW).map((o: { reason: string | null }) => o.reason)).toEqual([null, "max-lease", "max-lease"]);
    expect(renewOptions(view(), NOW).map((o: { reason: string | null }) => o.reason)).toEqual([null, "coins", "coins"]);
  });
});

describe("parks (docs/adr/0007)", () => {
  it("are offered at a free plot beside someone else's building, while I hold land, can pay and have room", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 7), MIA, "Mia", NOW);
    expect(canPark(view(), at(5, 6))).toMatchObject({ ok: true, cost: 60, lifts: [at(5, 7)], names: ["Mia"] });
    // beside only my own building: it would lift nobody, so it isn't offered
    expect(canPark(view(), at(4, 4))).toBeNull();
    // nor on a building, nor without land
    expect(canPark(view(), at(5, 7))).toBeNull();
    expect(canPark(view(KAI), at(5, 6))).toBeNull();
    expect(canPark(withMe(view(), { coins: 59 }), at(5, 6))).toMatchObject({ ok: false, reason: "coins" });
    expect(canPark(withMe(view(), { parks: 2 }), at(5, 6))).toMatchObject({ ok: false, reason: "park-limit" });
  });

  it("show as a park on the board, mine marked, with its placer's name and how long it has", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 7), MIA, "Mia", NOW);
    expect(store.park(ME, at(5, 6), NOW)).toBe("parked");
    const v = view();
    expect(v.me).toMatchObject({ parks: 1, parkLimit: 2, coins: 40 });
    expect(v.tiles[at(5, 6)]).toMatchObject({ state: "park", label: "Me", mine: true, height: 0 });
    expect(describeTile(v, at(5, 6), NOW)).toMatchObject({ kind: "park", title: "Your park · 2 h 0 m", action: null });
    expect(inspect(v, at(5, 6), NOW)).toEqual({ title: "Your park", facts: [["Lifts", "Mia +20%"], ["Closes", "in 2 h 0 m"]] });
    expect(inspect(view(MIA), at(5, 6), NOW)!.title).toBe("Me's park");
    expect(heldText(view(MIA), at(5, 6)).text).toBe("Me's park");
    // a park is no plot to build on: no preview, no claim
    expect(preview(v, at(5, 6))).toBeNull();
    // the page's own words for it, and its answer
    expect(doneText("parked")).toEqual({ text: "Park open! 2 h", said: "Park placed for 2 hours. It lifts the buildings round it, never your own." });
    expect(refusalText({ error: "park-limit", status: 400 }).text).toBe("2 parks at most");
    expect(eventText({ type: "park", label: "Me", cellId: at(5, 6) })).toBe("Me opened a park at row 6, column 7");
  });

  it("tells me when someone opens a park beside my building, and when it closes, never my own", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(9, 9), MIA, "Mia", NOW);
    const before = view();
    store.park(MIA, at(5, 6), NOW);
    const after = view();
    expect(after.tiles[at(5, 5)]).toMatchObject({ neighbours: 1, height: 2 });
    const d = diffBoards(before, after);
    expect(d.messages[0]).toMatchObject({ key: "arrived", text: "Mia opened a park beside you · +20%" });
    expect(d.rises).toEqual([{ id: at(5, 5), delta: 1 }]);
    expect(arrivals(before, after)).toEqual([at(5, 6)]);
    const closed = view(ME, new Date(NOW.getTime() + 2 * HOUR));
    expect(diffBoards(after, closed).messages[0]).toMatchObject({ key: "left", text: "Mia's park closed · \u221220%" });
    // my own park beside me lifts nobody I'd hear about
    expect(store.park(ME, at(4, 4), NOW)).toBe("parked");
    expect(view().tiles[at(4, 4)].state).toBe("park");
    expect(diffBoards(after, view()).messages).toEqual([]);
  });
});

describe("relocating", () => {
  it("knows from, to, cost and both incomes, or that it's cooling down", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.claim(at(1, 1), KAI, "Kai", NOW);
    const v = view();
    expect(relocateInfo(v, at(1, 2), NOW)).toEqual({ ok: true, reason: null, from: at(5, 5), to: at(1, 2), cost: 50, rate: 1200, nextRate: 1200, neighbours: 1 });
    expect(relocateInfo(v, at(1, 1), NOW)).toBeNull(); // someone's building
    const cooling = withMe(v, { relocateAt: new Date(NOW.getTime() + 12 * MIN).toISOString() });
    expect(relocateInfo(cooling, at(1, 2), NOW)).toMatchObject({ ok: false, reason: "cooldown" });
    expect(relocateInfo(withMe(v, { coins: 10 }), at(1, 2), NOW)).toMatchObject({ ok: false, reason: "coins" });
  });

  it("offers the move only when it can be made", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(1, 1), KAI, "Kai", NOW);
    const v = view();
    expect(describeTile(v, at(1, 2), NOW)).toMatchObject({ kind: "move", title: "+12/min · Kai +20%", action: "Move here · 50", open: true });
    const cooling = withMe(v, { relocateAt: new Date(NOW.getTime() + 12 * MIN).toISOString() });
    expect(describeTile(cooling, at(1, 2), NOW)).toMatchObject({ title: "+12/min · Kai +20% · move in 12 m", action: null, open: false });
    expect(describeTile(withMe(v, { coins: 10 }), at(1, 2), NOW)).toMatchObject({ title: "+12/min · Kai +20% · moving costs 50", action: null });
  });
});

describe("helping", () => {
  it("is possible only at someone else's building beside mine, and not while cooling down", () => {
    const { store, view } = scene();
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.claim(at(5, 8), KAI, "Kai", NOW);
    expect(canHelp(view(), at(5, 6), NOW)).toBeNull(); // I hold nothing yet
    store.claim(at(5, 5), ME, "Me", NOW);
    expect(canHelp(view(), at(5, 6), NOW)).toEqual({ id: at(5, 6), label: "Mia", ok: true, back: false });
    expect(canHelp(view(), at(5, 8), NOW)).toBeNull();
    expect(canHelp(view(), at(5, 5), NOW)).toBeNull();
    expect(canHelp(view(), at(6, 6), NOW)).toBeNull();
    const cooling = withMe(view(), { helpAt: new Date(NOW.getTime() + 40 * MIN).toISOString() });
    expect(canHelp(cooling, at(5, 6), NOW)).toEqual({ id: at(5, 6), label: "Mia", ok: false, back: false });
  });
});

// docs/adr/0008: the neighbour who helped me glows, and Help says "Help back".
describe("returning a favour", () => {
  it("glows and offers Help back only at the neighbour who helped me, inside the hour, while I can help", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.claim(at(4, 5), KAI, "Kai", NOW);
    expect(returnGlow(view(), NOW)).toBeNull();
    expect(store.help(MIA, at(5, 5), NOW)).toBe("helped");
    const v = view(ME, NOW);
    expect(returnTarget(v, NOW)).toBe(at(5, 6));
    expect(returnGlow(v, NOW)).toBe(at(5, 6));
    expect(canHelp(v, at(5, 6), NOW)).toMatchObject({ ok: true, back: true });
    expect(canHelp(v, at(4, 5), NOW)).toMatchObject({ ok: true, back: false }); // Kai never helped me
    expect(helpButtonText(canHelp(v, at(5, 6), NOW))).toEqual({
      text: "Help back +30 each",
      said: "Help Mia back: 80 coins to them, 50 to you",
    });
    expect(helpButtonText(canHelp(v, at(4, 5), NOW)).text).toBe("Help Kai · +50");
    // Mia's own page has nothing to return
    expect(returnGlow(view(MIA, NOW), NOW)).toBeNull();
    // the hour ends on the page's clock, with no new board
    expect(returnGlow(v, new Date(NOW.getTime() + HOUR))).toBeNull();
    // while my own help cools down, nothing glows: I couldn't act on it
    expect(store.help(ME, at(4, 5), NOW)).toBe("helped");
    expect(returnTarget(view(ME, NOW), NOW)).toBe(at(5, 6));
    expect(returnGlow(view(ME, NOW), NOW)).toBeNull();
  });

  it("is drawn by the server the same way, on that one tile, with words for a screen reader", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    store.help(MIA, at(5, 5), NOW);
    const doc = new JSDOM(renderBoard(view(ME, NOW), "Me", { now: NOW })).window.document;
    const glowing = [...doc.querySelectorAll<HTMLButtonElement>("button.tile[data-return]")];
    expect(glowing.map((b) => Number(b.value))).toEqual([at(5, 6)]);
    expect(glowing[0].getAttribute("aria-label")).toMatch(/Helped you: help back for 30 more each$/);
    expect(glowing[0].querySelector(".beacon")!.getAttribute("data-back")).toBe("+30");
    expect(doc.querySelectorAll(".beacon[data-back]")).toHaveLength(1);
    const theirs = new JSDOM(renderBoard(view(MIA, NOW), "Mia", { now: NOW })).window.document;
    expect(theirs.querySelectorAll("button.tile[data-return]")).toHaveLength(0);
  });

  it("says the return in one short line", () => {
    expect(doneText("returned")).toEqual({ text: "Helped back! +30 each", said: "You returned the favour: 30 more coins each." });
  });
});

describe("zoning (docs/adr/0009)", () => {
  it("offers my own building the other zones with their cost, only while I can pay and am not cooling down", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    expect(rezoneOptions(view(), NOW).map((o: { zone: string; text: string }) => [o.zone, o.text])).toEqual([
      ["market", "Market · 40"],
      ["factory", "Factory · 40"],
    ]);
    expect(rezoneOptions(view(), NOW)[1].said).toBe("Zone your building a factory for 40 coins: +35% you, \u221210% neighbours");
    expect(rezoneOptions(withMe(view(), { coins: 39 }), NOW)).toEqual([]);
    store.rezone(ME, "factory", NOW);
    expect(rezoneOptions(view(), NOW)).toEqual([]); // cooling down
    const later = new Date(NOW.getTime() + HOUR);
    expect(rezoneOptions(view(ME, later), later).map((o: { zone: string }) => o.zone)).toEqual(["civic", "market"]);
    // nobody else's building, and no land, offers nothing
    expect(rezoneOptions(view(MIA), NOW)).toEqual([]);
  });

  it("shows a building's zone in the inspector and its words, and leaves civic unsaid", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), KAI, "Kai", NOW);
    store.claim(at(5, 6), MIA, "Mia", NOW);
    expect(inspect(view(), at(5, 5), NOW).facts.map((f: string[]) => f[0])).toEqual(["Earns", "Neighbours", "Lease"]);
    store.rezone(KAI, "factory", NOW);
    expect(inspect(view(), at(5, 5), NOW).facts).toContainEqual(["Zone", "Factory · +35% you, \u221210% neighbours"]);
    expect(inspect(view(), at(5, 5), NOW).facts[0]).toEqual(["Earns", "+15.5/min"]);
    expect(inspect(view(), at(5, 6), NOW).facts[0]).toEqual(["Earns", "+11/min"]);
    expect(view().tiles[at(5, 5)].aria).toBeDefined();
    expect(eventText(view().events[0])).toBe("Kai zoned a factory");
  });

  it("tells me in one line when a neighbour zones a factory or a market beside me, never far away", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    store.claim(at(9, 9), ZOE, "Zoe", NOW);
    let before = view();
    store.rezone(KAI, "factory", NOW);
    expect(diffBoards(before, view()).messages).toEqual([
      { key: "zoned", text: "Kai built a factory beside you \u00b7 \u221210%", said: "Kai built a factory beside you. Your income is down 10%." },
    ]);
    before = view();
    store.rezone(ZOE, "factory", NOW);
    expect(diffBoards(before, view()).messages).toEqual([]);
    const later = new Date(NOW.getTime() + HOUR);
    before = view(ME, later);
    store.rezone(KAI, "market", later);
    expect(diffBoards(before, view(ME, later)).messages).toEqual([
      { key: "zoned", text: "Kai opened a market beside you \u00b7 +25%", said: "Kai opened a market beside you. Your income is up 25%." },
    ]);
    // my own rezone narrates nothing about neighbours: its answer says it
    before = view(ME, later);
    store.rezone(ME, "factory", later);
    expect(diffBoards(before, view(ME, later)).messages).toEqual([]);
    expect(doneText("rezoned", { zone: "factory" }, view(ME, later))).toEqual({ text: "Factory! +17/min", said: "Zoned a factory, earning 17 coins a minute." });
  });

  it("previews a factory moving in beside someone as +10%, and a market's gift on top of the +20%", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    store.claim(at(0, 0), ME, "Me", NOW);
    store.rezone(ME, "factory", NOW);
    const p = preview(view(), at(5, 6));
    expect(p.rate).toBe(1550);
    expect(p.pct[at(5, 5)]).toBe(10);
    expect(describeTile(view(), at(5, 6), NOW).title).toMatch(/^\+15\.5\/min · Mia \+10%/);
    const later = new Date(NOW.getTime() + HOUR);
    store.rezone(ME, "market", later);
    expect(inspect(view(ME, later), at(5, 6), later).facts).toContainEqual(["Lifts", "Mia +35%"]);
  });

  it("draws each building's zone on the server's page, for the roof icon", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), KAI, "Kai", NOW);
    store.claim(at(5, 7), MIA, "Mia", NOW);
    store.rezone(KAI, "market", NOW);
    const doc = new JSDOM(renderBoard(view(), "", { now: NOW })).window.document;
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("data-zone")).toBe("market");
    expect(doc.querySelector(`button.tile[value="${at(5, 7)}"]`)!.getAttribute("data-zone")).toBe("civic");
    expect(doc.querySelector(`button.tile[value="${at(0, 0)}"]`)!.hasAttribute("data-zone")).toBe(false);
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("aria-label")).toMatch(/Kai's Small House, market, height 1/);
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

describe("the wallet: only what you can act on now", () => {
  const owner = () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    return view();
  };

  it("doesn't exist without land", () => {
    expect(hudParts(scene().view(), NOW)).toBeNull();
    expect(hudParts({ ...scene().view(), me: undefined }, NOW)).toBeNull();
  });

  it("shows coins, income as +N/min, and the lease as a full ring for a new owner", () => {
    expect(hudParts(owner(), NOW)).toEqual({
      coins: "100",
      coinsSaid: "100 coins",
      rate: "+10/min",
      rateSaid: "Income 10 coins a minute",
      level: 1,
      collect: null,
      upgrade: null,
      lease: { left: "24 h 0 m", frac: 1, soon: false, said: "Lease: 24 h 0 m left" },
      renew: [],
    });
  });

  it("has no Collect while nothing waits, and one when a coin does", () => {
    expect(hudParts(owner(), NOW, 99)!.collect).toBeNull();
    expect(hudParts(owner(), NOW, 1234)!.collect).toEqual({ owed: 12, text: "+12", said: "Collect 12 coins" });
  });

  it("has no Upgrade until you can afford it, then names the next building and its cost", () => {
    expect(hudParts(withMe(owner(), { coins: 149 }), NOW)!.upgrade).toBeNull();
    expect(hudParts(withMe(owner(), { coins: 150 }), NOW)!.upgrade).toEqual({ next: 2, name: "Townhouse", cost: 150, said: "Upgrade to Townhouse for 150 coins" });
    const v = owner();
    const top = withMe({ ...v, tiles: v.tiles.map((t) => (t.state === "mine" ? { ...t, level: 5 } : t)) }, { coins: 99_999 });
    expect(hudParts(top, NOW)!.upgrade).toBeNull();
  });

  it("has no Renew above 6 h of lease, and only the options you can afford under it", () => {
    const v = withMe(owner(), { coins: 200 });
    const at = (h: number) => new Date(NOW.getTime() + h * HOUR);
    expect(hudParts(v, at(18 - 0.01))!.renew).toEqual([]); // 6 h 0.6 m left
    const under = hudParts(v, at(19))!; // 5 h left
    expect(under.renew.map((o: { hours: number; text: string; said: string }) => [o.hours, o.text, o.said])).toEqual([
      [6, "+6 h", "Renew lease 6 hours for 100 coins"],
      [12, "+12 h", "Renew lease 12 hours for 180 coins"],
    ]);
    expect(under.lease).toMatchObject({ left: "5 h 0 m", soon: false });
    expect(hudParts(v, at(23.5))!.lease).toMatchObject({ left: "30 m", soon: true, said: "Lease: 30 m left" });
    expect(hudParts(v, at(23.5))!.lease.frac).toBeCloseTo(0.5 / 24, 5);
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
  zone: "civic",
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

  // The same, with parks (docs/adr/0007) on the board: some mine, some
  // other people's (sometimes placed by a neighbour of the plot), some
  // ended. The page can't see who placed a park, so the preview starts from
  // the server's per-building counts; it must still agree exactly, mine
  // never lifting my own building.
  it("agrees with the server's heights and income on random boards with parks", () => {
    let checked = 0;
    let besideMyPark = 0;
    let besideOthers = 0;
    for (let seed = 101; seed <= 130; seed++) {
      const rand = rng(seed);
      const density = 0.15 + rand() * 0.5;
      const mineAt = rand() < 0.8 ? Math.floor(rand() * 144) : -1;
      const rows: Tile[] = [];
      const parks: Park[] = [];
      for (let id = 0; id < 144; id++) {
        const level = 1 + Math.floor(rand() * 5);
        if (id === mineAt) rows.push(row(id, ME, level));
        else if (rand() < density) rows.push(row(id, `p${id}`, level, rand() < 0.1 ? -HOUR : 10 * HOUR));
        else {
          rows.push(row(id, null));
          if (rand() < 0.2) {
            const r = rand();
            // mine, a stranger's, or the building beside it's own; a few ended
            const by = r < 0.3 ? ME : r < 0.6 ? "stranger" : `p${id + 1}`;
            const ends = rand() < 0.1 ? -MIN : HOUR;
            parks.push({ cellId: id, placedBy: by, label: by.toUpperCase(), placedAt: new Date(NOW.getTime() - HOUR).toISOString(), endsAt: new Date(NOW.getTime() + ends).toISOString() });
          }
        }
      }
      const before = boardView(rows, ME, NOW, [], { parks });
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
        const hs = heights(after, NOW, parks);
        const live = boardView(after, ME, NOW, [], { parks }).tiles;
        expect(p!.heights, `seed ${seed}, plot ${t.id}`).toEqual(hs);
        expect(p!.rates, `seed ${seed}, plot ${t.id} rates`).toEqual(live.map((x) => x.rate));
        expect(p!.neighbours).toBe(neighbourCounts(after, NOW, parks)[t.id]);
        const held = (i: number) => before.tiles[i].state === "held";
        expect(p!.lifted).toEqual(live.filter((x) => held(x.id) && x.rate > before.tiles[x.id].rate).map((x) => x.id));
        expect(p!.dropped).toEqual(live.filter((x) => held(x.id) && x.rate < before.tiles[x.id].rate).map((x) => x.id));
        const around = (pred: (x: { state: string; mine?: boolean }) => boolean) =>
          before.tiles.some((x) => x.state === "park" && pred(x) && Math.abs(Math.floor(x.id / 12) - Math.floor(t.id / 12)) <= 1 && Math.abs((x.id % 12) - (t.id % 12)) <= 1);
        if (around((x) => x.mine === true)) besideMyPark++;
        if (around((x) => x.mine === false)) besideOthers++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(besideMyPark).toBeGreaterThan(100);
    expect(besideOthers).toBeGreaterThan(100);
  }, 30_000);

  // The same with zones (docs/adr/0009) on every building, parks too, and
  // sometimes my own building zoned: the preview's incomes must equal the
  // server's to the cent, so its +N/min and each neighbour's +N% are true.
  it("agrees with the server's income on random boards with zones and parks", () => {
    const ZONES = ["civic", "market", "factory"];
    let checked = 0;
    let zoneMoves = 0;
    let factoryLifts = 0;
    for (let seed = 201; seed <= 225; seed++) {
      const rand = rng(seed);
      const density = 0.2 + rand() * 0.5;
      const mineAt = rand() < 0.8 ? Math.floor(rand() * 144) : -1;
      const myZone = ZONES[Math.floor(rand() * 3)];
      const rows: Tile[] = [];
      const parks: Park[] = [];
      for (let id = 0; id < 144; id++) {
        const level = 1 + Math.floor(rand() * 5);
        const zone = ZONES[Math.floor(rand() * 3)];
        if (id === mineAt) rows.push({ ...row(id, ME, level), zone: myZone });
        else if (rand() < density) rows.push({ ...row(id, `p${id}`, level, rand() < 0.1 ? -HOUR : 10 * HOUR), zone });
        else {
          rows.push(row(id, null));
          if (rand() < 0.15) {
            const by = rand() < 0.4 ? ME : "stranger";
            parks.push({ cellId: id, placedBy: by, label: by.toUpperCase(), placedAt: new Date(NOW.getTime() - HOUR).toISOString(), endsAt: new Date(NOW.getTime() + HOUR).toISOString() });
          }
        }
      }
      const before = boardView(rows, ME, NOW, [], { parks });
      const mine = rows.find((r) => r.claimerId === ME);
      for (const t of before.tiles) {
        const p: (Preview & { pct: Record<string, number> }) | null = preview(before, t.id);
        if (t.state !== "free") continue;
        // a move keeps my zone; a first claim is civic
        const after = rows.map((r) =>
          r.id === t.id ? { ...row(r.id, ME, mine?.level ?? 1), zone: mine?.zone ?? "civic" } : r.claimerId === ME ? row(r.id, null) : r,
        );
        const live = boardView(after, ME, NOW, [], { parks }).tiles;
        expect(p!.rates, `seed ${seed}, plot ${t.id} rates`).toEqual(live.map((x) => x.rate));
        expect(p!.rate).toBe(live[t.id].rate);
        const held = (i: number) => before.tiles[i].state === "held";
        expect(p!.lifted).toEqual(live.filter((x) => held(x.id) && x.rate > before.tiles[x.id].rate).map((x) => x.id));
        expect(p!.dropped).toEqual(live.filter((x) => held(x.id) && x.rate < before.tiles[x.id].rate).map((x) => x.id));
        // each moved building's mark is its change over its base, in points
        for (const i of [...p!.lifted, ...p!.dropped]) {
          const base = (before.tiles[i].level ?? 1) * 1000;
          expect(p!.pct[i], `seed ${seed}, plot ${t.id}, neighbour ${i}`).toBe((live[i].rate - before.tiles[i].rate) / (base / 100));
          if (p!.pct[i] !== 20 && p!.pct[i] !== -20) zoneMoves++;
          if (mine?.zone === "factory" && p!.lifted.includes(i)) factoryLifts++;
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(800);
    expect(zoneMoves).toBeGreaterThan(300);
    expect(factoryLifts).toBeGreaterThan(20);
  }, 30_000);

  it("says what building there would earn and whose income it raises, in numbers", () => {
    const { store, view } = scene();
    store.claim(at(1, 1), MIA, "Mia", NOW);
    store.claim(at(1, 3), KAI, "Kai", NOW);
    expect(describeTile(view(), at(1, 2), NOW)).toMatchObject({ kind: "claim", title: "+14/min · Mia and Kai +20%", action: "Build here" });
    expect(describeTile(view(), at(9, 9), NOW).title).toBe("+10/min");
    expect(describeTile(view(), at(1, 1), NOW)).toMatchObject({ kind: "held", title: "Mia's Small House", action: null });
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
  it("shows a building's owner, income, neighbours and lease, in short facts", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    expect(inspect(view(), at(5, 5), new Date(NOW.getTime() + 90 * MIN))).toEqual({
      title: "Mia's Small House",
      facts: [
        ["Earns", "+12/min"],
        ["Neighbours", "1 of 8"],
        ["Lease", "22 h 30 m left"],
      ],
    });
  });

  it("shows what a free plot would earn and whom it would lift", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    expect(inspect(view(), at(5, 6), NOW)).toEqual({ title: "Free plot", facts: [["Earns", "+12/min"], ["Lifts", "Mia +20%"]] });
    expect(inspect(view(), at(0, 11), NOW)).toEqual({ title: "Free plot", facts: [["Earns", "+10/min"]] });
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
  return `${p.count} ${p.noun} raised · ${p.lead}${p.who}${p.tail}${p.unit}${p.tier}`;
};
const landmark = (cellId: number, raisers: string[], tier: Landmark["tier"] = "gold"): Landmark => ({ cellId, tier, label: raisers[0], raisers, raisedAt: NOW.toISOString() });
const NINE = ["Mia", "Kai", "Zoe", "Ari", "Bo", "Cy", "Di", "Ed", "Flo"];

describe("the goal line", () => {
  it("names the building nearest its next tier, counted as neighbours, not height (ADR 6)", () => {
    const { store } = scene();
    store.claim(at(4, 4), MIA, "Mia", NOW);
    store.claim(at(4, 5), KAI, "Kai", NOW);
    store.claim(at(5, 4), ZOE, "Zoe", NOW);
    const v = boardView(store.tiles(), ME, NOW, [landmark(at(9, 9), NINE)]);
    expect(line(v)).toBe("1 landmark raised · Closest: Mia's building, 2 of 3 neighbours for bronze");
    // a higher level makes Kai taller, not closer
    const taller = { ...v, tiles: v.tiles.map((t) => (t.id === at(4, 5) ? { ...t, level: 5, height: 7 } : t)) };
    expect(line(taller)).toBe("1 landmark raised · Closest: Mia's building, 2 of 3 neighbours for bronze");
  });

  it("names the next tier after a cell's crown: 4 of 5 for silver once bronze stands", () => {
    const { store } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    // the four diagonals: each has only Mia beside it
    [at(4, 4), at(4, 6), at(6, 4), at(6, 6)].forEach((id, i) => store.claim(id, `r${i}`, `R${i}`, NOW));
    const bronze = boardView(store.tiles(), ME, NOW, store.raise(NOW));
    expect(bronze.landmarks.cells[String(at(5, 5))].tier).toBe("bronze");
    expect(line(bronze)).toMatch(/· Closest: Mia's building, 4 of 5 neighbours for silver$/);
    // the next gap glows, and says it completes silver
    expect(helpsWith(bronze, at(5, 6))).toMatchObject({ id: at(5, 5), tier: "silver", landmark: true });
    expect(goal(bronze).helps).toContain(at(5, 6));
    // once silver stands, Mia's next is gold: 5 of 8
    store.claim(at(5, 6), "r4", "R4", NOW);
    store.raise(NOW);
    const silver = boardView(store.tiles(), ME, NOW, store.landmarks());
    expect(silver.landmarks.cells[String(at(5, 5))].tier).toBe("silver");
    expect(goalParts(goal(silver)).tier).toMatch(/^ for (silver|gold|bronze)$/);
    expect(inspect(silver, at(6, 5), NOW).facts.find((f: string[]) => f[0] === "Landmark")?.[1]).toMatch(/ → \d of \d for (bronze|silver|gold)$|^completes (bronze|silver|gold)!$/);
  });

  it("never chases a tier a plot can't reach: a corner stops at bronze, an edge at silver", () => {
    const { store, view } = scene();
    // a corner with all 3 of its neighbours, crowned bronze
    [at(0, 0), at(0, 1), at(1, 0), at(1, 1)].forEach((id, i) => store.claim(id, `c${i}`, `C${i}`, NOW));
    const v = boardView(store.tiles(), ME, NOW, store.raise(NOW));
    expect(v.landmarks.cells[String(at(0, 0))].tier).toBe("bronze");
    expect(goal(v).closest?.id).not.toBe(at(0, 0));
    expect(goal(view()).closest?.id).not.toBe(at(0, 0));
  });

  it("says how to start one when nobody has a neighbour", () => {
    const { store, view } = scene();
    expect(line(view())).toBe("0 landmarks raised · Start one: build beside someone");
    store.claim(at(5, 5), MIA, "Mia", NOW);
    expect(goal(view()).helps.sort((a: number, b: number) => a - b)).toEqual([at(4, 4), at(4, 5), at(4, 6), at(5, 4), at(5, 6), at(6, 4), at(6, 5), at(6, 6)]);
  });

  it("glows the last gap round a building and says it completes gold", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    let n = 0;
    for (const id of [at(4, 4), at(4, 5), at(4, 6), at(5, 4), at(5, 6), at(6, 4), at(6, 5)]) store.claim(id, `n${n}`, `N${n++}`, NOW);
    const v = boardView(store.tiles(), ME, NOW, store.raise(NOW));
    expect(v.landmarks.cells[String(at(5, 5))].tier).toBe("silver");
    expect(helpsWith(v, at(6, 6))).toMatchObject({ id: at(5, 5), tier: "gold", landmark: true });
    expect(goal(v).helps).toContain(at(6, 6));
    expect(inspect(v, at(6, 6), NOW).facts).toContainEqual(["Landmark", "completes gold!"]);
  });
});

describe("the goal line", () => {
  it("stays hidden until some building is one neighbour short of a tier, or a crown stands", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    expect(goalShown(goal(view()))).toBe(false);
    const hiddenDoc = new JSDOM(renderBoard(view(), "")).window.document;
    expect(hiddenDoc.querySelector("[data-goal]")!.hasAttribute("hidden")).toBe(true);
    store.claim(at(4, 4), "r0", "R0", NOW); // 1 of 3: two short
    expect(goalShown(goal(view()))).toBe(false);
    store.claim(at(4, 5), "r1", "R1", NOW); // 2 of 3: one short
    expect(goalShown(goal(view()))).toBe(true);
    const shownDoc = new JSDOM(renderBoard(view(), "")).window.document;
    expect(shownDoc.querySelector("[data-goal]")!.hasAttribute("hidden")).toBe(false);
    // an inspector says nothing about landmarks while the goal is hidden
    const early = scene();
    early.store.claim(at(5, 5), MIA, "Mia", NOW);
    expect(inspect(early.view(), at(5, 6), NOW).facts.map((f: string[]) => f[0])).not.toContain("Landmark");
    expect(goalShown({ count: 1, closest: null, helps: [] })).toBe(true);
  });
});

describe("the page the server renders", () => {
  it("draws the goal line, glow and crown the way the page does", () => {
    const { store } = scene();
    store.claim(at(5, 5), MIA, "Mia", NOW);
    store.claim(at(5, 6), KAI, "Kai", NOW);
    const v = boardView(store.tiles(), ME, NOW, [landmark(at(5, 6), NINE)]);
    const doc = new JSDOM(renderBoard(v, "")).window.document;
    expect(doc.querySelector("[data-goal]")!.textContent!.replace(/\s+/g, " ")).toBe("1 landmark raised · Closest: Mia's building, 1 of 3 neighbours for bronze");
    const glowing = [...doc.querySelectorAll<HTMLButtonElement>("button.tile[data-helps]")].map((b) => Number(b.value));
    expect(glowing.length).toBeGreaterThan(0);
    expect(glowing.sort((a, b) => a - b)).toEqual(goal(v).helps.sort((a: number, b: number) => a - b));
    const crowned = doc.querySelector<HTMLButtonElement>(`button.tile[value="${at(5, 6)}"]`)!;
    expect(crowned.querySelector(":scope > .crown")).not.toBeNull();
    expect(crowned.dataset.tier).toBe("gold");
    expect(crowned.getAttribute("aria-label")).toMatch(/\. Gold landmark raised by Mia, Kai, .* and Flo$/);
    expect(raisedText({ cellId: at(3, 3), tier: "gold", label: "Mia", raisers: NINE })).toBe("Gold landmark raised at row 4, column 4 by Mia, Kai, Zoe, Ari, Bo, Cy, Di, Ed and Flo!");
    expect(tileAria("x", null)).toBe("x");
  });

  it("shows a cell's highest tier only, and counts crowned cells, not rows", () => {
    const rows = [landmark(at(5, 5), NINE.slice(0, 4), "bronze"), landmark(at(5, 5), NINE.slice(0, 6), "silver"), landmark(at(2, 2), NINE.slice(0, 4), "bronze")];
    const v = boardView(scene().store.tiles(), ME, NOW, rows);
    expect(v.landmarks.count).toBe(2);
    expect(v.landmarks.cells[String(at(5, 5))]).toEqual({ tier: "silver", label: "Mia", raisers: NINE.slice(0, 6) });
    const doc = new JSDOM(renderBoard(v, "")).window.document;
    const tierOf = (id: number) => doc.querySelector<HTMLButtonElement>(`button.tile[value="${id}"]`)!.dataset.tier;
    expect([tierOf(at(5, 5)), tierOf(at(2, 2)), tierOf(at(7, 7))]).toEqual(["silver", "bronze", undefined]);
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("aria-label")).toMatch(/\. Silver landmark raised by Mia, Kai, Zoe, Ari, Bo and Cy$/);
    // bronze and silver are the lighter line: no "!", and the names cut short
    expect(raisedText({ cellId: at(5, 5), tier: "silver", label: "Mia", raisers: NINE.slice(0, 6) })).toBe("Silver crown at row 6, column 6: Mia, Kai and 4 others");
    expect(raisedText({ cellId: at(2, 2), tier: "bronze", label: "Mia", raisers: NINE.slice(0, 4) })).toBe("Bronze crown at row 3, column 3: Mia, Kai and 2 others");
  });

  it("agrees with the server on which tiers a building's neighbours reach, on random boards", () => {
    let seed = 11;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let checked = 0;
    for (let round = 0; round < 20; round++) {
      const store = openStore(":memory:");
      for (let id = 0; id < 144; id++) if (rand() < 0.45) store.claim(id, `p${id}`, `P${id}`, NOW);
      const v = boardView(store.tiles(), ME, NOW, store.raise(NOW));
      for (const t of v.tiles) {
        if (t.state === "free") continue;
        const reached = ECONOMY.landmarkTiers.filter((x: { neighbours: number }) => t.neighbours >= x.neighbours).map((x: { tier: string }) => x.tier);
        expect(v.landmarks.cells[String(t.id)]?.tier).toBe(reached.at(-1));
        checked += reached.length > 0 ? 1 : 0;
      }
      store.close();
    }
    expect(checked).toBeGreaterThan(50);
  });

  // What the page renders, and what it leaves out: a control that can't be
  // used isn't drawn disabled with a reason, it isn't there. Every action
  // that is there is a real form button posting to its route.
  const pageOf = (v: View, now = NOW) => {
    const doc = new JSDOM(renderBoard(v, "Me", { now })).window.document;
    // shown: present, and neither it nor an ancestor is [hidden]
    const shown = (sel: string): boolean => {
      const el = doc.querySelector(sel);
      return el !== null && el.closest("[hidden]") === null;
    };
    return { doc, shown, text: (sel: string) => doc.querySelector(sel)?.textContent ?? null };
  };

  it("shows the first screen as one step: tagline, name field, board, and nothing else", () => {
    const { doc, shown, text } = pageOf(scene().view());
    expect(text(".lede")).toBe("Build next to people. Earn more together.");
    expect(doc.querySelector<HTMLInputElement>("#label")!.placeholder).toBe("Your name");
    expect(shown("[data-wallet]"), "no wallet without land").toBe(false);
    for (const act of ["collect", "upgrade"]) expect(shown(`[data-act="${act}"]`), act).toBe(false);
    expect(doc.querySelectorAll("[data-renew-hours]:not([hidden])")).toHaveLength(0);
    expect(shown("[data-goal]"), "no goal line before anyone is near one").toBe(false);
    // the key and the city's activity are behind closed icon buttons
    for (const name of ["key", "log"]) {
      const tool = doc.querySelector<HTMLDetailsElement>(`details[data-tool="${name}"]`)!;
      expect(tool.open, name).toBe(false);
      expect(tool.querySelector("summary .sr-only")!.textContent!.length, `${name} has a name`).toBeGreaterThan(0);
    }
    expect(doc.querySelector(".legend")!.closest("details")).not.toBeNull();
    expect(doc.querySelector("[data-events]")!.closest("details")).not.toBeNull();
    // the disabled-with-a-reason pattern is gone entirely
    expect(doc.querySelectorAll("[data-why], .act-why, button:disabled:not([hidden])")).toHaveLength(0);
    expect(doc.querySelector(".board")!.hasAttribute("data-invite")).toBe(true);
  });

  it("shows a new owner coins, income and the lease ring, with no Collect and no Upgrade", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const { doc, shown, text } = pageOf(view());
    expect(shown("[data-wallet]")).toBe(true);
    expect(text("[data-hud-coins]")).toBe("100");
    expect(text("[data-hud-coins-said]")).toBe("100 coins");
    expect(text("[data-hud-rate]")).toBe("+10/min");
    const ring = doc.querySelector("[data-hud-lease]")!;
    expect([ring.getAttribute("role"), ring.getAttribute("aria-label"), ring.getAttribute("title")]).toEqual(["img", "Lease: 24 h 0 m left", "Lease: 24 h 0 m left"]);
    expect(shown('[data-act="collect"]'), "nothing waits: no Collect").toBe(false);
    expect(shown('[data-act="upgrade"]'), "100 coins: no Upgrade").toBe(false);
    expect(doc.querySelectorAll("[data-renew-hours]:not([hidden])"), "24 h left: no Renew").toHaveLength(0);
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("style")).toMatch(/--lease:1\.000/);
    expect(doc.querySelector(".board")!.hasAttribute("data-invite")).toBe(false);
  });

  it("shows Collect once income waits, and Upgrade once it's affordable, as form posts", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const { doc, shown, text } = pageOf(withMe(view(), { coins: 400, pending: 1234 }));
    expect(shown('[data-act="collect"]')).toBe(true);
    expect(doc.querySelector('[data-act="collect"]')!.getAttribute("formaction")).toBe("/collect");
    expect(doc.querySelector('[data-act="collect"]')!.getAttribute("aria-label")).toBe("Collect 12 coins");
    expect(text("[data-hud-owed]")).toBe("+12");
    expect(shown('[data-act="upgrade"]')).toBe(true);
    expect(doc.querySelector('[data-act="upgrade"]')!.getAttribute("formaction")).toBe("/upgrade");
    expect(doc.querySelector('[data-act="upgrade"]')!.getAttribute("aria-label")).toBe("Upgrade to Townhouse for 150 coins");
    expect(text("[data-hud-next]")).toBe("Townhouse");
    expect(text("[data-hud-cost]")).toBe("150");
  });

  it("shows Renew only under 6 h, and only the renewals you can afford", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const late = new Date(NOW.getTime() + 20 * HOUR); // 4 h left, 100 coins
    const { doc } = pageOf(view(ME, late), late);
    const open = [...doc.querySelectorAll<HTMLButtonElement>("[data-renew-hours]:not([hidden])")];
    expect(open.map((b) => [b.value, b.getAttribute("formaction"), b.getAttribute("aria-label")])).toEqual([["6", "/renew", "Renew lease 6 hours for 100 coins"]]);
  });

  it("shows no Upgrade for a Skyscraper, however rich", () => {
    const { store, view } = scene();
    store.claim(at(5, 5), ME, "Me", NOW);
    const v = view();
    const top = withMe({ ...v, tiles: v.tiles.map((t) => (t.state === "mine" ? { ...t, level: 5, height: 5, rate: 5000 } : t)) }, { coins: 5000, level: 5 });
    const { doc, shown } = pageOf(top);
    expect(shown('[data-act="upgrade"]')).toBe(false);
    expect(doc.querySelector(`button.tile[value="${at(5, 5)}"]`)!.getAttribute("data-level")).toBe("5");
  });

  it("lists the city log, short, behind its icon", () => {
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

  it("gives every icon button a name", () => {
    const doc = new JSDOM(renderBoard(scene().view(), "")).window.document;
    const icons = [...doc.querySelectorAll("summary, a.about")];
    expect(icons.length).toBeGreaterThanOrEqual(5);
    for (const el of icons) {
      expect(el.querySelector("svg")!.getAttribute("aria-hidden"), el.outerHTML.slice(0, 60)).toBe("true");
      expect((el.querySelector(".sr-only")?.textContent ?? "").trim().length, el.outerHTML.slice(0, 60)).toBeGreaterThan(0);
    }
  });
});
