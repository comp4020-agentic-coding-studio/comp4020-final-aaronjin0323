// The Tipping Point set's rules (ADR 18): a long plank on a pivot at the
// stage's centre and three stones of different weights under ordinary
// gravity. Drop a stone on the high end and the plank tips; whatever sits
// on the other end rides it up and is catapulted off when the plank hits
// its stop. Stones on the plank slide down its slope; on the floor they
// bounce and roll, and knock each other. A set plug-in
// (public/sets/README.md). Deterministic from the gestures and the loop
// moment alone; + - * / and Math.sqrt only (spec/stage.test.ts reads this
// file): the plank's tilt is an angle in turns, with turnSin/turnCos.
import { GLIDE, LOOP, STAGE, STEP, turnCos, turnSin } from "./kit.js";

/** The stones, light to heavy. Lowercase letters only. */
export const STONES = ["pebble", "stone", "boulder"];

const TAU = Math.PI * 2;

// ---- the tuning: all of it, in one place. Toy physics, tuned for fun.
const T = {
  /** gravity, m/s/s: a little lighter than Earth's, so a flight reads */
  g: 7,
  /** each stone's radius and weight */
  r: { pebble: 0.09, stone: 0.13, boulder: 0.18 },
  m: { pebble: 1, stone: 2.5, boulder: 6 },
  /** the plank's own moment of inertia about the pivot (kg m^2) */
  plankI: 2.4,
  /** the pivot's friction: angular speed lost per second */
  plankDamp: 0.6,
  /** the plank's own off-centre weight (kg m): a light lean to rest */
  lean: 0.12,
  /** how much of the plank's swing survives hitting its stop */
  stopBounce: 0.18,
  /** under this angular speed (rad/s) at the stop, the plank just rests */
  stopRest: 0.35,
  /** a stone on the rising end leaves with this many times the end's speed */
  launch: 1.45,
  /** ...if the end rose at least this fast (m/s) */
  launchMin: 0.9,
  /** a stone landing on the plank bounces with this much of its speed... */
  landBounce: 0.3,
  /** ...unless that's under this (m/s), when it settles on the plank */
  stick: 0.9,
  /** a stone sliding along the plank loses this much speed per second */
  slideDrag: 0.8,
  /** the floor's bounce, and under this vertical speed it stays down */
  floorBounce: 0.38,
  floorRest: 0.45,
  /** speed lost rolling on the floor, per second */
  roll: 1.6,
  /** the round wall and the ceiling */
  wallBounce: 0.5,
  /** stones knocking each other keep this much of their closing speed */
  knockBounce: 0.55,
  /** the same two stones click at most once in this long (s) */
  knockGap: 0.3,
  /** no stone goes faster than this (m/s), so nothing jumps between frames */
  vMax: 5.6,
  /** a nudge kicks the plank's tapped end down this fast (rad/s) */
  nudge: 2.6,
  /** a nudge on the middle hops everything on the plank up (m/s) */
  hop: 1.8,
  /** a stone on the floor the plank comes down on rolls out at this (m/s) */
  squeeze: 0.6,
  /** the most a stone is moved to make room, per step (m) */
  ease: 0.03,
  /** in the loop's last GLIDE, everything settles: speed lost per second */
  settle: 4,
};

/** The plank: half its length, its thickness and width, the lips that
 * keep stones on it, the pivot's height, and how far it tilts (turns). */
export const PLANK = { half: 1.5, thick: 0.08, width: 0.44, lip: 0.03, pivotY: 0.56, limit: 20 / 360 };
/** the pivot stand, a post a stone on the floor can't pass through */
const POST_R = 0.1;

/** Where each stone rests: the pebble on the low (-x) end of the plank,
 * the other two on the floor, near the high end, waiting to be dropped. */
const REST_FLOOR = {
  stone: [-0.45, T.r.stone, -0.62],
  boulder: [0.95, T.r.boulder, 0.62],
};
const REST_ON = { pebble: -(PLANK.half - PLANK.lip - T.r.pebble) };

/** A point on the plank's top face at `lx` along it, tilted by `a` turns
 * (positive raises the +x end), lifted `up` off the face. */
export function plankPoint(a, lx, up = 0, z = 0) {
  const s = turnSin(a);
  const c = turnCos(a);
  const h = PLANK.thick / 2 + up;
  return [lx * c - h * s, PLANK.pivotY + lx * s + h * c, z];
}

// ---- the step

function startState() {
  const stones = {};
  for (const id of STONES) {
    if (id in REST_ON) {
      const lx = REST_ON[id];
      stones[id] = { pos: plankPoint(PLANK.limit, lx, T.r[id]), v: [0, 0, 0], on: true, lx, sv: 0 };
    } else stones[id] = { pos: [...REST_FLOOR[id]], v: [0, 0, 0], on: false, lx: 0, sv: 0 };
  }
  return { a: PLANK.limit, w: 0, stones, creak: false, knocked: {} };
}

// the plank's inertia with whatever rides it
function inertia(st) {
  let I = T.plankI;
  for (const id of STONES) {
    const s = st.stones[id];
    if (s.on) I += T.m[id] * s.lx * s.lx;
  }
  return I;
}

// A stone leaves the plank, moving as the plank's surface moved it.
function lift(st, id, s, c, sn, extra) {
  const up = st.w * s.lx * extra; // the surface's speed along its normal
  s.v = [s.sv * c - up * sn, s.sv * sn + up * c, 0];
  s.on = false;
}

function cap(v) {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (n > T.vMax) {
    const k = T.vMax / n;
    v[0] *= k;
    v[1] *= k;
    v[2] *= k;
  }
}

// Two stones knock: one click per pair, however many steps they settle
// over (a stack sorting itself out is one knock, not a rattle).
function knock(st, t, ia, ib, speed, pa, pb, emit) {
  const key = ia + ib;
  if (t - (st.knocked[key] ?? -1) < T.knockGap) return;
  st.knocked[key] = t;
  emit({ kind: "knock", object: ia, other: ib, speed, pos: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2] });
}

function apply(st, g, t, emit) {
  if (g.kind === "throw") {
    const s = st.stones[g.object];
    s.pos = [...g.from];
    s.v = [...g.v];
    cap(s.v);
    s.on = false;
    // let go past the stage's edge (THROW's bounds are a square): it starts
    // just inside it
    {
      const r = T.r[g.object];
      const R = STAGE.radius - r;
      const rr = Math.sqrt(s.pos[0] * s.pos[0] + s.pos[2] * s.pos[2]);
      if (rr > R) {
        s.pos[0] = (s.pos[0] / rr) * R;
        s.pos[2] = (s.pos[2] / rr) * R;
      }
      s.pos[1] = Math.max(r, Math.min(STAGE.ceiling - r, s.pos[1]));
    }
    // let go inside the plank (a hand held low over it): it starts on top
    const sn = turnSin(st.a);
    const c = turnCos(st.a);
    const r = T.r[g.object];
    const px = s.pos[0];
    const py = s.pos[1] - PLANK.pivotY;
    const lx = px * c + py * sn;
    const ly = -px * sn + py * c;
    if (lx < PLANK.half && lx > -PLANK.half && s.pos[2] < PLANK.width / 2 + r && s.pos[2] > -PLANK.width / 2 - r && ly < PLANK.thick / 2 + r && ly > -PLANK.thick / 2 - r) {
      s.pos = plankPoint(st.a, lx, r + 0.001, s.pos[2]);
    }
    emit({ kind: "throw", object: g.object, by: g.by, pos: [...s.pos] });
  } else if (g.kind === "nudge") {
    const sn = turnSin(st.a);
    const c = turnCos(st.a);
    if (g.side === 0) {
      // the middle: everything on the plank hops
      for (const id of STONES) {
        const s = st.stones[id];
        if (!s.on) continue;
        lift(st, id, s, c, sn, TAU);
        s.v[1] += T.hop;
        emit({ kind: "hop", object: id, by: g.by, pos: [...s.pos] });
      }
      emit({ kind: "nudge", object: "plank", by: g.by, side: 0, pos: plankPoint(st.a, 0) });
    } else {
      // the tapped end is pushed down, or, if it's already down, popped up
      const down = g.side * st.a <= -PLANK.limit + 1e-9;
      const kick = down ? -g.side * T.nudge : g.side * T.nudge;
      st.w -= kick / TAU;
      // off the stop, so the swing counts
      if (down) st.a = -g.side * (PLANK.limit - 1e-6);
      emit({ kind: "nudge", object: "plank", by: g.by, side: g.side, pos: plankPoint(st.a, g.side * (PLANK.half - 0.1)) });
    }
  }
}

function tick(st, t, emit) {
  const ending = t > LOOP - GLIDE;
  const settle = ending ? 1 - T.settle * STEP : 1;
  // ---- the plank turns: the weight of whatever rides it, and the pivot
  let sn = turnSin(st.a);
  let c = turnCos(st.a);
  let I = inertia(st);
  // the plank's own weight sits a little to its -x side, so left alone it
  // always comes back to rest there (any stone outweighs it)
  let torque = T.lean * T.g * c;
  for (const id of STONES) {
    const s = st.stones[id];
    if (s.on) torque -= T.m[id] * T.g * s.lx * c;
  }
  // angular speed in turns per second
  st.w += (torque / I / TAU) * STEP;
  st.w *= (1 - T.plankDamp * STEP) * settle;
  // swinging, not pressed against a stop: only a swing can throw
  const swung = st.a < PLANK.limit && st.a > -PLANK.limit;
  st.a += st.w * STEP;
  // it hits a stop: whatever was riding the end that rose flies on
  const hit = st.a > PLANK.limit ? 1 : st.a < -PLANK.limit ? -1 : 0;
  if (hit !== 0) {
    st.a = hit * PLANK.limit;
    sn = turnSin(st.a);
    c = turnCos(st.a);
    if (st.w * hit > 0 && !swung) st.w = 0;
    else if (st.w * hit > 0) {
      const wr = st.w * TAU;
      const end = Math.abs(wr) * PLANK.half;
      for (const id of STONES) {
        const s = st.stones[id];
        if (!s.on || s.lx * hit < 0) continue;
        // the end at lx rose at wr * lx; past launchMin it's a catapult
        const up = Math.abs(wr * s.lx);
        if (up < T.launchMin || ending) continue;
        s.on = false;
        const k = up * T.launch;
        s.v = [s.sv * c - k * sn, s.sv * sn + k * c, 0];
        cap(s.v);
        emit({ kind: "launch", object: id, by: "plank", speed: up, pos: [...s.pos] });
      }
      if (end > 0.5) emit({ kind: "clack", object: "plank", side: -hit, speed: end, pos: plankPoint(st.a, -hit * PLANK.half) });
      st.w = Math.abs(wr) < T.stopRest ? 0 : -st.w * T.stopBounce;
    }
  }
  // the creak as it starts to tip
  const endSpeed = Math.abs(st.w * TAU) * PLANK.half;
  if (!st.creak && endSpeed > 0.6) {
    st.creak = true;
    emit({ kind: "tip", object: "plank", speed: endSpeed, pos: plankPoint(st.a, 0) });
  } else if (st.creak && endSpeed < 0.15) st.creak = false;
  I = inertia(st);

  // ---- the stones
  const wr = st.w * TAU;
  for (const id of STONES) {
    const s = st.stones[id];
    const r = T.r[id];
    const m = T.m[id];
    if (s.on) {
      // sliding down the slope, held on by the lips at the ends
      s.sv += -T.g * sn * STEP;
      s.sv *= (1 - T.slideDrag * STEP) * settle;
      s.lx += s.sv * STEP;
      // the lips at the ends stop it (one that landed past a lip is eased
      // back inside it over a few steps, never in one jump)
      const end = PLANK.half - PLANK.lip - r;
      if (s.lx > end || s.lx < -end) {
        const lim = s.lx > 0 ? end : -end;
        s.lx = Math.abs(s.lx - lim) <= T.ease ? lim : s.lx - Math.sign(s.lx) * T.ease;
        if (s.sv * s.lx > 0) s.sv = Math.abs(s.sv) < 0.3 ? 0 : -s.sv * 0.2;
      }
      s.pos = plankPoint(st.a, s.lx, r, s.pos[2]);
      continue;
    }
    // falling, through a little air
    s.v[1] -= T.g * STEP;
    s.v[0] *= settle;
    s.v[1] *= settle;
    s.v[2] *= settle;
    cap(s.v);
    s.pos[0] += s.v[0] * STEP;
    s.pos[1] += s.v[1] * STEP;
    s.pos[2] += s.v[2] * STEP;
    // the floor: a bounce, then it stays down and rolls to a stop
    if (s.pos[1] < r) {
      s.pos[1] = r;
      if (s.v[1] < 0) {
        const hitV = -s.v[1];
        s.v[1] = hitV * T.floorBounce < T.floorRest ? 0 : hitV * T.floorBounce;
        if (hitV > 1.2) emit({ kind: "thud", object: id, speed: hitV, pos: [s.pos[0], 0.01, s.pos[2]] });
      }
    }
    if (s.pos[1] === r && s.v[1] === 0) {
      const k = 1 - T.roll * STEP;
      s.v[0] *= k;
      s.v[2] *= k;
      // and under 0.12 m/s, a stone stops (a slow roll reads as a glitch)
      if (s.v[0] * s.v[0] + s.v[2] * s.v[2] < 0.0144) {
        s.v[0] = 0;
        s.v[2] = 0;
      }
    }
    // the ceiling and the round wall
    const top = STAGE.ceiling - r;
    if (s.pos[1] > top) {
      s.pos[1] = top;
      if (s.v[1] > 0) s.v[1] = -s.v[1] * T.wallBounce;
    }
    const R = STAGE.radius - r;
    const rr = Math.sqrt(s.pos[0] * s.pos[0] + s.pos[2] * s.pos[2]);
    if (rr > R) {
      const nx = s.pos[0] / rr;
      const nz = s.pos[2] / rr;
      s.pos[0] = nx * R;
      s.pos[2] = nz * R;
      const vn = s.v[0] * nx + s.v[2] * nz;
      if (vn > 0) {
        s.v[0] -= (1 + T.wallBounce) * vn * nx;
        s.v[2] -= (1 + T.wallBounce) * vn * nz;
      }
    }
    // the pivot's post
    if (s.pos[1] < PLANK.pivotY) {
      const pr = Math.sqrt(s.pos[0] * s.pos[0] + s.pos[2] * s.pos[2]);
      const need = POST_R + r;
      if (pr < need) {
        const nx = pr > 1e-9 ? s.pos[0] / pr : 1;
        const nz = pr > 1e-9 ? s.pos[2] / pr : 0;
        s.pos[0] = nx * need;
        s.pos[2] = nz * need;
        const vn = s.v[0] * nx + s.v[2] * nz;
        if (vn < 0) {
          s.v[0] -= (1 + T.wallBounce) * vn * nx;
          s.v[2] -= (1 + T.wallBounce) * vn * nz;
        }
      }
    }
    // the plank: a box turned about the pivot. The nearest point of it to
    // the stone, in the plank's frame (lx along, ly off the top face)
    const px = s.pos[0];
    const py = s.pos[1] - PLANK.pivotY;
    const lx = px * c + py * sn;
    const ly = -px * sn + py * c;
    const halfT = PLANK.thick / 2;
    const halfW = PLANK.width / 2;
    const qx = Math.max(-PLANK.half, Math.min(PLANK.half, lx));
    const qy = Math.max(-halfT, Math.min(halfT, ly));
    const qz = Math.max(-halfW, Math.min(halfW, s.pos[2]));
    let dx = lx - qx;
    let dy = ly - qy;
    let dz = s.pos[2] - qz;
    let dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dd >= r) continue;
    if (dd < 1e-9) {
      // its centre is inside the wood: out through the nearest face
      const out = [PLANK.half - Math.abs(lx), halfT - Math.abs(ly), halfW - Math.abs(s.pos[2])];
      const k = out[1] <= out[0] && out[1] <= out[2] ? 1 : out[2] <= out[0] ? 2 : 0;
      dx = k === 0 ? (lx >= 0 ? 1 : -1) : 0;
      dy = k === 1 ? (ly >= 0 ? 1 : -1) : 0;
      dz = k === 2 ? (s.pos[2] >= 0 ? 1 : -1) : 0;
      dd = -out[k];
    } else {
      dx /= dd;
      dy /= dd;
      dz /= dd;
    }
    // out of the wood along the contact's normal, a few cm a step at most
    const nx = dx * c - dy * sn;
    const ny = dx * sn + dy * c;
    const push = Math.min(r - dd, 0.06);
    s.pos[0] += nx * push;
    s.pos[1] += ny * push;
    s.pos[2] += dz * push;
    // against the wood's own speed there, as the plank turns
    // a stone on the floor that the plank comes down on is squeezed out
    // sideways, rolling, at once: never halted under it each step while
    // it holds the plank creeping down for seconds
    if (s.pos[1] - r < 0.01 && ny < 0.7) {
      const hn = Math.sqrt(nx * nx + dz * dz);
      if (hn > 1e-6) {
        const along = (s.v[0] * nx + s.v[2] * dz) / hn;
        if (along < T.squeeze) {
          s.v[0] += ((T.squeeze - along) * nx) / hn;
          s.v[2] += ((T.squeeze - along) * dz) / hn;
        }
      }
    }
    const vn = (s.v[0] + wr * py) * nx + (s.v[1] - wr * px) * ny + s.v[2] * dz;
    if (vn >= 0) continue;
    const arm = px * ny - py * nx;
    const onTop = dy > 0.7;
    const settles = onTop &&-vn * T.landBounce < T.stick;
    const e = settles ? 0 : T.landBounce;
    const J = (-(1 + e) * vn) / (1 / m + (arm * arm) / I);
    // the plank takes the blow the other way: torque r x (-J n)
    st.w -= (J * arm) / I / TAU;
    if (-vn > 0.4) emit({ kind: "land", object: id, speed: -vn, pos: [...s.pos] });
    if (settles && lx > -PLANK.half && lx < PLANK.half) {
      // it comes to sit on the plank, sliding on along it
      s.on = true;
      s.lx = lx;
      s.sv = s.v[0] * c + s.v[1] * sn;
      s.pos = plankPoint(st.a, lx, r, s.pos[2]);
    } else {
      s.v[0] += (J / m) * nx;
      s.v[1] += (J / m) * ny;
      s.v[2] += (J / m) * dz;
    }
  }

  // ---- stones on the plank stack up along it from its low end: each
  // sits against the one below, and they slide on together (momentum kept)
  const riders = STONES.filter((id) => st.stones[id].on);
  if (riders.length > 1) {
    const down = sn > 0 ? 1 : -1; // +1: the -x end is low
    riders.sort((x, y) => down * (st.stones[x].lx - st.stones[y].lx) || STONES.indexOf(x) - STONES.indexOf(y));
    for (let k = 1; k < riders.length; k++) {
      const lo = st.stones[riders[k - 1]];
      const hi = st.stones[riders[k]];
      const touch = T.r[riders[k - 1]] + T.r[riders[k]];
      const gap = down * (hi.lx - lo.lx);
      if (gap >= touch) continue;
      hi.lx += down * Math.min(touch - gap, T.ease);
      const closing = down * (lo.sv - hi.sv);
      if (closing > 0) {
        const ml = T.m[riders[k - 1]];
        const mh = T.m[riders[k]];
        const v = (ml * lo.sv + mh * hi.sv) / (ml + mh);
        if (closing > 0.6) knock(st, t, riders[k - 1], riders[k], closing, lo.pos, hi.pos, emit);
        lo.sv = v;
        hi.sv = v;
      }
      // (all three in a row are 0.8 m: the plank always has room)
      hi.pos = plankPoint(st.a, hi.lx, T.r[riders[k]], hi.pos[2]);
    }
  }

  // ---- stones knock into each other
  for (let i = 0; i < STONES.length; i++) {
    for (let j = i + 1; j < STONES.length; j++) {
      const ia = STONES[i];
      const ib = STONES[j];
      const a = st.stones[ia];
      const b = st.stones[ib];
      const dx = b.pos[0] - a.pos[0];
      const dy = b.pos[1] - a.pos[1];
      const dz = b.pos[2] - a.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const touch = T.r[ia] + T.r[ib];
      if (d >= touch || d < 1e-9) continue;
      const ma = T.m[ia];
      const mb = T.m[ib];
      // two on the plank were settled by the stacking pass above
      if (a.on && b.on) continue;
      // a free stone hits one on the plank: it's knocked off
      if (a.on) lift(st, ia, a, c, sn, TAU);
      if (b.on) lift(st, ib, b, c, sn, TAU);
      const nx = dx / d;
      const ny = dy / d;
      const nz = dz / d;
      const over = touch - d;
      // the heavier moves less
      const ka = mb / (ma + mb);
      const kb = ma / (ma + mb);
      a.pos[0] -= nx * over * ka;
      a.pos[1] -= ny * over * ka;
      a.pos[2] -= nz * over * ka;
      b.pos[0] += nx * over * kb;
      b.pos[1] += ny * over * kb;
      b.pos[2] += nz * over * kb;
      for (const s of [a, b]) {
        const rr = T.r[s === a ? ia : ib];
        if (s.pos[1] < rr) s.pos[1] = rr;
      }
      const rel = (a.v[0] - b.v[0]) * nx + (a.v[1] - b.v[1]) * ny + (a.v[2] - b.v[2]) * nz;
      if (rel <= 0) continue;
      const J = ((1 + T.knockBounce) * rel) / (1 / ma + 1 / mb);
      a.v[0] -= (J / ma) * nx;
      a.v[1] -= (J / ma) * ny;
      a.v[2] -= (J / ma) * nz;
      b.v[0] += (J / mb) * nx;
      b.v[1] += (J / mb) * ny;
      b.v[2] += (J / mb) * nz;
      cap(a.v);
      cap(b.v);
      if (rel > 0.4) knock(st, t, ia, ib, rel, a.pos, b.pos, emit);
    }
  }
}

function copyState(st) {
  const stones = {};
  for (const id of STONES) {
    const s = st.stones[id];
    stones[id] = { pos: [s.pos[0], s.pos[1], s.pos[2]], v: [s.v[0], s.v[1], s.v[2]], on: s.on, lx: s.lx, sv: s.sv };
  }
  return { a: st.a, w: st.w, stones, creak: st.creak, knocked: { ...st.knocked } };
}

/** What a screen draws: the plank's tilt (turns) and spin, each stone. */
function view(st) {
  const stones = {};
  for (const id of STONES) {
    const s = st.stones[id];
    stones[id] = { pos: [s.pos[0], s.pos[1], s.pos[2]], on: s.on };
  }
  return { a: st.a, w: st.w, stones };
}

/** Everything `e` of the way (0 to 1) home: the plank's tilt and each stone. */
function ease(v, e) {
  const stones = {};
  const rest = restPos();
  for (const id of STONES) {
    const s = v.stones[id];
    const r = rest[id];
    stones[id] = { ...s, pos: [s.pos[0] + (r[0] - s.pos[0]) * e, s.pos[1] + (r[1] - s.pos[1]) * e, s.pos[2] + (r[2] - s.pos[2]) * e] };
  }
  return { ...v, a: v.a + (PLANK.limit - v.a) * e, w: v.w * (1 - e), stones };
}

let REST = null;
const restPos = () => (REST ??= Object.fromEntries(STONES.map((id) => [id, startState().stones[id].pos])));

/** Where each stone rests (for the view's buttons and checks). */
export const restOf = (id) => [...restPos()[id]];

/** @type {import("../stage.js").StageSet} */
export default {
  id: "seesaw",
  name: "Tipping Point",
  objects: [...STONES, "plank"],
  holdable: STONES,
  gestures: {
    throw: { objects: STONES },
    nudge: { objects: ["plank"], fields: { side: { lo: -1, hi: 1, step: 1 } } },
  },
  radii: T.r,
  colour: { pebble: 2, stone: 3, boulder: 6, plank: 0 },
  startState,
  tick,
  apply,
  copyState,
  view,
  ease,
  // each stone, then the plank's two ends
  positions: (v) => [...STONES.map((id) => v.stones[id].pos), plankPoint(v.a, -PLANK.half), plankPoint(v.a, PLANK.half)],
  fingerprint: {
    gestures: [
      { kind: "throw", object: "boulder", at: 0.5, from: [1.2, 1.8, 0], v: [0, -0.5, 0], by: "aaaaaa" },
      { kind: "throw", object: "stone", at: 3.5, from: [-1.1, 1.6, 0.05], v: [0, -1, 0], by: "aaaaaa" },
      { kind: "nudge", object: "plank", at: 6, side: 1, by: "aaaaaa" },
      { kind: "throw", object: "pebble", at: 8, from: [-1.5, 0.4, 0.6], v: [3.5, 1.2, -0.8], by: "aaaaaa" },
      { kind: "nudge", object: "plank", at: 11, side: 0, by: "aaaaaa" },
      { kind: "throw", object: "boulder", at: 13, from: [0.4, 1.2, -0.9], v: [2, 1.5, -1.5], by: "aaaaaa" },
      { kind: "nudge", object: "plank", at: 16.5, side: -1, by: "aaaaaa" },
    ],
    hash: "568122622889203942",
    events: 46,
  },
};
