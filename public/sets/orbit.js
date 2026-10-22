// The Orbit set's rules (ADR 15, 16, 18): four spheres that fall upward, a
// ribbon round the stage that catches them, and a bell. A set plug-in: the
// shape is described in public/sets/README.md, and public/stage.js plays
// it. Deterministic from the gestures and the loop moment alone; + - * /
// and Math.sqrt only (spec/stage.test.ts reads this file).
import { STAGE, STEP, turnCos, turnSin } from "./kit.js";

// Part ids are lowercase letters only, as the server checks.
export const SPHERES = ["chrome", "teal", "gold", "dusk"];

// ---- the tuning: all of it, in one place. Toy physics, tuned for fun.
const T = {
  sphereR: 0.17,
  /** spheres fall upward */
  lift: 0.55,
  /** speed lost to the air, per second */
  drag: 0.55,
  /** how much bounce survives a ceiling, floor or wall */
  bounce: 0.55,
  /** a sphere this close to the ribbon's path is caught */
  catchR: 0.14,
  /** and rides it at this many loops of the path per second */
  ride: 0.08,
  /** a pluck's pulse runs round the ribbon at this many loops per second */
  pulse: 1.0,
  /** a sphere just flung, hopped or knocked can't be caught for this long */
  cooldown: 0.9,
  /** a flung sphere leaves outward and up at these speeds */
  flingOut: 1.3,
  flingUp: 1.0,
  /** the bell hops nearby spheres away at this speed, and a little up */
  hop: 1.5,
  hopUp: 0.6,
  /** the bell can't ring twice from collisions within this long */
  ringGap: 0.25,
  /** a sphere hitting the bell slides off it sideways at this speed */
  slide: 0.9,
};
// which way a sphere slides off when it hits the bell dead centre: fixed
// per sphere, so it's the same on every screen
const SIDE = { chrome: [1, 0], teal: [0, 1], gold: [-1, 0], dusk: [0, -1] };

/** The bell: where it hangs, how big it is, and how far its ring reaches. */
export const BELL = { pos: [0, 0.75, 0], r: 0.16, reach: 0.7 };

/** The ribbon: a closed loop round the stage that dips and rises. */
export const RIBBON = { radius: 1, height: 0.95, swing: 0.42, turns: 2, breathe: 0.22 };

/** Where each sphere waits, floating, until something moves it. */
const REST = {
  chrome: [0.66, 0.3, 0.7],
  teal: [-0.7, 0.3, 0.45],
  gold: [0.42, 0.32, -0.18],
  dusk: [-0.35, 0.3, -0.72],
};

/** A point on the ribbon's path at u in [0, 1). */
export function ribbonPoint(u) {
  const w = turnSin(RIBBON.turns * u);
  const r = RIBBON.radius * (1 - RIBBON.breathe * w);
  return [r * turnCos(u), RIBBON.height + RIBBON.swing * w, r * turnSin(u)];
}

// The path sampled once; the step looks points up here, never calls trig.
const PATH_N = 480;
const PATH = Array.from({ length: PATH_N }, (_, i) => ribbonPoint(i / PATH_N));
const pathAt = (u) => {
  const f = (((u % 1) + 1) % 1) * PATH_N;
  const i = Math.floor(f);
  const k = f - i;
  const a = PATH[i % PATH_N];
  const b = PATH[(i + 1) % PATH_N];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
// the ribbon's reach, for a cheap test before looking along it
const R_MIN = RIBBON.radius * (1 - RIBBON.breathe) - T.catchR;
const R_MAX = RIBBON.radius * (1 + RIBBON.breathe) + T.catchR;
const Y_MIN = RIBBON.height - RIBBON.swing - T.catchR;
const Y_MAX = RIBBON.height + RIBBON.swing + T.catchR;

/** The nearest point of the path to p, if it's within the catch. */
function catchOf(p) {
  const rr = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
  if (rr < R_MIN || rr > R_MAX || p[1] < Y_MIN || p[1] > Y_MAX) return null;
  let best = -1;
  let bestD = T.catchR * T.catchR;
  for (let i = 0; i < PATH_N; i += 2) {
    const q = PATH[i];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best / PATH_N;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- the step

/** The stage at the start of every loop: every sphere floating at rest. */
function startState() {
  const spheres = {};
  for (const id of SPHERES) spheres[id] = { pos: [...REST[id]], v: [0, 0, 0], anchored: true, riding: false, u: 0, dir: 1, free: -Infinity };
  return { spheres, pulses: [], lastRing: null, lastRingBy: null };
}

function ring(st, t, by, emit) {
  st.lastRing = t;
  st.lastRingBy = by;
  emit({ kind: "ring", object: "bell", by, pos: [...BELL.pos] });
}

function apply(st, g, t, emit) {
  if (g.kind === "throw") {
    const s = st.spheres[g.object];
    s.pos = [...g.from];
    s.v = [...g.v];
    s.anchored = false;
    s.riding = false;
    // a throw is aimed: the ribbon may catch it at once
    s.free = -Infinity;
    emit({ kind: "throw", object: g.object, by: g.by, pos: [...s.pos] });
  } else if (g.kind === "pluck") {
    st.pulses.push({ u: g.u, t, hit: [] });
    emit({ kind: "pluck", object: "ribbon", by: g.by, u: g.u, pos: pathAt(g.u) });
  } else if (g.kind === "tap") {
    ring(st, t, g.by, emit);
    for (const id of SPHERES) {
      const s = st.spheres[id];
      const d = sub(s.pos, BELL.pos);
      const n = Math.sqrt(dot(d, d));
      if (n > BELL.reach || n < 1e-9) continue;
      s.v = [(d[0] / n) * T.hop, (d[1] / n) * T.hop + T.hopUp, (d[2] / n) * T.hop];
      s.anchored = false;
      s.riding = false;
      s.free = t;
      emit({ kind: "hop", object: id, by: g.by, pos: [...s.pos] });
    }
  }
}

function tick(st, t, emit) {
  const R = STAGE.radius - T.sphereR;
  const top = STAGE.ceiling - T.sphereR;
  for (const id of SPHERES) {
    const s = st.spheres[id];
    if (s.anchored) continue;
    if (s.riding) {
      s.u = (((s.u + s.dir * T.ride * STEP) % 1) + 1) % 1;
      s.pos = pathAt(s.u);
      continue;
    }
    // fall upward, through air
    s.v[1] += T.lift * STEP;
    const keep = 1 - T.drag * STEP;
    // in place: the same sums as making new vectors, without the garbage
    // (a sphere's pos and v are its own; anything handed out is a copy)
    s.v[0] = s.v[0] * keep;
    s.v[1] = s.v[1] * keep;
    s.v[2] = s.v[2] * keep;
    s.pos[0] = s.pos[0] + s.v[0] * STEP;
    s.pos[1] = s.pos[1] + s.v[1] * STEP;
    s.pos[2] = s.pos[2] + s.v[2] * STEP;
    // the ceiling, the floor and the round wall
    if (s.pos[1] > top) {
      s.pos[1] = top;
      if (s.v[1] > 0) s.v[1] = -s.v[1] * T.bounce;
    }
    if (s.pos[1] < T.sphereR) {
      s.pos[1] = T.sphereR;
      if (s.v[1] < 0) s.v[1] = -s.v[1] * T.bounce;
    }
    const rr = Math.sqrt(s.pos[0] * s.pos[0] + s.pos[2] * s.pos[2]);
    if (rr > R) {
      const nx = s.pos[0] / rr;
      const nz = s.pos[2] / rr;
      s.pos[0] = nx * R;
      s.pos[2] = nz * R;
      const vn = s.v[0] * nx + s.v[2] * nz;
      if (vn > 0) {
        s.v[0] -= (1 + T.bounce) * vn * nx;
        s.v[2] -= (1 + T.bounce) * vn * nz;
      }
    }
    // the bell: a sphere that hits it bounces off and rings it
    const d = sub(s.pos, BELL.pos);
    const n = Math.sqrt(dot(d, d));
    const touch = T.sphereR + BELL.r;
    if (n < touch && n > 1e-9) {
      const nn = [d[0] / n, d[1] / n, d[2] / n];
      s.pos = [BELL.pos[0] + nn[0] * touch, BELL.pos[1] + nn[1] * touch, BELL.pos[2] + nn[2] * touch];
      const vn = dot(s.v, nn);
      if (vn < 0) s.v = [s.v[0] - 1.8 * vn * nn[0], s.v[1] - 1.8 * vn * nn[1], s.v[2] - 1.8 * vn * nn[2]];
      // and sideways off the bell's dome, so a sphere rising straight under
      // it slides off instead of being held there ringing forever
      const side = Math.sqrt(nn[0] * nn[0] + nn[2] * nn[2]);
      const kick = side > 0.05 ? [nn[0] / side, nn[2] / side] : SIDE[id];
      s.v[0] += kick[0] * T.slide;
      s.v[2] += kick[1] * T.slide;
      if (st.lastRing === null || t - st.lastRing > T.ringGap) ring(st, t, id, emit);
    }
    // the ribbon catches a sphere that passes close, unless just flung off
    if (t - s.free >= T.cooldown) {
      const u = catchOf(s.pos);
      if (u !== null) {
        const ahead = sub(pathAt(u + 0.002), pathAt(u));
        s.dir = dot(ahead, s.v) >= 0 ? 1 : -1;
        s.riding = true;
        s.u = u;
        s.pos = pathAt(u);
        s.v = [0, 0, 0];
        emit({ kind: "catch", object: id, pos: [...s.pos] });
      }
    }
  }
  // spheres knock into each other; one at rest is set going
  for (let i = 0; i < SPHERES.length; i++) {
    for (let j = i + 1; j < SPHERES.length; j++) {
      const a = st.spheres[SPHERES[i]];
      const b = st.spheres[SPHERES[j]];
      if (a.riding || b.riding || (a.anchored && b.anchored)) continue;
      const d = sub(b.pos, a.pos);
      const n = Math.sqrt(dot(d, d));
      if (n >= 2 * T.sphereR || n < 1e-9) continue;
      const nn = [d[0] / n, d[1] / n, d[2] / n];
      const push = (2 * T.sphereR - n) / 2;
      a.pos = [a.pos[0] - nn[0] * push, a.pos[1] - nn[1] * push, a.pos[2] - nn[2] * push];
      b.pos = [b.pos[0] + nn[0] * push, b.pos[1] + nn[1] * push, b.pos[2] + nn[2] * push];
      const rel = dot(sub(a.v, b.v), nn);
      if (rel <= 0) continue;
      // equal masses: they trade the speed along the line between them
      a.v = [a.v[0] - rel * nn[0], a.v[1] - rel * nn[1], a.v[2] - rel * nn[2]];
      b.v = [b.v[0] + rel * nn[0], b.v[1] + rel * nn[1], b.v[2] + rel * nn[2]];
      for (const s of [a, b]) {
        if (s.anchored) {
          s.anchored = false;
          s.free = t;
        }
      }
      if (rel > 0.05) emit({ kind: "knock", object: SPHERES[i], other: SPHERES[j], pos: [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2] });
    }
  }
  // a pluck's pulse runs both ways round the ribbon and flings off riders
  for (const p of st.pulses) {
    const front = (t - p.t) * T.pulse;
    if (front > 0.5 + T.ride) continue;
    const w = (T.pulse + T.ride) * STEP;
    for (const id of SPHERES) {
      const s = st.spheres[id];
      if (!s.riding || p.hit.includes(id)) continue;
      const du = Math.abs(s.u - p.u);
      const d = Math.min(du, 1 - du);
      if (front < d - w || front > d + w) continue;
      p.hit.push(id);
      const at = s.pos;
      const rr = Math.sqrt(at[0] * at[0] + at[2] * at[2]) || 1;
      s.riding = false;
      s.free = t;
      s.v = [(at[0] / rr) * T.flingOut, T.flingUp, (at[2] / rr) * T.flingOut];
      emit({ kind: "fling", object: id, pos: [...at] });
    }
  }
}

// A deep copy of the state, for a snapshot: copying moves no bits.
function copyState(st) {
  const spheres = {};
  for (const id of SPHERES) {
    const s = st.spheres[id];
    spheres[id] = { pos: [s.pos[0], s.pos[1], s.pos[2]], v: [s.v[0], s.v[1], s.v[2]], anchored: s.anchored, riding: s.riding, u: s.u, dir: s.dir, free: s.free };
  }
  return { spheres, pulses: st.pulses.map((q) => ({ u: q.u, t: q.t, hit: [...q.hit] })), lastRing: st.lastRing, lastRingBy: st.lastRingBy };
}

/** What a screen draws (a fresh object; nothing shared with the state). */
function view(st, t) {
  const spheres = {};
  for (const id of SPHERES) {
    const s = st.spheres[id];
    spheres[id] = { pos: [...s.pos], riding: s.riding, anchored: s.anchored, u: s.u };
  }
  return { spheres, pulses: st.pulses.map((p) => ({ u: p.u, age: t - p.t })), lastRing: st.lastRing, lastRingBy: st.lastRingBy };
}

/** Each sphere `e` of the way (0 to 1) from where it is back to rest. */
function ease(v, e) {
  const spheres = {};
  for (const id of SPHERES) {
    const s = v.spheres[id];
    const r = REST[id];
    spheres[id] = { ...s, riding: false, pos: [s.pos[0] + (r[0] - s.pos[0]) * e, s.pos[1] + (r[1] - s.pos[1]) * e, s.pos[2] + (r[2] - s.pos[2]) * e] };
  }
  return { ...v, spheres };
}

/** @type {import("../stage.js").StageSet} */
export default {
  id: "orbit",
  name: "Orbit stage",
  objects: [...SPHERES, "ribbon", "bell"],
  holdable: SPHERES,
  gestures: {
    throw: { objects: SPHERES },
    pluck: { objects: ["ribbon"], fields: { u: { lo: 0, below: 1, step: 0.001 } } },
    tap: { objects: ["bell"] },
  },
  // kept for the page and old callers: the stage's size and a sphere's
  radius: STAGE.radius,
  ceiling: STAGE.ceiling,
  sphereR: T.sphereR,
  rest: REST,
  colour: { chrome: 5, teal: 3, gold: 7, dusk: 6, ribbon: 2, bell: 7 },
  startState,
  tick,
  apply,
  copyState,
  view,
  ease,
  positions: (v) => SPHERES.map((id) => v.spheres[id].pos),
  fingerprint: {
    gestures: [
      { kind: "throw", object: "teal", at: 0.5, from: [-0.62, 0.95, 0], v: [-0.9, 0, 0], by: "aaaaaa" },
      { kind: "throw", object: "gold", at: 1, from: [-0.6, 0.3, -0.2], v: [2.2, 0.2, 0.1], by: "aaaaaa" },
      { kind: "tap", object: "bell", at: 2, by: "aaaaaa" },
      { kind: "throw", object: "dusk", at: 3, from: [0, 0.15, 0], v: [0, 1.8, 0], by: "aaaaaa" },
      { kind: "pluck", object: "ribbon", at: 5, u: 0.5, by: "aaaaaa" },
      { kind: "throw", object: "chrome", at: 6.5, from: [1.2, 0.3, 0.6], v: [-2, 0.3, -0.6], by: "aaaaaa" },
      { kind: "tap", object: "bell", at: 9, by: "aaaaaa" },
    ],
    hash: "236435486642795239",
    events: 15,
    // the ribbon's path, which the engines check compares too
    statics: () => Array.from({ length: 480 }, (_, i) => ribbonPoint(i / 480)),
  },
};
