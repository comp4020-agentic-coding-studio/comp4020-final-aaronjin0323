// How a visitor stands, walks, looks and reaches in first person (ADR 17;
// CLAUDE.md, "First person"). One copy: the page imports it (served at
// /walk.js) to move the camera and aim the reticle, and spec/walk.test.ts
// holds it. Plain JS, no Three.js and no DOM, so it runs in Node.
//
// Units are metres; the stage's centre is the world origin and y is up. A
// look is [yaw, pitch]: yaw 0 faces -z, positive yaw turns left
// (counter-clockwise seen from above), positive pitch looks up. Nothing
// here is a stage rule, so Math.sin and Math.cos are fine: two screens
// needn't agree on where a visitor stands to the last bit.

/**
 * @typedef {[number, number]} XZ
 * @typedef {[number, number, number]} Vec
 * @typedef {[number, number]} Look
 * @typedef {{ x: number, z: number, r: number }} Circle
 * @typedef {{ fwd: number, side: number }} WalkInput
 * @typedef {{ id: string, kind: string, c: Vec | number[], r: number }} Target
 * @typedef {{ id: string, t: number, point: Vec }} Hit
 * @typedef {{ at: XZ, look: Look }} Pose
 */

const TAU = Math.PI * 2;

/** Eye height above the floor. */
export const EYE = 1.62;
/** How far the reticle reaches. */
export const REACH = 3.2;
/** Walking speed, metres a second. */
export const WALK_SPEED = 2.6;
/** Where a visitor starts and "Back to the stage" returns: in front of the
 * stage, facing it, looking a little down at it.
 * @type {Pose} */
export const START = { at: [0, 4.4], look: [0, -0.12] };
/** Nobody walks further than this from the centre (the floor is 8.6). */
export const BOUND = 7.6;

// ---- the room, as public/scene.js builds it
const PLINTH_R = 5.4; // the ring the plinths stand on
const PILLAR_RING = 8.6 - 0.45; // FLOOR_R - 0.45, the ring of arches
const PILLARS = 16;
const slotAngle = (/** @type {number} */ slot) => ((slot - 1) / 6) * TAU + Math.PI / 6;

/** Circles nobody can walk into: the stage's drum, the six plinths and the
 * sixteen pillars round the rim, in that order.
 * @type {Circle[]} */
export const OBSTACLES = [
  { x: 0, z: 0, r: 2.6 },
  ...[1, 2, 3, 4, 5, 6].map((s) => ({ x: Math.sin(slotAngle(s)) * PLINTH_R, z: Math.cos(slotAngle(s)) * PLINTH_R, r: 1.25 })),
  ...Array.from({ length: PILLARS }, (_, k) => ({ x: Math.sin((k / PILLARS) * TAU) * PILLAR_RING, z: Math.cos((k / PILLARS) * TAU) * PILLAR_RING, r: 0.45 })),
];

// ---- the tuning
/** a long frame is walked in pieces no longer than this, so nothing is
 * stepped over and sliding follows the curve */
const MAX_STRIDE = 0.2;
const PITCH_MAX = 1.35;
/** a plinth counts as faced within this distance of its centre, and this
 * angle of where the visitor looks */
const NEAR = 2.6;
const FACING = 0.6;
/** standBefore puts the visitor this far in front of a plinth, looking a
 * little down at its exhibit */
const BEFORE = 2.3;
const BEFORE_PITCH = -0.15;
/** a throw's speed: from slow to fast over a held press, plus a lift */
const THROW = { min: 1.2, gain: 3.8, holdMs: 900, up: 0.3 };

/**
 * The unit vector a visitor faces on the floor.
 * @param {number} yaw
 * @returns {XZ}
 */
export function forward(yaw) {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/**
 * The unit 3D direction a visitor looks along.
 * @param {Look | number[]} look
 * @returns {Vec}
 */
export function lookDir([yaw, pitch]) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** @param {number} p */
export const clampPitch = (p) => Math.min(PITCH_MAX, Math.max(-PITCH_MAX, p));

/**
 * Pushes a point out of every obstacle and back inside BOUND. A point
 * already somewhere a visitor may stand comes back unchanged.
 * @param {XZ | number[]} at
 * @returns {XZ}
 */
export function collide([x, z]) {
  // the obstacles don't overlap each other or the bound, so one pass
  // settles it; a few more cost nothing and guard a future tweak
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const o of OBSTACLES) {
      const dx = x - o.x, dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= o.r) continue;
      // dead centre has no way out: leave toward the start, outward
      const [nx, nz] = d > 1e-9 ? [dx / d, dz / d] : unit(o.x, o.z);
      x = o.x + nx * o.r;
      z = o.z + nz * o.r;
      moved = true;
    }
    const r = Math.hypot(x, z);
    if (r > BOUND) {
      x *= BOUND / r;
      z *= BOUND / r;
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

// the direction from the centre to (x, z), or toward START from dead centre
function unit(/** @type {number} */ x, /** @type {number} */ z) {
  const d = Math.hypot(x, z);
  return d > 1e-9 ? [x / d, z / d] : [0, 1];
}

/**
 * One frame of walking: `fwd` along where the visitor faces, `side` to
 * their right (+1) or left (-1), at WALK_SPEED, then out of anything walked
 * into. Walking into an obstacle at an angle slides along it.
 * @param {XZ | number[]} at
 * @param {Look | number[]} look
 * @param {WalkInput} input
 * @param {number} dt seconds
 * @returns {XZ}
 */
export function step(at, look, input, dt) {
  let mx = input.fwd, ms = input.side;
  const m = Math.hypot(mx, ms);
  if (m > 1) {
    mx /= m;
    ms /= m;
  }
  const [fx, fz] = forward(look[0]);
  // your right is forward turned clockwise seen from above
  const rx = -fz, rz = fx;
  const dist = WALK_SPEED * dt;
  const dx = (fx * mx + rx * ms) * dist;
  const dz = (fz * mx + rz * ms) * dist;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_STRIDE));
  /** @type {XZ} */
  let p = [at[0], at[1]];
  for (let i = 0; i < n; i++) p = collide([p[0] + dx / n, p[1] + dz / n]);
  return p;
}

/**
 * The nearest sphere a ray meets within reach, or null. `dir` needn't be
 * a unit vector. An eye inside a sphere meets it at once (t = 0).
 * @param {Vec | number[]} origin
 * @param {Vec | number[]} dir
 * @param {Target[]} targets
 * @param {number} [reach]
 * @returns {Hit | null}
 */
export function nearestHit(origin, dir, targets, reach = REACH) {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0)) return null;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  /** @type {Hit | null} */
  let best = null;
  for (const tg of targets) {
    if (tg.kind !== "sphere") continue;
    const oc = [origin[0] - tg.c[0], origin[1] - tg.c[1], origin[2] - tg.c[2]];
    const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
    const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - tg.r * tg.r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const s = Math.sqrt(disc);
    const t1 = -b - s, t2 = -b + s;
    const t = t1 >= 0 ? t1 : t2 >= 0 ? 0 : -1;
    if (t < 0 || t > reach) continue;
    if (best && best.t <= t) continue;
    best = { id: tg.id, t, point: [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t] };
  }
  return best;
}

/**
 * A throw's velocity: along `dir`, faster the longer the press was held
 * (1.2 up to 5.0), plus a little lift, each part rounded to 3 decimals so
 * checkGesture in public/stage.js takes it as it is (under its V_MAX, 6).
 * @param {Vec | number[]} dir
 * @param {number} heldMs
 * @returns {Vec}
 */
export function throwVelocity(dir, heldMs) {
  const held = Math.min(Math.max(heldMs, 0), THROW.holdMs) || 0;
  const speed = THROW.min + (held / THROW.holdMs) * THROW.gain;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0
  return [round((dir[0] / len) * speed), round((dir[1] / len) * speed + THROW.up), round((dir[2] / len) * speed)];
}

/**
 * The plinth the visitor is standing at and facing: within 2.6 m of its
 * centre and within 0.6 rad of where they look, nearest first.
 * @param {XZ | number[]} at
 * @param {Look | number[]} look
 * @returns {number | null} slot 1..6
 */
export function plinthNear(at, look) {
  const [fx, fz] = forward(look[0]);
  const cosMax = Math.cos(FACING);
  /** @type {number | null} */
  let best = null;
  let bestD = Infinity;
  for (let slot = 1; slot <= 6; slot++) {
    const o = OBSTACLES[slot];
    const dx = o.x - at[0], dz = o.z - at[1];
    const d = Math.hypot(dx, dz);
    if (d > NEAR || d >= bestD) continue;
    if (d > 1e-9 && (dx * fx + dz * fz) / d < cosMax) continue;
    best = slot;
    bestD = d;
  }
  return best;
}

/**
 * Where to stand to look at a plinth: 2.3 m in front of it, toward the
 * centre, facing it.
 * @param {number} slot 1..6
 * @returns {Pose}
 */
export function standBefore(slot) {
  const a = slotAngle(slot);
  const r = PLINTH_R - BEFORE;
  // facing outward from the centre: yaw a + π, kept within (-π, π]
  const yaw = a + Math.PI > Math.PI ? a - Math.PI : a + Math.PI;
  return { at: [Math.sin(a) * r, Math.cos(a) * r], look: [yaw, BEFORE_PITCH] };
}
