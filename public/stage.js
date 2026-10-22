// The Loop Stage's rules (ADR 16; CLAUDE.md, "The museum"). One copy: the
// server imports it to refuse a gesture or a performance outside the
// bounds, the page imports it (served at /stage.js) to play performances,
// and spec/stage.test.ts holds it. Plain JS, no Three.js, so it runs in
// Node.
//
// A performance is a set of objects and a loop of gestures. Everything
// that happens on the stage is computed from those and the loop moment
// alone, by a fixed 60 Hz step from the start of the loop with no
// randomness, so every screen shows the same performance and no frame is
// ever a write. Everything here is + - * / and square roots, which IEEE 754
// rounds the same in every browser; no Math.sin or **, which engines may
// each approximate in their own way.

/** The colours an object can wear, by index: the gallery's palette. */
export const PALETTE = [
  { name: "ivory", hex: "#f4ead8" },
  { name: "peach", hex: "#f6b38e" },
  { name: "coral", hex: "#ef6f5e" },
  { name: "teal", hex: "#3fa7a3" },
  { name: "deep teal", hex: "#1f6f78" },
  { name: "chrome", hex: "#c9d1d6" },
  { name: "dusk", hex: "#7a6aa8" },
  { name: "gold", hex: "#e3b65b" },
];

/** The colours a visitor marker can take, by index (`VisitorView.colour`). */
export const VISITOR_COLOURS = ["#e2553f", "#2e8f8a", "#7b5cc4", "#d98a1c", "#3c7bd1", "#c2477e", "#5a9a3a", "#8a6a4a"];

/** The loop, in seconds: every gesture replays once per loop. */
export const LOOP = 30;
/** For this long at the end of each loop, every sphere eases back to where
 * it rests, so the loop comes round without a jump. */
export const GLIDE = 1.2;
/** The fixed step every screen simulates with. */
export const STEP = 1 / 60;
/** At most this many gestures in a loop, and this many from one visitor. */
export const CAP = 40;
export const CAP_EACH = 12;

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

/**
 * @typedef {[number, number, number]} Vec
 * @typedef {{ name: string, objects: string[], radius: number, ceiling: number, sphereR: number, rest: Record<string, Vec>, colour: Record<string, number> }} StageSet
 * @typedef {{ kind: string, object: string, at: number, from?: number[], v?: number[], u?: number, by?: string }} Gesture
 * @typedef {{ set: string, gestures: Gesture[] }} Performance
 * @typedef {{ pos: number[], riding: boolean, anchored: boolean, u: number }} SphereView
 * @typedef {{ t: number, spheres: Record<string, SphereView>, pulses: { u: number, age: number }[], lastRing: number | null, lastRingBy: string | null, home?: number }} StageView
 * @typedef {{ kind: string, object: string, t: number, pos: number[], by?: string, u?: number, other?: string }} StageEvent
 */

/** The sets of objects a performance can be played on.
 * @type {Record<string, StageSet>} */
export const SETS = {
  orbit: {
    name: "Orbit stage",
    objects: [...SPHERES, "ribbon", "bell"],
    /** spheres stay within this distance of the centre, under the ceiling */
    radius: 2.0,
    ceiling: 2.2,
    sphereR: T.sphereR,
    /** where each sphere waits, floating, until something moves it */
    rest: {
      chrome: [0.66, 0.3, 0.7],
      teal: [-0.7, 0.3, 0.45],
      gold: [0.42, 0.32, -0.18],
      dusk: [-0.35, 0.3, -0.72],
    },
    colour: { chrome: 5, teal: 3, gold: 7, dusk: 6, ribbon: 2, bell: 7 },
  },
};

const TAU = Math.PI * 2;

// Sine and cosine of a whole number of turns `x` (sin(x * TAU)), from
// + - * / only, so every browser computes the same bits (CLAUDE.md: Math.sin
// may differ in the last digit between engines). The turn is cut to its
// nearest quarter, then a Taylor series runs over a small angle, good to
// about 1e-13: plenty for a ribbon's curve, and the same everywhere.
function turnSin(x) {
  const k = Math.round(x * 4); // nearest quarter turn
  const f = (x - k / 4) * TAU; // |f| <= pi/4
  const f2 = f * f;
  const s = f * (1 - (f2 / 6) * (1 - (f2 / 20) * (1 - (f2 / 42) * (1 - (f2 / 72) * (1 - (f2 / 110) * (1 - f2 / 156))))));
  const c = 1 - (f2 / 2) * (1 - (f2 / 12) * (1 - (f2 / 30) * (1 - (f2 / 56) * (1 - (f2 / 90) * (1 - f2 / 132)))));
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? s : q === 1 ? c : q === 2 ? -s : -c;
}
const turnCos = (x) => turnSin(x + 0.25);

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

/** A silent performance on a set.
 * @param {string} set @returns {Performance} */
export function emptyPerformance(set) {
  if (!Object.hasOwn(SETS, set)) throw new Error(`no set ${set}`);
  return { set, gestures: [] };
}

// ---- checking what arrives

/** @param {string} reason @returns {{ ok: false, reason: string }} */
const no = (reason) => ({ ok: false, reason });
/** @type {{ ok: true }} */
const YES = { ok: true };

const snap = (v, step) => Number((Math.round(v / step) * step).toFixed(4));
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const vec = (v, lo, hi) => Array.isArray(v) && v.length === 3 && v.every((x, i) => finite(x) && x >= lo[i] && x <= hi[i]);

const SHAPES = {
  throw: { keys: ["kind", "object", "at", "from", "v"], objects: SPHERES },
  pluck: { keys: ["kind", "object", "at", "u"], objects: ["ribbon"] },
  tap: { keys: ["kind", "object", "at"], objects: ["bell"] },
};
const FROM_LO = [-2.1, 0, -2.1];
const FROM_HI = [2.1, 2.4, 2.1];
const V_MAX = 6;

/**
 * Checks one gesture as the page sends it (no `by`: the server adds who).
 * Returns it snapped, or the reason it's refused. Unknown kinds, objects
 * and keys are refused, never ignored; out of range is refused, never
 * clamped. Own keys only, so `constructor` is never a field.
 * @returns {{ ok: true, gesture: Gesture } | { ok: false, reason: string }}
 */
/** @param {string} set @param {any} g */
export function checkGesture(set, g) {
  if (!Object.hasOwn(SETS, set)) return no("unknown set");
  if (typeof g !== "object" || g === null || Array.isArray(g)) return no("a gesture must be an object");
  const shape = Object.hasOwn(SHAPES, g.kind) ? SHAPES[g.kind] : null;
  if (!shape) return no("unknown gesture");
  const keys = Object.keys(g);
  const extra = keys.filter((k) => !shape.keys.includes(k));
  if (extra.length) return no(`unexpected ${extra.join(", ")}`);
  if (shape.keys.some((k) => !Object.hasOwn(g, k))) return no("missing a field");
  if (!shape.objects.includes(g.object) || !SETS[set].objects.includes(g.object)) return no(`can't ${g.kind} that`);
  if (!finite(g.at) || g.at < 0 || g.at >= LOOP) return no(`at must be from 0 to under ${LOOP}`);
  /** @type {Gesture} */
  const out = { kind: g.kind, object: g.object, at: Math.min(snap(g.at, 0.001), LOOP - 0.001) };
  if (g.kind === "throw") {
    if (!vec(g.from, FROM_LO, FROM_HI)) return no("from must be a point on the stage");
    if (!vec(g.v, [-V_MAX, -V_MAX, -V_MAX], [V_MAX, V_MAX, V_MAX])) return no(`v must be three speeds up to ${V_MAX}`);
    out.from = g.from.map((x) => snap(x, 0.001));
    out.v = g.v.map((x) => snap(x, 0.001));
  }
  if (g.kind === "pluck") {
    if (!finite(g.u) || g.u < 0 || g.u >= 1) return no("u must be from 0 to under 1");
    out.u = Math.min(snap(g.u, 0.001), 0.999);
  }
  return { ok: /** @type {const} */ (true), gesture: /** @type {Gesture} */ (out) };
}

const TAG = /^[0-9a-f]{6}$/;

/**
 * Checks a whole performance, as stored or copied from an exhibit: a known
 * set, at most CAP gestures and CAP_EACH from anyone, each one valid and
 * already snapped, with its author's tag.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
/** @param {any} p */
export function checkPerformance(p) {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return no("a performance must be an object");
  if (!Object.hasOwn(SETS, p.set)) return no("unknown set");
  if (Object.keys(p).length !== 2 || !Array.isArray(p.gestures)) return no("a performance is a set and gestures");
  if (p.gestures.length > CAP) return no(`at most ${CAP} gestures`);
  const each = new Map();
  for (const g of p.gestures) {
    if (typeof g !== "object" || g === null || !TAG.test(g.by)) return no("every gesture says who made it");
    const { by, ...rest } = g;
    const r = checkGesture(p.set, rest);
    if (!r.ok) return r;
    if (JSON.stringify(r.gesture) !== JSON.stringify(rest)) return no("a gesture isn't snapped");
    each.set(by, (each.get(by) ?? 0) + 1);
    if (each.get(by) > CAP_EACH) return no(`at most ${CAP_EACH} gestures from anyone`);
  }
  return YES;
}

/**
 * The loop after a gesture is added at the end: past CAP_EACH from one
 * visitor their own oldest goes, then past CAP the oldest of all. So
 * nobody can push someone else's gestures out by mashing a button.
 */
/** @template {{ by?: string }} G @param {G[]} gestures @returns {G[]} */
export function keepNewest(gestures) {
  const out = [...gestures];
  const count = new Map();
  for (const g of out) count.set(g.by, (count.get(g.by) ?? 0) + 1);
  for (const [by, n] of count) {
    for (let k = n; k > CAP_EACH; k--) out.splice(out.findIndex((g) => g.by === by), 1);
  }
  while (out.length > CAP) out.shift();
  return out;
}

// ---- playing a performance

/** The stage at the start of every loop: every sphere floating at rest. */
function startState(set) {
  const s = SETS[set];
  const spheres = {};
  for (const id of SPHERES) spheres[id] = { pos: [...s.rest[id]], v: [0, 0, 0], anchored: true, riding: false, u: 0, dir: 1, free: -Infinity };
  return { step: 0, spheres, pulses: [], lastRing: null, lastRingBy: null };
}

// Gestures by the step they land on, in the order they were made.
function schedule(p) {
  const at = new Map();
  for (const g of p.gestures) {
    const k = Math.round(g.at / STEP);
    if (!at.has(k)) at.set(k, []);
    at.get(k).push(g);
  }
  return at;
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

function ring(st, t, by, emit) {
  st.lastRing = t;
  st.lastRingBy = by;
  emit({ kind: "ring", object: "bell", by, pos: [...BELL.pos] });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function tick(st, set, emit) {
  const S = SETS[set];
  const t = st.step * STEP;
  const R = S.radius - T.sphereR;
  const top = S.ceiling - T.sphereR;
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

// A deep copy of the stage's state, for a snapshot: copying moves no bits.
function copyState(st) {
  const spheres = {};
  for (const id of SPHERES) {
    const s = st.spheres[id];
    spheres[id] = { pos: [s.pos[0], s.pos[1], s.pos[2]], v: [s.v[0], s.v[1], s.v[2]], anchored: s.anchored, riding: s.riding, u: s.u, dir: s.dir, free: s.free };
  }
  return { step: st.step, spheres, pulses: st.pulses.map((q) => ({ u: q.u, t: q.t, hit: [...q.hit] })), lastRing: st.lastRing, lastRingBy: st.lastRingBy };
}

/** A snapshot of the stage is kept every this many steps (1 s). */
const SNAP_EVERY = 60;
const LAST_STEP = Math.round(LOOP / STEP) - 1;

/**
 * @typedef {{ snaps: { st: any, n: number }[], log: StageEvent[] }} RunBase
 * @typedef {{ at(t: number): { stage: StageView, events: StageEvent[] }, base(k: number): RunBase }} Run
 */

/**
 * A performance being played: `at(t)` advances to loop moment t (0 to
 * LOOP), stepping on from where it was when it can, and when t goes back
 * (the loop came round) starts again from the latest snapshot at or before
 * it. It returns the stage and the events since the last call, for flashes
 * and sounds; after going back, every event since the start of the loop,
 * as a fresh replay would.
 *
 * Every SNAP_EVERY steps the run keeps a copy of the stage. `base(k)` hands
 * on the snapshots (and the stage now) from before step k, with the events
 * up to each: a performance whose gestures differ from this one's only at
 * step k or later starts from them (`createRun(p, base)`), since nothing
 * before step k can tell the two apart. Either way every stage and event
 * is exactly what a replay from rest gives, bit for bit.
 */
/** @param {Performance} p @param {RunBase} [from] @returns {Run} */
export function createRun(p, from) {
  const sched = schedule(p);
  /** @type {any} */
  let st = null;
  const snaps = from ? [...from.snaps] : [];
  const log = from ? [...from.log] : [];
  // how much of the log has been handed out
  let told = 0;
  const emitAt = (e) => log.push({ ...e, t: st.step * STEP });
  const land = () => {
    for (const g of sched.get(st.step) ?? []) apply(st, g, st.step * STEP, emitAt);
  };
  const steps = (k) => {
    while (st.step < k) {
      st.step++;
      tick(st, p.set, emitAt);
      land();
      if (st.step % SNAP_EVERY === 0) snaps.push({ st: copyState(st), n: log.length });
    }
  };
  // back to the latest snapshot at or before step k (or rest, before any)
  const restore = (k) => {
    let j = snaps.length - 1;
    while (j >= 0 && snaps[j].st.step > k) j--;
    if (j < 0) {
      snaps.length = 0;
      log.length = 0;
      st = startState(p.set);
      // gestures at step 0 land before anything moves
      land();
      snaps.push({ st: copyState(st), n: log.length });
    } else {
      snaps.length = j + 1;
      log.length = snaps[j].n;
      st = copyState(snaps[j].st);
    }
    told = 0;
  };
  return {
    at(t) {
      const k = Math.max(0, Math.min(Math.floor(t / STEP + 1e-9), LAST_STEP));
      if (st === null || k < st.step) restore(k);
      steps(k);
      const events = log.slice(told);
      told = log.length;
      return { stage: view(st), events };
    },
    base(k) {
      const out = { snaps: snaps.filter((s) => s.st.step < k), log: [] };
      if (st !== null && st.step < k && st.step > (out.snaps.at(-1)?.st.step ?? -1)) out.snaps.push({ st: copyState(st), n: log.length });
      out.log = log.slice(0, out.snaps.at(-1)?.n ?? 0);
      return out;
    },
  };
}

// Two gestures are the same when every field is (what JSON would show).
function sameGesture(a, b) {
  let n = 0;
  for (const key in a) {
    n++;
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    } else if (x !== y) return false;
  }
  for (const _ in b) n--;
  return n === 0;
}
const copyGesture = (g) => {
  const out = {};
  for (const key in g) out[key] = Array.isArray(g[key]) ? [...g[key]] : g[key];
  return out;
};

// The first step at which two loops' gestures differ (in what lands, or
// the order it lands in), or Infinity if they're the same.
function firstChange(a, b) {
  const sa = schedule({ gestures: a });
  const sb = schedule({ gestures: b });
  let first = Infinity;
  for (const [k, ga] of sa) {
    const gb = sb.get(k);
    if (!gb || gb.length !== ga.length || ga.some((g, i) => !sameGesture(g, gb[i]))) first = Math.min(first, k);
  }
  for (const k of sb.keys()) if (!sa.has(k)) first = Math.min(first, k);
  return first;
}

/**
 * Follows one performance as its gestures change, for a screen that plays
 * it every frame: `follow()(p)` gives the run to play `p` with, and whether
 * it's a fresh one (the gestures changed). Gestures are compared by value,
 * however they arrive (a new array, the same array changed, the server's
 * copy), and a fresh run starts from the latest snapshot the change can't
 * have touched, never replaying more than it must.
 */
/** @returns {(p: Performance) => { run: Run, fresh: boolean }} */
export function follow() {
  /** @type {Run | null} */
  let run = null;
  let set = "";
  /** @type {Gesture[]} */
  let seen = [];
  return (p) => {
    const g = p.gestures;
    const same = run !== null && p.set === set && g.length === seen.length && g.every((x, i) => sameGesture(x, seen[i]));
    if (same && run) return { run, fresh: false };
    const k = run !== null && p.set === set ? firstChange(seen, g) : 0;
    run = createRun(p, run && k > 0 ? run.base(k) : undefined);
    set = p.set;
    seen = g.map(copyGesture);
    return { run, fresh: true };
  };
}

function view(st) {
  const spheres = {};
  for (const id of SPHERES) {
    const s = st.spheres[id];
    spheres[id] = { pos: [...s.pos], riding: s.riding, anchored: s.anchored, u: s.u };
  }
  return { t: st.step * STEP, spheres, pulses: st.pulses.map((p) => ({ u: p.u, age: st.step * STEP - p.t })), lastRing: st.lastRing, lastRingBy: st.lastRingBy };
}

/** The stage at loop moment t.
 * @param {Performance} p @param {number} t @returns {StageView} */
export const simulate = (p, t) => createRun(p).at(t).stage;

/**
 * What a screen shows of a stage at loop moment t: the stage itself, except
 * in the last GLIDE of the loop, where each sphere eases from where it is
 * back to where it rests, so the next loop starts where this one ended.
 * Smoothstep on + - * only, so every engine shows the same.
 * @param {StageView} stage @param {string} set @param {number} t @returns {StageView}
 */
export function ease(stage, set, t) {
  const from = LOOP - GLIDE;
  if (t < from) return stage;
  const k = Math.min(1, (t - from) / GLIDE);
  const e = k * k * (3 - 2 * k);
  const rest = SETS[set].rest;
  const spheres = {};
  for (const id of SPHERES) {
    const s = stage.spheres[id];
    const r = rest[id];
    spheres[id] = { ...s, riding: false, pos: [s.pos[0] + (r[0] - s.pos[0]) * e, s.pos[1] + (r[1] - s.pos[1]) * e, s.pos[2] + (r[2] - s.pos[2]) * e] };
  }
  return { ...stage, spheres, home: e };
}

/** What a screen shows at loop moment t (see ease).
 * @param {Performance} p @param {number} t @returns {StageView} */
export const shownAt = (p, t) => ease(simulate(p, t), p.set, t);

/** Everything that happened from loop moment t0 up to t1.
 * @param {Performance} p @param {number} t0 @param {number} t1 @returns {StageEvent[]} */
export function events(p, t0, t1) {
  return createRun(p)
    .at(t1)
    .events.filter((e) => e.t >= t0 - 1e-9 && e.t < t1);
}

/** The loop moment at shared time `seconds`. */
export const loopMoment = (seconds) => ((seconds % LOOP) + LOOP) % LOOP;
