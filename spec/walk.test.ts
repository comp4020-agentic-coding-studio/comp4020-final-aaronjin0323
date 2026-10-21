import { describe, expect, it } from "vitest";
import { checkGesture } from "../public/stage.js";
import {
  BOUND,
  EYE,
  OBSTACLES,
  REACH,
  START,
  WALK_SPEED,
  clampPitch,
  collide,
  forward,
  lookDir,
  nearestHit,
  plinthNear,
  standBefore,
  step,
  throwVelocity,
} from "../public/walk.js";

// The first-person movement rules (CLAUDE.md, "First person"; ADR 17). Pure
// functions: where a visitor can stand, which way they face, what their
// reticle rests on, and how hard they throw. The scene draws them; this file
// holds them.

const TAU = Math.PI * 2;
const close = (a: number[], b: number[], eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps);
const len = (v: number[]) => Math.hypot(...v);
const PLINTH_R = 5.4;
const slotXZ = (slot: number): [number, number] => {
  const a = ((slot - 1) / 6) * TAU + Math.PI / 6;
  return [Math.sin(a) * PLINTH_R, Math.cos(a) * PLINTH_R];
};

/** True when [x, z] is somewhere a visitor may stand. */
function legal([x, z]: number[]): boolean {
  if (Math.hypot(x, z) > BOUND + 1e-9) return false;
  return OBSTACLES.every((o) => Math.hypot(x - o.x, z - o.z) >= o.r - 1e-9);
}

// a deterministic spread of numbers in [0, 1), so the sweeps are repeatable
function* spread(n: number, seed = 1): Generator<number> {
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    yield s / 2147483647;
  }
}

describe("which way a visitor faces", () => {
  it("yaw 0 faces -z, and positive yaw turns left (counter-clockwise from above)", () => {
    expect(close(forward(0), [0, -1])).toBe(true);
    expect(close(forward(Math.PI / 2), [-1, 0])).toBe(true);
    expect(close(forward(Math.PI), [0, 1])).toBe(true);
    expect(close(forward(-Math.PI / 2), [1, 0])).toBe(true);
    for (const y of spread(50)) expect(len(forward(y * 20 - 10))).toBeCloseTo(1, 12);
  });

  it("lookDir is a unit vector along forward on the floor, with pitch up positive", () => {
    expect(close(lookDir([0, 0]), [0, 0, -1])).toBe(true);
    expect(close(lookDir([Math.PI / 2, 0]), [-1, 0, 0])).toBe(true);
    expect(lookDir([0, 0.5])[1]).toBeCloseTo(Math.sin(0.5), 12);
    expect(lookDir([0, -0.5])[1]).toBeLessThan(0);
    for (const y of spread(50, 7)) {
      const look: [number, number] = [y * 12 - 6, (y - 0.5) * 2.6];
      const d = lookDir(look);
      expect(len(d)).toBeCloseTo(1, 12);
      const f = forward(look[0]);
      const flat = Math.hypot(d[0], d[2]);
      expect(close([d[0] / flat, d[2] / flat], f, 1e-9)).toBe(true);
    }
  });

  it("clampPitch keeps the head within ±1.35", () => {
    expect(clampPitch(2)).toBe(1.35);
    expect(clampPitch(-9)).toBe(-1.35);
    expect(clampPitch(0.4)).toBe(0.4);
  });

  it("EYE, REACH and WALK_SPEED are the decided numbers", () => {
    expect(EYE).toBe(1.62);
    expect(REACH).toBe(3.2);
    expect(WALK_SPEED).toBe(2.6);
  });
});

describe("walking", () => {
  it("START is a legal spot facing the stage", () => {
    expect(legal(START.at)).toBe(true);
    expect(close(collide(START.at), START.at)).toBe(true);
    const f = forward(START.look[0]);
    const toCentre = [-START.at[0], -START.at[1]];
    const cos = (f[0] * toCentre[0] + f[1] * toCentre[1]) / len(toCentre);
    expect(cos).toBeGreaterThan(0.99);
    expect(Math.abs(START.look[1])).toBeLessThan(0.3);
  });

  it("moves WALK_SPEED * dt in open floor, forward, back and sideways", () => {
    const at: [number, number] = [0, 3.5]; // between the stage and the front plinths
    const look: [number, number] = [Math.PI / 2, 0]; // facing -x
    const dt = 0.1;
    expect(close(step(at, look, { fwd: 1, side: 0 }, dt), [-WALK_SPEED * dt, 3.5])).toBe(true);
    expect(close(step(at, look, { fwd: -1, side: 0 }, dt), [WALK_SPEED * dt, 3.5])).toBe(true);
    // facing -x, your right is -z
    expect(close(step(at, look, { fwd: 0, side: 1 }, dt), [0, 3.5 - WALK_SPEED * dt])).toBe(true);
    expect(close(step(at, look, { fwd: 0, side: -1 }, dt), [0, 3.5 + WALK_SPEED * dt])).toBe(true);
    // diagonal is no faster than straight
    const d = step(at, look, { fwd: 1, side: 1 }, dt);
    expect(Math.hypot(d[0] - at[0], d[1] - at[1])).toBeCloseTo(WALK_SPEED * dt, 9);
    // no input, no move
    expect(close(step(at, look, { fwd: 0, side: 0 }, dt), at)).toBe(true);
  });

  it("never ends inside the stage, a plinth, a pillar, or beyond BOUND, from any start and direction", () => {
    const r = spread(6000, 42);
    const next = () => r.next().value as number;
    for (let i = 0; i < 1500; i++) {
      const start = collide([next() * 18 - 9, next() * 18 - 9]);
      expect(legal(start)).toBe(true);
      const look: [number, number] = [next() * TAU, 0];
      const dt = [0.016, 0.05, 0.2, 0.5][i % 4];
      let at = start;
      for (let k = 0; k < 8; k++) {
        at = step(at, look, { fwd: 1, side: (k % 3) - 1 }, dt);
        expect(legal(at), `at ${at} from ${start} yaw ${look[0]} dt ${dt}`).toBe(true);
      }
    }
  });

  it("never tunnels through an obstacle in one long frame", () => {
    // touching an obstacle's near side, walk straight at its centre for a
    // long frame: you stay on the near side, not pushed out the far one
    for (const o of OBSTACLES.slice(0, 7)) {
      const [ux, uz] = Math.hypot(o.x, o.z) > 0 ? [-o.x / Math.hypot(o.x, o.z), -o.z / Math.hypot(o.x, o.z)] : [0, 1];
      const at: [number, number] = [o.x + ux * (o.r + 0.01), o.z + uz * (o.r + 0.01)];
      const yaw = Math.atan2(ux, uz); // forward(yaw) = -u, toward the centre of o
      for (const dt of [0.2, 0.5, 1]) {
        const end = step(at, [yaw, 0], { fwd: 1, side: 0 }, dt);
        expect((end[0] - o.x) * ux + (end[1] - o.z) * uz, `obstacle at ${o.x},${o.z} dt ${dt}`).toBeGreaterThan(0);
      }
    }
  });

  it("collide pushes any point out of every obstacle and inside BOUND, and leaves legal points alone", () => {
    for (const o of OBSTACLES) {
      expect(legal(collide([o.x, o.z]))).toBe(true);
      expect(legal(collide([o.x + o.r * 0.3, o.z - o.r * 0.2]))).toBe(true);
    }
    expect(legal(collide([20, -3]))).toBe(true);
    expect(Math.hypot(...collide([20, 0]))).toBeCloseTo(BOUND, 6);
    expect(close(collide([0, 3.5]), [0, 3.5])).toBe(true);
  });

  it("slides along an obstacle walked into at an angle, still making progress", () => {
    // walk at the stage from START, angled 30 degrees off its centre
    let at: [number, number] = [0, 3.0];
    const look: [number, number] = [0.5, 0]; // toward -z, a little left
    for (let k = 0; k < 40; k++) at = step(at, look, { fwd: 1, side: 0 }, 0.05);
    expect(legal(at)).toBe(true);
    expect(at[0]).toBeLessThan(-1.5); // slid round the stage's left side
    // and along the rim: walking tangentially at the bound keeps going
    let rim: [number, number] = [0, 7.5];
    const before = Math.atan2(rim[0], rim[1]);
    for (let k = 0; k < 20; k++) rim = step(rim, [Math.PI / 2 + 0.3, 0], { fwd: 1, side: 0 }, 0.05);
    expect(legal(rim)).toBe(true);
    expect(Math.abs(Math.atan2(rim[0], rim[1]) - before)).toBeGreaterThan(0.2);
  });

  it("the obstacles are the stage drum, six plinths at their slots and sixteen rim pillars", () => {
    expect(OBSTACLES).toHaveLength(1 + 6 + 16);
    expect(OBSTACLES[0]).toEqual({ x: 0, z: 0, r: 2.6 });
    for (let s = 1; s <= 6; s++) {
      const [x, z] = slotXZ(s);
      expect(OBSTACLES.some((o) => Math.abs(o.x - x) < 1e-9 && Math.abs(o.z - z) < 1e-9 && o.r === 1.25)).toBe(true);
    }
    expect(OBSTACLES.filter((o) => Math.abs(Math.hypot(o.x, o.z) - 8.15) < 1e-9)).toHaveLength(16);
  });
});

describe("the reticle", () => {
  const targets = [
    { id: "near", kind: "sphere", c: [0, 1.6, -1] as [number, number, number], r: 0.17 },
    { id: "far", kind: "sphere", c: [0, 1.6, -2.5] as [number, number, number], r: 0.17 },
    { id: "behind", kind: "sphere", c: [0, 1.6, 1] as [number, number, number], r: 0.17 },
    { id: "beyond", kind: "sphere", c: [0, 1.6, -6] as [number, number, number], r: 0.5 },
    { id: "aside", kind: "sphere", c: [1, 1.6, -1] as [number, number, number], r: 0.17 },
  ];
  const eye: [number, number, number] = [0, 1.6, 0];

  it("picks the nearest sphere along the ray, with the distance and point", () => {
    const hit = nearestHit(eye, [0, 0, -1], targets);
    expect(hit?.id).toBe("near");
    expect(hit!.t).toBeCloseTo(1 - 0.17, 9);
    expect(close(hit!.point, [0, 1.6, -0.83])).toBe(true);
    // order of the list doesn't matter
    expect(nearestHit(eye, [0, 0, -1], [...targets].reverse())?.id).toBe("near");
    // an unnormalised direction means the same ray
    expect(nearestHit(eye, [0, 0, -7], targets)?.id).toBe("near");
  });

  it("ignores spheres behind the eye or beyond reach", () => {
    expect(nearestHit(eye, [0, 0, 1], targets.filter((t) => t.id !== "behind"))).toBeNull();
    expect(nearestHit(eye, [0, 0, -1], targets.filter((t) => t.id === "beyond"))).toBeNull();
    expect(nearestHit(eye, [0, 0, -1], targets.filter((t) => t.id === "beyond"), 6)?.id).toBe("beyond");
    expect(nearestHit(eye, [0, 0, -1], targets.filter((t) => t.id === "far"))?.id).toBe("far");
    expect(nearestHit(eye, [0, 0, -1], targets.filter((t) => t.id === "far"), 2)).toBeNull();
    expect(nearestHit(eye, [0, 1, 0], targets)).toBeNull();
  });
});

describe("throwing", () => {
  it("is harder the longer you hold, capped at 5.0 along the look plus 0.3 up", () => {
    const speed = (ms: number) => {
      const v = throwVelocity([1, 0, 0], ms);
      return Math.hypot(v[0], v[1] - 0.3, v[2]);
    };
    expect(speed(0)).toBeCloseTo(1.2, 3);
    expect(speed(450)).toBeGreaterThan(speed(100));
    expect(speed(900)).toBeCloseTo(5.0, 3);
    expect(speed(5000)).toBeCloseTo(5.0, 3);
    expect(throwVelocity([0, 0, -2], 900)).toEqual([0, 0.3, -5]);
  });

  it("rounds to 3 decimals and stays inside the stage's speed limit, so checkGesture takes it as is", () => {
    for (const y of spread(200, 3)) {
      const look: [number, number] = [y * TAU * 3, (y - 0.5) * 2.7];
      for (const ms of [0, 120, 450, 899, 900, 4000]) {
        const v = throwVelocity(lookDir(look), ms);
        for (const c of v) {
          expect(Math.abs(c)).toBeLessThanOrEqual(6);
          expect(Math.round(c * 1000) / 1000).toBe(c);
        }
        const res = checkGesture("orbit", { kind: "throw", object: "teal", at: 1.5, from: [0.2, 0.9, -0.4], v });
        expect(res.ok, JSON.stringify({ v, res })).toBe(true);
        if (res.ok) expect(res.gesture.v).toEqual(v);
      }
    }
  });
});

describe("plinths", () => {
  it("plinthNear finds the plinth faced within 2.6 m, and not one behind you or too far", () => {
    const [x, z] = slotXZ(1);
    const a = Math.atan2(x, z);
    const at: [number, number] = [x - Math.sin(a) * 2.0, z - Math.cos(a) * 2.0];
    const facing = a + Math.PI; // forward(a + π) points from the centre outward
    expect(plinthNear(at, [facing, 0])).toBe(1);
    expect(plinthNear(at, [facing + 0.4, -0.3])).toBe(1);
    expect(plinthNear(at, [facing + Math.PI, 0])).toBeNull(); // behind you
    expect(plinthNear(at, [facing + 1.2, 0])).toBeNull(); // off to the side
    expect(plinthNear(START.at, START.look)).toBeNull(); // the stage, not a plinth
    const far: [number, number] = [x - Math.sin(a) * 3.0, z - Math.cos(a) * 3.0];
    expect(plinthNear(far, [facing, 0])).toBeNull();
  });

  it("standBefore(slot) is a legal spot facing that plinth, for every slot", () => {
    for (let s = 1; s <= 6; s++) {
      const pose = standBefore(s);
      expect(close(collide(pose.at), pose.at)).toBe(true);
      expect(legal(pose.at)).toBe(true);
      expect(plinthNear(pose.at, pose.look)).toBe(s);
      const [x, z] = slotXZ(s);
      expect(Math.hypot(pose.at[0] - x, pose.at[1] - z)).toBeCloseTo(2.3, 9);
      expect(Math.hypot(...pose.at)).toBeCloseTo(PLINTH_R - 2.3, 9);
    }
  });
});
