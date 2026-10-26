// The hall's movement rule (ADR 24): a round robot launched across a
// top-down hall, slowing to a stop and rebounding off the walls. This is
// the one copy of the rule: the server imports it to move robots, the page
// to predict yours and to show everyone's between snapshots.
//
// A robot is a snapshot { pos, vel, t, seq }: where it is and how fast it's
// going at server time t (ms). `advance` steps it on in whole 20 ms steps,
// so the server and every screen, starting from the same snapshot, get the
// same numbers. The arithmetic is + - * / and Math.sqrt only, which every
// JavaScript engine rounds the same; spec/hall.test.ts reads this file to
// hold that.

// ---- every movement number, in one place
/** The hall, in metres: x across, y down the screen. */
export const HALL = { w: 16, h: 10 };
export const ROBOT_R = 0.45;
/** The fastest a launch sends a robot, in m/s (at power 1). */
export const LAUNCH_MAX = 8;
/** How far back you pull for full power, and the least that counts, in m. */
export const PULL_MAX = 2.5;
export const MIN_PULL = 0.25;
/** Slowing down: a steady FRICTION (m/s²) plus DRAG per second of speed. */
export const FRICTION = 2.5;
export const DRAG = 0.6;
/** What share of its speed into a wall a robot keeps coming off it. */
export const WALL_BOUNCE = 0.75;
/** Slower than this, in m/s, a robot stops. */
export const STOP = 0.05;
export const HZ = 50;
export const STEP_MS = 1000 / HZ;
const DT = STEP_MS / 1000;

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Checks a launch from a page: a direction and a power, and the page's own
 * count of its launches, `seq`. Nothing else: never a position or a speed.
 * @param {unknown} x
 * @returns {{ ok: true, launch: { dir: number[], power: number, seq: number } } | { ok: false, error: string }}
 */
export function checkLaunch(x) {
  const no = (error) => ({ ok: false, error });
  if (!x || typeof x !== "object" || Array.isArray(x)) return no("a launch is an object");
  const keys = Object.keys(x);
  if (keys.length !== 3 || !keys.every((k) => k === "dir" || k === "power" || k === "seq")) return no("a launch is { dir, power, seq }");
  if (!Array.isArray(x.dir) || x.dir.length !== 2 || !x.dir.every(isNum)) return no("dir is two numbers");
  const len = Math.sqrt(x.dir[0] * x.dir[0] + x.dir[1] * x.dir[1]);
  if (!(len > 1e-6)) return no("dir needs a direction");
  if (!isNum(x.power) || x.power <= 0 || x.power > 1) return no("power is over 0, at most 1");
  if (!Number.isInteger(x.seq) || x.seq < 0 || x.seq > 2147483647) return no("seq is a whole number");
  return { ok: true, launch: { dir: [r6(x.dir[0] / len), r6(x.dir[1] / len)], power: r6(x.power), seq: x.seq } };
}

/** A robot standing still at `pos` from server time `t`. */
export const standing = (pos, t) => ({ pos: [pos[0], pos[1]], vel: [0, 0], t, seq: 0 });

/** One step: slow down, move, and come off any wall. Changes `r`. */
function step(r) {
  const v = r.vel, p = r.pos;
  const s = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  if (s === 0) return;
  const slower = s - (FRICTION + DRAG * s) * DT;
  if (slower <= STOP) {
    v[0] = 0;
    v[1] = 0;
    return;
  }
  v[0] *= slower / s;
  v[1] *= slower / s;
  p[0] += v[0] * DT;
  p[1] += v[1] * DT;
  const lo = ROBOT_R, hiX = HALL.w - ROBOT_R, hiY = HALL.h - ROBOT_R;
  if (p[0] < lo) [p[0], v[0]] = [lo, -v[0] * WALL_BOUNCE];
  else if (p[0] > hiX) [p[0], v[0]] = [hiX, -v[0] * WALL_BOUNCE];
  if (p[1] < lo) [p[1], v[1]] = [lo, -v[1] * WALL_BOUNCE];
  else if (p[1] > hiY) [p[1], v[1]] = [hiY, -v[1] * WALL_BOUNCE];
}

/**
 * The robot at server time `to`, stepped on in whole steps from its
 * snapshot (the remainder waits for the next step). A fresh object.
 */
export function advance(r, to) {
  const out = { pos: [r.pos[0], r.pos[1]], vel: [r.vel[0], r.vel[1]], t: r.t, seq: r.seq };
  const steps = Math.floor((to - r.t) / STEP_MS);
  if (!(steps > 0)) return out;
  out.t = r.t + steps * STEP_MS;
  for (let i = 0; i < steps && (out.vel[0] !== 0 || out.vel[1] !== 0); i++) step(out);
  return out;
}

/**
 * A checked launch at server time `now`: the robot is brought up to now,
 * then its velocity is replaced, never added to, so it is never faster
 * than LAUNCH_MAX however often it's launched.
 */
export function launch(r, l, now) {
  const out = advance(r, now);
  out.t = now;
  // unit length here, whatever rounding did to dir, so the cap is exact
  const len = Math.sqrt(l.dir[0] * l.dir[0] + l.dir[1] * l.dir[1]);
  const s = (Math.min(l.power, 1) * LAUNCH_MAX) / len;
  out.vel = [l.dir[0] * s, l.dir[1] * s];
  out.seq = l.seq;
  return out;
}

/** Where a launch from `r` will go, until it stops: the preview. */
export function path(r, l) {
  const run = launch(r, l, r.t);
  const pts = [[run.pos[0], run.pos[1]]];
  for (let i = 1; i < HZ * 10 && (run.vel[0] !== 0 || run.vel[1] !== 0); i++) {
    step(run);
    if (i % 2 === 0 || (run.vel[0] === 0 && run.vel[1] === 0)) pts.push([run.pos[0], run.pos[1]]);
  }
  return pts;
}

/** Where the n-th robot to arrive starts: spread along the hall's middle. */
export function spawnAt(n) {
  const slots = 7;
  const i = n % slots;
  return [HALL.w / 2 + (i % 2 === 0 ? 1 : -1) * Math.floor((i + 1) / 2) * 1.6, HALL.h / 2];
}
