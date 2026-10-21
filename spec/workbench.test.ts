import { describe, expect, it } from "vitest";
import { defaultParts } from "../public/recipes.js";
import type { StateEvent } from "../src/types.ts";
import { get, open, post, sleep, stateOf, type Visitor, visitor } from "./helpers.ts";

// Everything that touches the one shared draft, or a slot, lives in this file
// and runs in order (CLAUDE.md, "there is one shared draft"). Vitest 5 has
// no describe.sequential; tests in a file run in order unless made
// concurrent, so each describe pins `concurrent: false`. Spec files run
// in parallel against one app, so no other file may touch the workbench, and
// no test here assumes it starts empty: each one empties it first.

// Empty the bench. Tests release the leases they take, but one that failed
// midway may leave a lease behind (these visitors hold no stream, so it
// lasts its 15 s); then wait it out rather than fail every test after it.
const janitor = visitor();
async function fresh(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const r = await post(janitor, "/draft/clear");
    if (r.status === 200 || r.body.error === "draft-empty") return;
    if (r.body.error !== "lease-held") break;
    await sleep(Math.max(0, Date.parse(r.body.expiresAt) - Date.now()) + 100);
  }
  throw new Error("can't empty the workbench");
}

const state = (r: { body: { state: StateEvent } }): StateEvent => r.body.state;

// A visitor who lets go of every part they hold when the test is done, so
// the next clear isn't refused.
async function releaseAll(v: Visitor): Promise<void> {
  for (const part of ["ribbon", "cube", "spheres", "stack", "arch", "halo", "petals", "stem", "motes"]) {
    await post(v, "/draft/release", { part });
  }
}

describe("the workbench", { concurrent: false }, () => {
  it("starts from a recipe's defaults, and only when empty", async () => {
    await fresh();
    const a = visitor();
    const r = await post(a, "/draft/start", { recipe: "loop" });
    expect(r.status).toBe(200);
    expect(state(r).draft).toMatchObject({ recipe: "loop", parts: defaultParts("loop"), basedOn: null });
    const again = await post(visitor(), "/draft/start", { recipe: "bloom" });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "draft-not-empty", message: expect.any(String) });
  });

  it("refuses an unknown recipe with 400, whatever the bench holds", async () => {
    await fresh();
    for (const recipe of ["nope", "constructor", "__proto__", 3, null]) {
      const r = await post(visitor(), "/draft/start", { recipe });
      expect(r.status, String(recipe)).toBe(400);
      expect(r.body.error).toBe("bad-request");
    }
  });

  it("refuses a lease, an edit and a clear on an empty bench with 409 draft-empty", async () => {
    await fresh();
    const a = visitor();
    expect((await post(a, "/draft/lease", { part: "ribbon" })).body.error).toBe("draft-empty");
    const e = await post(a, "/draft/edit", { part: "ribbon", values: { turns: 3 } });
    expect([e.status, e.body.error]).toEqual([409, "draft-empty"]);
    const c = await post(a, "/draft/clear");
    expect([c.status, c.body.error]).toEqual([409, "draft-empty"]);
    const p = await post(a, "/publish", { title: "Nothing", slot: 6 });
    expect([p.status, p.body.error]).toEqual([409, "draft-empty"]);
  });

  it("saves an accepted edit before answering, and credits its author", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/me", { name: "Edit Author" });
    await post(a, "/draft/start", { recipe: "loop" });
    const r = await post(a, "/draft/edit", { part: "ribbon", values: { turns: 4, twist: 3 }, revision: 1 });
    expect(r.status).toBe(200);
    expect(r.body.values).toEqual({ turns: 4, twist: 3 });
    const s = await stateOf(visitor());
    expect(s.draft.parts!.ribbon).toMatchObject({ turns: 4, twist: 3 });
    expect(s.draft.partAuthors.ribbon.name).toBe("Edit Author");
    expect(s.draft.contributors).toEqual([expect.objectContaining({ name: "Edit Author", edits: 1 })]);
    expect(state(r).leases).toEqual([expect.objectContaining({ part: "ribbon", mine: true })]);
    await releaseAll(a);
  });

  it("refuses bad values with 400, never clamping them", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "loop" });
    for (const values of [{ turns: 99 }, { turns: 0 }, { turns: "3" }, { wings: 1 }, { constructor: 1 }, {}, [1], null]) {
      const r = await post(a, "/draft/edit", { part: "ribbon", values });
      expect(r.status, JSON.stringify(values)).toBe(400);
      expect(r.body.error).toBe("bad-request");
    }
    for (const part of ["petals", "constructor", "", 3]) {
      expect((await post(a, "/draft/edit", { part, values: { lift: 0 } })).status, String(part)).toBe(400);
      expect((await post(a, "/draft/lease", { part })).status, String(part)).toBe(400);
    }
    expect((await stateOf(a)).draft.parts!.ribbon.turns).toBe(2);
    await releaseAll(a);
  });

  it("refuses an edit to a part someone else holds with 409 lease-held, naming them", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/me", { name: "Lease Holder" });
    await post(a, "/draft/start", { recipe: "arches" });
    const l = await post(a, "/draft/lease", { part: "halo" });
    expect(l.status).toBe(200);
    const you = state(l).you;

    const r = await post(b, "/draft/edit", { part: "halo", values: { tilt: 10 } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "lease-held", holder: { tag: you.tag, name: "Lease Holder", colour: you.colour } });
    expect(Date.parse(r.body.expiresAt)).toBeGreaterThan(Date.now());
    expect((await post(b, "/draft/lease", { part: "halo" })).body.error).toBe("lease-held");
    // nothing changed
    expect((await stateOf(b)).draft.parts!.halo.tilt).toBe(defaultParts("arches").halo.tilt);

    // a different part is free at the same time
    expect((await post(b, "/draft/edit", { part: "arch", values: { count: 4 } })).status).toBe(200);
    // and the holder can clear only once nobody else holds a lease
    const c = await post(a, "/draft/clear");
    expect([c.status, c.body.error]).toEqual([409, "lease-held"]);
    await post(b, "/draft/release", { part: "arch" });
    await releaseAll(a);
    // once released, the part is anyone's
    expect((await post(b, "/draft/edit", { part: "halo", values: { tilt: 10 } })).status).toBe(200);
    await releaseAll(b);
  });

  it("shows `mine` only on the asker's own leases", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/draft/start", { recipe: "bloom" });
    await post(a, "/draft/lease", { part: "stem" });
    const asB = state(await post(b, "/draft/lease", { part: "petals" }));
    const byPart = Object.fromEntries(asB.leases.map((l) => [l.part, l.mine]));
    expect(byPart).toEqual({ petals: true, stem: false });
    await releaseAll(a);
    await releaseAll(b);
  });

  it("refuses remix into a full bench unless replace, and replace archives the old draft first", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "loop" });
    await post(a, "/draft/edit", { part: "cube", values: { size: 1.3 } });
    await releaseAll(a);
    const old = (await stateOf(a)).draft;
    const totem = (await get(null, "/exhibits/2")).body.versions.at(-1);

    const refused = await post(a, "/draft/remix", { versionId: totem.id });
    expect([refused.status, refused.body.error]).toEqual([409, "draft-not-empty"]);
    expect((await stateOf(a)).draft.id).toBe(old.id);

    const r = await post(a, "/draft/remix", { versionId: totem.id, replace: true });
    expect(r.status).toBe(200);
    expect(r.body.archivedId).toBe(old.id);
    const s = state(r);
    expect(s.draft).toMatchObject({ recipe: "arches", parts: totem.parts, basedOn: { exhibitId: 2, versionId: totem.id, n: 1 } });
    expect(s.archivedDrafts[0]).toMatchObject({ id: old.id, recipe: "loop", reason: "replaced" });

    // and the archived draft comes back, numbers intact
    const back = await post(a, "/draft/restore-archived", { archivedId: old.id, replace: true });
    expect(back.status).toBe(200);
    expect(state(back).draft.parts!.cube.size).toBe(1.3);
    expect((await post(a, "/draft/restore-archived", { archivedId: old.id })).body.error).toBe("draft-not-empty");
    expect((await post(a, "/draft/restore-archived", { archivedId: 999999, replace: true })).status).toBe(404);
    expect((await post(a, "/draft/remix", { versionId: 999999, replace: true })).status).toBe(404);
    expect((await post(a, "/draft/remix", { versionId: "x" })).status).toBe(400);
  });

  it("clearing archives the draft too", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "bloom" });
    const id = (await stateOf(a)).draft.id;
    const r = await post(a, "/draft/clear");
    expect(r.status).toBe(200);
    expect(state(r).draft.recipe).toBeNull();
    expect(state(r).archivedDrafts[0]).toMatchObject({ id, reason: "cleared" });
  });
});

describe("publishing", { concurrent: false }, () => {
  // A free slot, emptying one if all six are full (into the storeroom: nothing
  // is lost).
  async function freeSlot(): Promise<number> {
    const s = await stateOf(visitor());
    const empty = s.slots.find((x) => !x.exhibit);
    if (empty) return empty.slot;
    const last = s.slots[5].exhibit!;
    expect((await post(visitor(), `/exhibits/${last.id}/store`)).status).toBe(200);
    return 6;
  }

  it("publishes the draft as a new exhibit, keeping the draft on the bench", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/me", { name: "Publisher" });
    await post(a, "/draft/start", { recipe: "loop" });
    await post(a, "/draft/edit", { part: "spheres", values: { count: 8 } });
    await releaseAll(a);
    const slot = await freeSlot();
    const r = await post(a, "/publish", { title: "  Eight Moons  ", slot });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ n: 1, stored: null });
    const s = state(r);
    expect(s.slots[slot - 1].exhibit!.latest).toMatchObject({
      title: "Eight Moons",
      n: 1,
      publishedBy: { name: "Publisher" },
      contributors: [expect.objectContaining({ name: "Publisher", edits: 1 })],
    });
    expect(s.slots[slot - 1].exhibit!.latest.parts.spheres.count).toBe(8);
    expect(s.draft.recipe).toBe("loop");
  });

  it("refuses a bad title, slot or target with 400, and an unknown exhibit with 404", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "loop" });
    for (const body of [
      { title: "", slot: 6 },
      { title: "x".repeat(41), slot: 6 },
      { title: "a\nb", slot: 6 },
      { title: "ok", slot: 0 },
      { title: "ok", slot: 7 },
      { title: "ok", slot: 2.5 },
      { title: "ok" },
      { title: "ok", slot: 6, exhibitId: 1 },
      { title: "ok", slot: 6, replace: "yes" },
    ]) {
      const r = await post(a, "/publish", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("bad-request");
    }
    const missing = await post(a, "/publish", { title: "ok", exhibitId: 999999 });
    expect([missing.status, missing.body.error]).toEqual([404, "not-found"]);
  });

  it("never silently replaces a full slot: 409 slot-taken says what's there; replace stores it", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "bloom" });
    const before = (await stateOf(a)).slots[0].exhibit!;

    const r = await post(a, "/publish", { title: "Usurper", slot: 1 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "slot-taken", exhibit: { id: before.id, slot: 1 } });
    expect((await stateOf(a)).slots[0].exhibit!.id).toBe(before.id);

    const ok = await post(a, "/publish", { title: "Usurper", slot: 1, replace: true });
    expect(ok.status).toBe(200);
    expect(ok.body.stored).toBe(before.id);
    const s = state(ok);
    expect(s.slots[0].exhibit!.latest.title).toBe("Usurper");
    const stored = s.storeroom.find((e) => e.id === before.id)!;
    expect(stored).toMatchObject({ slot: null, versionCount: before.versionCount });
    expect((await get(null, `/exhibits/${before.id}`)).body.versions).toHaveLength(before.versionCount);

    // put it back, swapping the usurper into the storeroom
    const usurper = s.slots[0].exhibit!.id;
    const taken = await post(a, `/exhibits/${before.id}/display`, { slot: 1 });
    expect([taken.status, taken.body.error, taken.body.exhibit?.id]).toEqual([409, "slot-taken", usurper]);
    const back = await post(a, `/exhibits/${before.id}/display`, { slot: 1, replace: true });
    expect(back.status).toBe(200);
    expect(state(back).slots[0].exhibit!.id).toBe(before.id);
    expect(state(back).storeroom.map((e) => e.id)).toContain(usurper);
  });

  it("takes an exhibit off display into the storeroom, and refuses one already there", async () => {
    await fresh();
    const a = visitor();
    await post(a, "/draft/start", { recipe: "arches" });
    const slot = await freeSlot();
    const { exhibitId } = (await post(a, "/publish", { title: "Short Stay", slot })).body;
    const r = await post(a, `/exhibits/${exhibitId}/store`);
    expect(r.status).toBe(200);
    expect(state(r).slots[slot - 1].exhibit).toBeNull();
    expect(state(r).storeroom.map((e) => e.id)).toContain(exhibitId);
    const again = await post(a, `/exhibits/${exhibitId}/store`);
    expect([again.status, again.body.error]).toEqual([409, "slot-empty"]);
  });

  it("adds a version to an exhibit, and never changes an earlier one", async () => {
    await fresh();
    const a = visitor();
    const v1 = (await get(null, "/exhibits/3")).body.versions;
    await post(a, "/draft/remix", { versionId: v1[0].id });
    await post(a, "/draft/edit", { part: "petals", values: { count: 12 } });
    await releaseAll(a);
    const r = await post(a, "/publish", { title: "Twelve Petals", exhibitId: 3 });
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(v1.length + 1);
    const after = (await get(null, "/exhibits/3")).body.versions;
    expect(after[0]).toMatchObject({ n: v1.length + 1, title: "Twelve Petals", basedOn: { versionId: v1[0].id } });
    expect(after[0].parts.petals.count).toBe(12);
    // every earlier version exactly as it was
    expect(after.slice(1)).toEqual(v1);
  });

  it("restore publishes the old numbers as version N+1 with restoredFrom", async () => {
    const a = visitor();
    const before = (await get(null, "/exhibits/3")).body.versions;
    const first = before.at(-1);
    const r = await post(a, "/exhibits/3/restore", { versionId: first.id });
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(before.length + 1);
    const after = (await get(null, "/exhibits/3")).body.versions;
    expect(after[0]).toMatchObject({ n: before.length + 1, restoredFrom: 1, title: first.title, parts: first.parts, recipe: first.recipe });
    expect(after.slice(1)).toEqual(before);
  });
});

// Real-time is a test, not a claim (CLAUDE.md, "The checks"): two streams as
// two visitors, an edit from one, seen by the other within 1000 ms.
describe("live", { concurrent: false }, () => {
  it("opens /events as an SSE stream: retry, then a state event straight away", async () => {
    const a = visitor();
    const s = await open(a);
    try {
      expect(s.headers.get("content-type")).toMatch(/^text\/event-stream/);
      const first = await s.first();
      expect(s.raw()).toMatch(/^retry: \d+\n\n/);
      expect(s.events[0].event).toBe("state");
      expect(first.present.map((p) => p.tag)).toContain(first.you.tag);
    } finally {
      s.close();
    }
  });

  it("shows an edit from one visitor on another's stream within 1000 ms", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/draft/start", { recipe: "loop" });
    const [sa, sb] = await Promise.all([open(a), open(b)]);
    try {
      await Promise.all([sa.first(), sb.first()]);
      const target = 4.5;
      const seen = sb.next((s) => s.draft.parts?.ribbon.twist === target, 1000);
      const sent = performance.now();
      const r = await post(a, "/draft/edit", { part: "ribbon", values: { twist: target } });
      expect(r.status).toBe(200);
      const { state, at } = await seen;
      expect(at - sent).toBeLessThan(1000);
      // B sees A's lease as A's, not B's
      expect(state.leases).toEqual([expect.objectContaining({ part: "ribbon", mine: false, holder: r.body.state.you })]);
      expect(state.you.tag).not.toBe(r.body.state.you.tag);
      expect(state.present.find((p) => p.tag === r.body.state.you.tag)?.editing).toEqual(["ribbon"]);
    } finally {
      sa.close();
      sb.close();
    }
  });

  it("lists who's here while their stream is open, and releases their leases at once when it closes", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/draft/start", { recipe: "bloom" });
    const sb = await open(b);
    try {
      await sb.first();
      const arrived = sb.next((s) => s.present.length > 0 && s.present.some((p) => p.tag !== s.you.tag && p.editing.length === 0));
      const sa = await open(a);
      const you = (await sa.first()).you;
      await arrived;
      expect((await stateOf(b)).present.map((p) => p.tag)).toContain(you.tag);
      const leased = sb.next((s) => s.leases.some((l) => l.part === "stem"));
      await post(a, "/draft/lease", { part: "stem" });
      await leased;

      // a second tab closing changes nothing: A is still here
      const sa2 = await open(a);
      await sa2.first();
      sa2.close();
      await sleep(300);
      expect((await stateOf(b)).leases.map((l) => l.part)).toEqual(["stem"]);

      const gone = sb.next((s) => !s.present.some((p) => p.tag === you.tag) && s.leases.length === 0, 1000);
      sa.close();
      await gone;
      // and the part is free for anyone
      expect((await post(b, "/draft/edit", { part: "stem", values: { bend: 0.9 } })).status).toBe(200);
      await releaseAll(b);
    } finally {
      sb.close();
    }
  });

  it("sends a renewal to every stream, so pages counting down see the new end", async () => {
    await fresh();
    const a = visitor();
    const b = visitor();
    await post(a, "/draft/start", { recipe: "arches" });
    const first = (await post(a, "/draft/lease", { part: "stack" })).body.expiresAt;
    const sb = await open(b);
    try {
      await sb.first();
      await sleep(20);
      const renewed = sb.next((s) => s.leases.some((l) => l.part === "stack" && l.expiresAt > first), 1000);
      expect((await post(a, "/draft/lease", { part: "stack" })).status).toBe(200);
      await renewed;
    } finally {
      sb.close();
      await releaseAll(a);
    }
  });
});
