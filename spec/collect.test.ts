// Collecting in the hall (CLAUDE.md, "Collecting"; ADR 25), held over the
// store: migrations that keep what's there, artifacts that are only ever in
// one state, pickups and deliveries that are atomic and idempotent, and a
// display that only shows what you own.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { MIGRATIONS, migrate, openStore } from "../src/db.ts";
// @ts-ignore -- plain JS module shared with the page
import { CARRY_MAX, KINDS, MAX_AVAILABLE, SPOTS } from "../public/hall.js";

const T0 = Date.parse("2026-11-01T00:00:00Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fresh(path = ":memory:") {
  const s: any = openStore(path);
  const a = s.visitor(null, T0).pid as string;
  const b = s.visitor(null, T0).pid as string;
  return { s, a, b };
}
const ok = (r: any): any => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
};
/** Puts n of `kind` in a's collection the way play does: on the floor, picked up, delivered. */
function own(s: any, pid: string, kind: string, n: number) {
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    s.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, ?, 1, 1, 'available', ?)").run(id, kind, T0);
    ok(s.pickUp(pid, id, T0));
    ok(s.deliver(pid, T0));
  }
}

describe("migrations keep what's there", () => {
  test("a new database is brought to the newest version", () => {
    const { s } = fresh();
    expect(s.db.prepare("PRAGMA user_version").get().user_version).toBe(MIGRATIONS.length);
  });
  test("an older file keeps every row, gains the new tables, and leaves a copy of itself first", () => {
    const dir = mkdtempSync(join(tmpdir(), "museum-"));
    const path = join(dir, "gallery.db");
    const old = new DatabaseSync(path);
    old.exec(MIGRATIONS[0]);
    old.exec("PRAGMA user_version = 1");
    old.prepare("INSERT INTO visitors (pid, tag, name, colour, created_at) VALUES ('p-old', 'abcd1234', 'Old Owl', 2, 1)").run();
    old.prepare("INSERT INTO exhibits (id, slot, created_at) VALUES (1, 3, 1)").run();
    old.prepare("INSERT INTO versions (exhibit_id, n, title, gestures, credits, left_by, created_at) VALUES (1, 1, 'Kept', '[]', '[]', '{}', 1)").run();
    old.close();

    const s: any = openStore(path);
    expect(s.who("p-old")).toMatchObject({ name: "Old Owl" });
    expect(s.state([]).slots[2].exhibit.latest.title).toBe("Kept");
    expect(s.db.prepare("PRAGMA user_version").get().user_version).toBe(MIGRATIONS.length);
    expect(s.floor()).toEqual([]);
    s.close();

    const copies = readdirSync(dir).filter((f) => /^gallery\.db\.before-v1-\d+$/.test(f));
    expect(copies.length).toBe(1);
    const copy = new DatabaseSync(join(dir, copies[0]));
    expect((copy.prepare("PRAGMA user_version").get() as any).user_version).toBe(1);
    expect((copy.prepare("SELECT name FROM visitors WHERE pid = 'p-old'").get() as any).name).toBe("Old Owl");
    copy.close();

    // opened again at the newest version: nothing to do, no new copy
    openStore(path).close();
    expect(readdirSync(dir).filter((f) => f.includes(".before-")).length).toBe(1);
  });
  test("a migration that fails is rolled back whole, and the version stays", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, ":memory:", MIGRATIONS, T0);
    const broken = [...MIGRATIONS, "CREATE TABLE half_made (x); CREATE TABLE broken ("];
    expect(() => migrate(db, ":memory:", broken, T0)).toThrow();
    expect((db.prepare("PRAGMA user_version").get() as any).user_version).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_made'").get()).toBeUndefined();
  });
});

describe("the floor", () => {
  test("six available, each with a UUID, a kind, and its own safe spot; topping up again adds none", () => {
    const { s } = fresh();
    expect(s.fillFloor(T0)).toBe(MAX_AVAILABLE);
    const f = s.floor();
    expect(f.length).toBe(MAX_AVAILABLE);
    expect(new Set(f.map((a: any) => a.id)).size).toBe(MAX_AVAILABLE);
    for (const a of f) {
      expect(a.id).toMatch(UUID);
      expect(KINDS).toContain(a.kind);
      expect(SPOTS.some((p: number[]) => p[0] === a.pos[0] && p[1] === a.pos[1])).toBe(true);
    }
    expect(new Set(f.map((a: any) => a.pos.join())).size).toBe(MAX_AVAILABLE);
    expect(s.fillFloor(T0)).toBe(0);
  });
  test("no artifact appears where a robot is standing", () => {
    const { s } = fresh();
    const free = SPOTS.slice(0, MAX_AVAILABLE);
    s.fillFloor(T0, SPOTS.slice(MAX_AVAILABLE));
    expect(s.floor().map((a: any) => a.pos.join()).sort()).toEqual(free.map((p: number[]) => p.join()).sort());
  });
});

describe("picking up and delivering", () => {
  test("touching an available artifact carries it; again, or by someone else, changes nothing", () => {
    const { s, a, b } = fresh();
    s.fillFloor(T0);
    const id = s.floor()[0].id;
    expect(ok(s.pickUp(a, id, T0)).picked).toBe(true);
    expect(ok(s.pickUp(a, id, T0)).picked).toBe(false);
    expect(ok(s.pickUp(b, id, T0)).picked).toBe(false);
    expect(s.cargo(a).map((c: any) => c.id)).toEqual([id]);
    expect(s.cargo(b)).toEqual([]);
    expect(s.floor().some((x: any) => x.id === id)).toBe(false);
  });
  test("at most three carried: a fourth stays on the floor", () => {
    const { s, a } = fresh();
    s.fillFloor(T0);
    const ids = s.floor().map((x: any) => x.id);
    for (let i = 0; i < CARRY_MAX; i++) expect(ok(s.pickUp(a, ids[i], T0)).picked).toBe(true);
    expect(ok(s.pickUp(a, ids[CARRY_MAX], T0)).picked).toBe(false);
    expect(s.cargo(a).length).toBe(CARRY_MAX);
    expect(s.floor().some((x: any) => x.id === ids[CARRY_MAX])).toBe(true);
  });
  test("delivering makes everything carried yours, counted by kind; delivering again changes nothing", () => {
    const { s, a, b } = fresh();
    s.fillFloor(T0);
    const picked = s.floor().slice(0, 3);
    for (const x of picked) s.pickUp(a, x.id, T0);
    expect(ok(s.deliver(a, T0)).delivered).toBe(3);
    expect(ok(s.deliver(a, T0)).delivered).toBe(0);
    expect(s.cargo(a)).toEqual([]);
    const want: Record<string, number> = { fish: 0, cloud: 0, door: 0 };
    for (const x of picked) want[x.kind]++;
    expect(s.collection(a)).toEqual(want);
    expect(s.collection(b)).toEqual({ fish: 0, cloud: 0, door: 0 });
    // and one delivered can't be picked up again
    expect(ok(s.pickUp(b, picked[0].id, T0)).picked).toBe(false);
  });
  test("an artifact id nobody has is no pickup", () => {
    const { s, a } = fresh();
    expect(ok(s.pickUp(a, "00000000-0000-4000-8000-000000000000", T0)).picked).toBe(false);
  });
});

describe("one state at a time, held by the database itself", () => {
  const raw = (s: any, sql: string) => () => s.db.exec(sql);
  test("no artifact is available and owned, carried without a holder, or deposited and held", () => {
    const { s, a } = fresh();
    s.fillFloor(T0);
    const [x, y] = s.floor();
    s.pickUp(a, x.id, T0);
    expect(raw(s, `UPDATE artifacts SET holder = NULL WHERE id = '${x.id}'`)).toThrow();
    expect(raw(s, `UPDATE artifacts SET owner = '${a}' WHERE id = '${y.id}'`)).toThrow();
    s.deliver(a, T0);
    expect(raw(s, `UPDATE artifacts SET holder = '${a}' WHERE id = '${x.id}'`)).toThrow();
  });
  test("only available → carried → deposited, or carried → available (a knock, ADR 26); a kept artifact never goes back and is never deleted", () => {
    const { s, a } = fresh();
    s.fillFloor(T0);
    const [x, y] = s.floor();
    expect(raw(s, `UPDATE artifacts SET state = 'deposited', owner = '${a}' WHERE id = '${y.id}'`)).toThrow();
    s.pickUp(a, x.id, T0);
    expect(raw(s, `UPDATE artifacts SET state = 'available', holder = NULL WHERE id = '${x.id}'`)).not.toThrow();
    s.pickUp(a, x.id, T0);
    s.deliver(a, T0);
    expect(raw(s, `UPDATE artifacts SET state = 'available', owner = NULL WHERE id = '${x.id}'`)).toThrow();
    expect(raw(s, `UPDATE artifacts SET state = 'carried', holder = '${a}', owner = NULL WHERE id = '${x.id}'`)).toThrow();
    expect(raw(s, `DELETE FROM artifacts WHERE id = '${x.id}'`)).toThrow();
    expect(s.collection(a)[x.kind]).toBe(1);
  });
});

describe("delivery zones", () => {
  test("each visitor's zone is assigned once and kept; the first eight get eight different ones", () => {
    const { s } = fresh();
    const pids = Array.from({ length: 8 }, () => s.visitor(null, T0).pid);
    const homes = pids.map((p) => s.hallHome(p, T0));
    expect(new Set(homes).size).toBe(8);
    expect(pids.map((p) => s.hallHome(p, T0 + 1))).toEqual(homes);
  });
});

describe("the display", () => {
  test("four slots, each empty or a kind you own, each kind once", () => {
    const { s, a } = fresh();
    expect(s.displayOf(a)).toEqual([null, null, null, null]);
    expect(s.arrange(a, ["fish", null, null, null])).toMatchObject({ ok: false, status: 409, error: "not-owned" });
    own(s, a, "fish", 2);
    own(s, a, "door", 1);
    expect(ok(s.arrange(a, [null, "door", null, "fish"])).display).toEqual([null, "door", null, "fish"]);
    expect(s.displayOf(a)).toEqual([null, "door", null, "fish"]);
    for (const bad of [["fish", "fish", null, null], ["fish", null, null], ["fish", null, null, null, null], ["whale", null, null, null], "fish", null]) {
      expect(s.arrange(a, bad)).toMatchObject({ ok: false, status: 400 });
    }
    expect(s.displayOf(a)).toEqual([null, "door", null, "fish"]);
  });
  test("someone else's collection doesn't count for yours", () => {
    const { s, a, b } = fresh();
    own(s, b, "cloud", 1);
    expect(s.arrange(a, ["cloud", null, null, null])).toMatchObject({ ok: false, error: "not-owned" });
  });
});

describe("kept on the volume", () => {
  test("cargo, collections, zones and displays survive a restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "museum-")), "gallery.db");
    let { s, a } = fresh(path);
    own(s, a, "cloud", 2);
    s.fillFloor(T0);
    const carried = s.floor()[0].id;
    s.pickUp(a, carried, T0);
    ok(s.arrange(a, ["cloud", null, null, null]));
    const home = s.hallHome(a, T0);
    s.close();
    s = openStore(path);
    expect(s.collection(a).cloud).toBe(2);
    expect(s.cargo(a).map((c: any) => c.id)).toEqual([carried]);
    expect(s.displayOf(a)).toEqual(["cloud", null, null, null]);
    expect(s.hallHome(a, T0)).toBe(home);
    expect(existsSync(path)).toBe(true);
    s.close();
  });
});

// ADR 26: a knock takes one carried artifact; nothing delivered is ever touched
describe("knocked loose", () => {
  test("a knock drops the struck visitor's newest carried artifact where it's told, ready only later", () => {
    const { s, a } = fresh();
    s.fillFloor(T0);
    const [x, y] = s.floor();
    s.pickUp(a, x.id, T0);
    s.pickUp(a, y.id, T0 + 20);
    const k = s.knockLoose(a, T0 + 100, [3, 4], T0 + 1100);
    expect(k).toEqual({ id: y.id, kind: y.kind });
    expect(s.cargo(a).map((c: any) => c.id)).toEqual([x.id]);
    expect(s.floor().find((f: any) => f.id === y.id)).toMatchObject({ pos: [3, 4], readyAt: T0 + 1100 });
  });
  test("a dropped artifact can't be picked up, by anyone, until it's ready", () => {
    const { s, a, b } = fresh();
    s.fillFloor(T0);
    const [x] = s.floor();
    s.pickUp(a, x.id, T0);
    s.knockLoose(a, T0 + 100, [3, 4], T0 + 1100);
    expect(ok(s.pickUp(b, x.id, T0 + 1099)).picked).toBe(false);
    expect(ok(s.pickUp(a, x.id, T0 + 1099)).picked).toBe(false);
    expect(ok(s.pickUp(b, x.id, T0 + 1100)).picked).toBe(true);
  });
  test("carrying nothing, nothing drops; nothing delivered is ever knocked loose", () => {
    const { s, a } = fresh();
    expect(s.knockLoose(a, T0, [3, 4], T0)).toBeNull();
    own(s, a, "door", 2);
    expect(s.knockLoose(a, T0, [3, 4], T0)).toBeNull();
    expect(s.collection(a).door).toBe(2);
  });
  test("migration 3 keeps a version-2 file's artifacts, ready at once, after a copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "museum-"));
    const path = join(dir, "gallery.db");
    const old = new DatabaseSync(path);
    old.exec(MIGRATIONS[0]);
    old.exec(MIGRATIONS[1]);
    old.exec("PRAGMA user_version = 2");
    old.prepare("INSERT INTO visitors (pid, tag, name, colour, created_at) VALUES ('p2', 'beef0002', 'Two Owl', 1, 1)").run();
    old.prepare("INSERT INTO artifacts (id, kind, x, y, state, owner, spawned_at, deposited_at) VALUES ('kept-1', 'fish', 3, 3, 'deposited', 'p2', 1, 2)").run();
    old.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES ('free-1', 'cloud', 4.4, 4.3, 'available', 1)").run();
    old.close();
    const s: any = openStore(path);
    expect(s.collection("p2").fish).toBe(1);
    expect(s.floor().find((f: any) => f.id === "free-1")).toMatchObject({ readyAt: 0 });
    expect(readdirSync(dir).filter((f) => /^gallery\.db\.before-v2-\d+$/.test(f)).length).toBe(1);
    s.close();
  });
});

describe("a display anyone can look at", () => {
  test("is the owner's real layout, with their real counts, and nothing else of theirs", () => {
    const { s, a } = fresh();
    own(s, a, "cloud", 3);
    ok(s.arrange(a, [null, "cloud", null, null]));
    expect(s.publicDisplay(a)).toEqual([null, { kind: "cloud", count: 3 }, null, null]);
  });
});

// ADR 27: leaving and coming back, a directory, stale changes
describe("cargo going back to the floor", () => {
  test("everything carried returns, where it's told, ready at once; again changes nothing", () => {
    const { s, a } = fresh();
    s.fillFloor(T0);
    const [x, y] = s.floor();
    s.pickUp(a, x.id, T0);
    s.pickUp(a, y.id, T0);
    const back = s.releaseCargo(a, T0 + 5, [[2.6, 2.8], [4.4, 2.8]]);
    expect(back.map((r: any) => r.id).sort()).toEqual([x.id, y.id].sort());
    expect(s.cargo(a)).toEqual([]);
    const f = s.floor();
    for (const r of back) expect(f.find((z: any) => z.id === r.id)).toMatchObject({ readyAt: T0 + 5 });
    expect(new Set(back.map((r: any) => r.pos.join())).size).toBe(2);
    expect(s.releaseCargo(a, T0 + 6, [[2.6, 2.8]])).toEqual([]);
  });
  test("never touches anything delivered, and never someone else's cargo", () => {
    const { s, a, b } = fresh();
    own(s, a, "fish", 2);
    s.fillFloor(T0);
    const z = s.floor()[0];
    s.pickUp(b, z.id, T0);
    expect(s.releaseCargo(a, T0, [[2.6, 2.8]])).toEqual([]);
    expect(s.collection(a).fish).toBe(2);
    expect(s.cargo(b).map((c: any) => c.id)).toEqual([z.id]);
  });
  test("who holds cargo right now", () => {
    const { s, a, b } = fresh();
    s.fillFloor(T0);
    s.pickUp(a, s.floor()[0].id, T0);
    expect(s.holders()).toEqual([a]);
    expect(s.holders()).not.toContain(b);
  });
});

describe("the directory of displays", () => {
  test("everyone who arranged one, newest change first, a page at a time, by cursor", () => {
    const { s } = fresh();
    const pids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const p = s.visitor(null, T0).pid;
      s.hallHome(p, T0);
      own(s, p, "door", 1);
      ok(s.arrange(p, ["door", null, null, null], undefined, T0 + i));
      pids.push(p);
    }
    s.hallHome(s.visitor(null, T0).pid, T0); // never arranged: not listed
    const first = s.directory(null);
    expect(first.entries.length).toBe(12);
    expect(first.entries[0].tag).toBe(s.who(pids[13]).tag);
    expect(first.entries[0].display[0]).toEqual({ kind: "door", count: 1 });
    expect(first.next).toMatch(/^\d+\.[0-9a-f]{8}$/);
    const second = s.directory(first.next);
    expect(second.entries.map((e: any) => e.tag)).toEqual([s.who(pids[1]).tag, s.who(pids[0]).tag]);
    expect(second.next).toBeNull();
    expect(JSON.stringify(first)).not.toContain(pids[13]);
  });
  test("a cursor that isn't one is refused", () => {
    const { s } = fresh();
    for (const bad of ["x", "1.zz", "1.abcd1234; DROP", "-1.abcd1234"]) expect(s.directory(bad)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("a display change from a layout that's no longer there", () => {
  test("is refused, with the current one", () => {
    const { s, a } = fresh();
    own(s, a, "fish", 1);
    own(s, a, "cloud", 1);
    ok(s.arrange(a, ["fish", null, null, null], [null, null, null, null], T0));
    const stale = s.arrange(a, ["cloud", null, null, null], [null, null, null, null], T0 + 1);
    expect(stale).toMatchObject({ ok: false, status: 409, error: "stale-display", display: ["fish", null, null, null] });
    expect(s.displayOf(a)).toEqual(["fish", null, null, null]);
    expect(s.arrange(a, ["cloud", null, null, null], "nope", T0 + 2)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("migration 4", () => {
  test("keeps a version-3 file's displays, and lists them", () => {
    const dir = mkdtempSync(join(tmpdir(), "museum-"));
    const path = join(dir, "gallery.db");
    const old = new DatabaseSync(path);
    for (const m of MIGRATIONS.slice(0, 3)) old.exec(m);
    old.exec("PRAGMA user_version = 3");
    old.prepare("INSERT INTO visitors (pid, tag, name, colour, created_at) VALUES ('p3', 'beef0003', 'Three Owl', 1, 1)").run();
    old.prepare("INSERT INTO hall_players (pid, home, joined_at) VALUES ('p3', 2, 1)").run();
    old.prepare("INSERT INTO artifacts (id, kind, x, y, state, owner, spawned_at, deposited_at) VALUES ('k3', 'cloud', 3, 3, 'deposited', 'p3', 1, 2)").run();
    old.prepare("INSERT INTO display_slots (pid, slot, kind) VALUES ('p3', 1, 'cloud')").run();
    old.close();
    const s: any = openStore(path);
    expect(s.displayOf("p3")).toEqual(["cloud", null, null, null]);
    expect(s.directory(null).entries.map((e: any) => e.tag)).toContain("beef0003");
    expect(readdirSync(dir).filter((f) => /^gallery\.db\.before-v3-\d+$/.test(f)).length).toBe(1);
    s.close();
  });
});
