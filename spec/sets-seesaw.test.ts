import { describe, expect, it } from "vitest";
import { LOOP, STAGE, STEP, SETS, checkPerformance, createRun, events, simulate, type Gesture } from "../public/stage.js";
import { PLANK, STONES, plankPoint } from "../public/sets/seesaw.js";
import { starter } from "../src/starters/seesaw.ts";
import { holdsTheSetContract, mixOf } from "./set-helpers.ts";

// Tipping Point (ADR 18): a plank on a pivot and three stones under
// gravity. Each way one thing sets another off, each seen red with its
// rule broken.

holdsTheSetContract("seesaw");

const perf = (gestures: Gesture[]) => ({ set: "seesaw", gestures });
const drop = (object: string, at: number, x: number, y = 1.8, vy = -0.5): Gesture => ({ kind: "throw", object, at, from: [x, y, 0], v: [0, vy, 0], by: "aaaaaa" });
const nudge = (at: number, side: number): Gesture => ({ kind: "nudge", object: "plank", at, side, by: "aaaaaa" });
const deg = (turns: number) => turns * 360;
/** The highest a stone goes between t0 and t1. */
function peak(p: { set: string; gestures: Gesture[] }, id: string, t0: number, t1: number): number {
  const run = createRun(p);
  let top = 0;
  for (let t = t0; t < t1; t += STEP) top = Math.max(top, run.at(t).stage.stones[id].pos[1]);
  return top;
}

describe("Tipping Point", { concurrent: false }, () => {
  it("rests with the small stone on the low end and the plank on its stop", () => {
    const s = simulate(perf([]), 12);
    expect(deg(s.a)).toBeCloseTo(20, 6);
    expect(s.stones.pebble.on).toBe(true);
    expect(s.stones.pebble.pos[0]).toBeLessThan(-1.2);
    for (const id of ["stone", "boulder"]) expect(s.stones[id].pos[1]).toBeCloseTo((SETS.seesaw as any).radii[id], 9);
  });

  // Seen red with the landing's impulse on the plank removed (no tip).
  it("a stone landing on the high end tips the plank, harder for a heavier stone", () => {
    const tipped = (id: string) => {
      const run = createRun(perf([drop(id, 1, 1.2)]));
      let fastest = 0;
      let prev = run.at(1).stage.a;
      for (let t = 1 + STEP; t < 2.5; t += STEP) {
        const a = run.at(t).stage.a;
        fastest = Math.max(fastest, Math.abs(a - prev) / STEP);
        prev = a;
      }
      return { a: run.at(3).stage.a, fastest };
    };
    const big = tipped("boulder");
    const mid = tipped("stone");
    expect(deg(big.a), "the big stone's end goes down").toBeCloseTo(-20, 6);
    expect(deg(mid.a)).toBeCloseTo(-20, 6);
    expect(big.fastest, "a heavier stone tips it faster").toBeGreaterThan(mid.fastest * 1.1);
    expect(events(perf([drop("boulder", 1, 1.2)]), 0, 3).some((e) => e.kind === "tip" && e.object === "plank")).toBe(true);
  });

  // Seen red with the catapult rule removed (the pebble stays on its end).
  it("a heavy stone dropped on one end launches the light one on the other end high, every time", () => {
    let low = Infinity;
    let runs = 0;
    for (const x of [0.75, 0.95, 1.15, 1.3]) {
      for (const y of [1.0, 1.4, 1.8, 2.0]) {
        for (const vy of [0, -1, -3]) {
          const p = perf([{ kind: "throw", object: "boulder", at: 2, from: [x, y, 0.03], v: [x > 1.2 ? 0 : 0.3, vy, 0], by: "aaaaaa" }]);
          low = Math.min(low, peak(p, "pebble", 2, 6));
          runs++;
          expect(events(p, 0, 6).some((e) => e.kind === "launch" && e.object === "pebble" && e.by === "plank"), `from ${x} ${y} ${vy}`).toBe(true);
        }
      }
    }
    expect(runs).toBe(48);
    // from resting at about 0.2 m to over 1.5 m, every drop
    expect(low).toBeGreaterThan(1.5);
    // and both ways: the same from the other end
    const back = perf([drop("boulder", 1, 1.2), drop("boulder", 5, -1.2)]);
    expect(peak(back, "pebble", 5, 9)).toBeGreaterThan(1.5);
    expect(peak(back, "pebble", 5, 9)).toBeLessThanOrEqual(STAGE.ceiling - 0.09 + 1e-9);
  });

  // Seen red with the slope's pull removed (a stone landing mid-plank stays put).
  it("a stone resting on the tilted plank slides down its slope to the low end", () => {
    const p = perf([{ kind: "throw", object: "stone", at: 1, from: [0.4, 1.0, 0], v: [0, 0, 0], by: "aaaaaa" }]);
    const s1 = simulate(p, 1.4);
    // it landed on the plank somewhere past the pivot, on the high side
    expect(s1.stones.stone.on).toBe(true);
    const s2 = simulate(p, 4);
    expect(s2.stones.stone.on).toBe(true);
    // ... and ended up down the low end, against the small stone or the lip
    expect(s2.stones.stone.pos[0]).toBeLessThan(-0.9);
    expect(s2.stones.stone.pos[1]).toBeLessThan(s1.stones.stone.pos[1]);
  });

  // Seen red with the nudge rule a no-op.
  it("a nudge on an end kicks the plank, and its swing throws the small stone", () => {
    const p = perf([nudge(1, -1)]);
    const ev = events(p, 0, 4);
    expect(ev.some((e) => e.kind === "nudge" && e.object === "plank" && e.by === "aaaaaa")).toBe(true);
    expect(ev.some((e) => e.kind === "tip")).toBe(true);
    expect(ev.some((e) => e.kind === "launch" && e.object === "pebble")).toBe(true);
    expect(peak(p, "pebble", 1, 4)).toBeGreaterThan(0.9);
    // tapping the high end pushes it down: the same swing
    expect(deg(simulate(perf([nudge(1, 1)]), 1.5).a)).toBeLessThan(0);
    // and the middle hops whatever rides the plank
    const hop = perf([nudge(1, 0)]);
    expect(events(hop, 0, 2).filter((e) => e.kind === "hop").map((e) => e.object)).toEqual(["pebble"]);
    expect(peak(hop, "pebble", 1, 2)).toBeGreaterThan(0.35);
  });

  // Seen red with the floor's bounce set to zero (no thud, no second rise).
  it("a stone thrown at the floor bounces, rolls to the wall and comes back off it", () => {
    const p = perf([{ kind: "throw", object: "stone", at: 1, from: [0.3, 1.2, 1.0], v: [0, -3, 2.5], by: "aaaaaa" }]);
    const ev = events(p, 0, 6);
    expect(ev.some((e) => e.kind === "thud" && e.object === "stone")).toBe(true);
    const run = createRun(p);
    let furthest = 0;
    let rises = 0;
    let prevY = 1.2;
    let falling = true;
    for (let t = 1; t < 6; t += STEP) {
      const q = run.at(t).stage.stones.stone.pos;
      furthest = Math.max(furthest, Math.hypot(q[0], q[2]));
      if (falling && q[1] > prevY + 1e-6) {
        rises++;
        falling = false;
      } else if (q[1] < prevY - 1e-6) falling = true;
      prevY = q[1];
    }
    expect(rises, "it bounces up off the floor").toBeGreaterThanOrEqual(1);
    expect(furthest).toBeLessThanOrEqual(STAGE.radius - 0.13 + 1e-9);
    expect(furthest).toBeGreaterThan(STAGE.radius - 0.2);
    const end = simulate(p, 12).stones.stone.pos;
    expect(Math.hypot(end[0], end[2]), "and comes back off the wall").toBeLessThan(STAGE.radius - 0.2);
  });

  // Seen red with stone-to-stone collisions removed (it passes through).
  it("a stone thrown into another knocks it, and the lighter one moves more", () => {
    const p = perf([{ kind: "throw", object: "boulder", at: 1, from: [-1.3, 0.18, -0.62], v: [3, 0, 0], by: "aaaaaa" }]);
    const ev = events(p, 0, 3);
    expect(ev.some((e) => e.kind === "knock" && [e.object, e.other].sort().join() === "boulder,stone")).toBe(true);
    const before = simulate(perf([]), 0).stones.stone.pos;
    const after = simulate(p, 3).stones.stone.pos;
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(0.5);
  });

  it("everything stays on the stage: inside its radius, between floor and ceiling", () => {
    const run = createRun(perf(SETS.seesaw.fingerprint.gestures));
    let frames = 0;
    for (let t = 0; t < LOOP; t += STEP) {
      const st = run.at(t).stage;
      expect(Math.abs(deg(st.a))).toBeLessThanOrEqual(20 + 1e-9);
      for (const id of STONES) {
        const q = st.stones[id].pos;
        expect(Math.hypot(q[0], q[2])).toBeLessThanOrEqual(STAGE.radius + 1e-9);
        expect(q[1]).toBeGreaterThan(0);
        expect(q[1]).toBeLessThanOrEqual(STAGE.ceiling + 1e-9);
      }
      frames++;
    }
    expect(frames).toBeGreaterThan(1700);
    // the plank's ends too
    for (const a of [PLANK.limit, -PLANK.limit]) for (const lx of [-PLANK.half, PLANK.half]) expect(plankPoint(a, lx)[1]).toBeGreaterThan(0);
  });

  // Seen red with the plank contact snapping a stone onto the top face (a
  // stone under the low end jumped 0.25 m in a frame).
  it("no stone ever jumps between two frames, except where it's thrown from", () => {
    let frames = 0;
    const edges: Gesture[][] = [
      // dropped just past the plank's end, onto its edge
      [{ kind: "throw", object: "boulder", at: 1, from: [1.6, 1.2, 0], v: [0, 0, 0], by: "aaaaaa" }],
      // dropped on the low end's lip, beside the small stone
      [{ kind: "throw", object: "boulder", at: 1, from: [-1.45, 1.2, 0.2], v: [0, 0, 0], by: "aaaaaa" }],
    ];
    for (const gs of [...edges, ...[3, 15, 72].map((seed) => mixOf("seesaw", seed, 14))]) {
      const seed = JSON.stringify(gs[0]);
      const run = createRun(perf(gs));
      let prev: Record<string, number[]> | null = null;
      for (let t = 0; t < LOOP; t += STEP) {
        const st = run.at(t).stage;
        for (const id of STONES) {
          const q = st.stones[id].pos;
          const thrown = gs.some((g) => g.object === id && Math.abs(g.at - t) < 0.02);
          if (prev && !thrown) expect(Math.hypot(...q.map((v: number, i: number) => v - prev![id][i])), `seed ${seed} ${id} at ${t.toFixed(3)}`).toBeLessThan(0.12);
        }
        prev = Object.fromEntries(STONES.map((id) => [id, st.stones[id].pos]));
        frames++;
      }
    }
    expect(frames).toBeGreaterThan(5 * 1700);
  });

  // Seen red with the plank's lean removed (an empty plank kept creeping).
  it("a stone on the floor under a lowering plank rolls out, never holds it creeping for seconds", () => {
    // seed 106 had the pebble halted under the low end each step while the
    // plank crept 4 degrees over 7 s
    let worst = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const run = createRun({ set: "seesaw", gestures: mixOf("seesaw", seed, 8) });
      let prev: number | null = null;
      let slow = 0;
      for (let k = 1; k * STEP < LOOP - 1.2; k++) {
        const v = run.at(k * STEP).stage as unknown as { a: number; stones: Record<string, { on: boolean; pos: number[] }> };
        const w = prev === null ? 0 : (Math.abs(v.a - prev) / STEP) * 2 * Math.PI;
        prev = v.a;
        const under = Object.values(v.stones).some((s) => !s.on && s.pos[1] < 0.45 && Math.abs(s.pos[0]) < PLANK.half && Math.abs(s.pos[2]) < PLANK.width);
        slow = w > 1e-4 && w < 0.05 && under ? slow + 1 : 0;
        worst = Math.max(worst, slow * STEP);
      }
    }
    expect(worst).toBeLessThan(1);
  });

  it("left alone, the plank comes back to rest on its stop", () => {
    // the small stone thrown off, then the plank nudged with nothing on it
    const p = perf([{ kind: "throw", object: "pebble", at: 1, from: [-1.3, 0.3, 0], v: [0, 0.5, 1.8], by: "aaaaaa" }, nudge(4, -1)]);
    const s = simulate(p, 12);
    expect(s.stones.pebble.on).toBe(false);
    expect(Math.abs(s.w)).toBe(0);
    expect(Math.abs(deg(s.a))).toBeCloseTo(20, 6);
  });

  it("the starter is a valid performance on plinth 6, and its loop sets off a chain", () => {
    expect(starter.slot).toBe(6);
    expect(starter.title.length).toBeGreaterThan(0);
    expect(starter.title.length).toBeLessThanOrEqual(40);
    expect(checkPerformance(starter.parts)).toEqual({ ok: true });
    expect(starter.parts.gestures.every((g) => g.by === "000000")).toBe(true);
    const ev = events(starter.parts, 0, LOOP);
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ["land", "tip", "launch", "knock", "nudge"]) expect(kinds, k).toContain(k);
    // the small stone is launched back and forth: from both ends
    const launches = ev.filter((e) => e.kind === "launch" && e.object === "pebble");
    expect(launches.length).toBeGreaterThanOrEqual(3);
    expect(new Set(launches.map((e) => Math.sign(e.pos[0]))).size).toBe(2);
  });
});
