// The Chime Tree set's rules (ADR 18): a ring of hanging chime tubes, each
// a note of one pentatonic scale, and a heavy striker ball on a cord from
// the middle. A tapped chime swings and sounds; a hard swing knocks the
// neighbour it swings towards, which sounds in turn, a little softer, so a
// cascade dies out. The striker swings on its cord (a pendulum about a
// fixed pivot, held to the cord's length by normalising with a square
// root) and strikes any chime it passes. A set plug-in
// (public/sets/README.md). Deterministic from the gestures and the loop
// moment alone; + - * / and Math.sqrt only (spec/stage.test.ts reads it).
import { STAGE, STEP, turnCos, turnSin } from "./kit.js";

/** The chimes, low to high: one octave of C major pentatonic, C5 to C6. Ids are
 * lowercase letters only, as the server checks. */
export const CHIMES = ["do", "re", "mi", "so", "la", "hido"];
/** Each chime's note in Hz, low to high (the view sounds them). */
export const NOTES = [523.25, 587.33, 659.26, 783.99, 880, 1046.5];

// ---- the tuning: all of it, in one place. Toy physics, tuned for fun.
const T = {
  /** the ring the chimes hang from: its radius and height */
  ringR: 0.8,
  ringY: 1.78,
  /** a chime's tube: the lowest note's length (higher notes are shorter,
   * as 1 / sqrt(pitch)) and its radius */
  longest: 0.92,
  tubeR: 0.042,
  /** a chime swings like a pendulum this stiff (rad/s for a 1 m tube) */
  stiff: 4.4,
  /** and loses this much of its swing a second */
  damp: 0.8,
  /** the widest a chime ever swings, in radians */
  maxSwing: 0.7,
  /** a tap swings a chime this far */
  tap: 0.22,
  /** a chime swinging past this angle knocks the neighbour it swings to */
  knockAt: 0.25,
  /** the neighbour swings this much of the knocker's speed */
  transfer: 0.9,
  /** and the knocker keeps this much of its own */
  keep: 0.85,
  /** each knock passes on this much of the chain it was given (a tap or a
   * strike gives 1), and a chain this weak knocks nothing: a cascade
   * reaches at most three chimes on, and always dies out */
  chain: 0.6,
  chainMin: 0.3,
  /** a swing this small (or a sound this soft) comes to rest */
  still: 0.01,
  hush: 0.05,
  /** the striker: its radius, where its cord hangs from, the cord */
  strikerR: 0.11,
  pivot: [0, 1.86, 0],
  cord: 1.04,
  /** gravity on the striker (gentler than Earth's: a slow, readable swing) */
  gravity: 7,
  /** speed lost to the air, per second, and to the pivot's friction */
  drag: 0.04,
  friction: 0.06,
  /** a strike: the chime swings this many radians per m/s of the
   * striker, which keeps this much of its speed; slower than strikeMin it
   * only brushes past */
  strike: 0.3,
  strikeKeep: 0.88,
  strikeMin: 0.25,
  /** a chime can't be struck twice within this long */
  strikeGap: 0.4,
  /** the striker comes to rest when this slow, this near its rest */
  settleV: 0.05,
  settleD: 0.06,
};

const N = CHIMES.length;
/** Each chime's tube length, its swing's stiffness, where it hangs and
 * which way it swings (along the ring: +1 towards the next chime). */
export const HANG = CHIMES.map((_, i) => {
  const len = T.longest * Math.sqrt(NOTES[0] / NOTES[i]);
  const c = turnCos(i / N);
  const s = turnSin(i / N);
  return { len, omega: T.stiff / Math.sqrt(len), top: [T.ringR * c, T.ringY, T.ringR * s], out: [c, 0, s], along: [-s, 0, c] };
});
/** The ring, the tubes and the striker, for the view. */
export const TREE = { ringR: T.ringR, ringY: T.ringY, tubeR: T.tubeR, strikerR: T.strikerR, pivot: T.pivot, cord: T.cord };
/** Where the striker hangs still. */
export const STRIKER_REST = [T.pivot[0], T.pivot[1] - T.cord, T.pivot[2]];

const TAU_TURNS = 1 / (2 * Math.PI);
/** A chime's bottom end, swung `th` radians along the ring. */
export function chimeEnd(i, th) {
  const h = HANG[i];
  const sn = turnSin(th * TAU_TURNS);
  const cs = turnCos(th * TAU_TURNS);
  return [h.top[0] + h.along[0] * h.len * sn, h.top[1] - h.len * cs, h.top[2] + h.along[2] * h.len * sn];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const swingOf = (c, i) => Math.sqrt(c.th * c.th + (c.w / HANG[i].omega) * (c.w / HANG[i].omega));

// ---- the step

function startState() {
  return {
    chimes: CHIMES.map(() => ({ th: 0, w: 0, arm: [0, 0], struck: -Infinity })),
    striker: { pos: [...STRIKER_REST], v: [0, 0, 0], still: true },
  };
}

/** Sets chime i swinging by `dw` more (rad/s), capped; says it sounds. */
function swing(st, i, dw, t, by, emit) {
  const c = st.chimes[i];
  const cap = T.maxSwing * HANG[i].omega;
  c.w = Math.max(-cap, Math.min(cap, c.w + dw));
  const power = Math.min(1, swingOf(c, i) / T.maxSwing);
  if (power >= T.hush) emit({ kind: "chime", object: CHIMES[i], by, power: Math.round(power * 100) / 100, pos: chimeEnd(i, c.th) });
}

function apply(st, g, t, emit) {
  if (g.kind === "throw") {
    const s = st.striker;
    s.pos = [...g.from];
    s.v = [...g.v];
    s.still = false;
    cord(s);
    emit({ kind: "throw", object: "striker", by: g.by, pos: [...s.pos] });
  } else if (g.kind === "tap") {
    const i = CHIMES.indexOf(g.object);
    const c = st.chimes[i];
    c.arm = [1, 1];
    swing(st, i, T.tap * HANG[i].omega, t, g.by, emit);
  }
}

/** The cord: never longer than its length. A striker past it is drawn
 * back onto the sphere round the pivot, losing its speed outward. */
function cord(s) {
  const d = sub(s.pos, T.pivot);
  const n = Math.sqrt(dot(d, d));
  if (n <= T.cord || n < 1e-9) return;
  const u = [d[0] / n, d[1] / n, d[2] / n];
  s.pos = [T.pivot[0] + u[0] * T.cord, T.pivot[1] + u[1] * T.cord, T.pivot[2] + u[2] * T.cord];
  const out = dot(s.v, u);
  if (out > 0) s.v = [s.v[0] - out * u[0], s.v[1] - out * u[1], s.v[2] - out * u[2]];
}

function tick(st, t, emit) {
  // the chimes swing, and a hard swing knocks the neighbour it swings to
  for (let i = 0; i < N; i++) {
    const c = st.chimes[i];
    if (c.th === 0 && c.w === 0) continue;
    const h = HANG[i];
    const was = c.th;
    c.w = c.w + (-h.omega * h.omega * c.th - T.damp * c.w) * STEP;
    c.th = c.th + c.w * STEP;
    if (Math.abs(c.th) < T.still && Math.abs(c.w) < T.still * h.omega) {
      c.th = 0;
      c.w = 0;
      continue;
    }
    // past the knock angle, swinging outward
    if (Math.abs(was) < T.knockAt && Math.abs(c.th) >= T.knockAt) {
      const side = c.th > 0 ? 1 : 0;
      if (c.arm[side] < T.chainMin) continue;
      const pass = c.arm[side] * T.chain;
      c.arm[side] = 0;
      const j = (i + (side ? 1 : -1) + N) % N;
      const n = st.chimes[j];
      // it swings away from the knocker and can knock on, more weakly
      n.arm[side] = Math.max(n.arm[side], pass);
      const dw = (side ? 1 : -1) * T.transfer * (Math.abs(c.w) / h.omega) * HANG[j].omega;
      c.w = c.w * T.keep;
      swing(st, j, dw, t, CHIMES[i], emit);
    }
  }
  // the striker swings on its cord
  const s = st.striker;
  if (s.still) return;
  s.v[1] -= T.gravity * STEP;
  const keep = 1 - T.drag * STEP;
  s.v[0] = s.v[0] * keep;
  s.v[1] = s.v[1] * keep;
  s.v[2] = s.v[2] * keep;
  const sp = Math.sqrt(dot(s.v, s.v));
  if (sp > 1e-9) {
    const k = Math.max(0, sp - T.friction * STEP) / sp;
    s.v = [s.v[0] * k, s.v[1] * k, s.v[2] * k];
  }
  s.pos = [s.pos[0] + s.v[0] * STEP, s.pos[1] + s.v[1] * STEP, s.pos[2] + s.v[2] * STEP];
  cord(s);
  // the ceiling (the cord keeps it off the floor and inside the stage)
  const top = STAGE.ceiling - T.strikerR;
  if (s.pos[1] > top) {
    s.pos[1] = top;
    if (s.v[1] > 0) s.v[1] = -s.v[1] * 0.5;
  }
  // striking a chime: the nearest point of its tube
  for (let i = 0; i < N; i++) {
    const c = st.chimes[i];
    const h = HANG[i];
    const end = chimeEnd(i, c.th);
    const axis = sub(end, h.top);
    const f = Math.max(0, Math.min(1, dot(sub(s.pos, h.top), axis) / (h.len * h.len)));
    const q = [h.top[0] + axis[0] * f, h.top[1] + axis[1] * f, h.top[2] + axis[2] * f];
    const d = sub(s.pos, q);
    const n = Math.sqrt(dot(d, d));
    const touch = T.strikerR + T.tubeR;
    if (n >= touch || t - c.struck < T.strikeGap) continue;
    // the heavy striker passes on, a little slower, and the light tube is
    // knocked out of its way, swinging the way the striker was going
    const sp = Math.sqrt(dot(s.v, s.v));
    if (sp < T.strikeMin) continue;
    c.struck = t;
    c.arm = [1, 1];
    const along = dot(s.v, h.along);
    const dir = along < 0 ? -1 : 1;
    s.v = [s.v[0] * T.strikeKeep, s.v[1] * T.strikeKeep, s.v[2] * T.strikeKeep];
    emit({ kind: "strike", object: "striker", other: CHIMES[i], speed: Math.round(sp * 100) / 100, pos: [...q] });
    swing(st, i, dir * Math.min(T.maxSwing, T.strike * sp) * h.omega, t, "striker", emit);
  }
  // and comes to rest, hanging still
  const r = sub(s.pos, STRIKER_REST);
  if (dot(s.v, s.v) < T.settleV * T.settleV && dot(r, r) < T.settleD * T.settleD) {
    s.pos = [...STRIKER_REST];
    s.v = [0, 0, 0];
    s.still = true;
  }
}

function copyState(st) {
  return {
    chimes: st.chimes.map((c) => ({ th: c.th, w: c.w, arm: [c.arm[0], c.arm[1]], struck: c.struck })),
    striker: { pos: [st.striker.pos[0], st.striker.pos[1], st.striker.pos[2]], v: [st.striker.v[0], st.striker.v[1], st.striker.v[2]], still: st.striker.still },
  };
}

/** What a screen draws: each chime's swing, and where the striker is. */
function view(st) {
  return { swing: st.chimes.map((c) => c.th), striker: [...st.striker.pos], still: st.striker.still };
}

/** Everything `e` of the way (0 to 1) back to rest: chimes hang straight,
 * the striker hangs under its pivot. */
function ease(v, e) {
  const p = v.striker;
  const r = STRIKER_REST;
  return { ...v, swing: v.swing.map((th) => th * (1 - e)), striker: [p[0] + (r[0] - p[0]) * e, p[1] + (r[1] - p[1]) * e, p[2] + (r[2] - p[2]) * e] };
}

/** @type {import("../stage.js").StageSet} */
export default {
  id: "chimes",
  name: "Chime Tree",
  objects: ["striker", ...CHIMES],
  holdable: ["striker"],
  gestures: {
    throw: { objects: ["striker"] },
    tap: { objects: CHIMES },
  },
  // pastel to metal, low to high (ivory, peach, coral, teal, deep teal,
  // chrome); the striker gold
  colour: { striker: 7, do: 0, re: 1, mi: 2, so: 3, la: 4, hido: 5 },
  strikerR: T.strikerR,
  startState,
  tick,
  apply,
  copyState,
  view,
  ease,
  positions: (v) => [v.striker, ...v.swing.map((th, i) => chimeEnd(i, th))],
  fingerprint: {
    gestures: [
      { kind: "tap", object: "so", at: 0.5, by: "aaaaaa" },
      { kind: "tap", object: "so", at: 0.7, by: "aaaaaa" },
      { kind: "tap", object: "mi", at: 1.5, by: "aaaaaa" },
      { kind: "throw", object: "striker", at: 2, from: [0.5, 1.4, 0], v: [0, 0.3, 2.4], by: "aaaaaa" },
      { kind: "tap", object: "hido", at: 4, by: "aaaaaa" },
      { kind: "throw", object: "striker", at: 6, from: [0.9, 1.6, 0.3], v: [-5, 2, -5], by: "aaaaaa" },
      { kind: "tap", object: "do", at: 9, by: "aaaaaa" },
      { kind: "tap", object: "la", at: 12.5, by: "aaaaaa" },
    ],
    hash: "1989398382823484377",
    events: 45,
  },
};
