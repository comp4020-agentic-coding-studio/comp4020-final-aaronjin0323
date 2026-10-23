import { describe, expect, it } from "vitest";
import { LOOP, STAGE, checkPerformance, events, simulate, type Gesture } from "../public/stage.js";
import { CHIMES, HANG, STRIKER_REST, TREE, chimeEnd } from "../public/sets/chimes.js";
import { starter } from "../src/starters/chimes.ts";
import { holdsTheSetContract, mixOf } from "./set-helpers.ts";

// Chime Tree (ADR 18): a ring of tuned chimes and a striker on a cord.
// Each rule that sets one thing off another, each seen red with the rule
// broken (noted per test).

holdsTheSetContract("chimes");

const by = "aaaaaa";
const perf = (gestures: Gesture[]) => ({ set: "chimes", gestures });
const tap = (object: string, at: number): Gesture => ({ kind: "tap", object, at, by });
// the striker drawn out and swung round the ring
const swing = (at: number, v = [0, 0.3, 2.4], from = [0.5, 1.4, 0]): Gesture => ({ kind: "throw", object: "striker", at, from, v, by });
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));

describe("Chime Tree: a tapped chime swings and sounds", () => {
  // seen red: with apply's tap doing nothing, no chime event and no swing
  it("sounds at once, then swings", () => {
    const p = perf([tap("so", 2)]);
    const ev = events(p, 0, LOOP);
    expect(ev[0]).toMatchObject({ kind: "chime", object: "so", by, t: 2 });
    const i = CHIMES.indexOf("so");
    expect(Math.abs(simulate(p, 2.2).swing[i])).toBeGreaterThan(0.05);
    // the others it hasn't reached stay still
    expect(simulate(p, 2.05).swing.filter((th: number) => th !== 0)).toHaveLength(1);
  });
});

describe("Chime Tree: a hard swing knocks its neighbour, a gentle cascade that dies out", () => {
  // seen red: with the knock removed from tick, a hard swing sounds alone
  it("a chime swung hard knocks the next one, which sounds, softer", () => {
    const ev = events(perf([tap("so", 1), tap("so", 1.2)]), 0, LOOP);
    const knocked = ev.filter((e) => e.kind === "chime" && e.by === "so");
    expect(knocked.length).toBeGreaterThan(0);
    expect(["mi", "la"]).toContain(knocked[0].object);
    expect(knocked[0].power).toBeLessThan(ev.filter((e) => e.object === "so").at(-1)!.power);
  });

  // seen red with taps doing nothing (no chime at all)
  it("a single gentle tap rings its own note and knocks nothing", () => {
    const ev = events(perf([tap("re", 3)]), 0, LOOP);
    expect(ev.filter((e) => e.kind === "chime").map((e) => e.object)).toEqual(["re"]);
  });

  // a cascade that weakens as it travels and an end to every swing
  it("never runs away: even hammering every chime, the ring falls quiet", () => {
    const hammer = CHIMES.flatMap((id, i) => [tap(id, 1 + i * 0.05), tap(id, 1.2 + i * 0.05), tap(id, 1.4 + i * 0.05)]);
    const p = perf(hammer);
    const ev = events(p, 0, LOOP);
    expect(ev.filter((e) => e.kind === "chime").length).toBeLessThan(80);
    expect(ev.filter((e) => e.t > 15)).toEqual([]);
    expect(simulate(p, 25).swing.every((th: number) => th === 0)).toBe(true);
  });
});

describe("Chime Tree: the striker swings on its cord and strikes what it passes", () => {
  // seen red: with cord() not called in tick, the striker falls through the floor
  it("stays on its cord: never further from the pivot than the cord, inside the stage", () => {
    for (const g of [swing(1), swing(1, [-5, 2, -5], [0.9, 1.6, 0.3]), swing(1, [6, 6, 6], [2, 2.4, 2])]) {
      const p = perf([g]);
      for (let t = 1; t < LOOP - 2; t += 0.1) {
        const s = simulate(p, t).striker;
        expect(dist(s, TREE.pivot), `t ${t}`).toBeLessThanOrEqual(TREE.cord + 1e-9);
        expect(Math.hypot(s[0], s[2])).toBeLessThan(STAGE.radius);
        expect(s[1]).toBeGreaterThan(0);
        expect(s[1]).toBeLessThanOrEqual(STAGE.ceiling);
      }
    }
  });

  // seen red: with the strike loop removed, no strike and no chime
  it("swung round the ring, it strikes chimes, which sound and set off their neighbours", () => {
    const ev = events(perf([swing(2)]), 0, LOOP);
    const strikes = ev.filter((e) => e.kind === "strike");
    expect(strikes.length).toBeGreaterThanOrEqual(2);
    for (const s of strikes) expect(ev.some((e) => e.kind === "chime" && e.object === s.other && e.by === "striker" && e.t === s.t)).toBe(true);
    // a cascade: chimes knocked by chimes, within a couple of seconds
    expect(ev.filter((e) => e.kind === "chime" && CHIMES.includes(e.by ?? "") && e.t < 4.5).length).toBeGreaterThanOrEqual(2);
    expect(new Set(ev.filter((e) => e.kind === "chime").map((e) => e.object)).size).toBeGreaterThanOrEqual(4);
  });

  // seen red: with the settle check removed, it hung a hair off rest forever
  it("swings like a pendulum, slowing, and comes to rest hanging under its pivot", () => {
    const p = perf([swing(2)]);
    const s = simulate(p, LOOP - 2);
    expect(s.still).toBe(true);
    expect(s.striker).toEqual(STRIKER_REST);
  });

  it("left hanging, nothing strikes the chimes", () => {
    expect(events(perf([]), 0, LOOP)).toEqual([]);
    // and its rest is clear of every tube
    for (let i = 0; i < CHIMES.length; i++) {
      for (let f = 0; f <= 1; f += 0.1) {
        const q = HANG[i].top.map((x, k) => x + (chimeEnd(i, 0)[k] - x) * f);
        expect(dist(q, STRIKER_REST)).toBeGreaterThan(TREE.strikerR + TREE.tubeR);
      }
    }
  });
});

describe("the chimes starter", () => {
  it("is a valid performance on slot 4, written out as data", () => {
    expect(starter.slot).toBe(4);
    expect(starter.title.length).toBeGreaterThan(0);
    expect(starter.title.length).toBeLessThanOrEqual(40);
    expect(starter.parts.set).toBe("chimes");
    expect(checkPerformance(starter.parts)).toEqual({ ok: true });
  });

  it("plays a tune, then a striker swing that cascades", () => {
    const ev = events(starter.parts as { set: string; gestures: Gesture[] }, 0, LOOP);
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ["chime", "throw", "strike"]) expect(kinds.has(k), k).toBe(true);
    // events from several rules: taps, strikes, and chimes knocked by chimes
    const sources = new Set(ev.filter((e) => e.kind === "chime").map((e) => (e.by === "000000" ? "tap" : e.by === "striker" ? "strike" : "knock")));
    expect([...sources].sort()).toEqual(["knock", "strike", "tap"]);
    expect(new Set(ev.filter((e) => e.kind === "chime").map((e) => e.object)).size).toBe(CHIMES.length);
  });
});

describe("a seeded mix always settles", () => {
  // seen red: with T.chain at 1 (every knock passes on all it was given),
  // a mix kept knocking into the glide
  it("every mix ends at rest before the glide", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = perf(mixOf("chimes", seed, 20).map((g) => ({ ...g, at: Math.min(g.at, 18) })));
      const ev = events(p, 0, LOOP);
      expect(ev.filter((e) => e.t > LOOP - 1.5).length, `seed ${seed}`).toBe(0);
    }
  });
});
