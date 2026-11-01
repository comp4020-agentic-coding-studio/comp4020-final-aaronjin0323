// The arena's rule (ADR 28): round robots launched across a top-down arena,
// slowing to a stop and rebounding off the walls. This is the one copy of
// the rule: the server imports it to move robots, the page
// to predict yours and to show everyone's between snapshots.
//
// A robot is a snapshot { pos, vel, t, seq }: where it is and how fast it's
// going at server time t (ms). `advance` steps it on in whole 20 ms steps,
// so the server and every screen, starting from the same snapshot, get the
// same numbers. The arithmetic is + - * / and Math.sqrt only, which every
// JavaScript engine rounds the same; spec/arena-rule.test.ts reads this file to
// hold that.

// ---- every number, in one place
/** The arena, in metres: x across, y down the screen. */
export const ARENA = { w: 16, h: 10 };
export const ROBOT_R = 0.45;
/** The fastest an empty robot's launch goes, in m/s (at power 1). */
export const LAUNCH_MAX = 10;
/** The fastest anything ever goes, collisions included, in m/s. */
export const SPEED_MAX = 12;
/** How far back you pull for full power, and the least that counts, in m. */
export const PULL_MAX = 2.5;
export const MIN_PULL = 0.25;
/** Slowing down: a steady FRICTION (m/s²) plus DRAG per second of speed. */
export const FRICTION = 2;
export const DRAG = 0.6;
/** What share of its speed into a wall a robot keeps coming off it. */
export const WALL_BOUNCE = 0.75;
/** Slower than this, in m/s, a robot stops. */
export const STOP = 0.05;
/** How many robots at once. */
export const MAX_PLAYERS = 4;
/** Where each slot's robot starts. */
export const SPAWNS = [[1.5, 1.5], [14.5, 8.5], [14.5, 1.5], [1.5, 8.5]];

// ---- load: each artifact makes a launch weaker and a turn wider
export const CARRY_MAX = 5;
const LOAD_SLOW = 0.2;
const LOAD_TURN = 0.1;
/** The launch cap with `n` artifacts aboard, in m/s. */
export const loadCap = (n) => LAUNCH_MAX / (1 + LOAD_SLOW * n);
/** The share of its old velocity a launch keeps with `n` aboard. */
export const loadKeep = (n) => LOAD_TURN * n;

// ---- artifacts and the vault
/** Three kinds, one set of rules. */
export const KINDS = ["fish", "cloud", "door"];
export const ARTIFACT_R = 0.3;
/** How many are on the floor at once. */
export const MAX_AVAILABLE = 7;
export const VAULT = [ARENA.w / 2, ARENA.h / 2];
export const VAULT_R = 1.3;
const dist = (a, b) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
/** A robot at `pos` is in the vault. */
export const inVault = (pos) => dist(pos, VAULT) < VAULT_R;
/** Where artifacts may appear: a grid inside the walls, clear of the vault. */
export const SPOTS = [];
for (let x = 1.4; x < ARENA.w - 1; x += 1.8) {
  for (let y = 1.4; y < ARENA.h - 1; y += 1.8) {
    const p = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    if (dist(p, VAULT) > VAULT_R + ROBOT_R + ARTIFACT_R) SPOTS.push(p);
  }
}
/** A robot at `pos` touches an artifact at `at`. */
export const touches = (pos, at) => dist(pos, at) < ROBOT_R + ARTIFACT_R;

// ---- contact
/** Robots bounce off each other keeping this share of their closing speed. */
export const ROBOT_BOUNCE = 0.8;
/** How long a scattered artifact settles before anyone can take it, in ms. */
export const SETTLE_MS = 600;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
/** `v` no faster than `max`. */
function bounded(v, max) {
  const s = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  return s > max ? [(v[0] * max) / s, (v[1] * max) / s] : v;
}
/** Keeps a robot's centre inside the walls. Changes `p`. */
function inside(p) {
  p[0] = clamp(p[0], ROBOT_R, ARENA.w - ROBOT_R);
  p[1] = clamp(p[1], ROBOT_R, ARENA.h - ROBOT_R);
}

/**
 * Two robots at the same moment: null unless they overlap and are closing.
 * Otherwise they bounce as equal masses, and it says how fast they closed,
 * and along which line (from a to b).
 */
export function collide(a, b) {
  const d = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
  if (len >= 2 * ROBOT_R || len < 1e-9) return null;
  const n = [d[0] / len, d[1] / len];
  const aInto = a.vel[0] * n[0] + a.vel[1] * n[1];
  const bInto = -(b.vel[0] * n[0] + b.vel[1] * n[1]);
  const closing = aInto + bInto;
  if (closing <= 0) return null;
  const j = ((1 + ROBOT_BOUNCE) / 2) * closing;
  const half = (2 * ROBOT_R - len) / 2;
  const na = { ...a, pos: [a.pos[0] - n[0] * half, a.pos[1] - n[1] * half], vel: bounded([a.vel[0] - j * n[0], a.vel[1] - j * n[1]], SPEED_MAX) };
  const nb = { ...b, pos: [b.pos[0] + n[0] * half, b.pos[1] + n[1] * half], vel: bounded([b.vel[0] + j * n[0], b.vel[1] + j * n[1]], SPEED_MAX) };
  inside(na.pos);
  inside(nb.pos);
  return { a: na, b: nb, closing, n };
}

/** The unit fan a robot's cargo spreads in: straight on, then out to ±80°. */
const FAN = [[1, 0], [0.766, 0.643], [0.766, -0.643], [0.174, 0.985], [0.174, -0.985]];
/** Where `n` artifacts from a robot at `pos` land: spread outward around
 * `away` (a unit vector from the other robot), inside the walls and out of
 * the vault, pushed to its edge if one fell in. */
export function scatterSpots(pos, away, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = FAN[i % FAN.length];
    const d = [away[0] * f[0] - away[1] * f[1], away[0] * f[1] + away[1] * f[0]];
    const reach = ROBOT_R + ARTIFACT_R + 0.9 + 0.3 * (i % 2);
    const q = [clamp(pos[0] + d[0] * reach, ARTIFACT_R, ARENA.w - ARTIFACT_R), clamp(pos[1] + d[1] * reach, ARTIFACT_R, ARENA.h - ARTIFACT_R)];
    const v = [q[0] - VAULT[0], q[1] - VAULT[1]];
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    const edge = VAULT_R + ARTIFACT_R + 0.1;
    if (len >= edge) out.push(q);
    else {
      const u = len < 1e-9 ? [1, 0] : [v[0] / len, v[1] / len];
      out.push([VAULT[0] + u[0] * edge, VAULT[1] + u[1] * edge]);
    }
  }
  return out;
}

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
// ---- leaving
/** How long a disconnected player's robot waits for them, in ms. */
export const GRACE_MS = 10_000;
/** The `n` free safe spots nearest `at`, none where an artifact already
 * is (`taken`): where a departed robot's cargo goes back on the floor. */
export function nearestFree(at, taken, n) {
  const free = SPOTS.filter((p) => !taken.some((t) => dist(t, p) < 2 * ARTIFACT_R));
  return free.sort((p, q) => dist(p, at) - dist(q, at)).slice(0, n);
}

/** The step a server time falls in: snapshot times sit on this grid. */
export const onGrid = (t) => t - (t % STEP_MS);

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
  const lo = ROBOT_R, hiX = ARENA.w - ROBOT_R, hiY = ARENA.h - ROBOT_R;
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
 * A checked launch at server time `now` with `load` artifacts aboard. The
 * robot is brought up to now, then its velocity becomes the launch, keeping
 * loadKeep(load) of the old one, and no faster than loadCap(load).
 * It works at any moment, and however often it's launched it's never faster.
 */
export function launch(r, l, now, load = 0) {
  const out = advance(r, now);
  out.t = now;
  // unit length here, whatever rounding did to dir, so the cap is exact
  const len = Math.sqrt(l.dir[0] * l.dir[0] + l.dir[1] * l.dir[1]);
  const cap = loadCap(load);
  const s = (Math.min(l.power, 1) * cap) / len;
  const keep = loadKeep(load);
  out.vel = bounded([out.vel[0] * keep + l.dir[0] * s * (1 - keep), out.vel[1] * keep + l.dir[1] * s * (1 - keep)], cap);
  out.seq = l.seq;
  return out;
}

/** Where a launch from `r` will go, until it stops: the preview. */
export function path(r, l, load = 0) {
  const run = launch(r, l, r.t, load);
  const pts = [[run.pos[0], run.pos[1]]];
  for (let i = 1; i < HZ * 10 && (run.vel[0] !== 0 || run.vel[1] !== 0); i++) {
    step(run);
    if (i % 2 === 0 || (run.vel[0] === 0 && run.vel[1] === 0)) pts.push([run.pos[0], run.pos[1]]);
  }
  return pts;
}
