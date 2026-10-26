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

describe("the rule uses only arithmetic every engine rounds the same", () => {
  test("no Math.sin, cos, pow, exp, atan2, hypot, random, or ** in public/hall.js", () => {
    const src = readFileSync("public/hall.js", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.length).toBeGreaterThan(500);
    expect(src).not.toMatch(/Math\.(sin|cos|tan|pow|exp|log|atan2?|hypot|random|cbrt)\b|\*\*|Date\b|performance\./);
  });
});
