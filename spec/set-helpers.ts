import { describe, expect, it } from "vitest";
import {
  CAP,
  LOOP,
  SETS,
  STEP,
  THROW,
  checkGesture,
  checkPerformance,
  createRun,
  emptyPerformance,
  events,
  follow,
  restPositions,
  shownAt,
  simulate,
  type FieldSpec,
  type Gesture,
  type Performance,
  type StageSet,
} from "../public/stage.js";

// What every set must hold (ADR 18; public/sets/README.md). A set's spec,
// spec/sets-<id>.test.ts, calls `holdsTheSetContract("<id>")` and then
// tests its own rules: each way one object sets another off, each seen red.

const dist = (a: number[], b: number[]): number => Math.hypot(...a.map((x, i) => x - b[i]));

/** The set's positions at every half second, hashed: any change to the
 * rules that moves anything by even the last digit changes it. */
export function fingerprintOf(set: StageSet, gestures: Gesture[] = set.fingerprint.gestures): string {
  const p = { set: set.id, gestures };
  let text = "";
  for (let t = 0; t < LOOP; t += 0.5) for (const pos of set.positions(simulate(p, t))) text += pos.join(",") + ";";
  let h = 0n;
  for (const c of text) h = (h * 131n + BigInt(c.charCodeAt(0))) % (2n ** 61n - 1n);
  return h.toString();
}

// A value inside a field's range, and values just outside it.
const inside = (f: FieldSpec): unknown => ("len" in f ? f.lo.map((lo, i) => Number(((lo + f.hi[i]) / 2).toFixed(3))) : Number(((f.lo + (f.below ?? f.hi!)) / 2).toFixed(3)));
const outside = (f: FieldSpec): unknown[] => {
  if ("len" in f) {
    const mid = inside(f) as number[];
    return [mid.slice(1), [...mid, 0], mid.map((x, i) => (i === 0 ? f.hi[0] + 1 : x)), mid.map((x, i) => (i === 0 ? f.lo[0] - 1 : x)), mid.map((x, i) => (i === 0 ? "1" : x)), mid.map((x, i) => (i === 0 ? Number.NaN : x)), "x", null];
  }
  return [f.lo - f.step, f.below ?? f.hi! + f.step, "0.5", Number.NaN, Infinity, null, [f.lo]];
};

const fieldsOf = (kind: string, shape: StageSet["gestures"][string]): Record<string, FieldSpec> => ({
  ...(kind === "throw"
    ? { from: { len: 3, lo: THROW.fromLo, hi: THROW.fromHi, step: 0.001 }, v: { len: 3, lo: [-THROW.vMax, -THROW.vMax, -THROW.vMax], hi: [THROW.vMax, THROW.vMax, THROW.vMax], step: 0.001 } }
    : {}),
  ...(shape.fields ?? {}),
});

/** A gesture of `kind` on the set that checkGesture accepts as is (no
 * `by`): the shape's first object, every field mid-range. For HTTP tests
 * and for building performances. */
export function validGesture(id: string, kind: string, at = 1, object?: string): Record<string, unknown> {
  const shape = SETS[id].gestures[kind];
  const g: Record<string, unknown> = { kind, object: object ?? shape.objects[0], at };
  for (const [name, f] of Object.entries(fieldsOf(kind, shape))) g[name] = inside(f);
  return g;
}

/** A seeded mix of every gesture the set takes, each checked and snapped. */
export function mixOf(id: string, seed: number, n: number): Gesture[] {
  const set = SETS[id];
  let x = seed;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const kinds = Object.keys(set.gestures);
  return Array.from({ length: n }, () => {
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const shape = set.gestures[kind];
    const g: Record<string, unknown> = { kind, object: shape.objects[Math.floor(rnd() * shape.objects.length)], at: Number((rnd() * (LOOP - 0.01)).toFixed(3)) };
    for (const [name, f] of Object.entries(fieldsOf(kind, shape))) {
      const pick = (lo: number, hi: number) => Number((lo + rnd() * (hi - lo) * 0.98).toFixed(3));
      g[name] = "len" in f ? f.lo.map((lo, i) => pick(lo, f.hi[i])) : pick(f.lo, f.below ?? f.hi!);
    }
    const c = checkGesture(id, g);
    if (!c.ok) throw new Error(`${JSON.stringify(g)}: ${c.reason}`);
    return { ...c.gesture, by: "aaaaaa" };
  });
}

/**
 * Registers the tests every set must pass: its shape, bounds (unknown
 * keys incl. `constructor`, objects and kinds refused; out of range
 * refused, never clamped), determinism, frame-by-frame equal to replay,
 * snapshot/follow equal to a fresh run bit for bit, its fingerprint, and
 * the glide home ending at rest without a jump.
 * `maxJump`: the furthest anything may move between two frames across
 * the glide and the wrap (default 0.1 m, a fast throw's one frame).
 */
export function holdsTheSetContract(id: string, { maxJump = 0.1 }: { maxJump?: number } = {}): void {
  const set = SETS[id];
  const perf = (gestures: Gesture[]): Performance => ({ set: id, gestures });

  describe(`the ${id} set keeps the set contract`, () => {
    it("is registered under its id, with objects, holdables and gestures that agree", () => {
      expect(set, `SETS.${id}`).toBeTruthy();
      expect(set.id).toBe(id);
      expect(set.name.length).toBeGreaterThan(0);
      expect(set.objects.length).toBeGreaterThan(0);
      for (const o of set.objects) {
        expect(o, "object ids are lowercase letters, as the server checks").toMatch(/^[a-z]{1,24}$/);
        expect(set.colour[o], `a colour for ${o}`).toBeTypeOf("number");
      }
      expect(new Set(set.objects).size).toBe(set.objects.length);
      for (const h of set.holdable) expect(set.objects).toContain(h);
      const kinds = Object.keys(set.gestures);
      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) {
        expect(kind).toMatch(/^[a-z]{1,24}$/);
        const shape = set.gestures[kind];
        expect(shape.objects.length).toBeGreaterThan(0);
        for (const o of shape.objects) expect(kind === "throw" ? set.holdable : set.objects, `${kind} ${o}`).toContain(o);
      }
      // every object can be touched somehow, and every holdable thrown
      const touched = new Set(kinds.flatMap((k) => set.gestures[k].objects));
      for (const o of set.objects) expect(touched.has(o), `${o} takes some gesture`).toBe(true);
      if (set.holdable.length) expect(set.gestures.throw?.objects.slice().sort()).toEqual(set.holdable.slice().sort());
      expect(checkPerformance(emptyPerformance(id))).toEqual({ ok: true });
    });

    it("accepts each gesture in bounds, and snaps it", () => {
      for (const kind of Object.keys(set.gestures)) {
        for (const object of set.gestures[kind].objects) {
          const g = validGesture(id, kind, 3.25, object);
          const r = checkGesture(id, g);
          expect(r, JSON.stringify(g)).toEqual({ ok: true, gesture: g });
        }
        const r = checkGesture(id, { ...validGesture(id, kind), at: 1.23456 });
        expect(r.ok && r.gesture.at).toBe(1.235);
      }
    });

    it("refuses unknown kinds, objects and keys (constructor too), and out-of-range or non-number fields, never clamping", () => {
      const bad: unknown[] = [null, [], "tap", 3, { kind: "constructor", object: set.objects[0], at: 1 }, { kind: "nonsense", object: set.objects[0], at: 1 }];
      for (const kind of Object.keys(set.gestures)) {
        const ok = validGesture(id, kind);
        bad.push({ ...ok, object: "nobody" }, { ...ok, object: "constructor" }, { ...ok, extra: 1 }, { ...ok, constructor: 1 }, { ...ok, by: "aaaaaa" });
        bad.push({ ...ok, at: LOOP }, { ...ok, at: -0.1 }, { ...ok, at: "1" }, { ...ok, at: Number.NaN });
        for (const o of set.objects) if (!set.gestures[kind].objects.includes(o)) bad.push({ ...ok, object: o });
        for (const [name, f] of Object.entries(fieldsOf(kind, set.gestures[kind]))) {
          const { [name]: _, ...missing } = ok;
          bad.push(missing);
          for (const v of outside(f)) bad.push({ ...ok, [name]: v });
        }
      }
      for (const g of bad) expect(checkGesture(id, g).ok, JSON.stringify(g)).toBe(false);
      expect(checkGesture("constructor", validGesture(id, Object.keys(set.gestures)[0])).ok).toBe(false);
    });

    it("refuses a performance with an unsnapped or unsigned gesture", () => {
      const g = validGesture(id, Object.keys(set.gestures)[0]);
      expect(checkPerformance(perf([g as Gesture])).ok).toBe(false);
      expect(checkPerformance(perf([{ ...g, by: "abc123" } as Gesture]))).toEqual({ ok: true });
      expect(checkPerformance(perf([{ ...g, at: 1.0001, by: "abc123" } as Gesture])).ok).toBe(false);
      expect(checkPerformance(perf(mixOf(id, 9, 1).flatMap((x) => Array(CAP + 1).fill({ ...x, by: "abc123" })))).ok).toBe(false);
    });

    it("holds still with no gestures", () => {
      const a = set.positions(simulate(emptyPerformance(id), 0));
      const b = set.positions(simulate(emptyPerformance(id), LOOP - STEP));
      expect(a.length).toBeGreaterThan(0);
      a.forEach((p, i) => expect(dist(p, b[i])).toBeLessThan(1e-9));
    });

    it("plays the same on every screen: two runs and a JSON copy agree exactly", () => {
      for (const gestures of [set.fingerprint.gestures, mixOf(id, 3, 20)]) {
        const p = perf(gestures);
        for (const t of [0, 1.5, 7.25, 18, LOOP - 0.5]) {
          expect(simulate(p, t)).toEqual(simulate(JSON.parse(JSON.stringify(p)), t));
          expect(createRun(p).at(t)).toEqual(createRun(p).at(t));
        }
      }
    });

    it("its fingerprint performance plays to the exact same positions, bit for bit", () => {
      const p = perf(set.fingerprint.gestures);
      expect(set.fingerprint.gestures.length).toBeGreaterThan(3);
      expect(checkPerformance(p)).toEqual({ ok: true });
      expect(fingerprintOf(set)).toBe(set.fingerprint.hash);
      expect(events(p, 0, LOOP)).toHaveLength(set.fingerprint.events);
    });

    it("frame by frame at 60, 120 and 47 Hz is simulate's, and every event comes once", () => {
      for (const gestures of [set.fingerprint.gestures, mixOf(id, 11, 16)]) {
        const p = perf(gestures);
        for (const hz of [60, 120, 47]) {
          const run = createRun(p);
          const heard: unknown[] = [];
          for (let f = 0; f / hz < LOOP; f++) {
            const t = f / hz;
            const a = run.at(t);
            heard.push(...a.events);
            if (f % 7 === 0) heard.push(...run.at(t).events);
            if (f % 9 === 0) expect(a.stage, `${hz} Hz at ${t}`).toEqual(simulate(p, t));
          }
          expect(heard, `${hz} Hz`).toEqual(createRun(p).at(LOOP).events);
        }
        // and across the wrap, the next loop plays as the first
        const run = createRun(p);
        for (let f = 0; f < 8 * 60; f++) {
          const t = (LOOP - 3 + f / 60) % LOOP;
          if (f % 13 === 0) expect(run.at(t).stage).toEqual(simulate(p, t));
          else run.at(t);
        }
      }
    });

    it("a run started from another's snapshots (follow) is a fresh run, bit for bit", () => {
      const base = set.fingerprint.gestures;
      const extra = mixOf(id, 41, 3).map((g) => ({ ...g, by: "bbbbbb" }));
      for (const g of extra) {
        const before = perf(base);
        const after = perf([...base, g]);
        const r0 = createRun(before);
        for (const t of [0, g.at + 2, LOOP - 0.1, 0.2, g.at]) r0.at(Math.min(t, LOOP - 0.01));
        const k = Math.round(g.at / STEP);
        const r1 = createRun(after, r0.base(k));
        const fresh = createRun(after);
        for (const t of [g.at, g.at + 1.5, LOOP - 0.5, 1]) {
          const tt = Math.min(t, LOOP - 0.01);
          expect(r1.at(tt), `extra at ${g.at}, t ${tt}`).toEqual(fresh.at(tt));
        }
        // and follow() finds the same
        const f = follow();
        f(before).run.at(LOOP - 1);
        const next = f(after);
        expect(next.fresh).toBe(true);
        expect(next.run.at(LOOP - 0.5).stage).toEqual(simulate(after, LOOP - 0.5));
      }
    });

    it("comes round gently: by the end of the glide everything is back at rest, with no jump", () => {
      const rest = restPositions(id);
      for (const gestures of [set.fingerprint.gestures, mixOf(id, 5, 20)]) {
        const p = perf(gestures);
        const end = set.positions(shownAt(p, LOOP - 1e-6));
        end.forEach((q, i) => expect(dist(q, rest[i]), `thing ${i}`).toBeLessThan(0.01));
        const at = (t: number) => set.positions(shownAt(p, t));
        const jump = (t0: number, t1: number) => Math.max(...at(t0).map((q, i) => dist(q, at(t1)[i])));
        expect(jump(LOOP - STEP, 0)).toBeLessThan(maxJump);
        for (let t = LOOP - 1.5; t < LOOP - STEP; t += STEP) expect(jump(t, t + STEP), `t ${t.toFixed(3)}`).toBeLessThan(maxJump);
        // before the glide, what's shown is the performance itself
        for (const t of [0, 5, 12.5]) expect(shownAt(p, t)).toEqual(simulate(p, t));
      }
    });
  });
}
