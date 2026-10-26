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
// ---- collecting (ADR 25): the numbers and places, in the same one place
/** Three kinds, one set of rules. */
export const KINDS = ["fish", "cloud", "door"];
export const ARTIFACT_R = 0.3;
/** How many are on the floor at once, how many a robot carries, display slots. */
export const MAX_AVAILABLE = 6;
export const CARRY_MAX = 3;
export const DISPLAY_SLOTS = 4;
/** Delivery zones: eight pads round the walls, each PAD_R round. */
export const PAD_R = 0.9;
const IN = 1.1; // a pad's centre from its walls
export const HOMES = [
  [IN, IN], [HALL.w / 2, IN], [HALL.w - IN, IN], [HALL.w - IN, HALL.h / 2],
  [HALL.w - IN, HALL.h - IN], [HALL.w / 2, HALL.h - IN], [IN, HALL.h - IN], [IN, HALL.h / 2],
];
const dist = (a, b) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
/** Where artifacts may appear: a grid inside the walls, keeping only the
 * spots where a robot touching one can't also be standing in a zone. */
export const SPOTS = [];
for (let x = 2.6; x < HALL.w - 2; x += 1.8) {
  for (let y = 2.8; y < HALL.h - 2; y += 1.5) {
    const p = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    if (HOMES.every((h) => dist(p, h) > PAD_R + ROBOT_R + ARTIFACT_R)) SPOTS.push(p);
  }
}
/** A robot at `pos` touches an artifact at `at`. */
export const touches = (pos, at) => dist(pos, at) < ROBOT_R + ARTIFACT_R;
/** A robot at `pos` is in the zone centred at `home`. */
export const atHome = (pos, home) => dist(pos, home) < PAD_R;

// ---- together (ADR 26): robots meeting, knocks, and fair zones
/** Robots bounce off each other keeping this share of their closing speed. */
export const ROBOT_BOUNCE = 0.8;
/** A knock needs at least this closing speed, in m/s (full power is LAUNCH_MAX). */
export const KNOCK_SPEED = 4.5;
/** The struck robot is moving less towards the other by at least this; less is a tie. */
export const KNOCK_CLEAR = 0.5;
/** A dropped artifact waits this long before anyone can pick it up, in ms. */
export const PICKUP_DELAY_MS = 1000;
/** A robot that dropped one can't be knocked again for this long, in ms. */
export const DROP_PROTECT_MS = 3000;
/** Within this of its own zone's centre, nothing is knocked loose from a robot. */
export const SAFE_R = PAD_R + 1.2;
export const inSafe = (pos, home) => dist(pos, home) < SAFE_R;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
/** Keeps a robot's centre inside the walls. Changes `p`. */
function inside(p) {
  p[0] = clamp(p[0], ROBOT_R, HALL.w - ROBOT_R);
  p[1] = clamp(p[1], ROBOT_R, HALL.h - ROBOT_R);
}

/**
 * Two robots at the same moment: null unless they overlap and are closing.
 * Otherwise they bounce as equal masses, and it says how fast they closed,
 * along which line (from a to b), and which was struck: the one moving
 * less towards the other by at least KNOCK_CLEAR, or null for a tie.
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
  const na = { ...a, pos: [a.pos[0] - n[0] * half, a.pos[1] - n[1] * half], vel: [a.vel[0] - j * n[0], a.vel[1] - j * n[1]] };
  const nb = { ...b, pos: [b.pos[0] + n[0] * half, b.pos[1] + n[1] * half], vel: [b.vel[0] + j * n[0], b.vel[1] + j * n[1]] };
  inside(na.pos);
  inside(nb.pos);
  const struck = aInto > bInto + KNOCK_CLEAR ? "b" : bInto > aInto + KNOCK_CLEAR ? "a" : null;
  return { a: na, b: nb, closing, struck, n };
}

/**
 * Whether a collision (from `collide`) knocks an artifact loose from the
 * struck robot: fast enough, a clear struck robot, that robot not
 * protected at `now`, and not within SAFE_R of its own zone. The same for
 * everyone; whether it carries anything is the store's to say.
 */
export function knocks(c, protectedUntil, now) {
  if (!c || c.closing < KNOCK_SPEED || !c.struck) return false;
  if (now < protectedUntil) return false;
  const r = c.struck === "a" ? c.a : c.b;
  return !(Number.isInteger(r.home) && inSafe(r.pos, HOMES[r.home]));
}

/** Where an artifact knocked loose from a robot at `pos` lands: just
 * beyond it along `away` (a unit vector from the striker), inside the
 * walls, and out of every zone (moved towards the middle if it fell in). */
export function dropSpot(pos, away) {
  const reach = ROBOT_R + ARTIFACT_R + 0.2;
  const q = [clamp(pos[0] + away[0] * reach, ARTIFACT_R, HALL.w - ARTIFACT_R), clamp(pos[1] + away[1] * reach, ARTIFACT_R, HALL.h - ARTIFACT_R)];
  for (const h of HOMES) {
    if (dist(q, h) > PAD_R + ARTIFACT_R) continue;
    const c = [HALL.w / 2 - h[0], HALL.h / 2 - h[1]];
    const cl = Math.sqrt(c[0] * c[0] + c[1] * c[1]);
    return [h[0] + (c[0] / cl) * (PAD_R + ARTIFACT_R + 0.1), h[1] + (c[1] / cl) * (PAD_R + ARTIFACT_R + 0.1)];
  }
  return q;
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
export const standing = (pos, t, home) => ({ pos: [pos[0], pos[1]], vel: [0, 0], t, seq: 0, home });
// ---- leaving (ADR 27)
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
  const lo = ROBOT_R, hiX = HALL.w - ROBOT_R, hiY = HALL.h - ROBOT_R;
  if (p[0] < lo) [p[0], v[0]] = [lo, -v[0] * WALL_BOUNCE];
  else if (p[0] > hiX) [p[0], v[0]] = [hiX, -v[0] * WALL_BOUNCE];
  if (p[1] < lo) [p[1], v[1]] = [lo, -v[1] * WALL_BOUNCE];
  else if (p[1] > hiY) [p[1], v[1]] = [hiY, -v[1] * WALL_BOUNCE];
  // a zone that isn't this robot's is solid to it, like a wall (ADR 26)
  if (!Number.isInteger(r.home)) return;
  for (let i = 0; i < HOMES.length; i++) {
    if (i === r.home) continue;
    const h = HOMES[i];
    const d = [p[0] - h[0], p[1] - h[1]];
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
    const min = PAD_R + ROBOT_R;
    if (len >= min || len < 1e-9) continue;
    const n = [d[0] / len, d[1] / len];
    p[0] = h[0] + n[0] * min;
    p[1] = h[1] + n[1] * min;
    const vn = v[0] * n[0] + v[1] * n[1];
    if (vn < 0) {
      v[0] -= (1 + WALL_BOUNCE) * vn * n[0];
      v[1] -= (1 + WALL_BOUNCE) * vn * n[1];
    }
  }
  // the walls win: a zone in a corner mustn't push a robot through one
  inside(p);
}

/**
 * The robot at server time `to`, stepped on in whole steps from its
 * snapshot (the remainder waits for the next step). A fresh object.
 */
export function advance(r, to) {
  const out = { pos: [r.pos[0], r.pos[1]], vel: [r.vel[0], r.vel[1]], t: r.t, seq: r.seq, home: r.home };
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
