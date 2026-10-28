// The Upside-down Fountain (ADR 21): four balls that fall up into a glass
// dome, and a bell hanging in the middle. This is the one copy of the
// rules: the server imports it to check gestures, the page to play them.
//
// What happens is a rule, not a record. Every position at every moment
// comes from the gestures alone, stepped at 60 Hz from rest with no
// randomness, so every screen shows the same performance. The arithmetic
// is + - * / and Math.sqrt only, which every JavaScript engine rounds the
// same; spec/fountain.test.ts reads this file to hold that.

/** A performance is a loop this long, in seconds. */
export const LOOP = 20;
/** The last GLIDE seconds of the loop ease every ball home. */
export const GLIDE = 1;
export const HZ = 60;
const STEP = 1 / HZ;

/** A loop holds at most this many gestures, and this many from one visitor. */
export const MAX_GESTURES = 30;
export const MAX_PER_VISITOR = 10;

export const BALLS = ["teal", "coral", "gold", "plum"];
export const BALL_R = 0.16;
/** The dome: a glass cylinder over the stage, `radius` round and `height` high. */
export const DOME = { radius: 1.6, height: 1.8 };
export const BELL = { pos: [0, 0.9, 0], r: 0.22 };
/** Fastest a flick may send a ball, per axis, in m/s. */
export const V_MAX = 6;
/** How far the bell's ring reaches, and how hard it pushes at the bell. */
export const RING_REACH = 0.9;
const RING_PUSH = 3.5;

// The tuning, in one place.
const LIFT = 3; // up is down: m/s² towards the dome
const DRAG = 0.3; // per second
const DOME_FRICTION = 0.995; // per step, sliding along the glass
const DOME_BOUNCE = 0.5;
const FLOOR_BOUNCE = 0.7;
const WALL_BOUNCE = 0.7;
const BALL_BOUNCE = 0.9;
const BELL_BOUNCE = 0.8;
const LOUD = 0.3; // slower than this, a touch makes no sound

// Where each ball rests: against the dome, on a ring round the bell.
const REST_RING = 0.85;
const TOP = DOME.height - BALL_R;
const REST = {
  teal: [REST_RING, TOP, 0],
  coral: [0, TOP, REST_RING],
  gold: [-REST_RING, TOP, 0],
  plum: [0, TOP, -REST_RING],
};

const restState = () => ({
  // `by` is the tag of whoever last moved the ball, `byAt` when (ADR 23)
  balls: Object.fromEntries(BALLS.map((id) => [id, { pos: [...REST[id]], v: [0, 0, 0], by: null, byAt: -1 }])),
  bell: { rungAt: -1 },
  events: [],
});

const r3 = (x) => Math.round(x * 1000) / 1000;
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * Checks a gesture from the page. Refuses unknown kinds, balls and keys
 * and anything out of range; never clamps. Numbers are rounded to 3 places.
 * @param {unknown} g
 * @returns {{ ok: true, gesture: object } | { ok: false, error: string }}
 */
export function checkGesture(g) {
  const no = (error) => ({ ok: false, error });
  if (!g || typeof g !== "object" || Array.isArray(g)) return no("a gesture is an object");
  const keys = Object.keys(g);
  if (!isNum(g.at)) return no("at must be a number");
  const at = r3(g.at);
  if (at < 0 || at >= LOOP) return no(`at must be from 0 to under ${LOOP}`);
  if (g.kind === "ring") {
    if (keys.length !== 2) return no("a ring is { kind, at }");
    return { ok: true, gesture: { kind: "ring", at } };
  }
  if (g.kind === "flick") {
    if (keys.length !== 4 || !keys.every((k) => k === "kind" || k === "ball" || k === "v" || k === "at")) return no("a flick is { kind, ball, v, at }");
    if (typeof g.ball !== "string" || !BALLS.includes(g.ball)) return no("no such ball");
    if (!Array.isArray(g.v) || g.v.length !== 3 || !g.v.every(isNum)) return no("v is three numbers");
    const v = g.v.map(r3);
    if (!v.every((x) => x >= -V_MAX && x <= V_MAX)) return no(`each part of v is from -${V_MAX} to ${V_MAX}`);
    return { ok: true, gesture: { kind: "flick", ball: g.ball, v, at } };
  }
  return no("kind is flick or ring");
}

/** A gesture made in the glide plays at the top of the next loop, where it
 * can be seen, rather than easing home unseen. @param {number} moment */
export const gestureMoment = (moment) => (moment >= LOOP - GLIDE ? 0 : moment);

/** The loop moment of a shared time in seconds. @param {number} seconds */
export const loopMoment = (seconds) => ((seconds % LOOP) + LOOP) % LOOP;

const stepOf = (at) => Math.floor(at * HZ + 1e-6);

function apply(st, g, t) {
  if (g.kind === "flick") {
    const b = st.balls[g.ball];
    b.v = [...g.v];
    b.by = g.by ?? null;
    b.byAt = t;
    st.events.push({ kind: "flick", ball: g.ball, by: g.by, t, pos: [...b.pos] });
    return;
  }
  st.bell.rungAt = t;
  st.events.push({ kind: "ring", by: g.by, t, pos: [...BELL.pos] });
  for (const id of BALLS) {
    const b = st.balls[id];
    const d = [b.pos[0] - BELL.pos[0], b.pos[1] - BELL.pos[1], b.pos[2] - BELL.pos[2]];
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    if (len >= RING_REACH) continue;
    const n = len < 1e-6 ? [0, 1, 0] : [d[0] / len, d[1] / len, d[2] / len];
    const push = RING_PUSH * (1 - len / RING_REACH);
    for (let i = 0; i < 3; i++) b.v[i] += n[i] * push;
    b.by = g.by ?? null;
    b.byAt = t;
  }
}

function tick(st, t) {
  const R = DOME.radius - BALL_R;
  for (const id of BALLS) {
    const b = st.balls[id];
    const p = b.pos, v = b.v;
    v[1] += LIFT * STEP;
    const keep = 1 - DRAG * STEP;
    v[0] *= keep;
    v[1] *= keep;
    v[2] *= keep;
    p[0] += v[0] * STEP;
    p[1] += v[1] * STEP;
    p[2] += v[2] * STEP;
    if (p[1] >= TOP) {
      p[1] = TOP;
      if (v[1] > LOUD * 2) st.events.push({ kind: "bounce", ball: id, t, pos: [...p] });
      v[1] = v[1] > 0 ? (v[1] * DOME_BOUNCE > 0.2 ? -v[1] * DOME_BOUNCE : 0) : v[1];
      v[0] *= DOME_FRICTION;
      v[2] *= DOME_FRICTION;
    }
    if (p[1] < BALL_R) {
      p[1] = BALL_R;
      if (v[1] < 0) v[1] = -v[1] * FLOOR_BOUNCE;
    }
    const rr = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
    if (rr > R) {
      const n = [p[0] / rr, p[2] / rr];
      p[0] = n[0] * R;
      p[2] = n[1] * R;
      const vn = v[0] * n[0] + v[2] * n[1];
      if (vn > 0) {
        v[0] -= (1 + WALL_BOUNCE) * vn * n[0];
        v[2] -= (1 + WALL_BOUNCE) * vn * n[1];
      }
    }
    // the bell: a ball that hits it bounces off and rings it
    const d = [p[0] - BELL.pos[0], p[1] - BELL.pos[1], p[2] - BELL.pos[2]];
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    const reach = BALL_R + BELL.r;
    if (len < reach && len > 1e-9) {
      const n = [d[0] / len, d[1] / len, d[2] / len];
      for (let i = 0; i < 3; i++) p[i] = BELL.pos[i] + n[i] * reach;
      const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      if (vn < 0) {
        for (let i = 0; i < 3; i++) v[i] -= (1 + BELL_BOUNCE) * vn * n[i];
        if (-vn > LOUD) {
          st.bell.rungAt = t;
          st.events.push({ kind: "ring", by: b.by, ball: id, t, pos: [...BELL.pos] });
        }
      }
    }
  }
  // balls knock each other, in a fixed order
  for (let i = 0; i < BALLS.length; i++) {
    for (let j = i + 1; j < BALLS.length; j++) {
      const a = st.balls[BALLS[i]], b = st.balls[BALLS[j]];
      const d = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
      const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      if (len >= 2 * BALL_R || len < 1e-9) continue;
      const n = [d[0] / len, d[1] / len, d[2] / len];
      const half = (2 * BALL_R - len) / 2;
      for (let k = 0; k < 3; k++) {
        a.pos[k] -= n[k] * half;
        b.pos[k] += n[k] * half;
      }
      const vn = (a.v[0] - b.v[0]) * n[0] + (a.v[1] - b.v[1]) * n[1] + (a.v[2] - b.v[2]) * n[2];
      if (vn <= 0) continue;
      // the one moving harder into the other is the striker: it passes its mover on
      const aInto = a.v[0] * n[0] + a.v[1] * n[1] + a.v[2] * n[2];
      const [striker, struck, hit] = aInto >= vn - aInto ? [a, b, BALLS[j]] : [b, a, BALLS[i]];
      const share = ((1 + BALL_BOUNCE) / 2) * vn;
      for (let k = 0; k < 3; k++) {
        a.v[k] -= share * n[k];
        b.v[k] += share * n[k];
      }
      if (vn <= LOUD) continue;
      const was = struck.by;
      if (striker.by !== null) {
        struck.by = striker.by;
        struck.byAt = t;
      }
      st.events.push({ kind: "knock", ball: BALLS[i], other: BALLS[j], by: striker.by, hit, was, t, pos: [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2] });
    }
  }
}

// After every push (walls, the bell, each other), every ball is back
// inside the dome: a knock near the glass mustn't leave one through it.
function contain(st) {
  const R = DOME.radius - BALL_R;
  for (const id of BALLS) {
    const p = st.balls[id].pos;
    if (p[1] > TOP) p[1] = TOP;
    if (p[1] < BALL_R) p[1] = BALL_R;
    const rr = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
    if (rr > R) {
      p[0] = (p[0] / rr) * R;
      p[2] = (p[2] / rr) * R;
    }
  }
}

/**
 * A performance being played: `at(t)` is the state at loop moment t,
 * stepping on from the last call, or starting over when t is earlier.
 * The state it returns is live; don't keep it across calls.
 * @param {{ kind: string, at: number }[]} gestures
 */
export function createRun(gestures) {
  const order = gestures.map((g, i) => ({ g, i, s: stepOf(g.at) })).sort((a, b) => a.s - b.s || a.i - b.i);
  let st = restState();
  let steps = 0;
  let next = 0;
  return {
    at(t) {
      const want = stepOf(Math.min(Math.max(t, 0), LOOP));
      if (want < steps) {
        st = restState();
        steps = 0;
        next = 0;
      }
      while (steps < want) {
        const now = steps * STEP;
        while (next < order.length && order[next].s === steps) apply(st, order[next++].g, now);
        tick(st, now);
        contain(st);
        steps++;
      }
      return st;
    },
  };
}

/** The state at loop moment t, from rest. */
export const simulate = (gestures, t) => createRun(gestures).at(t);

/**
 * What a screen shows at loop moment t: the state, with every ball eased
 * home over the last GLIDE seconds (smoothstep, + - * only). A fresh
 * object; the state isn't changed.
 */
export function shown(st, t) {
  const from = LOOP - GLIDE;
  const e0 = t <= from ? 0 : Math.min(1, (t - from) / GLIDE);
  const e = e0 * e0 * (3 - 2 * e0);
  const balls = {};
  for (const id of BALLS) {
    const p = st.balls[id].pos, r = REST[id];
    const b = st.balls[id];
    balls[id] = { pos: [p[0] + (r[0] - p[0]) * e, p[1] + (r[1] - p[1]) * e, p[2] + (r[2] - p[2]) * e], by: b.by, byAt: b.byAt };
  }
  return { balls, bell: { rungAt: st.bell.rungAt } };
}
