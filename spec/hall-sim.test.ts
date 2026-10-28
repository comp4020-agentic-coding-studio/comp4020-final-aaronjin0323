// Playing together in the hall (CLAUDE.md, "Together in the hall"; ADR 26),
// held over the real hall and store with a clock the test turns: robots
// stepped together, knocks by the rule, what's protected, and one winner.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { openStore } from "../src/db.ts";
import { createHall } from "../src/hall.ts";
// @ts-ignore -- plain JS module shared with the page
import * as H from "../public/hall.js";

const T0 = 1_800_000_000_000; // on the 20 ms grid
type V2 = [number, number];

function world(store: any = openStore(":memory:"), start = T0) {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hall = createHall(store, { now: start, random });
  let now = start;
  const join = (pid: string = store.visitor(null, now).pid) => {
    hall.join(pid, now);
    return pid;
  };
  const leave = (pid: string) => hall.leave(pid, now);
  const tagOf = (pid: string) => store.who(pid).tag as string;
  const view = () => hall.view((pid) => store.who(pid), now);
  const robot = (pid: string) => {
    const r = view().find((x: any) => x.tag === tagOf(pid))!;
    return H.advance(r, now) as any;
  };
  const news: any[] = [];
  /** Turns the clock on `ms`, ticking every 20 ms like the server's 50 ms tick would. */
  const run = (ms: number, each?: () => void) => {
    for (const end = now + ms; now < end; ) {
      now += 20;
      hall.tick(now);
      news.push(...hall.news());
      each?.();
    }
  };
  let seq = 0; // counts up, as a page's does: each launch newer than the last
  const launch = (pid: string, dir: number[], power: number) => {
    const r = hall.launch(pid, { dir, power, seq: ++seq }, now);
    expect(r.ok).toBe(true);
  };
  /** An artifact of `kind` in the visitor's cargo, the way a pickup puts it there. */
  const give = (pid: string, kind = "fish") => {
    const id = randomUUID();
    store.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, ?, 0.5, 0.5, 'available', ?)").run(id, kind, now);
    expect(store.pickUp(pid, id, now).picked).toBe(true);
    return id;
  };
  const own = (pid: string, kind: string, n: number) => {
    for (let i = 0; i < n; i++) give(pid, kind);
    store.deliver(pid, now);
  };
  /** The least power that sends `pid` from where it stands to within `near` of `to`, or 1. */
  const powerTo = (pid: string, to: number[], ok: (p: number[]) => boolean) => {
    const r = robot(pid);
    const dir = [to[0] - r.pos[0], to[1] - r.pos[1]];
    for (let p = 0.1; p <= 1.0001; p += 0.02) if ((H.path(r, { dir, power: Math.min(1, p), seq: 0 }) as V2[]).some(ok)) return { dir, power: Math.min(1, p) };
    return { dir, power: 1 };
  };
  const viewOf = (pid: string) => hall.view((p: string) => store.who(p), now).find((x: any) => x.tag === tagOf(pid)) as any;
  return { store, hall, join, leave, viewOf, tagOf, robot, run, launch, give, own, news, powerTo, now: () => now };
}

/** B rolls out of its zone and stops in the open; A (home 0) can then reach it. */
function apart(w: ReturnType<typeof world>) {
  const a = w.join(); // zone 0, top left
  const b = w.join(); // zone 1, top middle
  w.launch(b, [-1, 0], 0.62);
  w.run(4000);
  const pb = w.robot(b).pos;
  expect(pb[0]).toBeGreaterThan(H.HOMES[0][0] + H.SAFE_R);
  expect(pb[0]).toBeLessThan(H.HOMES[1][0] - H.SAFE_R);
  return { a, b, pb };
}

describe("a fast hit knocks one carried artifact loose", () => {
  test("from the struck robot, newest first, just beyond it, ready later; it's protected; nothing delivered moves", () => {
    const w = world();
    const { a, b, pb } = apart(w);
    w.own(b, "door", 2);
    const older = w.give(b, "cloud");
    w.run(20);
    const newest = w.give(b, "fish");
    const aCargo = w.store.cargo(a).length;
    w.launch(a, [pb[0] - w.robot(a).pos[0], pb[1] - w.robot(a).pos[1]], 1);
    w.run(1500);
    const knocks = w.news.filter((n) => n.kind === "knock");
    expect(knocks.length).toBe(1);
    expect(knocks[0]).toMatchObject({ by: w.tagOf(a), from: w.tagOf(b), artifact: { id: newest, kind: "fish" } });
    // the older one is still B's: carried, or delivered if the hit sent B home
    const o = w.store.db.prepare("SELECT state, holder, owner FROM artifacts WHERE id = ?").get(older);
    expect(o.state === "carried" ? o.holder : o.owner).toBe(b);
    expect(w.store.cargo(a).length).toBeGreaterThanOrEqual(aCargo); // strikers never drop
    expect(w.store.collection(b).door).toBe(2);
    const dropped = w.store.floor().find((f: any) => f.id === newest);
    expect(dropped.readyAt).toBe(knocks[0].at + H.PICKUP_DELAY_MS);
    expect(Math.hypot(dropped.pos[0] - pb[0], dropped.pos[1] - pb[1])).toBeLessThan(2.5);
    const vb: any = w.hall.view((pid: string) => w.store.who(pid), w.now()).find((r: any) => r.tag === w.tagOf(b));
    expect(vb.protectedUntil).toBe(knocks[0].at + H.DROP_PROTECT_MS);
  });
  test("a gentle bump moves the other robot and knocks nothing loose", () => {
    const w = world();
    const { a, b, pb } = apart(w);
    w.give(b, "fish");
    const gentle = w.powerTo(a, pb, (p) => Math.hypot(p[0] - pb[0], p[1] - pb[1]) < 2 * H.ROBOT_R - 0.05);
    w.launch(a, gentle.dir, gentle.power);
    w.run(3000);
    expect(w.news.filter((n) => n.kind === "knock")).toEqual([]);
    expect(w.store.cargo(b).length).toBe(1);
    expect(Math.hypot(w.robot(b).pos[0] - pb[0], w.robot(b).pos[1] - pb[1])).toBeGreaterThan(0.01);
  });
  test("the robot that knocked it loose can't scoop it up at once", () => {
    const w = world();
    const { a, b, pb } = apart(w);
    const id = w.give(b, "cloud");
    w.launch(a, [pb[0] - w.robot(a).pos[0], pb[1] - w.robot(a).pos[1]], 1);
    let carriedEarly = false;
    w.run(H.PICKUP_DELAY_MS, () => {
      if (w.store.cargo(a).some((c: any) => c.id === id)) carriedEarly = true;
    });
    expect(w.news.some((n) => n.kind === "knock")).toBe(true);
    expect(carriedEarly).toBe(false);
  });
});

describe("two robots, one artifact", () => {
  test("reaching it on the same step, exactly one carries it", () => {
    const w = world();
    const a = w.join(); // zone 0, (1.1, 1.1)
    for (let i = 0; i < 5; i++) w.store.hallHome(w.store.visitor(null, w.now()).pid, w.now()); // zones 1-5 taken
    const b = w.join(); // zone 6, (1.1, 8.9): a mirror of a across the middle
    expect(w.hall.view((pid: string) => w.store.who(pid), w.now()).map((r: any) => r.home).sort()).toEqual([0, 6]);
    const spot: V2 = [2.8, H.HALL.h / 2];
    const id = randomUUID();
    w.store.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, 'door', ?, ?, 'available', ?)").run(id, spot[0], spot[1], w.now());
    w.hall.refresh();
    const ra = w.robot(a).pos, rb = w.robot(b).pos;
    w.launch(a, [spot[0] - ra[0], spot[1] - ra[1]], 0.9);
    w.launch(b, [spot[0] - rb[0], spot[1] - rb[1]], 0.9);
    let touchedA = -1, touchedB = -1;
    w.run(3000, () => {
      if (touchedA < 0 && H.touches(w.robot(a).pos, spot)) touchedA = w.now();
      if (touchedB < 0 && H.touches(w.robot(b).pos, spot)) touchedB = w.now();
    });
    expect(touchedA).toBeGreaterThan(0);
    expect(touchedA).toBe(touchedB);
    const holders = [a, b].filter((p) => w.store.cargo(p).some((c: any) => c.id === id));
    expect(holders.length).toBe(1);
  });
});

describe("alone", () => {
  test("one robot plays as before: launch, pick up, nothing to collide with", () => {
    const w = world();
    const a = w.join();
    w.launch(a, [1, 1], 1);
    w.run(4000);
    expect(w.news.filter((n) => n.kind === "knock")).toEqual([]);
    expect(H.advance(w.robot(a), w.now()).vel).toEqual([0, 0]);
  });
});

// ADR 27: leaving and coming back
describe("a disconnected robot is a ghost for the grace", () => {
  test("it picks up nothing it glides over", () => {
    const w = world();
    const a = w.join();
    const r = w.robot(a);
    const spot: V2 = [r.pos[0] + 2, r.pos[1] + 2];
    const id = randomUUID();
    w.store.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, 'fish', ?, ?, 'available', ?)").run(id, spot[0], spot[1], w.now());
    w.hall.refresh();
    w.launch(a, [2, 2], 1);
    w.leave(a);
    let over = false;
    w.run(2000, () => {
      if (H.touches(w.robot(a).pos, spot)) over = true;
    });
    expect(over).toBe(true);
    expect(w.store.cargo(a)).toEqual([]);
    expect(w.viewOf(a).away).toBe(true);
  });
  test("it collides with nobody: a fast hit passes through and knocks nothing loose", () => {
    const w = world();
    const { a, b, pb } = apart(w);
    w.give(b, "fish");
    w.leave(b);
    w.launch(a, [pb[0] - w.robot(a).pos[0], pb[1] - w.robot(a).pos[1]], 1);
    w.run(1500);
    expect(w.news.filter((n) => n.kind === "knock")).toEqual([]);
    expect(w.store.cargo(b).length).toBe(1);
    expect(w.robot(b).pos).toEqual(pb);
  });
  test("leaving never delivers: a ghost gliding through its own zone keeps its cargo carried", () => {
    const w = world();
    const { b } = apart(w);
    w.give(b, "cloud");
    const home = H.HOMES[1];
    w.launch(b, [home[0] - w.robot(b).pos[0], home[1] - w.robot(b).pos[1]], 1);
    w.leave(b);
    let inZone = false;
    w.run(3000, () => {
      if (H.atHome(w.robot(b).pos, home)) inZone = true;
    });
    expect(inZone).toBe(true);
    expect(w.store.cargo(b).length).toBe(1);
    expect(w.store.collection(b).cloud).toBe(0);
  });
});

describe("back within the grace", () => {
  test("the same robot carries on, where it got to, with its cargo; nothing delivered for coming back", () => {
    const w = world();
    const { b: a } = apart(w); // out in the open, away from its zone
    const id = w.give(a, "door");
    w.launch(a, [1, 0.6], 0.4);
    w.run(100);
    const snap = w.viewOf(a);
    w.leave(a);
    w.run(H.GRACE_MS - 1000);
    const back = w.hall.join(a, w.now());
    expect(back).toMatchObject({ kind: "restored" });
    expect(w.viewOf(a).away).toBe(false);
    expect(w.robot(a).pos).toEqual(H.advance(snap, w.now()).pos);
    expect(w.store.cargo(a).map((c: any) => c.id)).toEqual([id]);
    expect(w.store.collection(a).door).toBe(0);
  });
});

describe("not back in time", () => {
  test("its cargo goes back to the floor nearest where it was, once, ready; the robot leaves; they're told on return", () => {
    const w = world();
    const { b } = apart(w);
    const ids = [w.give(b, "fish"), w.give(b, "cloud")];
    const where = w.robot(b).pos;
    const before = w.store.db.prepare("SELECT COUNT(*) AS c FROM artifacts").get().c;
    w.leave(b);
    w.run(H.GRACE_MS + 100);
    expect(w.viewOf(b)).toBeUndefined();
    expect(w.store.cargo(b)).toEqual([]);
    const floor = w.store.floor();
    for (const id of ids) {
      const f = floor.find((x: any) => x.id === id);
      expect(f.readyAt).toBeLessThanOrEqual(w.now());
      expect(Math.hypot(f.pos[0] - where[0], f.pos[1] - where[1])).toBeLessThan(4);
    }
    expect(w.store.db.prepare("SELECT COUNT(*) AS c FROM artifacts").get().c).toBe(before);
    expect(w.news.filter((n) => n.kind === "released")).toEqual([{ kind: "released", tag: w.tagOf(b), name: w.store.who(b).name, count: 2, at: expect.any(Number) }]);
    const back = w.hall.join(b, w.now());
    expect(back).toMatchObject({ kind: "new", released: 2 });
    expect(w.robot(b).pos).toEqual(H.HOMES[1]);
    expect(w.store.cargo(b)).toEqual([]);
  });
});

describe("coming back at the deadline", () => {
  const setup = () => {
    const w = world();
    const { b } = apart(w);
    const ids = [w.give(b, "fish"), w.give(b, "door")];
    w.leave(b);
    return { w, b, ids, deadline: w.now() + H.GRACE_MS };
  };
  const states = (w: any, ids: string[]) => ids.map((id) => w.store.db.prepare("SELECT state, holder FROM artifacts WHERE id = ?").get(id));
  test("a step before: restored, everything still carried by them", () => {
    const { w, b, ids, deadline } = setup();
    w.run(deadline - w.now() - 20);
    expect(w.hall.join(b, w.now())).toMatchObject({ kind: "restored" });
    w.run(H.GRACE_MS + 100);
    expect(states(w, ids)).toEqual(ids.map(() => ({ state: "carried", holder: b })));
  });
  test("at the deadline: released first, exactly once, and a fresh robot with nothing", () => {
    const { w, b, ids, deadline } = setup();
    w.run(deadline - w.now() - 20);
    const at = deadline; // the join arrives on the deadline itself
    const back = w.hall.join(b, at);
    expect(back).toMatchObject({ kind: "new", released: 2 });
    expect(states(w, ids)).toEqual(ids.map(() => ({ state: "available", holder: null })));
    w.run(3000);
    expect(w.news.filter((n) => n.kind === "released").length).toBe(1);
  });
});

describe("a server restart", () => {
  const before = () => {
    const w = world();
    const { b } = apart(w);
    const ids = [w.give(b, "cloud"), w.give(b, "fish")];
    return { store: w.store, b, ids, at: w.now() };
  };
  test("coming back within the grace: in your zone, still carrying, nothing delivered until you move", () => {
    const { store, b, ids, at } = before();
    const w = world(store, at + 5000); // the restart: robots gone, rows kept
    w.run(H.GRACE_MS - 2000);
    expect(w.hall.join(b, w.now())).toMatchObject({ kind: "recovered" });
    expect(w.robot(b).pos).toEqual(H.HOMES[1]);
    w.run(1000);
    expect(store.cargo(b).map((c: any) => c.id).sort()).toEqual([...ids].sort());
    w.launch(b, [0, 1], 0.12); // a nudge, inside the zone
    w.run(500);
    expect(store.cargo(b)).toEqual([]);
    expect(store.collection(b).cloud + store.collection(b).fish).toBe(2);
  });
  test("not coming back: the cargo goes back to the floor, once", () => {
    const { store, b, ids, at } = before();
    const w = world(store, at + 5000);
    w.run(H.GRACE_MS + 3000);
    expect(store.cargo(b)).toEqual([]);
    for (const id of ids) expect(store.db.prepare("SELECT state FROM artifacts WHERE id = ?").get(id).state).toBe("available");
    expect(w.news.filter((n) => n.kind === "released").length).toBe(1);
  });
});

describe("nothing stays locked to someone absent", () => {
  test("cargo held by anyone with no robot and no grace goes back within a second or so", () => {
    const w = world();
    w.join();
    const ghost = w.store.visitor(null, w.now()).pid;
    const id = w.give(ghost, "door"); // never had a robot here
    w.run(1500);
    expect(w.store.db.prepare("SELECT state FROM artifacts WHERE id = ?").get(id).state).toBe("available");
  });
});

describe("stale launches", () => {
  test("a launch that isn't newer than the robot's last is refused, with the robot", () => {
    const w = world();
    const a = w.join();
    expect(w.hall.launch(a, { dir: [1, 0], power: 0.5, seq: 5 }, w.now()).ok).toBe(true);
    const again = w.hall.launch(a, { dir: [0, 1], power: 1, seq: 5 }, w.now());
    expect(again).toMatchObject({ ok: false, status: 409, error: "stale-launch", robot: { seq: 5 } });
    expect(w.hall.launch(a, { dir: [0, 1], power: 1, seq: 4 }, w.now())).toMatchObject({ ok: false, error: "stale-launch" });
  });
  test("a ghost can't be launched", () => {
    const w = world();
    const a = w.join();
    w.leave(a);
    expect(w.hall.launch(a, { dir: [1, 0], power: 0.5, seq: 1 }, w.now())).toMatchObject({ ok: false, error: "no-robot" });
  });
});
