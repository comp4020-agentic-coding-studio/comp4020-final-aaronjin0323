// The store's rules (CLAUDE.md, "The performance" and "Exhibits"), over an
// in-memory database with an injected clock.
import { describe, expect, test } from "vitest";
import { openStore } from "../src/db.ts";

const T0 = Date.parse("2026-11-01T00:00:00Z");
const ring = (at: number) => ({ kind: "ring", at });
const flick = (ball: string, at: number) => ({ kind: "flick", ball, v: [1, -2, 0], at });

function fresh() {
  const s: any = openStore(":memory:");
  const a = s.visitor(null, T0);
  const b = s.visitor(null, T0);
  return { s, a: a.pid, b: b.pid };
}
// the store's results, read loosely: the shapes are what the tests check
const ok = (r: any): any => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
};

describe("visitors", () => {
  test("a new visitor gets a name, a colour and a tag; the pid is never in the state", () => {
    const { s, a } = fresh();
    const v = s.visitor(a, T0);
    expect(v.pid).toBe(a);
    expect(v.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(v.tag).toMatch(/^[0-9a-f]{8}$/);
    s.addGesture(a, ring(1), T0);
    expect(JSON.stringify(s.state([]))).not.toContain(a);
  });
  test("an unknown or missing pid is a new visitor", () => {
    const { s } = fresh();
    expect(s.visitor("not-a-real-one", T0).pid).not.toBe("not-a-real-one");
  });
  test("rename takes 1-24 characters after trimming, never truncating", () => {
    const { s, a } = fresh();
    expect(ok(s.rename(a, "  Ada  ")).visitor.name).toBe("Ada");
    for (const bad of ["", "   ", "x".repeat(25), 7 as unknown as string]) expect(s.rename(a, bad)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the stage", () => {
  test("a gesture is kept with who made it; a bad one is refused", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, flick("teal", 2), T0));
    expect(s.state([]).stage.gestures).toMatchObject([{ kind: "flick", ball: "teal", at: 2 }]);
    expect(s.addGesture(a, { kind: "flick", ball: "teal", at: 2 }, T0)).toMatchObject({ ok: false, status: 400 });
  });
  test("past 10 your own oldest drops; past 30 the oldest of all", () => {
    const { s, a, b } = fresh();
    for (let i = 0; i < 12; i++) ok(s.addGesture(a, ring(i), T0));
    let g = s.state([]).stage.gestures;
    expect(g.length).toBe(10);
    expect(g.map((x: any) => x.at)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const c = s.visitor(null, T0).pid;
    for (let i = 0; i < 10; i++) ok(s.addGesture(b, ring(i + 0.5), T0));
    for (let i = 0; i < 11; i++) ok(s.addGesture(c, ring(i + 0.25), T0));
    g = s.state([]).stage.gestures;
    expect(g.length).toBe(30);
    // c's 11th pushed out c's own first (the per-visitor cap), so a and b keep 10 each
    const tags = s.state([]).stage.credits;
    expect(tags.map((x: any) => x.count).sort()).toEqual([10, 10, 10]);
  });
  test("over 30 from many visitors, the oldest of all drops", () => {
    const s: any = openStore(":memory:");
    const ps = Array.from({ length: 4 }, () => s.visitor(null, T0).pid);
    for (let i = 0; i < 31; i++) ok(s.addGesture(ps[i % 4], ring(i * 0.5), T0));
    const g = s.state([]).stage.gestures;
    expect(g.length).toBe(30);
    expect(g.some((x: any) => x.at === 0)).toBe(false);
  });
  test("undo removes only your own newest gesture", () => {
    const { s, a, b } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.addGesture(b, ring(2), T0));
    ok(s.addGesture(a, ring(3), T0));
    ok(s.undo(b));
    expect(s.state([]).stage.gestures.map((x: any) => x.at)).toEqual([1, 3]);
  });
  test("undo with nothing of yours is a 409", () => {
    const { s, a, b } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    expect(s.undo(b)).toMatchObject({ ok: false, status: 409, error: "nothing-to-undo" });
  });
  test("start over archives the loop and leaves a silent one; a silent stage can't be cleared", () => {
    const { s, a } = fresh();
    expect(s.clear(a, T0)).toMatchObject({ ok: false, status: 409, error: "stage-empty" });
    ok(s.addGesture(a, ring(1), T0));
    ok(s.clear(a, T0 + 1000));
    const st = s.state([]);
    expect(st.stage.gestures).toEqual([]);
    expect(st.archived.length).toBe(1);
    expect(st.archived[0].gestures.length).toBe(1);
  });
  test("a cleared loop can be brought back; over a busy stage only with replace, archiving it", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.clear(a, T0 + 1));
    const old = s.state([]).archived[0].id;
    ok(s.addGesture(a, ring(5), T0 + 2));
    expect(s.bringBack(old, false, T0 + 3)).toMatchObject({ ok: false, status: 409, error: "stage-busy" });
    ok(s.bringBack(old, true, T0 + 3));
    const st = s.state([]);
    expect(st.stage.gestures.map((x: any) => x.at)).toEqual([1]);
    expect(st.archived.some((x: any) => x.gestures[0]?.at === 5)).toBe(true);
  });
});

describe("exhibits and versions", () => {
  test("leave it on an empty plinth makes version 1, crediting everyone who played", () => {
    const { s, a, b } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.addGesture(b, ring(2), T0));
    ok(s.addGesture(b, ring(3), T0));
    ok(s.publish(a, { title: "Bell storm", slot: 2 }, T0));
    const slot = s.state([]).slots.find((x: any) => x.slot === 2);
    expect(slot.exhibit.latest).toMatchObject({ n: 1, title: "Bell storm" });
    const h = ok(s.history(slot.exhibit.id)).versions;
    expect(h[0].credits.map((c: any) => c.count).sort()).toEqual([1, 2]);
    expect(h[0].leftBy.tag).toBe(s.visitor(a, T0).tag);
    expect(s.state([]).stage.gestures.length).toBe(3); // the loop stays
  });
  test("an empty stage can't be left; a title must be 1-40 characters", () => {
    const { s, a } = fresh();
    expect(s.publish(a, { title: "x", slot: 1 }, T0)).toMatchObject({ ok: false, status: 409, error: "stage-empty" });
    ok(s.addGesture(a, ring(1), T0));
    for (const title of ["", "  ", "x".repeat(41)]) expect(s.publish(a, { title, slot: 1 }, T0)).toMatchObject({ ok: false, status: 400 });
    for (const slot of [0, 7, 1.5]) expect(s.publish(a, { title: "ok", slot }, T0)).toMatchObject({ ok: false, status: 400 });
  });
  test("a taken plinth is never silently replaced; with replace, the old exhibit goes to the storeroom whole", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.publish(a, { title: "First", slot: 1 }, T0));
    const first = s.state([]).slots[0].exhibit.id;
    expect(s.publish(a, { title: "Second", slot: 1 }, T0)).toMatchObject({ ok: false, status: 409, error: "slot-taken" });
    ok(s.publish(a, { title: "Second", slot: 1, replace: true }, T0));
    const st = s.state([]);
    expect(st.slots[0].exhibit.latest.title).toBe("Second");
    expect(st.storeroom.map((x: any) => x.id)).toEqual([first]);
    ok(s.display(first, 4, false));
    expect(s.state([]).slots[3].exhibit.id).toBe(first);
  });
  test("a new version of an exhibit adds to it; restore publishes an old one again as the newest", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.publish(a, { title: "One", slot: 3 }, T0));
    const id = s.state([]).slots[2].exhibit.id;
    ok(s.addGesture(a, ring(2), T0));
    ok(s.publish(a, { title: "Two", exhibitId: id }, T0 + 1));
    const v1 = ok(s.history(id)).versions.find((v: any) => v.n === 1);
    ok(s.restore(id, v1.id, a, T0 + 2));
    const h = ok(s.history(id)).versions;
    expect(h.map((v: any) => v.n)).toEqual([3, 2, 1]);
    expect(h[0]).toMatchObject({ title: "One", restoredFrom: 1 });
    expect(h[0].gestures).toEqual(v1.gestures);
  });
  test("versions can't be changed or deleted, even by SQL", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.publish(a, { title: "Kept", slot: 1 }, T0));
    expect(() => s.db.exec("UPDATE versions SET title = 'x'")).toThrow(/immutable/);
    expect(() => s.db.exec("DELETE FROM versions")).toThrow(/immutable/);
  });
  test("join in brings a version to the stage; over a busy stage only with replace, archiving it", () => {
    const { s, a, b } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.publish(a, { title: "Shared", slot: 5 }, T0));
    const id = s.state([]).slots[4].exhibit.id;
    const vid = ok(s.history(id)).versions[0].id;
    expect(s.join(vid, false, T0)).toMatchObject({ ok: false, status: 409, error: "stage-busy" });
    ok(s.join(vid, true, T0));
    const st = s.state([]);
    expect(st.stage.basedOn).toMatchObject({ title: "Shared", n: 1 });
    expect(st.archived.length).toBe(1);
    ok(s.addGesture(b, ring(4), T0));
    expect(s.state([]).stage.gestures.length).toBe(2);
    expect(s.join(99999, true, T0)).toMatchObject({ ok: false, status: 404 });
  });
  test("taking an exhibit off its plinth keeps it in the storeroom; an empty plinth can't be taken off", () => {
    const { s, a } = fresh();
    ok(s.addGesture(a, ring(1), T0));
    ok(s.publish(a, { title: "Away", slot: 6 }, T0));
    const id = s.state([]).slots[5].exhibit.id;
    ok(s.store(id));
    expect(s.store(id)).toMatchObject({ ok: false, status: 409, error: "slot-empty" });
    expect(s.state([]).storeroom[0].id).toBe(id);
    expect(ok(s.history(id)).versions.length).toBe(1);
  });
});

describe("migrations", () => {
  test("opening twice keeps everything", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "museum-")), "x.db");
    const s1: any = openStore(file);
    const a = s1.visitor(null, T0).pid;
    ok(s1.addGesture(a, ring(1), T0));
    ok(s1.publish(a, { title: "Stays", slot: 1 }, T0));
    s1.close();
    const s2: any = openStore(file);
    expect(s2.state([]).slots[0].exhibit.latest.title).toBe("Stays");
    expect(s2.visitor(a, T0).pid).toBe(a);
    s2.close();
  });
});
