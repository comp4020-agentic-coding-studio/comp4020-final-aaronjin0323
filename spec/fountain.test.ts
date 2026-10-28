// The Upside-down Fountain's rules (CLAUDE.md, "The performance"): one
// module the server and the page share, so these hold both.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as F from "../public/fountain.js";

type V3 = [number, number, number];
type Gesture = { kind: "flick"; ball: string; v: V3; at: number } | { kind: "ring"; at: number };
const flick = (ball: string, v: V3, at: number): Gesture => ({ kind: "flick", ball, v, at });
const ring = (at: number): Gesture => ({ kind: "ring", at });
const pos = (st: any, ball: string): V3 => st.balls[ball].pos;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("at rest", () => {
  test("with no gestures nothing moves, all loop long", () => {
    const a = F.simulate([], 0);
    const b = F.simulate([], 13.7);
    for (const id of F.BALLS) expect(pos(b, id)).toEqual(pos(a, id));
    expect(F.simulate([], 13.7).events).toEqual([]);
  });
  test("the balls rest against the dome, apart, inside it", () => {
    const st = F.simulate([], 0);
    for (const id of F.BALLS) {
      const p = pos(st, id);
      expect(p[1]).toBeCloseTo(F.DOME.height - F.BALL_R, 6);
      expect(Math.hypot(p[0], p[2])).toBeLessThan(F.DOME.radius - F.BALL_R);
    }
    for (const a of F.BALLS) for (const b of F.BALLS) if (a < b) expect(dist(pos(st, a), pos(st, b))).toBeGreaterThan(2 * F.BALL_R);
  });
});

describe("gestures", () => {
  test("a flick moves its ball, and only after its moment", () => {
    const g = [flick("teal", [0, -4, 0], 5)];
    const rest = pos(F.simulate([], 0), "teal");
    expect(pos(F.simulate(g, 4.9), "teal")).toEqual(rest);
    expect(dist(pos(F.simulate(g, 5.3), "teal"), rest)).toBeGreaterThan(0.3);
  });
  test("a flicked ball falls back up to the dome", () => {
    const g = [flick("gold", [0, -4, 0], 2)];
    const p = pos(F.simulate(g, 2 + 6), "gold");
    expect(p[1]).toBeGreaterThan(F.DOME.height - F.BALL_R - 0.05);
  });
  test("ringing the bell pushes nearby balls away from it", () => {
    // bring teal down beside the bell, then ring while it's close
    const g = [flick("teal", [-3, -1.7, 0.3], 3)]; // passes near the bell, misses it
    let closest = 99, when = 0;
    for (let t = 3; t < 4.5; t += 1 / 60) {
      const d = dist(pos(F.simulate(g, t), "teal"), F.BELL.pos);
      if (d < closest) [closest, when] = [d, t];
    }
    expect(closest).toBeLessThan(F.RING_REACH);
    const t0 = Math.ceil(when * 60) / 60;
    const quiet = dist(pos(F.simulate(g, t0 + 0.3), "teal"), F.BELL.pos);
    const rung = dist(pos(F.simulate([...g, ring(t0)], t0 + 0.3), "teal"), F.BELL.pos);
    expect(rung).toBeGreaterThan(quiet + 0.2);
  });
  test("a ball hitting the bell rings it", () => {
    const g = [flick("coral", [-3, -5.5, -4], 1)]; // down and in, at the bell
    const st = F.simulate(g, 3);
    expect(st.events.some((e: any) => e.kind === "ring" && e.ball === "coral")).toBe(true);
  });
  test("balls knock each other", () => {
    // teal rests at +x, coral at +z: send teal straight at coral
    const a = pos(F.simulate([], 0), "teal"), b = pos(F.simulate([], 0), "coral");
    const d = dist(a, b);
    const v: V3 = [((b[0] - a[0]) / d) * 3, 0, ((b[2] - a[2]) / d) * 3];
    const st = F.simulate([flick("teal", v, 1)], 2.5);
    expect(st.events.some((e: any) => e.kind === "knock")).toBe(true);
    expect(dist(pos(st, "coral"), b)).toBeGreaterThan(0.1);
  });
});

// ADR 23: a ball carries who last moved it, passed on by every push
describe("whose ball it is", () => {
  const by = <G extends Gesture>(g: G, who: string) => ({ ...g, by: who });
  const towardsCoral = (): V3 => {
    const a = pos(F.simulate([], 0), "teal"), b = pos(F.simulate([], 0), "coral");
    const d = dist(a, b);
    return [((b[0] - a[0]) / d) * 3, 0, ((b[2] - a[2]) / d) * 3];
  };
  test("at rest, nobody's", () => {
    for (const id of F.BALLS) expect(F.simulate([], 5).balls[id].by).toBeNull();
  });
  test("a flick makes the ball the flicker's, from its moment", () => {
    const st = F.simulate([by(flick("gold", [0, -3, 0], 2), "aaaa1111")], 2.5);
    expect(st.balls.gold.by).toBe("aaaa1111");
    expect(st.balls.gold.byAt).toBeCloseTo(2, 6);
    expect(st.balls.teal.by).toBeNull();
  });
  test("a ball that knocks another passes its mover on, and the knock says whose it was", () => {
    const g = [by(flick("coral", [0, -0.6, 0], 0.5), "bbbb2222"), by(flick("teal", towardsCoral(), 1), "aaaa1111")];
    const st = F.simulate(g, 2.5);
    const knock: any = st.events.find((e: any) => e.kind === "knock");
    expect(knock).toMatchObject({ by: "aaaa1111", hit: "coral", was: "bbbb2222" });
    expect(st.balls.coral.by).toBe("aaaa1111");
    expect(st.balls.coral.byAt).toBeCloseTo(knock.t, 6);
  });
  test("a ring makes every ball it pushes the ringer's", () => {
    const g = [by(flick("teal", [-3, -1.7, 0.3], 3), "aaaa1111")];
    let closest = 99, when = 0;
    for (let t = 3; t < 4.5; t += 1 / 60) {
      const d = dist(pos(F.simulate(g, t), "teal"), F.BELL.pos);
      if (d < closest) [closest, when] = [d, t];
    }
    const t0 = Math.ceil(when * 60) / 60;
    const st = F.simulate([...g, by(ring(t0), "cccc3333")], t0 + 0.1);
    expect(st.balls.teal.by).toBe("cccc3333");
    expect(st.balls.gold.by).toBeNull(); // out of reach, at rest by the dome
  });
  test("a ball's ring of the bell is credited to whoever moved the ball", () => {
    const st = F.simulate([by(flick("coral", [-3, -5.5, -4], 1), "aaaa1111")], 3);
    expect(st.events.some((e: any) => e.kind === "ring" && e.ball === "coral" && e.by === "aaaa1111")).toBe(true);
  });
  test("shown passes the mover on to the screen", () => {
    const st = F.simulate([by(flick("plum", [1, -2, 0], 4), "aaaa1111")], 4.5);
    expect((F.shown(st, 4.5).balls as any).plum).toMatchObject({ by: "aaaa1111" });
  });
  test("credit moves nothing: the same positions as before it existed", () => {
    // the fingerprint of the wild run below, taken before ADR 23's change
    const wild: Gesture[] = [];
    for (let i = 0; i < 30; i++) wild.push(i % 5 === 4 ? ring(i * 0.6) : flick(F.BALLS[i % 4], [((i * 7) % 13) - 6, ((i * 5) % 13) - 6, ((i * 3) % 13) - 6], i * 0.6));
    const run = F.createRun(wild.map((g, i) => by(g, `0000000${i % 3}`)));
    const h = createHash("sha256");
    for (let t = 0; t < F.LOOP; t += 0.25) {
      const st = run.at(t);
      for (const id of F.BALLS) h.update(JSON.stringify(st.balls[id].pos));
    }
    expect(h.digest("hex").slice(0, 16)).toBe("2d8836b3dd65ca4b");
  });
});

describe("bounds", () => {
  const wild: Gesture[] = [];
  for (let i = 0; i < 30; i++) wild.push(i % 5 === 4 ? ring(i * 0.6) : flick(F.BALLS[i % 4], [((i * 7) % 13) - 6, ((i * 5) % 13) - 6, ((i * 3) % 13) - 6], i * 0.6));
  test("every ball stays inside the dome at every step, however wild", () => {
    const run = F.createRun(wild);
    for (let t = 0; t < F.LOOP; t += 1 / 60) {
      const st = run.at(t);
      for (const id of F.BALLS) {
        const p = pos(st, id);
        expect(Math.hypot(p[0], p[2])).toBeLessThanOrEqual(F.DOME.radius - F.BALL_R + 1e-9);
        expect(p[1]).toBeGreaterThanOrEqual(F.BALL_R - 1e-9);
        expect(p[1]).toBeLessThanOrEqual(F.DOME.height - F.BALL_R + 1e-9);
      }
    }
  });
  test("a run read forwards matches a fresh simulation, at a real clock time", () => {
    const run = F.createRun(wild);
    for (let t = 0; t < 11.3; t += 0.37) run.at(t);
    expect(run.at(11.3).balls).toEqual(F.simulate(wild, 11.3).balls);
    // and reading backwards starts over rather than going wrong
    expect(run.at(4.2).balls).toEqual(F.simulate(wild, 4.2).balls);
  });
  test("the same gestures give the same performance, to the bit", () => {
    const a = JSON.stringify(F.simulate(wild, 17.25).balls);
    expect(JSON.stringify(F.simulate(wild.map((g) => ({ ...g })), 17.25).balls)).toBe(a);
  });
});

describe("the loop comes round gently", () => {
  test("in the last second every ball eases home, and the wrap doesn't jump", () => {
    const g = [flick("plum", [3, -3, 1], 17), flick("teal", [-2, -4, 2], 18.5)];
    const run = F.createRun(g);
    const rest = F.simulate([], 0);
    let prev = F.shown(run.at(F.LOOP - F.GLIDE - 1 / 60), F.LOOP - F.GLIDE - 1 / 60);
    let worst = 0;
    for (let t = F.LOOP - F.GLIDE; t < F.LOOP; t += 1 / 60) {
      const s = F.shown(run.at(t), t);
      for (const id of F.BALLS) worst = Math.max(worst, dist(pos(s, id), pos(prev, id)));
      prev = s;
    }
    for (const id of F.BALLS) {
      worst = Math.max(worst, dist(pos(prev, id), pos(rest, id)));
      expect(dist(pos(F.shown(run.at(F.LOOP - 1e-9), F.LOOP - 1e-9), id), pos(rest, id))).toBeLessThan(0.01);
    }
    expect(worst).toBeLessThan(0.12);
  });
  test("a gesture made in the glide is kept for the top of the next loop", () => {
    expect(F.gestureMoment(F.LOOP - 0.5)).toBe(0);
    expect(F.gestureMoment(7.25)).toBe(7.25);
  });
});

describe("checkGesture refuses anything it doesn't know, and never clamps", () => {
  const ok = { kind: "flick", ball: "teal", v: [1, -2, 0.5], at: 3 };
  test("a good flick and a good ring pass, rounded to 3 places", () => {
    expect(F.checkGesture({ ...ok, v: [1.23456, -2, 0.5] })).toEqual({ ok: true, gesture: { ...ok, v: [1.235, -2, 0.5] } });
    expect(F.checkGesture({ kind: "ring", at: 19.9 })).toEqual({ ok: true, gesture: { kind: "ring", at: 19.9 } });
  });
  for (const [why, g] of [
    ["unknown kind", { kind: "kick", at: 1 }],
    ["unknown ball", { ...ok, ball: "constructor" }],
    ["extra key", { ...ok, extra: 1 }],
    ["constructor key", JSON.parse('{"kind":"ring","at":1,"constructor":1}')],
    ["at out of range", { ...ok, at: F.LOOP }],
    ["negative at", { ...ok, at: -0.1 }],
    ["speed too high", { ...ok, v: [F.V_MAX + 0.1, 0, 0] }],
    ["not numbers", { ...ok, v: ["1", 0, 0] }],
    ["NaN", { ...ok, at: NaN }],
    ["short v", { ...ok, v: [1, 2] }],
    ["not an object", "ring"],
    ["null", null],
    ["array", []],
  ] as const) {
    test(why, () => expect(F.checkGesture(g).ok).toBe(false));
  }
});

describe("the rules use only arithmetic every engine rounds the same", () => {
  test("no Math.sin, cos, pow, exp, atan2, hypot, random, or ** in public/fountain.js", () => {
    const src = readFileSync("public/fountain.js", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.length).toBeGreaterThan(500);
    expect(src).not.toMatch(/Math\.(sin|cos|tan|pow|exp|log|atan2?|hypot|random|cbrt)\b|\*\*|Date\b|performance\./);
  });
});
