import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { CAP_EACH, checkPerformance, events, LOOP } from "../public/stage.js";
import { ARCHIVE_LIST, CLAIM_MS, migrate, MIGRATIONS, openStore, type Store, tagOf } from "../src/db.ts";

// The store's rules over ":memory:" with an injected clock (CLAUDE.md, "The
// checks"): the stage's loop, sphere claims, versions, archiving, slots and
// migrations. The HTTP tests hold the same rules through the routes.

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BO = "00000000-0000-4000-8000-0000000000b2";
const T0 = new Date("2026-11-01T10:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);

let store: Store;
beforeEach(() => {
  store = openStore(":memory:");
  store.ensureVisitor(ANA, "Coral Heron", 0, T0);
  store.ensureVisitor(BO, "Teal Finch", 1, T0);
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r as Extract<T, { ok: true }>;
};

const tap = (at = 1) => ({ kind: "tap", object: "bell", at });
const pluck = (at = 1, u = 0.2) => ({ kind: "pluck", object: "ribbon", at, u });
const toss = (object = "teal", at = 1) => ({ kind: "throw", object, at, from: [0.3, 0.4, 0.2], v: [0.5, 1.5, -0.4] });
const gestures = () => store.snapshot(T0).draft.parts!.gestures;

describe("migrations", () => {
  it("seeds three starter performances on plinths 1-3, each one playing and setting something off", () => {
    const s = store.snapshot(T0);
    expect(s.slots.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    const starters = s.slots.slice(0, 3).map((x) => x.exhibit!);
    for (const e of starters) {
      expect(e.latest.recipe).toBe("stage");
      expect(e.latest.publishedBy).toBeNull();
      expect(checkPerformance(e.latest.parts), e.latest.title).toEqual({ ok: true });
      const happened = events(e.latest.parts, 0, LOOP).map((x) => x.kind);
      expect(happened.some((k) => ["catch", "ring", "fling", "knock", "hop"].includes(k)), `${e.latest.title}: ${happened}`).toBe(true);
    }
    expect(s.slots.slice(3).every((x) => x.exhibit === null)).toBe(true);
  });

  it("moves exhibits made with the old recipes to the storeroom, every version kept", () => {
    const s = store.snapshot(T0);
    expect(s.storeroom.map((e) => e.latest.recipe).sort()).toEqual(["arches", "bloom", "loop"]);
    for (const e of s.storeroom) expect(store.history(e.id)!.versions.length).toBe(e.versionCount);
  });

  it("starts a silent loop on the stage", () => {
    expect(store.snapshot(T0).draft).toMatchObject({ recipe: "stage", parts: { set: "orbit", gestures: [] } });
  });

  it("runs each migration once: reopening never seeds again", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(db.prepare("SELECT COUNT(*) AS c FROM versions").get()).toEqual({ c: 6 });
  });

  it("archives a sculpture left on the old workbench, recoverably", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS.slice(0, 2));
    db.exec(`INSERT INTO drafts (recipe, parts, created_at) VALUES ('loop', '{}', '2026-10-30T00:00:00.000Z')`);
    migrate(db);
    const rows = db.prepare("SELECT recipe, archived_at IS NOT NULL AS archived FROM drafts ORDER BY id").all();
    expect(rows).toEqual([
      { recipe: "loop", archived: 1 },
      { recipe: "stage", archived: 0 },
    ]);
  });

  it("refuses a database newer than the code", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/only knows/);
  });

  it("rolls a failed migration back whole", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => migrate(db, ["CREATE TABLE a (x); CREATE TABLE a (x);"])).toThrow();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'a'").get()).toEqual({ c: 0 });
  });
});

describe("visitors", () => {
  it("creates a visitor once and keeps the first name", () => {
    expect(store.ensureVisitor(ANA, "Other", 3, T0).created).toBe(false);
    expect(store.visitor(ANA)).toEqual({ pid: ANA, name: "Coral Heron", colour: 0 });
    expect(store.view(ANA)).toEqual({ tag: tagOf(ANA), name: "Coral Heron", colour: 0 });
    expect(tagOf(ANA)).not.toBe(tagOf(BO));
  });
});

describe("gestures", () => {
  it("adds a gesture with its author, and credits them", () => {
    ok(store.gesture(ANA, tap(2.5), T0));
    expect(gestures()).toEqual([{ ...tap(2.5), by: tagOf(ANA) }]);
    expect(store.snapshot(T0).draft.contributors).toMatchObject([{ tag: tagOf(ANA), edits: 1 }]);
  });

  it("refuses a bad gesture without writing anything", () => {
    expect(store.gesture(ANA, { kind: "tap", object: "bell", at: 99 }, T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.gesture(ANA, { ...tap(), by: tagOf(BO) }, T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(gestures()).toEqual([]);
  });

  it("keeps at most CAP_EACH from anyone, dropping their own oldest", () => {
    ok(store.gesture(BO, pluck(0.5), T0));
    for (let i = 0; i < CAP_EACH + 3; i++) ok(store.gesture(ANA, tap(i * 0.5), T0));
    const g = gestures();
    expect(g.filter((x) => x.by === tagOf(ANA))).toHaveLength(CAP_EACH);
    expect(g[0]).toEqual({ ...pluck(0.5), by: tagOf(BO) });
  });

  it("undo removes your own newest gesture, never anyone else's", () => {
    ok(store.gesture(ANA, tap(1), T0));
    ok(store.gesture(BO, pluck(2), T0));
    ok(store.gesture(ANA, tap(3), T0));
    ok(store.undo(ANA, T0));
    expect(gestures()).toEqual([
      { ...tap(1), by: tagOf(ANA) },
      { ...pluck(2), by: tagOf(BO) },
    ]);
    ok(store.undo(ANA, T0));
    expect(gestures()).toEqual([{ ...pluck(2), by: tagOf(BO) }]);
    expect(store.undo(ANA, T0)).toMatchObject({ ok: false, error: "nothing-to-undo" });
    expect(gestures()).toHaveLength(1);
  });
});

describe("claims", () => {
  it("a throw needs your claim, and ends it", () => {
    expect(store.gesture(ANA, toss("teal"), T0)).toMatchObject({ ok: false, error: "taken" });
    ok(store.grab(ANA, "teal", T0));
    ok(store.gesture(ANA, toss("teal"), T0));
    expect(store.claims(T0)).toEqual([]);
    expect(store.gesture(ANA, toss("teal"), T0)).toMatchObject({ ok: false, error: "taken" });
  });

  it("grabbing takes a sphere from whoever holds it, and says who lost it", () => {
    ok(store.grab(ANA, "gold", T0));
    const r = ok(store.grab(BO, "gold", at(500)));
    expect(r.from).toEqual({ tag: tagOf(ANA), name: "Coral Heron", colour: 0 });
    expect(store.claims(at(500)).map((c) => [c.part, c.pid])).toEqual([["gold", BO]]);
    // the throw that lost it is refused, naming who has it now
    expect(store.gesture(ANA, toss("gold"), at(600))).toMatchObject({ ok: false, error: "taken", holder: { tag: tagOf(BO) } });
    ok(store.gesture(BO, toss("gold"), at(700)));
  });

  it("only spheres can be grabbed", () => {
    expect(store.grab(ANA, "bell", T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.grab(ANA, "nobody", T0)).toMatchObject({ ok: false, error: "bad-request" });
  });

  it("ends on the clock, on drop, and when the visitor leaves", () => {
    ok(store.grab(ANA, "teal", T0));
    expect(store.claims(at(CLAIM_MS - 1))).toHaveLength(1);
    expect(store.claims(at(CLAIM_MS))).toEqual([]);
    expect(store.gesture(ANA, toss("teal"), at(CLAIM_MS))).toMatchObject({ ok: false, error: "taken" });
    ok(store.grab(ANA, "teal", T0));
    expect(store.drop(ANA, "teal").dropped).toBe(true);
    expect(store.claims(T0)).toEqual([]);
    ok(store.grab(ANA, "teal", T0));
    ok(store.grab(ANA, "gold", T0));
    expect(store.releaseAll(ANA).sort()).toEqual(["gold", "teal"]);
    ok(store.grab(ANA, "dusk", T0));
    expect(store.expire(at(CLAIM_MS)).map((c) => c.part)).toEqual(["dusk"]);
  });

  it("plucks and taps need no claim", () => {
    ok(store.grab(BO, "teal", T0));
    ok(store.gesture(ANA, pluck(), T0));
    ok(store.gesture(ANA, tap(), T0));
  });
});

describe("the stage's loop", () => {
  it("start over archives the loop and leaves a silent one", () => {
    expect(store.clear(ANA, T0)).toMatchObject({ ok: false, error: "stage-empty" });
    ok(store.gesture(ANA, tap(), T0));
    const r = ok(store.clear(BO, at(1000)));
    expect(gestures()).toEqual([]);
    expect(store.snapshot(at(1000)).archivedDrafts[0]).toMatchObject({ id: r.archivedId, reason: "cleared", contributors: [{ tag: tagOf(ANA) }] });
  });

  it("join brings a version's performance to the stage; over gestures it needs replace, which archives", () => {
    const v1 = store.snapshot(T0).slots[0].exhibit!.latest;
    ok(store.join(ANA, v1.id, false, T0));
    expect(store.snapshot(T0).draft).toMatchObject({ parts: v1.parts, basedOn: { versionId: v1.id } });
    // the joined performance already has gestures: joining again asks
    expect(store.join(BO, v1.id, false, T0)).toMatchObject({ ok: false, error: "stage-busy" });
    const r = ok(store.join(BO, v1.id, true, at(1000)));
    expect(r.archivedId).toBeTruthy();
    expect(store.join(ANA, 999, true, T0)).toMatchObject({ ok: false, error: "not-found" });
  });

  it("an old sculpture can't be joined: it isn't a performance", () => {
    const old = store.snapshot(T0).storeroom[0].latest;
    expect(store.join(ANA, old.id, true, T0)).toMatchObject({ ok: false, error: "bad-request" });
  });

  it("brings an archived loop back with its gestures and credits", () => {
    ok(store.gesture(ANA, tap(4), T0));
    const { archivedId } = ok(store.clear(ANA, T0));
    ok(store.gesture(BO, pluck(), T0));
    expect(store.restoreArchived(BO, archivedId, false, T0)).toMatchObject({ ok: false, error: "stage-busy" });
    ok(store.restoreArchived(BO, archivedId, true, at(1000)));
    expect(gestures()).toEqual([{ ...tap(4), by: tagOf(ANA) }]);
    expect(store.snapshot(at(1000)).draft.contributors).toMatchObject([{ tag: tagOf(ANA) }]);
  });

  it("keeps every archived loop reachable past the state's newest few", () => {
    for (let i = 0; i < ARCHIVE_LIST + 3; i++) {
      ok(store.gesture(ANA, tap(), at(i * 10)));
      ok(store.clear(ANA, at(i * 10 + 1)));
    }
    const s = store.snapshot(T0);
    expect(s.archivedDrafts).toHaveLength(ARCHIVE_LIST);
    const rest = store.archive(s.archivedDrafts.at(-1)!.id);
    expect(s.archivedTotal).toBe(ARCHIVE_LIST + 3 + 0);
    expect(rest.drafts).toHaveLength(3);
    expect(rest.more).toBe(false);
  });
});

describe("versions", () => {
  it("leaves the loop as a new exhibit, credits everyone in it, and keeps the loop", () => {
    ok(store.gesture(ANA, tap(), T0));
    ok(store.gesture(BO, pluck(), T0));
    ok(store.gesture(BO, pluck(3), T0));
    const p = ok(store.publish(ANA, { title: "Bell Panic", slot: 4 }, at(1000)));
    const v = store.snapshot(at(1000)).slots[3].exhibit!.latest;
    expect(v).toMatchObject({ title: "Bell Panic", n: 1, recipe: "stage", publishedBy: { tag: tagOf(ANA) } });
    expect(v.contributors.map((c) => [c.tag, c.edits])).toEqual([
      [tagOf(ANA), 1],
      [tagOf(BO), 2],
    ]);
    expect(v.parts.gestures).toHaveLength(3);
    expect(gestures()).toHaveLength(3);
    expect(p.n).toBe(1);
  });

  it("credits only who's still in the loop, not everyone who ever played", () => {
    ok(store.gesture(BO, pluck(), T0));
    ok(store.undo(BO, T0));
    ok(store.gesture(ANA, tap(), T0));
    ok(store.publish(ANA, { title: "Solo", slot: 4 }, T0));
    expect(store.snapshot(T0).slots[3].exhibit!.latest.contributors.map((c) => c.tag)).toEqual([tagOf(ANA)]);
  });

  it("refuses to leave a silent loop", () => {
    expect(store.publish(ANA, { title: "x", slot: 4 }, T0)).toMatchObject({ ok: false, error: "stage-empty" });
  });

  it("keeps names as they were when the version was made", () => {
    ok(store.gesture(ANA, tap(), T0));
    const p = ok(store.publish(ANA, { title: "Before", slot: 4 }, T0));
    store.rename(ANA, "Renamed");
    const v = store.history(p.exhibitId)!.versions[0];
    expect(v.contributors[0].name).toBe("Coral Heron");
    expect(v.publishedBy!.name).toBe("Coral Heron");
  });

  it("adds a version to an existing exhibit; restore makes N+1", () => {
    const first = store.snapshot(T0).slots[0].exhibit!;
    ok(store.gesture(ANA, tap(), T0));
    expect(ok(store.publish(ANA, { title: "Second", exhibitId: first.id }, at(1000))).n).toBe(2);
    const r = ok(store.restoreVersion(BO, first.id, first.latest.id, at(2000)));
    expect(r).toMatchObject({ n: 3, from: 1 });
    const h = store.history(first.id)!;
    expect(h.versions[0]).toMatchObject({ restoredFrom: 1, parts: first.latest.parts });
  });

  it("refuses UPDATE and DELETE on versions in the database itself", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    expect(() => db.exec("UPDATE versions SET title = 'x' WHERE id = 1")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM versions WHERE id = 1")).toThrow(/immutable/);
  });
});

describe("slots", () => {
  beforeEach(() => ok(store.gesture(ANA, tap(), T0)));

  it("never silently replaces a full slot; with replace the old one goes to the storeroom", () => {
    const there = store.snapshot(T0).slots[0].exhibit!;
    expect(store.publish(BO, { title: "Usurper", slot: 1 }, T0)).toMatchObject({ ok: false, error: "slot-taken", exhibit: { id: there.id } });
    const r = ok(store.publish(BO, { title: "Usurper", slot: 1, replace: true }, at(1000)));
    expect(r.stored).toBe(there.id);
    expect(store.snapshot(at(1000)).storeroom.map((e) => e.id)).toContain(there.id);
  });

  it("stores an exhibit and displays it again on a free slot", () => {
    const id = store.snapshot(T0).slots[1].exhibit!.id;
    expect(ok(store.storeAway(id)).slot).toBe(2);
    expect(store.storeAway(id)).toMatchObject({ ok: false, error: "slot-empty" });
    ok(store.display(id, 6, false));
    expect(store.snapshot(T0).slots[5].exhibit!.id).toBe(id);
  });
});
