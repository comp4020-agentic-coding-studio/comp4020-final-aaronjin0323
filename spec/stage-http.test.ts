import { describe, expect, it } from "vitest";
import { CAP_EACH, SETS } from "../public/stage.js";
import { validGesture } from "./set-helpers.ts";
import type { StateEvent } from "../src/types.ts";
import { get, open, post, sleep, stateOf, type Visitor, visitor } from "./helpers.ts";

// Everything that touches the one shared stage, or a slot, lives in this
// file and runs in order (CLAUDE.md, "there is one shared stage"). Vitest 5
// has no describe.sequential; tests in a file run in order unless made
// concurrent, so each describe pins `concurrent: false`. Spec files run in
// parallel against one app, so no other file may touch the stage, and no
// test here assumes it starts quiet: each one starts it over first.

const janitor = visitor();
async function fresh(): Promise<void> {
  const r = await post(janitor, "/stage/clear");
  if (r.status !== 200 && r.body.error !== "stage-empty") throw new Error(`can't start the stage over: ${JSON.stringify(r.body)}`);
}

// The museum as an onlooker sees it. Never read state through a stream as a
// visitor who holds a sphere: closing that stream is their last one
// closing, which drops what they hold (the rule).
const onlooker = visitor();
const look = (): Promise<StateEvent> => stateOf(onlooker);
const state = (r: { body: { state: StateEvent } }): StateEvent => r.body.state;

const tap = (at = 1) => ({ kind: "tap", object: "bell", at });
const pluck = (at = 1, u = 0.2) => ({ kind: "pluck", object: "ribbon", at, u });
const toss = (object: string, at = 1) => ({ kind: "throw", object, at, from: [0.3, 0.4, 0.2], v: [0.5, 1.5, -0.4] });
const play = (who: Visitor, gesture: unknown) => post(who, "/stage/gesture", { gesture });

async function dropAll(v: Visitor): Promise<void> {
  for (const object of ["chrome", "teal", "gold", "dusk"]) await post(v, "/stage/drop", { object });
}

describe("the stage", { concurrent: false }, () => {
  it("saves a gesture before answering, with its author, and credits them", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/me", { name: "Bell Ringer" });
    const r = await play(a, tap(2.5));
    expect(r.status).toBe(200);
    const you = state(r).you;
    expect(r.body.gesture).toEqual({ ...tap(2.5), by: you.tag });
    const s = await look();
    expect(s.draft.parts!.gestures).toEqual([{ ...tap(2.5), by: you.tag }]);
    expect(s.draft.contributors).toEqual([expect.objectContaining({ name: "Bell Ringer", edits: 1 })]);
  });

  it("refuses a bad gesture with 400, never clamping it, and never trusts a `by`", async () => {
    await fresh();
    const a = visitor();
    for (const gesture of [
      { kind: "tap", object: "bell", at: 30 },
      { kind: "tap", object: "bell", at: -1 },
      { kind: "kick", object: "bell", at: 1 },
      { kind: "throw", object: "teal", at: 1, from: [0, 0, 0], v: [0, 99, 0] },
      { ...tap(), by: "abcdef" },
      { ...tap(), constructor: 1 },
      "tap",
    ]) {
      const r = await play(a, gesture);
      expect(r.status, JSON.stringify(gesture)).toBe(400);
      expect(r.body.error).toBe("bad-request");
    }
    expect((await post(a, "/stage/gesture", { gesture: tap(), extra: 1 })).status).toBe(400);
    expect((await look()).draft.parts!.gestures).toEqual([]);
  });

  it("a throw needs the sphere in hand: 409 taken until you grab it", async () => {
    await fresh();
    const a = visitor();
    const r = await play(a, toss("teal"));
    expect([r.status, r.body.error]).toEqual([409, "taken"]);
    expect((await post(a, "/stage/grab", { object: "teal" })).status).toBe(200);
    expect((await play(a, toss("teal"))).status).toBe(200);
    // and the throw let go of it
    expect((await look()).claims).toEqual([]);
  });

  it("grabbing takes a sphere from whoever holds it; the throw that lost it is refused, naming the taker", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/me", { name: "First Hand" });
    await post(b, "/me", { name: "Quick Hand" });
    await post(a, "/stage/grab", { object: "gold" });
    const took = await post(b, "/stage/grab", { object: "gold" });
    expect(took.status).toBe(200);
    expect(took.body.from).toMatchObject({ name: "First Hand" });
    expect(state(took).claims).toEqual([expect.objectContaining({ part: "gold", mine: true, holder: expect.objectContaining({ name: "Quick Hand" }) })]);
    const lost = await play(a, toss("gold"));
    expect(lost.status).toBe(409);
    expect(lost.body).toMatchObject({ error: "taken", holder: { name: "Quick Hand" } });
    expect((await play(b, toss("gold"))).status).toBe(200);
  });

  it("refuses to grab what isn't a sphere", async () => {
    const a = visitor();
    const live = SETS[(await look()).draft.parts!.set];
    const cant = live.objects.filter((o) => !live.holdable.includes(o));
    expect(cant.length).toBeGreaterThan(0);
    for (const object of [...cant, "bell", "ribbon", "nobody", "Teal", "constructor", 3]) {
      const r = await post(a, "/stage/grab", { object });
      expect(r.status, String(object)).toBe(400);
    }
  });

  it("keeps at most CAP_EACH gestures from one visitor, so nobody crowds the others out", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await play(b, pluck(0.5));
    for (let i = 0; i < CAP_EACH + 4; i++) expect((await play(a, tap(i * 0.5))).status).toBe(200);
    const g = (await look()).draft.parts!.gestures;
    expect(g).toHaveLength(CAP_EACH + 1);
    expect(g[0].kind).toBe("pluck");
  });

  it("undo removes only your own newest gesture", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await play(a, tap(1));
    await play(b, pluck(2));
    const r = await post(a, "/stage/undo");
    expect(r.status).toBe(200);
    expect(state(r).draft.parts!.gestures.map((g) => g.kind)).toEqual(["pluck"]);
    const none = await post(a, "/stage/undo");
    expect([none.status, none.body.error]).toEqual([409, "nothing-to-undo"]);
    expect((await look()).draft.parts!.gestures).toHaveLength(1);
  });

  it("start over archives the loop and leaves a quiet one", async () => {
    await fresh();
    const a = visitor();
    await play(a, tap());
    const r = await post(a, "/stage/clear");
    expect(r.status).toBe(200);
    expect(state(r).draft.parts!.gestures).toEqual([]);
    expect(state(r).archivedDrafts[0]).toMatchObject({ id: r.body.archivedId, reason: "cleared" });
    const again = await post(a, "/stage/clear");
    expect([again.status, again.body.error]).toEqual([409, "stage-empty"]);
  });

  // Choosing a set (ADR 18). The store's tests switch to a test-only set;
  // here every other registered set is chosen in turn (none until the
  // second set lands), and the same set behaves as plain Start over.
  it("start over takes a set: unknown is 400, the same set with no gestures 409, with gestures it archives", async () => {
    await fresh();
    const a = visitor();
    const live = (await look()).draft.parts!.set;
    for (const set of ["nope", "constructor", "Orbit", "", 3, null]) {
      const r = await post(a, "/stage/clear", { set });
      expect([r.status, r.body.error], JSON.stringify(set)).toEqual([400, "bad-request"]);
    }
    expect((await post(a, "/stage/clear", { set: live, extra: 1 })).status).toBe(400);
    const quiet = await post(a, "/stage/clear", { set: live });
    expect([quiet.status, quiet.body.error]).toEqual([409, "stage-empty"]);
    await play(a, validGesture(live, Object.keys(SETS[live].gestures).find((k) => k !== "throw")!));
    const r = await post(a, "/stage/clear", { set: live });
    expect(r.status).toBe(200);
    expect(state(r).draft.parts).toEqual({ set: live, gestures: [] });
    expect(state(r).archivedDrafts[0]).toMatchObject({ id: r.body.archivedId, reason: "cleared" });
  });

  it("choosing another set starts a silent loop on it, archiving one with gestures; what's holdable comes from it", async () => {
    for (const id of Object.keys(SETS)) {
      if (id === "orbit") continue;
      // each set's turn starts from a quiet Orbit (the last turn left its
      // own set on the stage, where Orbit's bell tap is refused)
      await post(janitor, "/stage/clear", { set: "orbit" });
      await fresh();
      const a = visitor();
      expect((await play(a, tap())).status, id).toBe(200);
      const r = await post(a, "/stage/clear", { set: id });
      expect(r.status, id).toBe(200);
      expect(state(r).draft.parts).toEqual({ set: id, gestures: [] });
      expect(state(r).archivedDrafts[0]).toMatchObject({ id: r.body.archivedId, reason: "cleared" });
      // a silent loop switches without archiving anything
      const back = await post(a, "/stage/clear", { set: "orbit" });
      expect([back.status, back.body.archivedId], id).toEqual([200, null]);
      expect(state(back).archivedTotal).toBe(state(r).archivedTotal);
      await post(a, "/stage/clear", { set: id });
      for (const object of SETS[id].objects) {
        const g = await post(a, "/stage/grab", { object });
        expect(g.status, `${id}: grab ${object}`).toBe(SETS[id].holdable.includes(object) ? 200 : 400);
        await post(a, "/stage/drop", { object });
      }
      expect((await post(a, "/stage/grab", { object: "teal" })).status, `${id}: no orbit sphere`).toBe(400);
    }
    await post(visitor(), "/stage/clear", { set: "orbit" });
    expect((await look()).draft.parts!.set).toBe("orbit");
  });

  it("join brings a plinth's performance to the stage; over someone's playing it asks, and replace archives", async () => {
    await fresh();
    const a = visitor();
    const v = (await look()).slots[0].exhibit!.latest;
    const r = await post(a, "/stage/join", { versionId: v.id });
    expect(r.status).toBe(200);
    expect(state(r).draft).toMatchObject({ parts: v.parts, basedOn: { versionId: v.id } });
    const busy = await post(a, "/stage/join", { versionId: v.id });
    expect([busy.status, busy.body.error]).toEqual([409, "stage-busy"]);
    const swapped = await post(a, "/stage/join", { versionId: v.id, replace: true });
    expect(swapped.status).toBe(200);
    expect(state(swapped).archivedDrafts[0]).toMatchObject({ id: swapped.body.archivedId, reason: "replaced" });
    expect((await post(a, "/stage/join", { versionId: 999999, replace: true })).status).toBe(404);
    expect((await post(a, "/stage/join", { versionId: "1" })).status).toBe(400);
  });

  it("brings an archived loop back", async () => {
    await fresh();
    const a = visitor();
    await play(a, tap(7));
    const { archivedId } = (await post(a, "/stage/clear")).body;
    const r = await post(a, "/stage/restore-archived", { archivedId });
    expect(r.status).toBe(200);
    expect(state(r).draft.parts!.gestures.map((g) => g.at)).toEqual([7]);
  });
});

describe("leaving it on a plinth", { concurrent: false }, () => {
  async function freeSlot(): Promise<number> {
    const s = await look();
    const empty = s.slots.find((x) => !x.exhibit);
    if (empty) return empty.slot;
    const last = s.slots[5].exhibit!;
    expect((await post(visitor(), `/exhibits/${last.id}/store`)).status).toBe(200);
    return 6;
  }

  it("leaves the loop as a new exhibit, crediting everyone in it, and keeps it playing", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/me", { name: "Leaver" });
    await post(b, "/me", { name: "Plucker" });
    await play(a, tap());
    await play(b, pluck());
    await play(b, pluck(4));
    const slot = await freeSlot();
    const r = await post(a, "/publish", { title: "  Bell Panic II  ", slot });
    expect(r.status).toBe(200);
    const v = state(r).slots[slot - 1].exhibit!.latest;
    expect(v).toMatchObject({ title: "Bell Panic II", n: 1, recipe: "stage", publishedBy: { name: "Leaver" } });
    expect(v.contributors.map((c) => [c.name, c.edits])).toEqual([
      ["Leaver", 1],
      ["Plucker", 2],
    ]);
    expect(v.parts.gestures).toHaveLength(3);
    expect(state(r).draft.parts!.gestures).toHaveLength(3);
  });

  it("refuses to leave a quiet stage, a bad title or slot", async () => {
    await fresh();
    const a = visitor();
    const quiet = await post(a, "/publish", { title: "Nothing", slot: 6 });
    expect([quiet.status, quiet.body.error]).toEqual([409, "stage-empty"]);
    await play(a, tap());
    for (const body of [{ title: "", slot: 6 }, { title: "x".repeat(41), slot: 6 }, { title: "ok", slot: 7 }, { title: "ok" }, { title: "ok", slot: 6, exhibitId: 1 }]) {
      expect((await post(a, "/publish", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(a, "/publish", { title: "ok", exhibitId: 999999 })).status).toBe(404);
  });

  it("never silently replaces a full slot: 409 slot-taken says what's there; replace stores it", async () => {
    await fresh();
    const a = visitor();
    await play(a, tap());
    const before = (await look()).slots[0].exhibit!;
    const r = await post(a, "/publish", { title: "Usurper", slot: 1 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "slot-taken", exhibit: { id: before.id } });
    const ok = await post(a, "/publish", { title: "Usurper", slot: 1, replace: true });
    expect(ok.body.stored).toBe(before.id);
    // and back again, swapping the usurper into the storeroom
    const usurper = state(ok).slots[0].exhibit!.id;
    const back = await post(a, `/exhibits/${before.id}/display`, { slot: 1, replace: true });
    expect(back.status).toBe(200);
    expect(state(back).storeroom.map((e) => e.id)).toContain(usurper);
  });

  it("adds a version, never changing an earlier one; restore makes N+1", async () => {
    await fresh();
    const a = visitor();
    const id = (await look()).slots[1].exhibit!.id;
    const v1 = (await get(null, `/exhibits/${id}`)).body.versions;
    await post(a, "/stage/join", { versionId: v1[0].id, replace: true });
    await play(a, tap(11));
    const r = await post(a, "/publish", { title: "Louder", exhibitId: id });
    expect(r.body.n).toBe(v1.length + 1);
    const after = (await get(null, `/exhibits/${id}`)).body.versions;
    expect(after[0]).toMatchObject({ title: "Louder", basedOn: { versionId: v1[0].id } });
    expect(after.slice(1)).toEqual(v1);
    const back = await post(a, `/exhibits/${id}/restore`, { versionId: v1.at(-1).id });
    expect(back.body.n).toBe(v1.length + 2);
  });
});

// Real-time is a test, not a claim (CLAUDE.md, "The checks"): two streams as
// two visitors, a gesture from one, seen by the other within 1000 ms.
describe("live", { concurrent: false }, () => {
  it("opens /events as an SSE stream: retry, then a state event straight away", async () => {
    const a = visitor();
    const s = await open(a);
    try {
      expect(s.headers.get("content-type")).toMatch(/^text\/event-stream/);
      const first = await s.first();
      expect(s.raw()).toMatch(/^retry: \d+\n\n/);
      expect(first.present.map((p) => p.tag)).toContain(first.you.tag);
    } finally {
      s.close();
    }
  });

  it("shows a gesture from one visitor on another's stream within 1000 ms", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    const [sa, sb] = await Promise.all([open(a), open(b)]);
    try {
      await Promise.all([sa.first(), sb.first()]);
      const seen = sb.next((s) => s.draft.parts!.gestures.some((g) => g.kind === "pluck" && g.at === 5.5), 1000);
      const sent = performance.now();
      expect((await play(a, pluck(5.5))).status).toBe(200);
      const { at } = await seen;
      expect(at - sent).toBeLessThan(1000);
    } finally {
      sa.close();
      sb.close();
    }
  });

  it("shows a grab to the one it was taken from, in both colours", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    const sa = await open(a);
    try {
      const me = (await sa.first()).you;
      await post(a, "/stage/grab", { object: "dusk" });
      const taken = sa.next((s) => s.claims.some((c) => c.part === "dusk" && !c.mine), 1000);
      await post(b, "/stage/grab", { object: "dusk" });
      const { state: s } = await taken;
      expect(s.claims.find((c) => c.part === "dusk")!.holder.tag).not.toBe(me.tag);
    } finally {
      sa.close();
      await dropAll(b);
    }
  });

  it("lists who's here and what they hold, and drops it at once when they leave", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    const sb = await open(b);
    try {
      await sb.first();
      const sa = await open(a);
      const you = (await sa.first()).you;
      const holding = sb.next((s) => s.present.some((p) => p.tag === you.tag && p.holding.includes("chrome")));
      await post(a, "/stage/grab", { object: "chrome" });
      await holding;
      // a second tab closing changes nothing: A is still here
      const sa2 = await open(a);
      await sa2.first();
      sa2.close();
      await sleep(300);
      expect((await look()).claims.map((c) => c.part)).toEqual(["chrome"]);
      const gone = sb.next((s) => !s.present.some((p) => p.tag === you.tag) && s.claims.length === 0, 1000);
      sa.close();
      await gone;
    } finally {
      sb.close();
    }
  });
});
