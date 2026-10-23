import { describe, expect, it } from "vitest";
import { LOOP, SETS, STAGE, STEP, checkPerformance, createRun, events, simulate, type Gesture } from "../public/stage.js";
import { BALLS, BALL_R, DOOR_AT, DOOR_REST, FACE, FRAME, shotInto } from "../public/sets/doors.js";
import { starter } from "../src/starters/doors.ts";
import { holdsTheSetContract, mixOf } from "./set-helpers.ts";

// Swap Doors (ADR 18): two door frames joined to each other, three bouncy
// balls. Each rule that sets one thing off another, each seen red with the
// rule broken (noted per test).

holdsTheSetContract("doors");

const perf = (gestures: Gesture[]) => ({ set: "doors", gestures });
const r3 = (x: number) => Number(x.toFixed(3));
const by = "aaaaaa";
// a throw straight into a door's opening from just in front of it, at
// height y and `ahead` metres out, at `speed` (the door at its rest facing)
function into(door: "coraldoor" | "tealdoor", object: string, at: number, { ahead = 0.3, y = 0.45, speed = 2.5 } = {}): Gesture {
  const c = DOOR_AT[door];
  const f = FACE[DOOR_REST[door]];
  return { kind: "throw", object, at, from: [r3(c[0] + f[0] * ahead), y, r3(c[2] + f[1] * ahead)], v: [r3(-f[0] * speed), 0, r3(-f[1] * speed)], by };
}
const tap = (object: string, at: number): Gesture => ({ kind: "tap", object, at, by });
const ballOf = (p: { set: string; gestures: Gesture[] }, id: string, t: number) => simulate(p, t).balls[id] as { pos: number[]; v: number[]; still: boolean };
const flat = (v: number[]) => Math.sqrt(v[0] * v[0] + v[2] * v[2]);

describe("Swap Doors: a ball through one door comes out of the other", () => {
  // seen red: with the doors' crossing check removed, no enter/exit, and
  // the ball flies on behind the coral door
  it("goes in at the coral door and comes out at the teal one, same speed", () => {
    const p = perf([into("coraldoor", "apricot", 2)]);
    const ev = events(p, 0, LOOP);
    const enter = ev.find((e) => e.kind === "enter");
    const exit = ev.find((e) => e.kind === "exit");
    expect(enter).toMatchObject({ object: "apricot", door: "coraldoor" });
    expect(exit).toMatchObject({ object: "apricot", door: "tealdoor" });
    expect(exit!.t).toBe(enter!.t);
    // where it comes out: at the teal door's opening
    const c = DOOR_AT.tealdoor;
    expect(Math.hypot(exit!.pos[0] - c[0], exit!.pos[2] - c[2])).toBeLessThan(FRAME.half);
    // same speed through the door (one step's gravity either side)
    const before = ballOf(p, "apricot", enter!.t - STEP);
    const after = ballOf(p, "apricot", enter!.t);
    expect(flat(after.v)).toBeCloseTo(flat(before.v), 2);
    expect(Math.abs(after.v[1] - before.v[1])).toBeLessThan(0.2);
    // and it's now by the teal door, moving out of its front
    const fB = FACE[DOOR_REST.tealdoor];
    expect(Math.hypot(after.pos[0] - c[0], after.pos[2] - c[2])).toBeLessThan(FRAME.half);
    expect(after.v[0] * fB[0] + after.v[2] * fB[1]).toBeGreaterThan(2);
  });

  // seen red: rotating by kB - kA (no half turn) sent it out of the teal
  // door's back, straight into the wall behind it
  it("its velocity turns with the doors: in the front of one, out the front of the other", () => {
    for (const door of ["coraldoor", "tealdoor"] as const) {
      const other = door === "coraldoor" ? "tealdoor" : "coraldoor";
      const p = perf([into(door, "lemon", 1)]);
      const t = events(p, 0, LOOP).find((e) => e.kind === "exit")!.t;
      const v = ballOf(p, "lemon", t).v;
      const fB = FACE[DOOR_REST[other]];
      // straight out along the other door's facing
      expect((v[0] * fB[0] + v[2] * fB[1]) / flat(v)).toBeCloseTo(1, 6);
    }
  });

  // seen red: with a tap doing nothing, the two exits matched
  it("tapping a door turns it a quarter, and the same shot comes out a quarter turned", () => {
    const shot = into("coraldoor", "apricot", 3);
    const plain = perf([shot]);
    const turned = perf([tap("tealdoor", 1), shot]);
    expect(simulate(turned, 2).doors.tealdoor.turn).toBe((DOOR_REST.tealdoor + 2) % 8);
    const tOut = (p: typeof plain) => events(p, 0, LOOP).find((e) => e.kind === "exit")!.t;
    const a = ballOf(plain, "apricot", tOut(plain)).v;
    const b = ballOf(turned, "apricot", tOut(turned)).v;
    // exactly a quarter turn about the upright: (x, z) -> (-z, x)
    expect(b[0]).toBeCloseTo(-a[2], 12);
    expect(b[2]).toBeCloseTo(a[0], 12);
    expect(b[1]).toBe(a[1]);
    // four taps bring it round to where it was, exactly
    const round = perf([1, 2, 3, 4].map((at) => tap("tealdoor", at)));
    expect(simulate(round, 5).doors.tealdoor.turn).toBe(DOOR_REST.tealdoor);
    expect(events(round, 0, LOOP).filter((e) => e.kind === "turn")).toHaveLength(4);
  });

  // seen red: with the cooldown at 0, the apricot ball, knocked back into
  // the teal door the moment it came out, went straight back through
  it("a ball just through can't go back in at once, even knocked straight back", () => {
    const c = DOOR_AT.tealdoor;
    const f = FACE[DOOR_REST.tealdoor];
    // lemon rushes at the teal door's front as apricot comes out of it
    const rush: Gesture = { kind: "throw", object: "lemon", at: 2, from: [r3(c[0] + f[0] * 0.25), 0.45, r3(c[2] + f[1] * 0.25)], v: [r3(-f[0]), 0, r3(-f[1])], by };
    const p = perf([into("coraldoor", "apricot", 2, { ahead: 0.05, speed: 1.5 }), rush]);
    const ev = events(p, 2, 2.4);
    expect(ev.some((e) => e.kind === "knock")).toBe(true);
    const enters = ev.filter((e) => e.kind === "enter" && e.object === "apricot");
    expect(enters).toHaveLength(1);
  });

  // seen red: with the frame's bars taken out, the ball sailed through the post
  it("the frame itself is solid: a ball off the opening clacks off a post", () => {
    const c = DOOR_AT.coraldoor;
    const f = FACE[DOOR_REST.coraldoor];
    const tg = [-f[1], f[0]];
    const post = [c[0] + tg[0] * FRAME.half, c[2] + tg[1] * FRAME.half];
    const p = perf([{ kind: "throw", object: "plum", at: 1, from: [r3(post[0] + f[0] * 0.4), 0.4, r3(post[1] + f[1] * 0.4)], v: [r3(-f[0] * 2.5), 0, r3(-f[1] * 2.5)], by }]);
    const ev = events(p, 0, 3);
    expect(ev.some((e) => e.kind === "bounce" && e.other === "coraldoor")).toBe(true);
    expect(ev.some((e) => e.kind === "enter")).toBe(false);
  });
});

describe("Swap Doors: bouncy balls", () => {
  // seen red: with floorBounce 0 a ball thumped down and rolled, one bounce event
  it("falls under gravity and bounces off the floor, ticking, then settles", () => {
    const p = perf([{ kind: "throw", object: "lemon", at: 1, from: [0, 1.5, 1.2], v: [0, 0, 0], by }]);
    expect(ballOf(p, "lemon", 1.3).v[1]).toBeLessThan(-1);
    const bounces = events(p, 0, LOOP).filter((e) => e.kind === "bounce" && e.object === "lemon");
    expect(bounces.length).toBeGreaterThanOrEqual(3);
    // each bounce lower than the one before
    for (let i = 1; i < bounces.length; i++) expect(bounces[i].speed).toBeLessThan(bounces[i - 1].speed);
    expect(ballOf(p, "lemon", 12).still).toBe(true);
    expect(ballOf(p, "lemon", 12).pos[1]).toBe(BALL_R);
  });

  // seen red: with the knock loop removed, plum never moved
  it("a ball knocks a resting one going (equal masses: it hands over most of its speed)", () => {
    const rest = simulate(perf([]), 0).balls;
    const plum = rest.plum.pos as number[];
    const p = perf([{ kind: "throw", object: "lemon", at: 1, from: [r3(plum[0] - 0.6), BALL_R, r3(plum[2])], v: [3, 0, 0], by }]);
    const ev = events(p, 0, 3);
    expect(ev.some((e) => e.kind === "knock")).toBe(true);
    const t = ev.find((e) => e.kind === "knock")!.t;
    const after = simulate(p, t + STEP).balls;
    expect(after.plum.v[0]).toBeGreaterThan(2);
    expect(Math.abs(after.lemon.v[0])).toBeLessThan(0.5);
  });

  it("everything stays on the stage, whatever is thrown", () => {
    for (const seed of [1, 2, 3, 7, 19]) {
      const p = perf(mixOf("doors", seed, 30));
      const run = createRun(p);
      for (let t = 0; t < LOOP; t += STEP * 3) {
        const s = run.at(t).stage;
        for (const id of BALLS) {
          const q = s.balls[id].pos;
          expect(Math.hypot(q[0], q[2]), `seed ${seed} ${id} at ${t}`).toBeLessThanOrEqual(STAGE.radius - BALL_R + 1e-9);
          expect(q[1]).toBeGreaterThanOrEqual(BALL_R - 1e-9);
          expect(q[1]).toBeLessThanOrEqual(STAGE.ceiling - BALL_R + 1e-9);
        }
      }
    }
  });

  it("a shot from a ball's place reaches a door's opening (the buttons' throw)", () => {
    const rest = simulate(perf([]), 0);
    const facing = { coraldoor: DOOR_REST.coraldoor, tealdoor: DOOR_REST.tealdoor };
    for (const id of BALLS) {
      const from = (rest.balls[id].pos as number[]).map(r3);
      const p = perf([{ kind: "throw", object: id, at: 1, from, v: shotInto(from, facing), by }]);
      expect(events(p, 1, 3).some((e) => e.kind === "enter" && e.object === id), id).toBe(true);
    }
  });
});

describe("the doors starter", () => {
  it("is a valid performance on slot 5, written out as data", () => {
    expect(starter.slot).toBe(5);
    expect(starter.title.length).toBeGreaterThan(0);
    expect(starter.title.length).toBeLessThanOrEqual(40);
    expect(starter.parts.set).toBe("doors");
    expect(checkPerformance(starter.parts)).toEqual({ ok: true });
  });

  it("uses the doors, turns one halfway, and the next pass goes somewhere new", () => {
    const p = starter.parts as { set: string; gestures: Gesture[] };
    const ev = events(p, 0, LOOP);
    const kinds = new Set(ev.map((e) => e.kind));
    for (const k of ["throw", "enter", "exit", "turn", "bounce"]) expect(kinds.has(k), k).toBe(true);
    expect(ev.filter((e) => e.kind === "enter").length).toBeGreaterThanOrEqual(5);
    const turn = p.gestures.find((g) => g.kind === "tap")!;
    expect(turn.at).toBeGreaterThan(10);
    expect(turn.at).toBeLessThan(20);
    // without the turn, the throws after it end up somewhere else
    const without = { ...p, gestures: p.gestures.filter((g) => g !== turn) };
    // the first pass through after the turn comes out heading another way
    const firstOut = (q: typeof p) => {
      const e = events(q, turn.at, LOOP).find((x) => x.kind === "exit")!;
      const v = simulate(q, e.t).balls[e.object].v as number[];
      return [v[0] / flat(v), v[2] / flat(v)];
    };
    const [a, b] = [firstOut(p), firstOut(without)];
    expect(a[0] * b[0] + a[1] * b[1], "the turned pass leaves at least 45 degrees off").toBeLessThan(0.71);
  });
});
