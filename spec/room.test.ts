// Rooms: the shared table and check, and the store's rules, including that
// only what you've banked can stand in your room.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openStore } from "../src/db.ts";
// @ts-ignore -- plain JS module shared with the page
import * as R from "../public/room.js";

const T = 1_800_000_000_000;
const room = (items: any[] = [], over: object = {}) => ({ wall: "plaster", floor: "oak", light: "warm", items, ...over });
const stand = (uid = 1, artifact?: string) => ({ uid, type: "plinth", x: 0.5, y: 0.5, ...(artifact ? { artifact } : {}) });
function banked(s: any, pid: string, id: string, kind = "fish", material = "gold") {
  s.db.prepare("INSERT INTO artifacts (id, kind, material, seed, x, y, state, owner, spawned_at, banked_at) VALUES (?, ?, ?, 9, 1, 1, 'banked', ?, 0, ?)").run(id, kind, material, pid, T);
}

describe("checkLayout", () => {
  test("the default room is valid, and offers somewhere to stand things", () => {
    expect(R.checkLayout(R.DEFAULT_ROOM).ok).toBe(true);
    expect(R.DEFAULT_ROOM.items.some((i: any) => (R.ITEMS as any)[i.type].group === "stand")).toBe(true);
  });
  test("refuses anything not in the table", () => {
    const bad = [
      room([], { wall: "lava" }),
      room([], { floor: "lava" }),
      room([], { light: "lava" }),
      room([], { title: "hello" }),
      room([{ ...stand(), type: "throne" }]),
      room([{ ...stand(), note: "hi" }]),
      room([{ ...stand(), x: 1.5 }]),
      room([{ ...stand(), y: -0.1 }]),
      room([{ ...stand(), x: "0.5" }]),
      room([stand(1), stand(1)]),
      room([{ uid: 1, type: "bench", x: 0.5, y: 0.5, artifact: "a" }]),
      room([stand(1, "a"), stand(2, "a")]),
      room(Array.from({ length: R.ROOM_MAX_ITEMS + 1 }, (_, i) => stand(i + 1))),
      null,
      [],
    ];
    for (const b of bad) expect(R.checkLayout(b).ok, JSON.stringify(b)).toBe(false);
  });
  test("a full room of artifacts fits the 4 KB body limit", () => {
    const items = Array.from({ length: R.ROOM_MAX_ITEMS }, (_, i) => ({ uid: 1000 + i, type: "plinth", x: 0.123, y: 0.456, artifact: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    expect(JSON.stringify({ layout: room(items), was: 999999 }).length).toBeLessThan(4096);
  });
  test("every wall, floor, light and item has a name a person can read", () => {
    for (const t of [R.WALLS, R.FLOORS, R.LIGHTS, R.ITEMS]) for (const v of Object.values(t) as any[]) expect(v.name).toBeTruthy();
  });
});

describe("the view", () => {
  test("a position survives being drawn and dragged, on the floor and the wall", () => {
    for (const place of ["floor", "wall"]) {
      for (const [x, y] of [[0.2, 0.3], [0.8, 0.9], [0.5, 0]]) {
        const p = R.project({ x, y }, place);
        const back = R.unproject(p.X, p.Y, place);
        expect(back[0]).toBeCloseTo(x, 6);
        expect(back[1]).toBeCloseTo(y, 6);
      }
    }
  });
  test("what's nearer is drawn later, and the wall comes first", () => {
    const o = R.order([{ uid: 1, type: "plinth", x: 0.5, y: 0.9 }, { uid: 2, type: "plinth", x: 0.5, y: 0.1 }, { uid: 3, type: "painting", x: 0.5, y: 0.5 }]);
    expect(o.map((i: any) => i.uid)).toEqual([3, 2, 1]);
    expect(R.project({ x: 0.9, y: 0.9 }, "floor").Y).toBeGreaterThan(R.project({ x: 0.1, y: 0.1 }, "floor").Y);
  });
  test("the room fits its view, floor corners and all", () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = R.project({ x, y }, "floor");
      expect(p.X).toBeGreaterThan(0);
      expect(p.X).toBeLessThan(1);
      expect(p.Y).toBeLessThan(1);
    }
    expect(R.project({ x: 0, y: 1 }, "wall").Y).toBeGreaterThan(0);
  });
  test("a press finds the frontmost thing there", () => {
    const items = [{ uid: 1, type: "plinth", x: 0.5, y: 0.5 }, { uid: 2, type: "plinth", x: 0.5, y: 0.6 }];
    const b = R.project(items[1], "floor");
    expect(R.hitItem(items, b.X, b.Y - 0.02)?.uid).toBe(2);
    expect(R.hitItem(items, 0.02, 0.02)).toBeNull();
  });
  test("names come from the tag, the same every time", () => {
    expect(R.roomName("00000000")).toBe(R.roomName("00000000"));
    expect(R.roomName("ffffffff")).not.toBe(R.roomName("00000000"));
    expect(R.roomName("3fa2c1b0")).toMatch(/^The /);
  });
  test("a new item lands clear of what's already there", () => {
    const items: any[] = [];
    for (let i = 1; i <= 8; i++) {
      const [x, y] = R.freeSpot(items, "floor");
      for (const o of items) expect(Math.hypot(o.x - x, o.y - y)).toBeGreaterThan(0.1);
      items.push({ uid: i, type: "plinth", x, y });
    }
    const [wx, wy] = R.freeSpot([{ uid: 1, type: "painting", x: 0.5, y: 0.6 }, ...items], "wall");
    expect(Math.hypot(wx - 0.5, wy - 0.6)).toBeGreaterThan(0.1);
  });
  test("a new item gets a fresh uid", () => {
    expect(R.nextUid([{ uid: 4 }, { uid: 9 }])).toBe(10);
    expect(R.nextUid([])).toBe(1);
  });
});

describe("the store", () => {
  test("a new visitor has the default room at revision 0", () => {
    const s = openStore(":memory:");
    const a = s.visitor(null, T);
    expect(s.roomOf(a.tag)).toMatchObject({ rev: 0, layout: R.DEFAULT_ROOM, name: R.roomName(a.tag) });
  });
  test("no such room is null", () => {
    expect(openStore(":memory:").roomOf("00000000")).toBeNull();
  });
  test("you can show what you banked, with its details, and no pid anywhere", () => {
    const s = openStore(":memory:");
    const a = s.visitor(null, T);
    banked(s, a.pid, "mine");
    const r: any = s.saveRoom(a.pid, { layout: room([stand(1, "mine")]), was: 0 }, T);
    expect(r).toMatchObject({ ok: true, rev: 1 });
    const v: any = s.roomOf(a.tag);
    expect(v.artifacts.mine).toMatchObject({ kind: "fish", material: "gold", seed: 9 });
    expect(JSON.stringify(v)).not.toContain(a.pid);
  });
  test("you can't show what isn't yours: someone else's, carried, or made up", () => {
    const s = openStore(":memory:");
    const a = s.visitor(null, T), b = s.visitor(null, T);
    banked(s, b.pid, "theirs");
    s.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, holder, spawned_at) VALUES ('held', 'fish', 1, 1, 'carried', ?, 0)").run(a.pid);
    for (const id of ["theirs", "held", "nothing"]) expect(s.saveRoom(a.pid, { layout: room([stand(1, id)]), was: 0 }, T)).toMatchObject({ ok: false, status: 409, error: "not-owned" });
    expect(s.roomOf(a.tag)).toMatchObject({ rev: 0 });
  });
  test("a save from an old revision is refused and changes nothing", () => {
    const s = openStore(":memory:");
    const a = s.visitor(null, T);
    s.saveRoom(a.pid, { layout: room([stand(1)]), was: 0 }, T);
    expect(s.saveRoom(a.pid, { layout: room(), was: 0 }, T)).toMatchObject({ ok: false, status: 409, error: "stale-room" });
    expect((s.roomOf(a.tag) as any).layout.items).toHaveLength(1);
  });
  test("a bad shape is refused: was is a whole number, no other fields", () => {
    const s = openStore(":memory:");
    const a = s.visitor(null, T);
    for (const b of [{ layout: room() }, { layout: room(), was: "0" }, { layout: room(), was: 0, tag: "x" }, { layout: { wall: "lava" }, was: 0 }]) {
      expect(s.saveRoom(a.pid, b, T)).toMatchObject({ ok: false, status: 400 });
    }
  });
  test("the directory: only rooms with something on show, newest first, paged", () => {
    const s = openStore(":memory:");
    const empty = s.visitor(null, T);
    s.saveRoom(empty.pid, { layout: room([stand(1)]), was: 0 }, T);
    for (let i = 0; i < 14; i++) {
      const v = s.visitor(null, T);
      banked(s, v.pid, `a${i}`);
      s.saveRoom(v.pid, { layout: room([stand(1, `a${i}`)]), was: 0 }, T + i);
    }
    const one: any = s.rooms(null);
    expect(one.entries).toHaveLength(12);
    expect(one.entries[0].changedAt).toBeGreaterThan(one.entries[1].changedAt);
    expect(JSON.stringify(one)).not.toMatch(/pid/);
    const two: any = s.rooms(one.next);
    expect(two.entries).toHaveLength(2);
    expect(two.next).toBeNull();
    expect(s.rooms("nonsense")).toMatchObject({ ok: false, status: 400 });
  });
  test("a room survives closing the file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "r-")), "x.db");
    let s = openStore(path);
    const a = s.visitor(null, T);
    s.saveRoom(a.pid, { layout: room([stand(1)], { wall: "walnut" }), was: 0 }, T);
    s.close();
    s = openStore(path);
    expect(s.roomOf(a.tag)).toMatchObject({ rev: 1, layout: { wall: "walnut" } });
    s.close();
  });
});

describe("walking", () => {
  const stand = { uid: 1, type: "plinth", x: 0.5, y: 0.5 };
  const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
  test("steering moves you, at a bounded pace", () => {
    const n = R.stepWalker({ x: 0.2, y: 0.2 }, [1, 0], 0.1, []);
    expect(n.x).toBeCloseTo(0.2 + R.WALK_SPEED * 0.1, 6);
    expect(n.y).toBeCloseTo(0.2, 6);
  });
  test("the walls hold you in", () => {
    let w = { x: 0.5, y: 0.5 };
    for (let i = 0; i < 400; i++) w = R.stepWalker(w, [1, 1], 0.05, []);
    expect(w.x).toBeLessThanOrEqual(1);
    expect(w.y).toBeLessThanOrEqual(1);
    expect(R.blocked(w, [])).toBe(false);
  });
  test("nothing placed can be walked through", () => {
    let w = { x: 0.2, y: 0.5 };
    for (let i = 0; i < 200; i++) {
      w = R.stepWalker(w, [1, 0], 0.03, [stand]);
      expect(R.blocked(w, [stand])).toBe(false);
    }
    expect(w.x).toBeLessThan(0.5);
  });
  test("a rug and a painting don't block anyone", () => {
    const soft = [{ uid: 1, type: "rug", x: 0.5, y: 0.5 }, { uid: 2, type: "painting", x: 0.5, y: 0.5 }];
    expect(R.blocked({ x: 0.5, y: 0.5 }, soft)).toBe(false);
  });
  test("you slide along what stops you", () => {
    const n = R.stepWalker({ x: 0.5 - R.WALK_R - R.footR(stand) - 0.002, y: 0.47 }, [1, 0.6], 0.05, [stand]);
    expect(n.y).toBeGreaterThan(0.47);
  });
  test("a route goes round things, and every step is clear", () => {
    const wall = [0.15, 0.3, 0.45, 0.6, 0.75].map((y, i) => ({ uid: i + 1, type: "plinth", x: 0.5, y }));
    const path = R.route({ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }, wall);
    expect(path.length).toBeGreaterThan(2);
    for (const p of path) expect(R.blocked(p, wall)).toBe(false);
    expect(dist(path[path.length - 1], { x: 0.8, y: 0.4 })).toBeLessThan(0.08);
  });
  test("a route to somewhere blocked stops beside it", () => {
    const path = R.route({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, [stand]);
    const end = path[path.length - 1];
    expect(R.blocked(end, [stand])).toBe(false);
    expect(dist(end, stand)).toBeLessThan(0.2);
  });
  test("a start spot is always free", () => {
    const items = [{ uid: 1, type: "plinth", x: R.WALK_START.x, y: R.WALK_START.y }];
    expect(R.blocked(R.freeNear(R.WALK_START, items), items)).toBe(false);
  });
  test("what's in reach: artifacts on show and seats, the nearest first", () => {
    const items = [{ ...stand, artifact: "a" }, { uid: 2, type: "plinth", x: 0.2, y: 0.2 }, { uid: 3, type: "bench", x: 0.8, y: 0.8 }];
    const shown = { a: { kind: "fish" } };
    expect(R.reachable({ x: 0.5, y: 0.42 }, items, shown)?.uid).toBe(1);
    expect(R.reachable({ x: 0.2, y: 0.12 }, items, shown)).toBeNull(); // an empty stand offers nothing
    expect(R.reachable({ x: 0.8, y: 0.7 }, items, shown)?.uid).toBe(3);
    expect(R.reachable({ x: 0.05, y: 0.95 }, items, shown)).toBeNull();
  });
});
