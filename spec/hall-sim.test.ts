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

function world() {
  const store: any = openStore(":memory:");
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hall = createHall(store, { now: T0, random });
  let now = T0;
  const join = () => {
    const pid = store.visitor(null, now).pid as string;
    hall.join(pid, now);
    return pid;
  };
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
  const launch = (pid: string, dir: number[], power: number) => {
    const r = hall.launch(pid, { dir, power, seq: 1 }, now);
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
  return { store, hall, join, tagOf, robot, run, launch, give, own, news, powerTo, now: () => now };
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
