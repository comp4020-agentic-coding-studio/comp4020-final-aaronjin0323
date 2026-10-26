// The hall's movement rule (CLAUDE.md, "The hall"; ADR 24): one module the
// server and the page share, so these hold both.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as H from "../public/hall.js";

type V2 = [number, number];
const speed = (r: any) => Math.sqrt(r.vel[0] * r.vel[0] + r.vel[1] * r.vel[1]);
const still = (pos: V2, t = 1000) => ({ pos, vel: [0, 0], t, seq: 0 });
const go = (dir: V2, power: number, seq = 1) => {
  const c: any = H.checkLaunch({ dir, power, seq });
  if (!c.ok) throw new Error(c.error);
  return c.launch;
};
const mid: V2 = [H.HALL.w / 2, H.HALL.h / 2];

describe("checkLaunch takes a direction and a power, never a position", () => {
  test("a good launch passes, its direction made unit length", () => {
    const c: any = H.checkLaunch({ dir: [3, 4], power: 0.5, seq: 7 });
    expect(c.ok).toBe(true);
    expect(c.launch.dir[0]).toBeCloseTo(0.6, 6);
    expect(c.launch.dir[1]).toBeCloseTo(0.8, 6);
    expect(c.launch).toMatchObject({ power: 0.5, seq: 7 });
  });
  for (const [why, x] of [
    ["a position", { dir: [1, 0], power: 0.5, seq: 1, pos: [3, 3] }],
    ["a velocity", { dir: [1, 0], power: 0.5, seq: 1, vel: [99, 0] }],
    ["power over 1", { dir: [1, 0], power: 1.01, seq: 1 }],
    ["power 0", { dir: [1, 0], power: 0, seq: 1 }],
    ["no direction", { dir: [0, 0], power: 0.5, seq: 1 }],
    ["a 3D direction", { dir: [1, 0, 0], power: 0.5, seq: 1 }],
    ["not numbers", { dir: ["1", 0], power: 0.5, seq: 1 }],
    ["NaN power", { dir: [1, 0], power: NaN, seq: 1 }],
    ["a fractional seq", { dir: [1, 0], power: 0.5, seq: 1.5 }],
    ["no seq", { dir: [1, 0], power: 0.5 }],
    ["not an object", "go"],
    ["null", null],
  ] as const) {
    test(`refuses ${why}`, () => expect(H.checkLaunch(x).ok).toBe(false));
  }
});

describe("launching", () => {
  test("full power is LAUNCH_MAX, half power half that, the way it's aimed", () => {
    const r = H.launch(still(mid), go([1, 0], 1), 1000);
    expect(speed(r)).toBeCloseTo(H.LAUNCH_MAX, 9);
    expect(r.vel[1]).toBe(0);
    expect(speed(H.launch(still(mid), go([0, -1], 0.5), 1000))).toBeCloseTo(H.LAUNCH_MAX / 2, 9);
  });
  test("repeated launches never add up: speed stays at most LAUNCH_MAX", () => {
    let r: any = still(mid);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      r = H.launch(r, go([1, 0.2], 1, i), r.t + (i % 3) * 20);
      worst = Math.max(worst, speed(r), speed(H.advance(r, r.t + 20)));
    }
    expect(worst).toBeLessThanOrEqual(H.LAUNCH_MAX + 1e-9);
  });
  test("a launch first brings the robot up to the moment, then sets its velocity", () => {
    const moving = H.launch(still(mid, 0), go([1, 0], 1), 0);
    const later = H.launch(moving, go([0, 1], 0.5, 2), 400);
    expect(later.t).toBe(400);
    expect(later.pos).toEqual(H.advance(moving, 400).pos);
    expect(later.seq).toBe(2);
  });
});

describe("moving", () => {
  test("a robot slows down all the time and stops, within LAUNCH_MAX / FRICTION seconds", () => {
    let r = H.launch(still(mid, 0), go([0.3, 1], 1), 0);
    let prev = speed(r);
    for (let t = 20; t <= (H.LAUNCH_MAX / H.FRICTION) * 1000 + 20; t += 20) {
      r = H.advance(r, t);
      expect(speed(r)).toBeLessThanOrEqual(prev + 1e-12);
      prev = speed(r);
    }
    expect(speed(r)).toBe(0);
  });
  test("a robot at rest stays put", () => {
    expect(H.advance(still(mid, 0), 5000).pos).toEqual(mid);
  });
  test("it rebounds off a wall, slower, and stays inside", () => {
    const start: V2 = [H.HALL.w - H.ROBOT_R - 0.5, mid[1]];
    let r = H.launch(still(start, 0), go([1, 0], 1), 0);
    let bounced = false;
    for (let t = 20; t < 1000; t += 20) {
      const before = r.vel[0];
      r = H.advance(r, t);
      if (before > 0 && r.vel[0] < 0) {
        bounced = true;
        expect(-r.vel[0]).toBeLessThan(before * H.WALL_BOUNCE + 1e-9);
        break;
      }
    }
    expect(bounced).toBe(true);
    expect(r.pos[0]).toBeLessThanOrEqual(H.HALL.w - H.ROBOT_R);
  });
  test("however it's launched, it never leaves the hall", () => {
    for (let i = 0; i < 24; i++) {
      const dir: V2 = [((i * 7) % 11) - 5, ((i * 5) % 9) - 4 || 1];
      let r = H.launch(still([H.ROBOT_R + (i % 5) * 3, H.ROBOT_R + (i % 3) * 4], 0), go(dir, 1), 0);
      for (let t = 20; t < 4000; t += 20) {
        r = H.advance(r, t);
        expect(r.pos[0]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
        expect(r.pos[0]).toBeLessThanOrEqual(H.HALL.w - H.ROBOT_R + 1e-9);
        expect(r.pos[1]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
        expect(r.pos[1]).toBeLessThanOrEqual(H.HALL.h - H.ROBOT_R + 1e-9);
      }
    }
  });
  test("advancing in hops lands exactly where one advance does (server and screens agree)", () => {
    const r = H.launch(still([2, 2], 1000), go([1, 0.7], 1), 1000);
    let hops: any = r;
    for (const t of [1013, 1047, 1300, 1301, 1999, 2600]) hops = H.advance(hops, t);
    expect(hops).toEqual(H.advance(r, 2600));
  });
  test("time is whole steps of whole milliseconds", () => {
    expect(Number.isInteger(H.STEP_MS)).toBe(true);
    expect(H.advance(still(mid, 1000), 1047).t).toBe(1040);
  });
});

describe("the preview", () => {
  test("is the path the launch will take, wall bounces included, ending where it stops", () => {
    const r = still([H.HALL.w - 1.5, mid[1]], 0);
    const l = go([1, 0], 1);
    const pts = H.path(r, l) as V2[];
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]).toEqual(r.pos);
    expect(Math.max(...pts.map((p) => p[0]))).toBeLessThanOrEqual(H.HALL.w - H.ROBOT_R);
    // it went right, hit the wall and came back
    expect(pts[pts.length - 1][0]).toBeLessThan(r.pos[0]);
    let end: any = H.launch(r, l, 0);
    end = H.advance(end, 10_000);
    const last = pts[pts.length - 1];
    expect(Math.abs(last[0] - end.pos[0]) + Math.abs(last[1] - end.pos[1])).toBeLessThan(1e-9);
  });
});

// ADR 25: where artifacts may be, where you deliver, and what counts as a touch
describe("collecting: places and touches", () => {
  const d = (a: number[], b: number[]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  test("three kinds, six on the floor, three carried, four display slots", () => {
    expect(H.KINDS).toEqual(["fish", "cloud", "door"]);
    expect(H.MAX_AVAILABLE).toBe(6);
    expect(H.CARRY_MAX).toBe(3);
    expect(H.DISPLAY_SLOTS).toBe(4);
  });
  test("eight delivery zones, inside the walls, reachable by a robot, apart", () => {
    expect(H.HOMES.length).toBe(8);
    for (const h of H.HOMES) {
      expect(h[0] - H.PAD_R).toBeGreaterThanOrEqual(0);
      expect(h[1] - H.PAD_R).toBeGreaterThanOrEqual(0);
      expect(h[0] + H.PAD_R).toBeLessThanOrEqual(H.HALL.w);
      expect(h[1] + H.PAD_R).toBeLessThanOrEqual(H.HALL.h);
      // a robot's centre can stand in it
      expect(H.atHome([Math.min(Math.max(h[0], H.ROBOT_R), H.HALL.w - H.ROBOT_R), Math.min(Math.max(h[1], H.ROBOT_R), H.HALL.h - H.ROBOT_R)], h)).toBe(true);
    }
    for (const a of H.HOMES) for (const b of H.HOMES) if (a !== b) expect(d(a, b)).toBeGreaterThan(2 * H.PAD_R);
  });
  test("every safe spot is inside the walls, clear of every zone, and apart, with room for six", () => {
    expect(H.SPOTS.length).toBeGreaterThanOrEqual(H.MAX_AVAILABLE * 2);
    for (const p of H.SPOTS) {
      expect(p[0]).toBeGreaterThanOrEqual(H.ROBOT_R + H.ARTIFACT_R);
      expect(p[0]).toBeLessThanOrEqual(H.HALL.w - H.ROBOT_R - H.ARTIFACT_R);
      expect(p[1]).toBeGreaterThanOrEqual(H.ROBOT_R + H.ARTIFACT_R);
      expect(p[1]).toBeLessThanOrEqual(H.HALL.h - H.ROBOT_R - H.ARTIFACT_R);
      // a robot touching it can't also be in a zone
      for (const h of H.HOMES) expect(d(p, h)).toBeGreaterThan(H.PAD_R + H.ROBOT_R + H.ARTIFACT_R);
    }
    for (const a of H.SPOTS) for (const b of H.SPOTS) if (a !== b) expect(d(a, b)).toBeGreaterThan(2 * H.ARTIFACT_R);
  });
  test("a touch is the robot's edge reaching the artifact's", () => {
    const a = [5, 5];
    expect(H.touches([5 + H.ROBOT_R + H.ARTIFACT_R - 0.01, 5], a)).toBe(true);
    expect(H.touches([5 + H.ROBOT_R + H.ARTIFACT_R + 0.01, 5], a)).toBe(false);
  });
  test("in your zone means your robot's centre is on the pad", () => {
    const h = H.HOMES[0];
    expect(H.atHome([h[0] + H.PAD_R - 0.01, h[1]], h)).toBe(true);
    expect(H.atHome([h[0] + H.PAD_R + 0.01, h[1]], h)).toBe(false);
  });
});

// ADR 26: one clock, robots meeting, knocks, fair zones
describe("together: the clock", () => {
  test("snapshot times sit on the shared 20 ms grid", () => {
    expect(H.onGrid(1047)).toBe(1040);
    expect(H.onGrid(1040)).toBe(1040);
  });
  test("a robot keeps its zone through advancing and launching", () => {
    const r = { ...still(mid, 0), home: 3 };
    expect(H.advance(r, 500).home).toBe(3);
    expect(H.launch(r, go([1, 0], 1), 0).home).toBe(3);
  });
});

describe("together: zones", () => {
  const d = (a: number[], b: number[]) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  test("a zone that isn't yours is solid: launched straight at it, a robot never enters", () => {
    const pad = H.HOMES[1]; // the middle of the top wall
    let r: any = H.launch({ ...still([pad[0], pad[1] + 3], 0), home: 0 }, go([0, -1], 1), 0);
    let closest = 99;
    for (let t = 20; t < 4000; t += 20) {
      r = H.advance(r, t);
      closest = Math.min(closest, d(r.pos, pad));
    }
    expect(closest).toBeGreaterThanOrEqual(H.PAD_R + H.ROBOT_R - 1e-9);
  });
  test("pushed off a zone in a corner, a robot still never leaves the hall", () => {
    for (let i = 0; i < 40; i++) {
      const home = (i + 4) % 8; // never the corner zones it's thrown into
      const dir: V2 = [((i * 7) % 11) - 5 || -1, ((i * 5) % 9) - 4 || -1];
      let r: any = H.launch({ ...still([2 + (i % 4) * 0.3, 2 + (i % 3) * 0.4], 0), home }, go(dir, 1), 0);
      for (let t = 20; t < 3000; t += 20) {
        r = H.advance(r, t);
        expect(r.pos[0]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
        expect(r.pos[0]).toBeLessThanOrEqual(H.HALL.w - H.ROBOT_R + 1e-9);
        expect(r.pos[1]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
        expect(r.pos[1]).toBeLessThanOrEqual(H.HALL.h - H.ROBOT_R + 1e-9);
      }
    }
  });
  test("sliding along a wall into a corner zone, it's stopped by the zone and stays inside the wall", () => {
    let r: any = H.launch({ ...still([H.ROBOT_R, 3.2], 0), home: 4 }, go([0, -1], 1), 0);
    for (let t = 20; t < 2000; t += 20) {
      r = H.advance(r, t);
      expect(r.pos[0]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
      expect(r.pos[1]).toBeGreaterThanOrEqual(H.ROBOT_R - 1e-9);
    }
  });
  test("your own zone you can drive into", () => {
    const pad = H.HOMES[1];
    let r: any = H.launch({ ...still([pad[0], pad[1] + 3], 0), home: 1 }, go([0, -1], 1), 0);
    let entered = false;
    for (let t = 20; t < 4000; t += 20) {
      r = H.advance(r, t);
      if (H.atHome(r.pos, pad)) entered = true;
    }
    expect(entered).toBe(true);
  });
  test("near your own zone, inside SAFE_R, is safe from knocks", () => {
    const h = H.HOMES[0];
    expect(H.inSafe([h[0] + H.SAFE_R - 0.01, h[1]], h)).toBe(true);
    expect(H.inSafe([h[0] + H.SAFE_R + 0.01, h[1]], h)).toBe(false);
  });
});

describe("together: robots meeting", () => {
  const at = (pos: V2, vel: V2) => ({ pos, vel, t: 0, seq: 0 });
  test("apart, or touching but parting, nothing happens", () => {
    expect((H as any).collide(at([2, 2], [1, 0]), at([5, 2], [0, 0]))).toBeNull();
    expect((H as any).collide(at([2, 2], [-1, 0]), at([2 + 2 * H.ROBOT_R - 0.05, 2], [1, 0]))).toBeNull();
  });
  test("closing, they bounce as equal masses: separated, momentum kept, closing speed reported", () => {
    const a = at([2, 2], [6, 0]), b = at([2 + 2 * H.ROBOT_R - 0.04, 2], [0, 0]);
    const c = (H as any).collide(a, b);
    expect(c.closing).toBeCloseTo(6, 9);
    expect(c.a.vel[0] + c.b.vel[0]).toBeCloseTo(6, 9);
    expect(c.b.vel[0]).toBeGreaterThan(c.a.vel[0]);
    const gap = Math.sqrt((c.a.pos[0] - c.b.pos[0]) ** 2 + (c.a.pos[1] - c.b.pos[1]) ** 2);
    expect(gap).toBeGreaterThanOrEqual(2 * H.ROBOT_R - 1e-9);
  });
  test("the struck robot is the one clearly moving less towards the other; a near tie strikes nobody", () => {
    const hit = (H as any).collide(at([2, 2], [6, 0]), at([2.85, 2], [-1, 0]));
    expect(hit.struck).toBe("b");
    expect((H as any).collide(at([2, 2], [1, 0]), at([2.85, 2], [-6, 0])).struck).toBe("a");
    expect((H as any).collide(at([2, 2], [3, 0]), at([2.85, 2], [-3.2, 0])).struck).toBeNull();
  });
  test("a knock needs KNOCK_SPEED: a gentle bump is just a bump", () => {
    const soft = (H as any).collide(at([2, 2], [H.KNOCK_SPEED - 0.5, 0]), at([2.85, 2], [0, 0]));
    expect(soft.closing).toBeLessThan(H.KNOCK_SPEED);
    expect(H.KNOCK_SPEED).toBeGreaterThan(H.LAUNCH_MAX / 2);
    expect(H.KNOCK_SPEED).toBeLessThan(H.LAUNCH_MAX);
  });
});

describe("together: what makes a knock", () => {
  const at = (pos: V2, vel: V2, home = 5) => ({ pos, vel, t: 0, seq: 0, home });
  const fast = () => (H as any).collide(at([6, 5], [7, 0]), at([6.85, 5], [0, 0]));
  test("a clear, fast hit, away from the struck robot's zone, unprotected: a knock", () => {
    expect(H.knocks(fast(), 0, 0)).toBe(true);
  });
  test("not when slow, a tie, protected, or near the struck robot's own zone", () => {
    expect(H.knocks((H as any).collide(at([6, 5], [H.KNOCK_SPEED - 0.3, 0]), at([6.85, 5], [0, 0])), 0, 0)).toBe(false);
    expect(H.knocks((H as any).collide(at([6, 5], [5, 0]), at([6.85, 5], [-5, 0])), 0, 0)).toBe(false);
    expect(H.knocks(fast(), 1000, 999)).toBe(false); // protected until 1000
    expect(H.knocks(fast(), 1000, 1000)).toBe(true);
    const h = H.HOMES[5];
    const nearHome = (H as any).collide(at([h[0] - 0.85, h[1] - 1.2], [7, 0]), at([h[0], h[1] - 1.2], [0, 0]));
    expect(H.knocks(nearHome, 0, 0)).toBe(false);
  });
});

describe("together: where a knocked artifact lands", () => {
  test("just beyond the struck robot, away from the striker, inside the walls and out of every zone", () => {
    const away: V2 = [1, 0];
    const p = H.dropSpot(mid, away);
    expect(p[0]).toBeGreaterThan(mid[0] + H.ROBOT_R);
    for (let i = 0; i < 200; i++) {
      const pos: V2 = [H.ROBOT_R + ((i * 37) % 150) / 10, H.ROBOT_R + ((i * 53) % 91) / 10];
      const n: V2 = [((i * 7) % 11) - 5 || 1, ((i * 3) % 7) - 3];
      const len = Math.sqrt(n[0] * n[0] + n[1] * n[1]);
      const q = H.dropSpot(pos, [n[0] / len, n[1] / len]);
      expect(q[0]).toBeGreaterThanOrEqual(H.ARTIFACT_R);
      expect(q[0]).toBeLessThanOrEqual(H.HALL.w - H.ARTIFACT_R);
      expect(q[1]).toBeGreaterThanOrEqual(H.ARTIFACT_R);
      expect(q[1]).toBeLessThanOrEqual(H.HALL.h - H.ARTIFACT_R);
      for (const h of H.HOMES) expect(Math.sqrt((q[0] - h[0]) ** 2 + (q[1] - h[1]) ** 2)).toBeGreaterThan(H.PAD_R);
    }
  });
});

describe("the rule uses only arithmetic every engine rounds the same", () => {
  test("no Math.sin, cos, pow, exp, atan2, hypot, random, or ** in public/hall.js", () => {
    const src = readFileSync("public/hall.js", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.length).toBeGreaterThan(500);
    expect(src).not.toMatch(/Math\.(sin|cos|tan|pow|exp|log|atan2?|hypot|random|cbrt)\b|\*\*|Date\b|performance\./);
  });
});
