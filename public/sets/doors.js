// The Swap Doors set's rules (ADR 18): two free-standing door frames joined
// to each other, and three bouncy balls under ordinary gravity. A ball that
// passes through one door's opening comes out of the other, same speed,
// turned by how the doors face each other (a portal). Tap a door and it
// turns a quarter about its upright, so every trick shot through it goes
// somewhere new. A set plug-in (public/sets/README.md), played by
// public/stage.js. Deterministic from the gestures and the loop moment
// alone; + - * / and Math.sqrt only (spec/stage.test.ts reads this file).
import { GLIDE, LOOP, STAGE, STEP, turnCos, turnSin } from "./kit.js";

// Object ids are lowercase letters only, and unique across every set (the
// page finds a name or a held look by id), so no "teal" or "gold" here.
export const BALLS = ["apricot", "lemon", "plum"];
export const DOORS = ["coraldoor", "tealdoor"];

// ---- the tuning: all of it, in one place. Toy physics, tuned for fun.
const T = {
  ballR: 0.1,
  /** gentler than Earth's, so a throw hangs long enough to follow */
  gravity: 6.5,
  /** speed lost to the air, per second */
  drag: 0.06,
  /** how much bounce survives the floor, the wall, the ceiling, a frame */
  floorBounce: 0.8,
  wallBounce: 0.75,
  frameBounce: 0.7,
  /** below this upward speed off the floor a ball stops bouncing and rolls */
  settle: 0.55,
  /** a rolling ball loses this much speed per second */
  roll: 1.1,
  /** slower than this, a rolling ball stops */
  stop: 0.04,
  /** a ball just through a door can't go through one again for this long */
  cooldown: 0.4,
  /** two balls keep this much of their closing speed when they knock */
  knockBounce: 0.92,
  /** a bounce this hard or harder is heard */
  tick: 0.9,
};

/** A door frame: posts this far either side of its middle, a lintel this
 * high (centre of the bar), bars this thick. The opening is between the
 * posts and under the lintel; the frame's top is at `H + bar`. */
export const FRAME = { half: 0.35, H: 0.86, bar: 0.035 };

/** A door's facing is one of 8 eighth-turns, so its orientation is exact.
 * Facing k points the opening's front along (FACE[k][0], 0, FACE[k][1]). */
export const FACINGS = 8;
export const FACE = Array.from({ length: FACINGS }, (_, k) => [turnCos(k / FACINGS), turnSin(k / FACINGS)]);
/** A tap turns a door by this many eighths: a quarter turn. */
const QUARTER = FACINGS / 4;

/** Where each door stands (the middle of its threshold) and how it faces
 * at the start of every loop: a V opening toward the visitor's start. */
export const DOOR_AT = { coraldoor: [-0.8, 0, -0.25], tealdoor: [0.8, 0, -0.25] };
export const DOOR_REST = { coraldoor: 1, tealdoor: 3 };
/** Each door's other end. */
const OTHER = { coraldoor: "tealdoor", tealdoor: "coraldoor" };

/** Where each ball rests, on the floor in front of the doors. */
export const REST = {
  apricot: [-0.55, T.ballR, 0.85],
  lemon: [0, T.ballR, 1.15],
  plum: [0.55, T.ballR, 0.85],
};
export const BALL_R = T.ballR;
export const GRAVITY = T.gravity;

/** A point a post's width in front of a door at facing `turn` (eighths,
 * whole or not, as the view has it). */
export function frontOf(id, turn) {
  const c = DOOR_AT[id];
  return [c[0] + turnCos(turn / FACINGS) * FRAME.half, FRAME.H / 2, c[2] + turnSin(turn / FACINGS) * FRAME.half];
}

const wrap8 = (k) => ((k % FACINGS) + FACINGS) % FACINGS;
// a door's tangent (along the threshold, post to post) for facing k
const tangent = (k) => [-FACE[k][1], FACE[k][0]];

/** The ends of a door's three bars (two posts and the lintel) at facing k. */
function bars(id, k) {
  const c = DOOR_AT[id];
  const t = tangent(k);
  const L = [c[0] - t[0] * FRAME.half, c[2] - t[1] * FRAME.half];
  const R = [c[0] + t[0] * FRAME.half, c[2] + t[1] * FRAME.half];
  return [
    [[L[0], 0, L[1]], [L[0], FRAME.H, L[1]]],
    [[R[0], 0, R[1]], [R[0], FRAME.H, R[1]]],
    [[L[0], FRAME.H, L[1]], [R[0], FRAME.H, R[1]]],
  ];
}

/**
 * What a door does to a ball going through it: where it comes out and how
 * it's turned. Going in at `from` (door `from`, facing kA) it comes out of
 * door `to` (facing kB) turned by (kB - kA + 4) eighths about the upright:
 * in through the front of one, out through the front of the other, and the
 * same through the backs. Exact on the 8 facings.
 * @returns {(p: number[]) => number[]} turns a vector (x, y, z)
 */
function turnBy(kA, kB) {
  const r = wrap8(kB - kA + FACINGS / 2);
  const c = FACE[r][0];
  const s = FACE[r][1];
  return (p) => [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
}

/** A shot from `from` (a ball's place) into the opening of the door that
 * faces it most squarely, from the side it's on: a throw's speed that
 * reaches the middle of the opening on an arc, within the throw's bounds.
 * For the view's buttons and the starter. @param {number[]} from
 * @param {Record<string, number>} facing each door's facing now
 * @returns {number[]} */
export function shotInto(from, facing) {
  let best = DOORS[0];
  let bestSq = -1;
  for (const id of DOORS) {
    const c = DOOR_AT[id];
    const f = FACE[facing[id]];
    const dx = from[0] - c[0];
    const dz = from[2] - c[2];
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const sq = Math.abs((dx * f[0] + dz * f[1]) / d);
    if (sq > bestSq + 1e-9) {
      bestSq = sq;
      best = id;
    }
  }
  const c = DOOR_AT[best];
  const target = [c[0], FRAME.H * 0.45, c[2]];
  const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
  const flat = Math.sqrt(d[0] * d[0] + d[2] * d[2]);
  const time = Math.min(0.9, Math.max(0.45, flat / 2.6));
  const v = [d[0] / time, d[1] / time + (T.gravity * time) / 2, d[2] / time];
  return v.map((x) => Number(Math.max(-5.9, Math.min(5.9, x)).toFixed(3)));
}

// ---- the step

/** Puts a ball back inside the stage's room (a throw may start at its
 * very edge, a knock may push it there). */
function keepIn(b) {
  const R = STAGE.radius - T.ballR;
  const rr = Math.sqrt(b.pos[0] * b.pos[0] + b.pos[2] * b.pos[2]);
  if (rr > R) {
    b.pos[0] = (b.pos[0] * R) / rr;
    b.pos[2] = (b.pos[2] * R) / rr;
  }
  b.pos[1] = Math.max(T.ballR, Math.min(STAGE.ceiling - T.ballR, b.pos[1]));
}

/** The stage at the start of every loop: balls at rest, doors as they stand. */
function startState() {
  const balls = {};
  for (const id of BALLS) balls[id] = { pos: [...REST[id]], v: [0, 0, 0], still: true, rolling: false, through: -Infinity };
  const doors = {};
  for (const id of DOORS) doors[id] = { k: DOOR_REST[id], was: DOOR_REST[id], at: -Infinity };
  return { balls, doors };
}

function apply(st, g, t, emit) {
  if (g.kind === "throw") {
    const b = st.balls[g.object];
    b.pos = [...g.from];
    keepIn(b);
    b.v = [...g.v];
    b.still = false;
    b.rolling = false;
    emit({ kind: "throw", object: g.object, by: g.by, pos: [...b.pos] });
  } else if (g.kind === "tap") {
    const d = st.doors[g.object];
    d.was = d.k;
    d.k = wrap8(d.k + QUARTER);
    d.at = t;
    const c = DOOR_AT[g.object];
    for (const id of BALLS) {
      // a ball resting against the door is woken as it turns
      const b = st.balls[id];
      const dx = b.pos[0] - c[0];
      const dz = b.pos[2] - c[2];
      if (b.still && dx * dx + dz * dz < (FRAME.half + T.ballR + FRAME.bar) * (FRAME.half + T.ballR + FRAME.bar)) b.still = false;
    }
    emit({ kind: "turn", object: g.object, by: g.by, k: d.k, pos: [c[0], FRAME.H / 2, c[2]] });
  }
}

/** Bounces a ball off a bar (a segment a-b, radius FRAME.bar); the speed
 * it hit with along the push, or 0. */
function offBar(b, a, e) {
  const ab = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
  const ap = [b.pos[0] - a[0], b.pos[1] - a[1], b.pos[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const u = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L));
  const q = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
  const d = [b.pos[0] - q[0], b.pos[1] - q[1], b.pos[2] - q[2]];
  const n = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  const touch = T.ballR + FRAME.bar;
  if (n >= touch || n < 1e-9) return 0;
  const nn = [d[0] / n, d[1] / n, d[2] / n];
  b.pos = [q[0] + nn[0] * touch, q[1] + nn[1] * touch, q[2] + nn[2] * touch];
  const vn = b.v[0] * nn[0] + b.v[1] * nn[1] + b.v[2] * nn[2];
  if (vn >= 0) return 0;
  const k = (1 + T.frameBounce) * vn;
  b.v = [b.v[0] - k * nn[0], b.v[1] - k * nn[1], b.v[2] - k * nn[2]];
  b.rolling = false;
  return -vn;
}

function tick(st, t, emit) {
  const R = STAGE.radius - T.ballR;
  const top = STAGE.ceiling - T.ballR;
  // the doors are open until the glide home begins, so nothing jumps
  // through one while everything eases back to rest
  const open = t < LOOP - GLIDE;
  for (const id of BALLS) {
    const b = st.balls[id];
    if (b.still) continue;
    const p0 = [b.pos[0], b.pos[1], b.pos[2]];
    if (b.rolling) {
      // on the floor: slowing, until it stops
      const sp = Math.sqrt(b.v[0] * b.v[0] + b.v[2] * b.v[2]);
      const left = sp - T.roll * STEP;
      if (left <= T.stop) {
        b.v = [0, 0, 0];
        b.still = true;
        b.rolling = false;
        continue;
      }
      b.v[0] = (b.v[0] * left) / sp;
      b.v[2] = (b.v[2] * left) / sp;
      b.v[1] = 0;
    } else {
      b.v[1] -= T.gravity * STEP;
      const keep = 1 - T.drag * STEP;
      b.v[0] = b.v[0] * keep;
      b.v[1] = b.v[1] * keep;
      b.v[2] = b.v[2] * keep;
    }
    b.pos[0] = b.pos[0] + b.v[0] * STEP;
    b.pos[1] = b.pos[1] + b.v[1] * STEP;
    b.pos[2] = b.pos[2] + b.v[2] * STEP;
    // through a door's opening: out of the other one
    if (open && t - b.through >= T.cooldown) {
      for (const door of DOORS) {
        const kA = st.doors[door].k;
        const f = FACE[kA];
        const c = DOOR_AT[door];
        const s0 = (p0[0] - c[0]) * f[0] + (p0[2] - c[2]) * f[1];
        const s1 = (b.pos[0] - c[0]) * f[0] + (b.pos[2] - c[2]) * f[1];
        if (!((s0 > 0 && s1 <= 0) || (s0 < 0 && s1 >= 0))) continue;
        const w = s0 / (s0 - s1);
        const q = [p0[0] + (b.pos[0] - p0[0]) * w, p0[1] + (b.pos[1] - p0[1]) * w, p0[2] + (b.pos[2] - p0[2]) * w];
        const tg = tangent(kA);
        const lateral = (q[0] - c[0]) * tg[0] + (q[2] - c[2]) * tg[1];
        if (Math.abs(lateral) >= FRAME.half - FRAME.bar || q[1] >= FRAME.H - FRAME.bar) continue;
        const to = OTHER[door];
        const kB = st.doors[to].k;
        const turn = turnBy(kA, kB);
        const cB = DOOR_AT[to];
        const off = turn([b.pos[0] - c[0], b.pos[1] - c[1], b.pos[2] - c[2]]);
        const qOut = turn([q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
        emit({ kind: "enter", object: id, door, pos: q });
        b.pos = [cB[0] + off[0], cB[1] + off[1], cB[2] + off[2]];
        b.v = turn(b.v);
        b.through = t;
        emit({ kind: "exit", object: id, door: to, pos: [cB[0] + qOut[0], cB[1] + qOut[1], cB[2] + qOut[2]] });
        break;
      }
    }
    // the floor, the ceiling and the round wall
    if (b.pos[1] < T.ballR) {
      b.pos[1] = T.ballR;
      if (b.v[1] < 0) {
        const hit = -b.v[1];
        b.v[1] = hit * T.floorBounce;
        if (hit >= T.tick) emit({ kind: "bounce", object: id, speed: hit, pos: [b.pos[0], 0.01, b.pos[2]] });
        if (b.v[1] < T.settle) {
          b.v[1] = 0;
          b.rolling = true;
        }
      }
    }
    if (b.pos[1] > top) {
      b.pos[1] = top;
      if (b.v[1] > 0) {
        if (b.v[1] >= T.tick) emit({ kind: "bounce", object: id, speed: b.v[1], pos: [...b.pos] });
        b.v[1] = -b.v[1] * T.wallBounce;
      }
    }
    const rr = Math.sqrt(b.pos[0] * b.pos[0] + b.pos[2] * b.pos[2]);
    if (rr > R) {
      const nx = b.pos[0] / rr;
      const nz = b.pos[2] / rr;
      b.pos[0] = nx * R;
      b.pos[2] = nz * R;
      const vn = b.v[0] * nx + b.v[2] * nz;
      if (vn > 0) {
        b.v[0] -= (1 + T.wallBounce) * vn * nx;
        b.v[2] -= (1 + T.wallBounce) * vn * nz;
        if (vn >= T.tick) emit({ kind: "bounce", object: id, speed: vn, pos: [...b.pos] });
      }
    }
    // the frames themselves are solid: a ball off the opening clacks off
    for (const door of DOORS) {
      const c = DOOR_AT[door];
      const dx = b.pos[0] - c[0];
      const dz = b.pos[2] - c[2];
      const near = FRAME.half + T.ballR + FRAME.bar;
      if (dx * dx + dz * dz > near * near || b.pos[1] > FRAME.H + near) continue;
      for (const [a, e] of bars(door, st.doors[door].k)) {
        const hit = offBar(b, a, e);
        if (hit >= T.tick) emit({ kind: "bounce", object: id, other: door, speed: hit, pos: [...b.pos] });
      }
    }
  }
  // balls knock each other; equal masses trade the speed along the line
  // between them, and one at rest is set going
  for (let i = 0; i < BALLS.length; i++) {
    for (let j = i + 1; j < BALLS.length; j++) {
      const a = st.balls[BALLS[i]];
      const b = st.balls[BALLS[j]];
      if (a.still && b.still) continue;
      const d = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
      const n = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      if (n >= 2 * T.ballR || n < 1e-9) continue;
      const nn = [d[0] / n, d[1] / n, d[2] / n];
      const push = (2 * T.ballR - n) / 2;
      a.pos = [a.pos[0] - nn[0] * push, Math.max(T.ballR, a.pos[1] - nn[1] * push), a.pos[2] - nn[2] * push];
      b.pos = [b.pos[0] + nn[0] * push, Math.max(T.ballR, b.pos[1] + nn[1] * push), b.pos[2] + nn[2] * push];
      keepIn(a);
      keepIn(b);
      const rel = (a.v[0] - b.v[0]) * nn[0] + (a.v[1] - b.v[1]) * nn[1] + (a.v[2] - b.v[2]) * nn[2];
      if (rel <= 0) continue;
      const k = (rel * (1 + T.knockBounce)) / 2;
      a.v = [a.v[0] - k * nn[0], a.v[1] - k * nn[1], a.v[2] - k * nn[2]];
      b.v = [b.v[0] + k * nn[0], b.v[1] + k * nn[1], b.v[2] + k * nn[2]];
      for (const s of [a, b]) {
        s.still = false;
        s.rolling = false;
      }
      if (rel > 0.3) emit({ kind: "knock", object: BALLS[i], other: BALLS[j], pos: [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2] });
    }
  }
}

// A deep copy of the state, for a snapshot: copying moves no bits.
function copyState(st) {
  const balls = {};
  for (const id of BALLS) {
    const b = st.balls[id];
    balls[id] = { pos: [b.pos[0], b.pos[1], b.pos[2]], v: [b.v[0], b.v[1], b.v[2]], still: b.still, rolling: b.rolling, through: b.through };
  }
  const doors = {};
  for (const id of DOORS) doors[id] = { k: st.doors[id].k, was: st.doors[id].was, at: st.doors[id].at };
  return { balls, doors };
}

/** What a screen draws (a fresh object; nothing shared with the state).
 * A door's `turn` is its facing in eighths, a whole number except while
 * it glides home; `was` and `at` say which way it last turned, and when. */
function view(st, t) {
  const balls = {};
  for (const id of BALLS) {
    const b = st.balls[id];
    balls[id] = { pos: [...b.pos], v: [...b.v], still: b.still };
  }
  const doors = {};
  for (const id of DOORS) {
    const d = st.doors[id];
    doors[id] = { turn: d.k, was: d.was, age: t - d.at };
  }
  return { balls, doors };
}

/** Each ball `e` of the way (0 to 1) back to rest, and each door turned
 * `e` of the way back to its facing (the short way round). */
function ease(v, e) {
  const balls = {};
  for (const id of BALLS) {
    const b = v.balls[id];
    const r = REST[id];
    balls[id] = { ...b, pos: [b.pos[0] + (r[0] - b.pos[0]) * e, b.pos[1] + (r[1] - b.pos[1]) * e, b.pos[2] + (r[2] - b.pos[2]) * e] };
  }
  const doors = {};
  for (const id of DOORS) {
    const d = v.doors[id];
    const back = wrap8(DOOR_REST[id] - d.turn + FACINGS / 2) - FACINGS / 2;
    doors[id] = { ...d, turn: d.turn + back * e, was: d.turn + back * e, age: Infinity };
  }
  return { ...v, balls, doors };
}

/** @type {import("../stage.js").StageSet} */
export default {
  id: "doors",
  name: "Swap Doors",
  objects: [...BALLS, ...DOORS],
  holdable: BALLS,
  gestures: {
    throw: { objects: BALLS },
    tap: { objects: DOORS },
  },
  colour: { apricot: 1, lemon: 7, plum: 6, coraldoor: 2, tealdoor: 3 },
  startState,
  tick,
  apply,
  copyState,
  view,
  ease,
  // the balls, and a point on each door's front, so a door's facing is in
  // the fingerprint and the glide home too
  positions: (v) => [...BALLS.map((id) => v.balls[id].pos), ...DOORS.map((id) => frontOf(id, v.doors[id].turn))],
  fingerprint: {
    gestures: [
      { kind: "throw", object: "apricot", at: 0.5, from: [-0.55, 0.1, 0.85], v: [-0.5, 2.6, -2.2], by: "aaaaaa" },
      { kind: "throw", object: "plum", at: 1.5, from: [0.55, 0.1, 0.85], v: [0.5, 2.6, -2.2], by: "aaaaaa" },
      { kind: "tap", object: "tealdoor", at: 3, by: "aaaaaa" },
      { kind: "throw", object: "lemon", at: 3.5, from: [0, 0.1, 1.15], v: [-1.6, 2.4, -2.6], by: "aaaaaa" },
      { kind: "tap", object: "coraldoor", at: 6, by: "aaaaaa" },
      { kind: "throw", object: "apricot", at: 7, from: [0.2, 0.6, 0.6], v: [2, 1.5, -1.8], by: "aaaaaa" },
    ],
    hash: "2248655225257862478",
    events: 39,
  },
};
