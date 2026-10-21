import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { checkSculpture, defaultParts } from "../public/recipes.js";
import { ARCHIVE_LIST, LEASE_MS, migrate, MIGRATIONS, openStore, type Store, tagOf } from "../src/db.ts";

// The store's rules over ":memory:" with an injected clock (CLAUDE.md, "The
// checks"): leases, versions, archiving, slots and migrations. The HTTP
// tests hold the same rules through the routes.

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

describe("migrations", () => {
  it("seeds the three starters in slots 1-3, version 1, published by the museum", () => {
    const s = store.snapshot(T0);
    expect(s.slots.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    const starters = s.slots.slice(0, 3).map((x) => x.exhibit!);
    expect(starters.map((e) => [e.latest.title, e.latest.recipe, e.latest.n, e.versionCount, e.latest.publishedBy])).toEqual([
      ["Loop & Lantern", "loop", 1, 1, null],
      ["Arch Totem", "arches", 1, 1, null],
      ["Glass Bloom", "bloom", 1, 1, null],
    ]);
    expect(s.slots.slice(3).every((x) => x.exhibit === null)).toBe(true);
    for (const e of starters) {
      expect(checkSculpture(e.latest.recipe, e.latest.parts), e.latest.title).toEqual({ ok: true });
      expect(e.latest.parts, `${e.latest.title} should differ from the bare defaults`).not.toEqual(defaultParts(e.latest.recipe));
    }
    expect(s.draft.recipe).toBeNull();
    expect(s.storeroom).toEqual([]);
  });

  it("runs each migration once: reopening never seeds again", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRATIONS.length });
    expect(db.prepare("SELECT COUNT(*) AS c FROM versions").get()).toEqual({ c: 3 });
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
    expect(tagOf(ANA)).toMatch(/^[0-9a-f]{6}$/);
    expect(tagOf(ANA)).not.toBe(tagOf(BO));
  });
});

describe("leases", () => {
  beforeEach(() => ok(store.start(ANA, "loop", T0)));

  it("refuses an edit to a part someone else holds, naming the holder", () => {
    ok(store.lease(ANA, "ribbon", T0));
    const r = store.edit(BO, "ribbon", { turns: 4 }, at(1000));
    expect(r).toMatchObject({ ok: false, error: "lease-held", holder: { tag: tagOf(ANA), name: "Coral Heron" } });
    expect(store.lease(BO, "ribbon", at(1000))).toMatchObject({ ok: false, error: "lease-held" });
    expect(store.snapshot(at(1000)).draft.parts!.ribbon.turns).toBe(2);
  });

  it("lets two people edit two parts at once", () => {
    ok(store.edit(ANA, "ribbon", { turns: 4 }, T0));
    ok(store.edit(BO, "cube", { size: 1 }, T0));
    const s = store.snapshot(T0);
    expect(s.leases.map((l) => [l.part, l.pid])).toEqual([
      ["cube", BO],
      ["ribbon", ANA],
    ]);
    expect(s.draft.parts!.ribbon.turns).toBe(4);
    expect(s.draft.parts!.cube.size).toBe(1);
  });

  it("takes the lease implicitly on an edit and renews it on every edit", () => {
    const first = ok(store.edit(ANA, "ribbon", { turns: 3 }, T0));
    expect(first.taken).toBe(true);
    ok(store.edit(ANA, "ribbon", { turns: 4 }, at(10_000)));
    // 20 s after the first edit, but only 10 s after the renewing one
    expect(store.edit(BO, "ribbon", { turns: 1 }, at(20_000))).toMatchObject({ ok: false, error: "lease-held" });
    expect(store.leases(at(20_000))[0].expiresAt).toBe(at(10_000 + LEASE_MS).toISOString());
  });

  it("renews a lease on POST /draft/lease", () => {
    ok(store.lease(ANA, "ribbon", T0));
    const again = ok(store.lease(ANA, "ribbon", at(14_000)));
    expect(again.taken).toBe(false);
    expect(store.lease(BO, "ribbon", at(20_000))).toMatchObject({ ok: false, error: "lease-held" });
  });

  it("is free on read once expired, with no sweep", () => {
    ok(store.lease(ANA, "ribbon", T0));
    expect(store.leases(at(LEASE_MS - 1))).toHaveLength(1);
    expect(store.leases(at(LEASE_MS))).toHaveLength(0);
    const r = ok(store.edit(BO, "ribbon", { turns: 5 }, at(LEASE_MS)));
    expect(r.taken).toBe(true);
    expect(store.snapshot(at(LEASE_MS)).leases[0].pid).toBe(BO);
  });

  it("expire() deletes and returns the leases that ran out", () => {
    ok(store.lease(ANA, "ribbon", T0));
    ok(store.lease(BO, "cube", at(5000)));
    expect(store.expire(at(LEASE_MS)).map((l) => l.part)).toEqual(["ribbon"]);
    expect(store.expire(at(LEASE_MS))).toEqual([]);
    expect(store.leases(at(LEASE_MS)).map((l) => l.part)).toEqual(["cube"]);
  });

  it("releases one lease, or all of a visitor's", () => {
    ok(store.lease(ANA, "ribbon", T0));
    ok(store.lease(ANA, "cube", T0));
    ok(store.lease(BO, "spheres", T0));
    expect(store.release(BO, "ribbon", T0)).toEqual({ ok: true, released: false });
    expect(store.release(ANA, "ribbon", T0)).toEqual({ ok: true, released: true });
    expect(store.releaseAll(ANA)).toEqual(["cube"]);
    expect(store.leases(T0).map((l) => l.part)).toEqual(["spheres"]);
  });

  it("refuses a part the recipe doesn't have, and bad values, without taking the lease", () => {
    expect(store.lease(ANA, "petals", T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.lease(ANA, "constructor", T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.edit(ANA, "ribbon", { turns: 99 }, T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.edit(ANA, "ribbon", { turns: "3" }, T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.edit(ANA, "ribbon", { wings: 1 }, T0)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.leases(T0)).toEqual([]);
  });

  it("refuses leases and edits on an empty bench", () => {
    ok(store.clear(ANA, T0));
    expect(store.lease(ANA, "ribbon", T0)).toMatchObject({ ok: false, error: "draft-empty" });
    expect(store.edit(ANA, "ribbon", { turns: 3 }, T0)).toMatchObject({ ok: false, error: "draft-empty" });
  });
});

describe("the draft", () => {
  it("starts from defaults, once", () => {
    ok(store.start(ANA, "bloom", T0));
    expect(store.snapshot(T0).draft).toMatchObject({ recipe: "bloom", parts: defaultParts("bloom"), revision: 1, basedOn: null });
    expect(store.start(BO, "loop", T0)).toMatchObject({ ok: false, error: "draft-not-empty" });
    expect(store.start(BO, "nope", T0)).toMatchObject({ ok: false, error: "bad-request" });
  });

  it("credits each part's last author and counts each contributor's edits", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "ribbon", { turns: 3 }, T0));
    ok(store.edit(ANA, "ribbon", { turns: 4 }, T0));
    ok(store.edit(BO, "cube", { size: 1 }, T0));
    ok(store.release(ANA, "ribbon", T0));
    ok(store.edit(BO, "ribbon", { twist: 3 }, T0));
    const d = store.snapshot(T0).draft;
    expect(d.revision).toBe(5);
    expect(d.partAuthors.ribbon.tag).toBe(tagOf(BO));
    expect(d.partAuthors.cube.tag).toBe(tagOf(BO));
    expect(d.partAuthors.spheres).toBeUndefined();
    expect(d.contributors.map((c) => [c.name, c.edits])).toEqual([
      ["Coral Heron", 2],
      ["Teal Finch", 2],
    ]);
    expect(d.parts!.ribbon).toMatchObject({ turns: 4, twist: 3 });
  });

  it("refuses remix into a non-empty bench unless replace, and replace archives first", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "ribbon", { turns: 5 }, T0));
    const before = store.snapshot(T0).draft;
    const starter = store.snapshot(T0).slots[1].exhibit!.latest;
    expect(store.remix(BO, starter.id, false, T0)).toMatchObject({ ok: false, error: "draft-not-empty" });
    expect(store.snapshot(T0).draft.id).toBe(before.id);

    const r = ok(store.remix(BO, starter.id, true, at(1000)));
    expect(r.archivedId).toBe(before.id);
    const s = store.snapshot(at(1000));
    expect(s.draft).toMatchObject({ recipe: "arches", parts: starter.parts, basedOn: { versionId: starter.id, title: "Arch Totem", n: 1 } });
    expect(s.leases).toEqual([]);
    expect(s.archivedDrafts[0]).toMatchObject({ id: before.id, recipe: "loop", reason: "replaced", archivedBy: { tag: tagOf(BO) } });
    expect(s.archivedDrafts[0].contributors.map((c) => c.name)).toEqual(["Coral Heron"]);
  });

  it("brings an archived draft back with its numbers and credits", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "ribbon", { turns: 5 }, T0));
    const { archivedId } = ok(store.clear(ANA, T0));
    expect(store.snapshot(T0).archivedDrafts[0]).toMatchObject({ id: archivedId, reason: "cleared" });
    expect(store.snapshot(T0).draft.recipe).toBeNull();
    ok(store.restoreArchived(BO, archivedId, false, at(1000)));
    const d = store.snapshot(at(1000)).draft;
    expect(d.parts!.ribbon.turns).toBe(5);
    expect(d.contributors.map((c) => [c.name, c.edits])).toEqual([["Coral Heron", 1]]);
    expect(store.restoreArchived(BO, archivedId, false, at(1000))).toMatchObject({ ok: false, error: "draft-not-empty" });
    expect(store.restoreArchived(BO, 9999, true, at(1000))).toMatchObject({ ok: false, error: "not-found" });
    expect(store.restoreArchived(BO, d.id, true, at(1000))).toMatchObject({ ok: false, error: "not-found" });
  });

  it("keeps every archived draft reachable past the state's newest few", () => {
    const ids: number[] = [];
    for (let i = 0; i < ARCHIVE_LIST + 5; i++) {
      ok(store.start(ANA, "loop", at(i * 1000)));
      ids.push(ok(store.clear(ANA, at(i * 1000))).archivedId);
    }
    const s = store.snapshot(at(60_000));
    expect(s.archivedDrafts.length).toBe(ARCHIVE_LIST);
    expect(s.archivedTotal).toBe(ARCHIVE_LIST + 5);
    // paging back from the oldest one the state shows reaches the rest, in order
    const older = store.archive(s.archivedDrafts.at(-1)!.id);
    expect(older.drafts.map((d) => d.id)).toEqual(ids.slice(0, 5).reverse());
    expect(older.more).toBe(false);
    expect(store.archive(null).drafts.map((d) => d.id)).toEqual(s.archivedDrafts.map((d) => d.id));
    expect(store.archive(null).more).toBe(true);
  });

  it("refuses clear while someone else holds a lease, and on an empty bench", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.lease(BO, "cube", T0));
    expect(store.clear(ANA, T0)).toMatchObject({ ok: false, error: "lease-held", holder: { tag: tagOf(BO) } });
    ok(store.lease(ANA, "ribbon", T0));
    expect(store.clear(BO, T0)).toMatchObject({ ok: false, error: "lease-held" });
    ok(store.clear(ANA, at(LEASE_MS)));
    expect(store.clear(ANA, at(LEASE_MS))).toMatchObject({ ok: false, error: "draft-empty" });
  });
});

describe("versions", () => {
  it("publishes a new exhibit into a free slot, keeping the draft and its credits", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(BO, "cube", { size: 1.2 }, T0));
    const p = ok(store.publish(ANA, { title: "Cube Dream", slot: 4 }, at(1000)));
    expect(p).toMatchObject({ n: 1, stored: null });
    const s = store.snapshot(at(1000));
    expect(s.slots[3].exhibit!.latest).toMatchObject({
      title: "Cube Dream",
      n: 1,
      publishedBy: { tag: tagOf(ANA), name: "Coral Heron" },
      contributors: [{ tag: tagOf(BO), name: "Teal Finch", edits: 1 }],
      publishedAt: at(1000).toISOString(),
    });
    expect(s.draft.recipe).toBe("loop");
  });

  it("keeps names as they were when the version was made", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "cube", { size: 1.2 }, T0));
    const p = ok(store.publish(ANA, { title: "Before", slot: 4 }, T0));
    store.rename(ANA, "Renamed");
    const v = store.history(p.exhibitId)!.versions[0];
    expect(v.contributors[0].name).toBe("Coral Heron");
    expect(v.publishedBy!.name).toBe("Coral Heron");
  });

  it("adds a version to an existing exhibit; history is newest first", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "cube", { size: 1.2 }, T0));
    const p = ok(store.publish(ANA, { title: "Second", exhibitId: 1 }, at(1000)));
    expect(p.n).toBe(2);
    const h = store.history(1)!;
    expect(h.versions.map((v) => [v.n, v.title])).toEqual([
      [2, "Second"],
      [1, "Loop & Lantern"],
    ]);
    expect(h.exhibit.versionCount).toBe(2);
    expect(store.publish(ANA, { title: "x", exhibitId: 999 }, T0)).toMatchObject({ ok: false, error: "not-found" });
    expect(store.history(999)).toBeNull();
  });

  it("records the version a remix came from on what it publishes", () => {
    ok(store.remix(ANA, 2, false, T0));
    const p = ok(store.publish(ANA, { title: "Totem II", slot: 5 }, T0));
    expect(store.history(p.exhibitId)!.versions[0].basedOn).toEqual({ exhibitId: 2, versionId: 2, title: "Arch Totem", n: 1 });
  });

  it("refuses to publish an empty bench", () => {
    expect(store.publish(ANA, { title: "x", slot: 4 }, T0)).toMatchObject({ ok: false, error: "draft-empty" });
  });

  it("restore makes version N+1 with the old numbers and restoredFrom", () => {
    ok(store.start(ANA, "loop", T0));
    ok(store.edit(ANA, "ribbon", { turns: 5 }, T0));
    ok(store.publish(ANA, { title: "Loopier", exhibitId: 1 }, at(1000)));
    const r = ok(store.restoreVersion(BO, 1, 1, at(2000)));
    expect(r).toMatchObject({ n: 3, from: 1 });
    const h = store.history(1)!;
    expect(h.versions.map((v) => v.n)).toEqual([3, 2, 1]);
    expect(h.versions[0]).toMatchObject({ restoredFrom: 1, title: "Loop & Lantern", parts: h.versions[2].parts, publishedBy: { tag: tagOf(BO) } });
    expect(h.versions[1].parts.ribbon.turns).toBe(5);
    expect(store.restoreVersion(BO, 2, 1, T0)).toMatchObject({ ok: false, error: "not-found" });
    expect(store.restoreVersion(BO, 1, 999, T0)).toMatchObject({ ok: false, error: "not-found" });
  });

  it("refuses UPDATE and DELETE on versions and their credits in the database itself", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    expect(() => db.exec("UPDATE versions SET title = 'x' WHERE id = 1")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM versions WHERE id = 1")).toThrow(/immutable/);
    db.exec("INSERT INTO version_credits (version_id, pid, name, colour, edits, ord) VALUES (1, 'p', 'n', 0, 1, 0)");
    expect(() => db.exec("UPDATE version_credits SET name = 'x'")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM version_credits")).toThrow(/immutable/);
    expect(db.prepare("SELECT title FROM versions WHERE id = 1").get()).toEqual({ title: "Loop & Lantern" });
  });
});

describe("slots", () => {
  beforeEach(() => ok(store.start(ANA, "loop", T0)));

  it("never silently replaces a full slot", () => {
    const r = store.publish(BO, { title: "Usurper", slot: 1 }, T0);
    expect(r).toMatchObject({ ok: false, error: "slot-taken", exhibit: { id: 1, latest: { title: "Loop & Lantern" } } });
    expect(store.snapshot(T0).slots[0].exhibit!.id).toBe(1);
    expect(store.snapshot(T0).storeroom).toEqual([]);
  });

  it("with replace, moves the old exhibit to the storeroom with all its versions", () => {
    ok(store.publish(ANA, { title: "v2", exhibitId: 1 }, T0));
    const r = ok(store.publish(BO, { title: "Usurper", slot: 1, replace: true }, at(1000)));
    expect(r.stored).toBe(1);
    const s = store.snapshot(at(1000));
    expect(s.slots[0].exhibit!.latest.title).toBe("Usurper");
    expect(s.storeroom.map((e) => [e.id, e.slot, e.versionCount])).toEqual([[1, null, 2]]);
    expect(store.history(1)!.versions).toHaveLength(2);
  });

  it("stores an exhibit and displays it again on a free slot", () => {
    expect(ok(store.storeAway(2)).slot).toBe(2);
    expect(store.storeAway(2)).toMatchObject({ ok: false, error: "slot-empty" });
    expect(store.storeAway(99)).toMatchObject({ ok: false, error: "not-found" });
    expect(store.snapshot(T0).slots[1].exhibit).toBeNull();
    expect(store.display(2, 1, false)).toMatchObject({ ok: false, error: "slot-taken", exhibit: { id: 1 } });
    ok(store.display(2, 6, false));
    expect(store.snapshot(T0).slots[5].exhibit!.id).toBe(2);
    expect(store.display(2, 5, false)).toMatchObject({ ok: false, error: "bad-request" });
    expect(store.display(99, 5, false)).toMatchObject({ ok: false, error: "not-found" });
  });

  it("display with replace swaps the slot's exhibit into the storeroom", () => {
    ok(store.storeAway(3));
    const r = ok(store.display(3, 1, true));
    expect(r.stored).toBe(1);
    const s = store.snapshot(T0);
    expect(s.slots[0].exhibit!.id).toBe(3);
    expect(s.storeroom.map((e) => e.id)).toEqual([1]);
  });
});
