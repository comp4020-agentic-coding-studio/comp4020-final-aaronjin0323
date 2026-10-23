// The Loop Stage's shared rules (ADR 16, 18; CLAUDE.md, "The museum"). One
// copy: the server imports it to refuse a gesture or a performance outside
// the bounds, the page imports it (served at /stage.js) to play
// performances, and spec/stage.test.ts holds it. Plain JS, no Three.js, so
// it runs in Node.
//
// A performance is a set and a loop of gestures. What every set shares
// lives here: the loop, the caps, checking what arrives, playing a run with
// snapshots, easing home, and the registry SETS. Each set's own objects,
// gesture shapes, bounds and step live in public/sets/<id>.js (see
// public/sets/README.md). Everything that happens on the stage is computed
// from the set, the gestures and the loop moment alone, by a fixed 60 Hz
// step from the start of the loop with no randomness, so every screen shows
// the same performance and no frame is ever a write. Everything here and in
// every set's rules is + - * / and square roots, which IEEE 754 rounds the
// same in every browser; no Math.sin or **, which engines may each
// approximate in their own way.
import { GLIDE, LOOP, STAGE, STEP, THROW, turnCos, turnSin } from "./sets/kit.js";
import orbit from "./sets/orbit.js";
import chimes from "./sets/chimes.js";
import doors from "./sets/doors.js";
import seesaw from "./sets/seesaw.js";

export { GLIDE, LOOP, STAGE, STEP, THROW, turnCos, turnSin };

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

/** At most this many gestures in a loop, and this many from one visitor. */
export const CAP = 40;
export const CAP_EACH = 12;

/**
 * @typedef {[number, number, number]} Vec
 * @typedef {{ kind: string, object: string, at: number, from?: number[], v?: number[], u?: number, by?: string } & Record<string, any>} Gesture
 * @typedef {{ set: string, gestures: Gesture[] }} Performance
 * @typedef {{ t: number, home?: number } & Record<string, any>} StageView
 * @typedef {{ kind: string, object: string, t: number, pos: number[], by?: string, u?: number, other?: string } & Record<string, any>} StageEvent
 * @typedef {(e: Omit<StageEvent, "t">) => void} Emit
 *
 * One number field of a gesture: from `lo` to `hi` (both allowed), or to
 * under `below`; snapped to `step`. With `len`, a list of that many, each
 * within its own `lo[i]`..`hi[i]`.
 * @typedef {{ lo: number, hi?: number, below?: number, step: number } | { len: number, lo: number[], hi: number[], step: number }} FieldSpec
 *
 * A gesture shape: which objects take it, and its own number fields (in
 * the order they're stored). The kind `throw` is special: its objects must
 * be holdable, it carries `from` and `v` (THROW's bounds) before any fields
 * of its own, and the server lets it through only with the thrower's claim.
 * @typedef {{ objects: string[], fields?: Record<string, FieldSpec> }} GestureShape
 *
 * A set: a plug-in (public/sets/README.md). `S` is its own state; the
 * shared run keeps the step count beside it.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   objects: string[],
 *   holdable: string[],
 *   gestures: Record<string, GestureShape>,
 *   colour: Record<string, number>,
 *   startState(): any,
 *   tick(st: any, t: number, emit: Emit): void,
 *   apply(st: any, g: Gesture, t: number, emit: Emit): void,
 *   copyState(st: any): any,
 *   view(st: any, t: number): Record<string, any>,
 *   ease(view: Record<string, any>, e: number): Record<string, any>,
 *   positions(view: Record<string, any>): number[][],
 *   fingerprint: { gestures: Gesture[], hash: string, events: number, statics?: () => number[][] },
 * } & Record<string, any>} StageSet
 */

/** The sets of objects a performance can be played on, by id (ADR 18).
 * Adding a set is one line here (public/sets/README.md).
 * @type {Record<string, StageSet>} */
export const SETS = { orbit, chimes, doors, seesaw };

/** The set with this id, or null (own keys only: never `constructor`).
 * @param {unknown} id @returns {StageSet | null} */
export const setOf = (id) => (typeof id === "string" && Object.hasOwn(SETS, id) ? SETS[id] : null);

/** Every object any set lets a visitor hold, for a pose's `holding`. */
export const HOLDABLE = [...new Set(Object.values(SETS).flatMap((s) => s.holdable))];

/** Whether `object` can be held on set `set`. @param {string} set @param {unknown} object */
export const isHoldable = (set, object) => typeof object === "string" && !!setOf(set)?.holdable.includes(object);

/** A silent performance on a set.
 * @param {string} set @returns {Performance} */
export function emptyPerformance(set) {
  if (!setOf(set)) throw new Error(`no set ${set}`);
  return { set, gestures: [] };
}

// ---- checking what arrives

/** @param {string} reason @returns {{ ok: false, reason: string }} */
const no = (reason) => ({ ok: false, reason });
/** @type {{ ok: true }} */
const YES = { ok: true };

const snap = (v, step) => Number((Math.round(v / step) * step).toFixed(4));
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const vec = (v, lo, hi) => Array.isArray(v) && v.length === lo.length && v.every((x, i) => finite(x) && x >= lo[i] && x <= hi[i]);

const THROW_FIELDS = {
  from: { len: 3, lo: THROW.fromLo, hi: THROW.fromHi, step: 0.001 },
  v: { len: 3, lo: [-THROW.vMax, -THROW.vMax, -THROW.vMax], hi: [THROW.vMax, THROW.vMax, THROW.vMax], step: 0.001 },
};
const THROW_SAYS = { from: "from must be a point on the stage", v: `v must be three speeds up to ${THROW.vMax}` };

// A shape's fields, in the order they're stored.
const fieldsOf = (kind, shape) => ({ ...(kind === "throw" ? THROW_FIELDS : {}), ...(shape.fields ?? {}) });

/** Checks one field; the snapped value, or the reason it's refused. */
function checkField(name, f, x, kind) {
  if ("len" in f) {
    if (!vec(x, f.lo, f.hi)) return { reason: kind === "throw" && name in THROW_SAYS ? THROW_SAYS[name] : `${name} must be ${f.len} numbers in range` };
    return { value: x.map((n) => snap(n, f.step)) };
  }
  const top = f.below !== undefined ? f.below : f.hi;
  const ok = finite(x) && x >= f.lo && (f.below !== undefined ? x < f.below : x <= f.hi);
  if (!ok) return { reason: `${name} must be from ${f.lo} to ${f.below !== undefined ? "under " : ""}${top}` };
  const s = snap(x, f.step);
  // snapped up to the open end: the last step under it
  return { value: f.below !== undefined ? Math.min(s, Number((f.below - f.step).toFixed(4))) : Math.min(s, f.hi) };
}

/**
 * Checks one gesture as the page sends it (no `by`: the server adds who).
 * Returns it snapped, or the reason it's refused. Unknown kinds, objects
 * and keys are refused, never ignored; out of range is refused, never
 * clamped. Own keys only, so `constructor` is never a field.
 * @param {string} set @param {any} g
 * @returns {{ ok: true, gesture: Gesture } | { ok: false, reason: string }}
 */
export function checkGesture(set, g) {
  const S = setOf(set);
  if (!S) return no("unknown set");
  if (typeof g !== "object" || g === null || Array.isArray(g)) return no("a gesture must be an object");
  const shape = typeof g.kind === "string" && Object.hasOwn(S.gestures, g.kind) ? S.gestures[g.kind] : null;
  if (!shape) return no("unknown gesture");
  const fields = fieldsOf(g.kind, shape);
  const allowed = ["kind", "object", "at", ...Object.keys(fields)];
  const extra = Object.keys(g).filter((k) => !allowed.includes(k));
  if (extra.length) return no(`unexpected ${extra.join(", ")}`);
  if (allowed.some((k) => !Object.hasOwn(g, k))) return no("missing a field");
  if (!shape.objects.includes(g.object) || !S.objects.includes(g.object) || (g.kind === "throw" && !S.holdable.includes(g.object))) return no(`can't ${g.kind} that`);
  if (!finite(g.at) || g.at < 0 || g.at >= LOOP) return no(`at must be from 0 to under ${LOOP}`);
  /** @type {Gesture} */
  const out = { kind: g.kind, object: g.object, at: Math.min(snap(g.at, 0.001), LOOP - 0.001) };
  for (const [name, f] of Object.entries(fields)) {
    const r = checkField(name, f, g[name], g.kind);
    if ("reason" in r) return no(/** @type {string} */ (r.reason));
    out[name] = r.value;
  }
  return { ok: /** @type {const} */ (true), gesture: out };
}

const TAG = /^[0-9a-f]{6}$/;

/**
 * Checks a whole performance, as stored or copied from an exhibit: a known
 * set, at most CAP gestures and CAP_EACH from anyone, each one valid and
 * already snapped, with its author's tag.
 * @param {any} p
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkPerformance(p) {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return no("a performance must be an object");
  if (!setOf(p.set)) return no("unknown set");
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

// The run's state: the step count, and the set's own state beside it.
const copyRun = (S, st) => ({ step: st.step, s: S.copyState(st.s) });
const viewOf = (S, st) => {
  const t = st.step * STEP;
  return { t, ...S.view(st.s, t) };
};

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
 * Every SNAP_EVERY steps the run keeps a copy of the stage (the set's
 * copyState). `base(k)` hands on the snapshots (and the stage now) from
 * before step k, with the events up to each: a performance whose gestures
 * differ from this one's only at step k or later starts from them
 * (`createRun(p, base)`), since nothing before step k can tell the two
 * apart. Either way every stage and event is exactly what a replay from
 * rest gives, bit for bit.
 */
/** @param {Performance} p @param {RunBase} [from] @returns {Run} */
export function createRun(p, from) {
  const S = setOf(p.set);
  if (!S) throw new Error(`no set ${p.set}`);
  const sched = schedule(p);
  /** @type {any} */
  let st = null;
  const snaps = from ? [...from.snaps] : [];
  const log = from ? [...from.log] : [];
  // how much of the log has been handed out
  let told = 0;
  const emitAt = (e) => log.push({ ...e, t: st.step * STEP });
  const land = () => {
    for (const g of sched.get(st.step) ?? []) S.apply(st.s, g, st.step * STEP, emitAt);
  };
  const steps = (k) => {
    while (st.step < k) {
      st.step++;
      S.tick(st.s, st.step * STEP, emitAt);
      land();
      if (st.step % SNAP_EVERY === 0) snaps.push({ st: copyRun(S, st), n: log.length });
    }
  };
  // back to the latest snapshot at or before step k (or rest, before any)
  const restore = (k) => {
    let j = snaps.length - 1;
    while (j >= 0 && snaps[j].st.step > k) j--;
    if (j < 0) {
      snaps.length = 0;
      log.length = 0;
      st = { step: 0, s: S.startState() };
      // gestures at step 0 land before anything moves
      land();
      snaps.push({ st: copyRun(S, st), n: log.length });
    } else {
      snaps.length = j + 1;
      log.length = snaps[j].n;
      st = copyRun(S, snaps[j].st);
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
      return { stage: viewOf(S, st), events };
    },
    base(k) {
      const out = { snaps: snaps.filter((s) => s.st.step < k), log: [] };
      if (st !== null && st.step < k && st.step > (out.snaps.at(-1)?.st.step ?? -1)) out.snaps.push({ st: copyRun(S, st), n: log.length });
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
 * it's a fresh one (the gestures or the set changed). Gestures are compared
 * by value, however they arrive (a new array, the same array changed, the
 * server's copy), and a fresh run starts from the latest snapshot the
 * change can't have touched, never replaying more than it must.
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

/** The stage at loop moment t.
 * @param {Performance} p @param {number} t @returns {StageView} */
export const simulate = (p, t) => createRun(p).at(t).stage;

/**
 * What a screen shows of a stage at loop moment t: the stage itself, except
 * in the last GLIDE of the loop, where the set eases everything from where
 * it is back to where it rests (the set's `ease`), so the next loop starts
 * where this one ended. Smoothstep on + - * only, so every engine shows the
 * same.
 * @param {StageView} stage @param {string} set @param {number} t @returns {StageView}
 */
export function ease(stage, set, t) {
  const from = LOOP - GLIDE;
  if (t < from) return stage;
  const k = Math.min(1, (t - from) / GLIDE);
  const e = k * k * (3 - 2 * k);
  const S = setOf(set);
  if (!S) return stage;
  return { ...S.ease(stage, e), t: stage.t, home: e };
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

/** The moment a gesture made at loop moment t is recorded at: as made,
 * except during the glide home, when everything is easing to rest and a
 * throw would barely show; then at the top of the next loop (CLAUDE.md,
 * "A gesture made during the glide"). */
export const gestureMoment = (t) => (t >= LOOP - GLIDE ? 0 : t);

/** The loop moment at shared time `seconds`. */
export const loopMoment = (seconds) => ((seconds % LOOP) + LOOP) % LOOP;

/** Where each moving thing of a set rests: its positions at the start of
 * a silent loop (what the glide home ends at). @param {string} set */
export const restPositions = (set) => /** @type {StageSet} */ (setOf(set)).positions(simulate(emptyPerformance(set), 0));
