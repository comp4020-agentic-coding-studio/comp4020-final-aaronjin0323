import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAP,
  GLIDE,
  CAP_EACH,
  LOOP,
  SETS,
  STEP,
  checkGesture,
  checkPerformance,
  createRun,
  emptyPerformance,
  events,
  follow,
  keepNewest,
  shownAt,
  simulate,
  type Gesture,
} from "../public/stage.js";
import { BELL, SPHERES } from "../public/sets/orbit.js";
import { holdsTheSetContract } from "./set-helpers.ts";

// The Loop Stage's rules (CLAUDE.md, "The museum"; ADR 16). What happens on
// the stage is computed from the set, the gestures and the loop moment alone,
// so every screen agrees and no frame writes to the server.

const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const throwAt = (sphere: string, at: number, from: number[], v: number[], by = "aaaaaa") => ({ kind: "throw", object: sphere, at, from, v, by });
const perf = (gestures: Gesture[]) => ({ set: "orbit", gestures });

// What every set holds (spec/set-helpers.ts), Orbit included.
holdsTheSetContract("orbit");

describe("the orbit set", () => {
  it("is four spheres, a ribbon and a bell", () => {
    expect(SPHERES).toHaveLength(4);
    expect(SETS.orbit.objects).toEqual([...SPHERES, "ribbon", "bell"]);
    expect(checkPerformance(emptyPerformance("orbit"))).toEqual({ ok: true });
  });

  it("starts with every sphere resting, and holds still with no gestures", () => {
    const a = simulate(emptyPerformance("orbit"), 0);
    const b = simulate(emptyPerformance("orbit"), LOOP - STEP);
    for (const s of SPHERES) expect(dist(a.spheres[s].pos, b.spheres[s].pos), s).toBeLessThan(1e-9);
  });
});

describe("a gesture is checked", () => {
  it("accepts a throw, a pluck and a tap in bounds", () => {
    expect(checkGesture("orbit", { kind: "throw", object: "teal", at: 3.25, from: [0.2, 0.5, 0.1], v: [1, 2, -0.5] }).ok).toBe(true);
    expect(checkGesture("orbit", { kind: "pluck", object: "ribbon", at: 0, u: 0.4 }).ok).toBe(true);
    expect(checkGesture("orbit", { kind: "tap", object: "bell", at: 11.9 }).ok).toBe(true);
  });

  it("refuses unknown kinds, objects and keys, wrong shapes and out-of-range numbers", () => {
    const bad: unknown[] = [
      null,
      [],
      { kind: "kick", object: "teal", at: 1 },
      { kind: "throw", object: "ribbon", at: 1, from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "nobody", at: 1, from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: 1, from: [0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: 1, from: [0, 0, 0], v: [0, 99, 0] },
      { kind: "throw", object: "teal", at: LOOP, from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: -0.1, from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: 1, from: [2.5, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: "1", from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "throw", object: "teal", at: Number.NaN, from: [0, 0, 0], v: [0, 0, 0] },
      { kind: "pluck", object: "ribbon", at: 1, u: 1 },
      { kind: "pluck", object: "bell", at: 1, u: 0.2 },
      { kind: "tap", object: "bell", at: 1, extra: 1 },
      { kind: "tap", object: "bell", at: 1, constructor: 1 },
      { kind: "tap", object: "bell", at: 1, by: "aaaaaa" },
    ];
    for (const g of bad) expect(checkGesture("orbit", g).ok, JSON.stringify(g)).toBe(false);
  });

  it("snaps times and numbers so they store small", () => {
    const r = checkGesture("orbit", { kind: "throw", object: "gold", at: 1.23456, from: [0.123456, 0, 0], v: [0, 1.98765, 0] });
    expect(r).toEqual({ ok: true, gesture: { kind: "throw", object: "gold", at: 1.235, from: [0.123, 0, 0], v: [0, 1.988, 0] } });
  });
});

describe("a whole performance is checked", () => {
  it("refuses a gesture without its author tag, an unknown set, or too many", () => {
    expect(checkPerformance({ set: "nope", gestures: [] }).ok).toBe(false);
    expect(checkPerformance(perf([{ kind: "tap", object: "bell", at: 1 }])).ok).toBe(false);
    expect(checkPerformance(perf([{ kind: "tap", object: "bell", at: 1, by: "abc123" }])).ok).toBe(true);
    const many = Array.from({ length: CAP + 1 }, (_, i) => ({ kind: "tap", object: "bell", at: i * 0.1, by: "abc123" }));
    expect(checkPerformance(perf(many)).ok).toBe(false);
  });
});

describe("the loop keeps the newest, fairly", () => {
  const tap = (by: string, i: number) => ({ kind: "tap", object: "bell", at: (i % 100) * 0.1, by });

  it("drops your own oldest past CAP_EACH, never someone else's", () => {
    const others = [tap("bbbbbb", 0), tap("cccccc", 1)];
    let gestures = [...others];
    for (let i = 0; i < CAP_EACH + 5; i++) gestures = keepNewest([...gestures, tap("aaaaaa", 10 + i)]);
    expect(gestures.filter((g) => g.by === "aaaaaa")).toHaveLength(CAP_EACH);
    expect(gestures.filter((g) => g.by !== "aaaaaa")).toEqual(others);
    // and it's the newest of yours that stay
    expect(gestures.at(-1)).toEqual(tap("aaaaaa", 10 + CAP_EACH + 4));
  });

  it("drops the oldest of all past CAP", () => {
    let gestures: ReturnType<typeof tap>[] = [];
    const who = ["aaaaaa", "bbbbbb", "cccccc", "dddddd", "eeeeee"];
    for (let i = 0; i < CAP + 7; i++) gestures = keepNewest([...gestures, tap(who[i % who.length], i)]);
    expect(gestures).toHaveLength(CAP);
    expect(gestures[0]).toEqual(tap(who[7 % who.length], 7));
  });
});

describe("the objects set each other off", () => {
  // the shared clock as the page reads it is huge; the loop moment is what
  // the rules take, and a real clock time maps onto it
  const NOW = 1_792_000_000.25;
  const moment = NOW % LOOP;

  it("a thrown sphere moves, and the same gestures give the same stage on every screen", () => {
    const p = perf([throwAt("teal", 1, [0.3, 0.4, 0.2], [0.5, 1.5, -0.4])]);
    const before = simulate(p, 0.9);
    const after = simulate(p, 2);
    expect(dist(before.spheres.teal.pos, after.spheres.teal.pos)).toBeGreaterThan(0.2);
    expect(simulate(p, moment)).toEqual(simulate(JSON.parse(JSON.stringify(p)), moment));
  });

  it("a thrown sphere floats upward and stays inside the stage", () => {
    const p = perf([throwAt("gold", 0.5, [0, 0.3, 0], [0.2, 0, 0.1])]);
    const later = simulate(p, 2.5);
    expect(later.spheres.gold.pos[1]).toBeGreaterThan(0.3);
    for (let t = 0; t < LOOP; t += 0.5) {
      const s = simulate(p, t).spheres.gold.pos;
      expect(Math.hypot(s[0], s[2]), `t ${t}`).toBeLessThan(SETS.orbit.radius + 1e-6);
      expect(s[1]).toBeLessThan(SETS.orbit.ceiling + 1e-6);
      expect(s[1]).toBeGreaterThan(-1e-6);
    }
  });

  it("a sphere thrown through the ribbon is caught and rides it", () => {
    // straight at a point of the ribbon, from just beside it
    const p = perf([throwAt("chrome", 1, [0.62, 0.95, 0], [0.9, 0, 0])]);
    const at = simulate(p, 2.2).spheres.chrome;
    expect(at.riding).toBe(true);
    const ev = events(p, 0, 3).filter((e) => e.kind === "catch" && e.object === "chrome");
    expect(ev.length).toBeGreaterThan(0);
  });

  it("plucking the ribbon flings a riding sphere off it", () => {
    const caught = [throwAt("chrome", 1, [0.62, 0.95, 0], [0.9, 0, 0])];
    expect(simulate(perf(caught), 3).spheres.chrome.riding).toBe(true);
    const plucked = perf([...caught, { kind: "pluck", object: "ribbon", at: 3.2, u: 0, by: "bbbbbb" }]);
    const fling = events(plucked, 3, 5).find((e) => e.kind === "fling" && e.object === "chrome");
    expect(fling).toBeTruthy();
    // thrown outward, away from the centre, faster than drifting up would
    const off = simulate(plucked, fling!.t + 0.4).spheres.chrome;
    expect(off.riding).toBe(false);
    expect(Math.hypot(off.pos[0], off.pos[2]) - Math.hypot(fling!.pos[0], fling!.pos[2])).toBeGreaterThan(0.2);
  });

  it("a pluck's pulse reaches a rider when it gets there, not at once", () => {
    const caught = [throwAt("chrome", 1, [0.62, 0.95, 0], [0.9, 0, 0])];
    const u = simulate(perf(caught), 3.2).spheres.chrome.u;
    // plucked at the far side of the ribbon: half a loop away
    const plucked = perf([...caught, { kind: "pluck", object: "ribbon", at: 3.2, u: Number(((u + 0.5) % 1).toFixed(3)), by: "bbbbbb" }]);
    const fling = events(plucked, 3.2, 5).find((e) => e.kind === "fling");
    expect(fling).toBeTruthy();
    expect(fling!.t - 3.2).toBeGreaterThan(0.3);
  });

  it("a pulse that has already passed doesn't fling a sphere caught behind it", () => {
    const caught = [throwAt("chrome", 1, [0.62, 0.95, 0], [0.9, 0, 0])];
    const c = events(perf(caught), 0, 3).find((e) => e.kind === "catch")!;
    const u = simulate(perf(caught), c.t).spheres.chrome.u;
    // plucked where chrome will be caught, a moment before: the pulse is
    // still running when chrome lands, but it has already gone past
    const p = perf([{ kind: "pluck", object: "ribbon", at: Number((c.t - 0.18).toFixed(3)), u: Number(u.toFixed(3)), by: "bbbbbb" }, ...caught]);
    expect(simulate(p, c.t + 0.5).spheres.chrome.riding).toBe(true);
  });

  it("tapping the bell rings it and hops a sphere resting near it", () => {
    const near = SPHERES.find((s) => dist(SETS.orbit.rest[s], BELL.pos) < BELL.reach)!;
    expect(near, "a sphere rests within the bell's reach").toBeTruthy();
    const p = perf([{ kind: "tap", object: "bell", at: 2, by: "aaaaaa" }]);
    const ev = events(p, 1.9, 2.5);
    expect(ev.some((e) => e.kind === "ring")).toBe(true);
    // hopped away from the bell, sideways, not just drifting up
    const was = SETS.orbit.rest[near];
    const now = simulate(p, 2.4).spheres[near].pos;
    const flat = (q: number[]) => Math.hypot(q[0] - BELL.pos[0], q[2] - BELL.pos[2]);
    expect(flat(now) - flat(was)).toBeGreaterThan(0.15);
    // a sphere out of reach doesn't move
    const far = SPHERES.find((s) => dist(SETS.orbit.rest[s], BELL.pos) > BELL.reach + 0.3)!;
    expect(dist(simulate(p, 3).spheres[far].pos, SETS.orbit.rest[far])).toBeLessThan(1e-9);
  });

  it("a sphere that hits the bell rings it", () => {
    const from = [BELL.pos[0], BELL.pos[1] - 0.6, BELL.pos[2]];
    const p = perf([throwAt("dusk", 1, from, [0, 1.6, 0])]);
    expect(events(p, 1, 2.5).some((e) => e.kind === "ring" && e.by === "dusk")).toBe(true);
  });

  it("a sphere under the bell is knocked aside, not trapped ringing it", () => {
    const from = [BELL.pos[0], 0.2, BELL.pos[2]];
    const p = perf([throwAt("dusk", 1, from, [0, 1.6, 0])]);
    expect(events(p, 1, LOOP).filter((e) => e.kind === "ring").length).toBeLessThanOrEqual(2);
  });

  it("spheres knock into each other", () => {
    const target = SETS.orbit.rest.teal;
    const from = [target[0] - 0.6, target[1], target[2]];
    const p = perf([throwAt("gold", 1, from, [1.6, 0, 0])]);
    const knock = events(p, 1, 2).find((e) => e.kind === "knock");
    expect(knock).toBeTruthy();
    // teal is sent on along the line of the hit (+x), not just drifting up
    const after = simulate(p, knock!.t + 0.3).spheres;
    expect(after.teal.pos[0] - target[0]).toBeGreaterThan(0.15);
    // a real knock: gold hands its speed on and teal pulls away from it,
    // rather than the two being shoved along together
    expect(dist(after.teal.pos, after.gold.pos)).toBeGreaterThan(2 * SETS.orbit.sphereR + 0.15);
  });

  it("the loop starts over: every cycle replays the same performance from rest", () => {
    const p = perf([throwAt("teal", 1, [0.3, 0.4, 0.2], [0.5, 1.5, -0.4])]);
    expect(simulate(p, 0)).toEqual(simulate(emptyPerformance("orbit"), 0));
  });
});

describe("every browser plays the same performance", () => {
  // JavaScript lets each engine approximate sin, cos, pow, exp and ** in
  // the last digit; + - * / and sqrt are exactly rounded everywhere. A
  // last-digit difference grows through collisions until two screens
  // disagree (CLAUDE.md, "The rules use only arithmetic every engine rounds
  // the same").
  // Every rules file: stage.js and each set's rules in public/sets/ (not a
  // *-view.js, which only draws). Seen red with a Math.sin in orbit.js.
  it("the rules use no maths an engine may approximate, in stage.js and every set's rules", () => {
    const files = ["public/stage.js", ...readdirSync("public/sets").filter((f) => f.endsWith(".js") && !f.endsWith("-view.js")).map((f) => `public/sets/${f}`)];
    expect(files).toContain("public/sets/kit.js");
    // every registered set has its rules file there
    for (const id of Object.keys(SETS)) expect(files).toContain(`public/sets/${id}.js`);
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const bad = code.match(/Math\.(sin|cos|tan|asin|acos|atan2?|pow|exp|expm1|log\w*|cbrt|hypot|sinh|cosh|tanh|random)\b|\*\*|\bDate\b|\bperformance\.now\b/g) ?? [];
      expect(bad, file).toEqual([]);
    }
  });

  // A busy performance's exact positions, every half second, hashed. Node
  // and Chrome share an engine, so this can't compare browsers itself; what
  // it holds is that the bits never drift: any change to the rules that
  // moves a sphere by even the last digit shows here, and must be a
  // decision, since it changes every saved performance.
  it("a busy performance plays to the exact same positions, bit for bit", () => {
    const g: Gesture[] = [
      { kind: "throw", object: "teal", at: 0.5, from: [-0.62, 0.95, 0], v: [-0.9, 0, 0], by: "aaaaaa" },
      { kind: "throw", object: "gold", at: 1, from: [-0.6, 0.3, -0.2], v: [2.2, 0.2, 0.1], by: "aaaaaa" },
      { kind: "tap", object: "bell", at: 2, by: "aaaaaa" },
      { kind: "throw", object: "dusk", at: 3, from: [0, 0.15, 0], v: [0, 1.8, 0], by: "aaaaaa" },
      { kind: "pluck", object: "ribbon", at: 5, u: 0.5, by: "aaaaaa" },
      { kind: "throw", object: "chrome", at: 6.5, from: [1.2, 0.3, 0.6], v: [-2, 0.3, -0.6], by: "aaaaaa" },
      { kind: "tap", object: "bell", at: 9, by: "aaaaaa" },
    ];
    let text = "";
    for (let t = 0; t < LOOP; t += 0.5) {
      const s = simulate(perf(g), t);
      for (const id of SPHERES) text += s.spheres[id].pos.join(",") + ";";
    }
    let h = 0n;
    for (const c of text) h = (h * 131n + BigInt(c.charCodeAt(0))) % (2n ** 61n - 1n);
    expect(h.toString()).toBe("236435486642795239");
    expect(events(perf(g), 0, LOOP)).toHaveLength(15);
  });
});

describe("the loop comes round gently", () => {
  // a busy loop: spheres flung far from where they rest by the end
  const busy = perf([
    throwAt("teal", 1, [-0.62, 0.95, 0], [-0.9, 0, 0]),
    throwAt("gold", 2, [-0.6, 0.3, -0.2], [2.2, 0.2, 0.1]),
    { kind: "pluck", object: "ribbon", at: 6, u: 0.5, by: "bbbbbb" },
    throwAt("dusk", 20, [0, 0.15, 0], [0, 1.8, 0]),
    throwAt("chrome", LOOP - 3, [1.2, 0.3, 0.6], [-2, 0.3, -0.6]),
  ]);
  const frame = 1 / 60;
  const jump = (t0: number, t1: number) => Math.max(...SPHERES.map((id) => dist(shownAt(busy, t0).spheres[id].pos, shownAt(busy, t1).spheres[id].pos)));

  it("is 30 seconds long", () => {
    expect(LOOP).toBe(30);
  });

  it("no sphere jumps between the last frame of a loop and the first of the next", () => {
    // as far as a fast throw moves in one frame, at most
    const limit = 6 * frame;
    expect(jump(LOOP - frame, 0)).toBeLessThan(limit);
    for (let t = LOOP - GLIDE - 0.5; t < LOOP - frame; t += frame) expect(jump(t, t + frame), `t ${t.toFixed(3)}`).toBeLessThan(limit);
  });

  it("before the glide, what's shown is the performance itself", () => {
    for (const t of [0, 5, 12.5, LOOP - GLIDE - 0.01]) expect(shownAt(busy, t)).toEqual(simulate(busy, t));
  });

  it("by the end of the glide every sphere is back where it rests, as the next loop starts", () => {
    const end = shownAt(busy, LOOP - 1e-6);
    for (const id of SPHERES) expect(dist(end.spheres[id].pos, SETS.orbit.rest[id]), id).toBeLessThan(0.01);
  });

  it("is the same on every screen: a pure function of the loop moment", () => {
    expect(shownAt(busy, LOOP - 0.6)).toEqual(shownAt(JSON.parse(JSON.stringify(busy)), LOOP - 0.6));
  });
});

// a seeded mix of throws, plucks and taps, each checked and snapped
const mix = (seed: number, n: number): Gesture[] => {
  let x = seed;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const r3 = (v: number) => Number(v.toFixed(3));
  return Array.from({ length: n }, () => {
    const at = r3(rnd() * (LOOP - 0.01));
    const k = rnd();
    const g =
      k < 0.6
        ? { kind: "throw", object: SPHERES[Math.floor(rnd() * 4)], at, from: [r3(rnd() * 2 - 1), r3(0.2 + rnd()), r3(rnd() * 2 - 1)], v: [r3(rnd() * 4 - 2), r3(rnd() * 2), r3(rnd() * 4 - 2)] }
        : k < 0.8
          ? { kind: "pluck", object: "ribbon", at, u: r3(rnd() * 0.99) }
          : { kind: "tap", object: "bell", at };
    const c = checkGesture("orbit", g);
    if (!c.ok) throw new Error(c.reason);
    return { ...c.gesture, by: "aaaaaa" };
  });
};

// Playing a performance frame by frame, as every screen does, has to be
// the rule itself: at every frame the stage is simulate's, bit for bit,
// whatever the frame rate, and everything that happens is heard once.
// (Seen red: each call re-applied the gestures of the step it stood on, so
// at 60 Hz a pluck sent two pulses and a throw flashed three times, and a
// screen held still at 0 added a pulse every frame.)
describe("frame by frame is the rule itself", () => {
  const busy = [throwAt("chrome", 1, [0.62, 0.95, 0], [0.9, 0, 0]), { kind: "pluck", object: "ribbon", at: 3.2, u: 0, by: "bbbbbb" }, { kind: "tap", object: "bell", at: 5, by: "aaaaaa" }];

  it("at 60 Hz, 120 Hz and 47 Hz, every frame is simulate's and every event comes once", () => {
    for (const gestures of [busy, mix(11, 12), mix(29, 30)]) {
      const p = perf(gestures);
      for (const hz of [60, 120, 47]) {
        const run = createRun(p);
        const heard: unknown[] = [];
        for (let f = 0; f / hz < LOOP; f++) {
          const t = f / hz;
          const a = run.at(t);
          heard.push(...a.events);
          // a frame asked for twice hears nothing new
          if (f % 7 === 0) heard.push(...run.at(t).events);
          if (f % 5 === 0) expect(a.stage, `${hz} Hz at ${t}`).toEqual(simulate(p, t));
        }
        expect(heard, `${hz} Hz`).toEqual(createRun(p).at(LOOP).events);
      }
    }
  });

  it("held still at the start, the stage doesn't change", () => {
    const p = perf([{ kind: "pluck", object: "ribbon", at: 0, u: 0.3, by: "aaaaaa" }]);
    const run = createRun(p);
    const first = run.at(0).stage;
    for (let i = 0; i < 30; i++) expect(run.at(0).stage).toEqual(first);
  });

  it("across the wrap, the next loop plays exactly as the first", () => {
    const p = perf(mix(5, 20));
    const run = createRun(p);
    for (let f = 0; f < 70 * 60; f++) {
      const t = (LOOP - 3 + f / 60) % LOOP;
      const a = run.at(t).stage;
      if (f % 11 === 0) expect(a, `t ${t}`).toEqual(simulate(p, t));
    }
  });
});

// A screen keeps one run per performance and replays only when the
// gestures change (stageview's update), from the latest moment that the
// change can't have touched. The check must never miss a change, however
// the gestures arrive: a new array, the same array pushed to, an element
// swapped, an undo; and the server's copy of the same gestures needs none.
describe("a screen follows a performance as it changes", () => {
  it("replays exactly when the gestures change, and plays what a fresh run would", () => {
    const follower = follow();
    let x = 3;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    let n = 0;
    const make = () => mix(100 + n++, 1)[0];
    let gestures: Gesture[] = mix(1, 6);
    let shown = "";
    let replays = 0;
    let changes = 0;
    for (let step = 0; step < 300; step++) {
      const k = rnd();
      if (k < 0.15) gestures = [...gestures, make()]; // a new gesture
      else if (k < 0.25) gestures.push(make()); // pushed onto the same array
      else if (k < 0.35 && gestures.length) gestures[Math.floor(rnd() * gestures.length)] = make(); // swapped in place
      else if (k < 0.45 && gestures.length) gestures = gestures.slice(1); // the oldest dropped
      else if (k < 0.6) gestures = JSON.parse(JSON.stringify(gestures)); // the server's copy
      else if (k < 0.7) gestures = [...gestures]; // a new array, the same gestures
      if (gestures.length > CAP) gestures = gestures.slice(-CAP);
      const p = perf(gestures);
      const now = JSON.stringify(gestures);
      if (now !== shown) changes++;
      shown = now;
      const r = follower(p);
      if (r.fresh) replays++;
      // a few frames on from a random moment, as a screen plays
      const t0 = rnd() * (LOOP - 1);
      for (let f = 0; f < 3; f++) {
        const t = t0 + f / 60;
        const a = r.run.at(t);
        expect(a.stage, `step ${step} at ${t}`).toEqual(simulate(p, t));
        // a fresh run hears what a full replay hears
        if (r.fresh && f === 0) expect(a.events, `step ${step}`).toEqual(createRun(p).at(t).events);
      }
    }
    expect(changes).toBeGreaterThan(50);
    expect(replays).toBe(changes);
  });

  it("a change on a whole second, where a snapshot is kept, or on the moment being shown, plays as a fresh run", () => {
    const base = mix(77, 10);
    for (const at of [0, 1, 2, 5, 12, 12.017, 20, LOOP - 1]) {
      for (const shownAt of [at, at + 0.5, at + 3]) {
        const follower = follow();
        const before = perf(base);
        const r0 = follower(before);
        // played on past the change, across a wrap, and back to it
        for (const t of [0, shownAt, LOOP - 0.1, 0.2, shownAt]) r0.run.at(Math.min(t, LOOP - 0.01));
        const extra = [...base, { kind: "throw", object: "gold", at, from: [-0.6, 0.3, -0.2], v: [2.2, 0.2, 0.1], by: "bbbbbb" }];
        const after = perf(extra);
        const r1 = follower(after);
        expect(r1.fresh).toBe(true);
        for (const t of [shownAt, shownAt + 1.5, LOOP - 0.5, 1]) expect(r1.run.at(Math.min(t, LOOP - 0.01)).stage, `at ${at}, shown ${shownAt}, t ${t}`).toEqual(simulate(after, Math.min(t, LOOP - 0.01)));
      }
    }
  });
});
