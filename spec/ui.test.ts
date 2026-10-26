// The page's decisions, as pure functions (public/ui.js), held without a
// browser: the shared clock, the connection, a flick from a drag, what a
// gesture button does, the latest chain in words, and where "Leave it"
// can put a loop.
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as ui from "../public/ui.js";
// @ts-ignore -- plain JS module shared with the page
import { LOOP, V_MAX, checkGesture, simulate } from "../public/fountain.js";

describe("the shared clock", () => {
  test("two pages with different clocks agree on the loop moment", () => {
    const server = Date.parse("2026-11-01T00:00:07.500Z");
    const a = ui.clockOffset(new Date(server).toISOString(), server - 3000); // 3 s slow
    const b = ui.clockOffset(new Date(server).toISOString(), server + 9000); // 9 s fast
    expect(ui.loopNow(server - 3000 + 1234, a)).toBeCloseTo(ui.loopNow(server + 9000 + 1234, b), 6);
    expect(ui.loopNow(server - 3000, a)).toBeGreaterThanOrEqual(0);
    expect(ui.loopNow(server - 3000, a)).toBeLessThan(LOOP);
  });
  test("a bad serverTime leaves the clock alone", () => {
    expect(ui.clockOffset("nope", 1000)).toBe(0);
  });
});

describe("the connection", () => {
  test("play waits for the first state, a drop takes it away until the next first state", () => {
    let c = ui.INITIAL_CONN;
    expect(ui.canPlay(c)).toBe(false);
    c = ui.connection(c, "state");
    expect(ui.canPlay(c)).toBe(true);
    c = ui.connection(c, "error");
    expect(ui.canPlay(c)).toBe(false);
    expect(ui.connectionMessage(c)).toMatch(/reconnecting/i);
    c = ui.connection(c, "open");
    expect(ui.canPlay(c)).toBe(false);
    c = ui.connection(c, "state");
    expect(ui.canPlay(c)).toBe(true);
    expect(ui.connectionMessage(c)).toBe("");
  });
});

describe("a flick from a drag", () => {
  test("the ball goes the way you dragged, faster the further, never past V_MAX", () => {
    const v = ui.flickFrom([0, 1, 0], [0.5, 1, 0]);
    expect(v[0]).toBeGreaterThan(0);
    expect(Math.abs(v[1])).toBeLessThan(1e-9);
    const far = ui.flickFrom([0, 1, 0], [9, -9, 9]);
    expect(far.every((x: number) => Math.abs(x) <= V_MAX)).toBe(true);
    expect(checkGesture({ kind: "flick", ball: "teal", v: far, at: 1 }).ok).toBe(true);
  });
  test("a press without a drag is a hop: down, then it falls back up", () => {
    const v = ui.flickFrom([0, 1, 0], [0, 1, 0]);
    expect(v[1]).toBeLessThan(-1);
  });
  test("a button flick throws the ball down and in from wherever it is", () => {
    const v = ui.buttonFlick([0.85, 1.64, 0]);
    expect(v[0]).toBeLessThan(0);
    expect(v[1]).toBeLessThan(0);
    expect(checkGesture({ kind: "flick", ball: "teal", v, at: 1 }).ok).toBe(true);
  });
});

describe("where Leave it can go", () => {
  const ex = (id: number, title: string) => ({ id, latest: { title, n: 1 }, versionCount: 1 });
  const state = { slots: [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, exhibit: slot === 2 ? ex(7, "Bells") : null })) };
  test("every plinth is offered: empty ones as new, taken ones as a new version or a replacement", () => {
    const t = ui.publishTargets(state);
    expect(t.filter((x: any) => x.kind === "empty").map((x: any) => x.slot)).toEqual([1, 3, 4, 5, 6]);
    expect(t.find((x: any) => x.kind === "version")).toMatchObject({ exhibitId: 7, label: expect.stringContaining("Bells") });
    expect(t.find((x: any) => x.kind === "replace")).toMatchObject({ slot: 2, label: expect.stringContaining("storeroom") });
  });
  test("each target says what request it makes", () => {
    const t = ui.publishTargets(state);
    expect(ui.publishBody(t.find((x: any) => x.kind === "empty"), "T")).toEqual({ title: "T", slot: 1 });
    expect(ui.publishBody(t.find((x: any) => x.kind === "version"), "T")).toEqual({ title: "T", exhibitId: 7 });
    expect(ui.publishBody(t.find((x: any) => x.kind === "replace"), "T")).toEqual({ title: "T", slot: 2, replace: true });
  });
  test("a suggested title is short and depends on the gestures", () => {
    const a = ui.suggestTitle([{ kind: "ring", at: 1 }]);
    const b = ui.suggestTitle([{ kind: "flick", ball: "gold", v: [1, 1, 1], at: 2 }, { kind: "flick", ball: "plum", v: [1, 1, 1], at: 3 }]);
    for (const t of [a, b]) expect(t.length).toBeGreaterThan(0), expect(t.length).toBeLessThanOrEqual(40);
    expect(a).not.toBe(b);
  });
});

describe("the latest chain, in words (ADR 23)", () => {
  const A = "aaaa1111", B = "bbbb2222";
  const name = (tag: string) => ({ [A]: "Rosy Wren", [B]: "Copper Ibis" })[tag] ?? "Someone";
  // teal rests at +x, coral at +z: Copper nudges coral, then Rosy sends teal into it
  const knockRun = [
    { kind: "flick", ball: "coral", v: [0, -0.6, 0], at: 0.5, by: B },
    { kind: "flick", ball: "teal", v: [-2.12, 0, 2.12], at: 1, by: A },
  ];
  test("who started it, and whose ball their ball knocked", () => {
    const st = simulate(knockRun, 2.5);
    expect(ui.chainStory(st.events, 2.5, name, "")).toMatch(/^Rosy Wren flicked teal; teal knocked Copper Ibis's coral/);
  });
  test("you are you", () => {
    const st = simulate(knockRun, 2.5);
    expect(ui.chainStory(st.events, 2.5, name, A)).toMatch(/^You flicked teal; teal knocked Copper Ibis's coral/);
    expect(ui.chainStory(st.events, 2.5, name, B)).toMatch(/^Rosy Wren flicked teal; teal knocked your coral/);
  });
  test("a ball ringing the bell is part of the chain", () => {
    const st = simulate([{ kind: "flick", ball: "coral", v: [-3, -5.5, -4], at: 1, by: A }], 3);
    expect(ui.chainStory(st.events, 3, name, "")).toMatch(/^Rosy Wren flicked coral; .*coral rang the bell/);
  });
  test("a ring of the bell starts a chain; the newest gesture is the story; it ends with a full stop", () => {
    const events = [
      { kind: "flick", ball: "gold", by: A, t: 1 },
      { kind: "ring", by: B, t: 2 },
    ];
    expect(ui.chainStory(events, 2.5, name, "")).toBe("Copper Ibis rang the bell.");
  });
  test("it goes quiet a few seconds after the last gesture, and when nothing has happened", () => {
    const events = [{ kind: "flick", ball: "gold", by: A, t: 1 }];
    expect(ui.chainStory(events, 2, name, "")).toBe("Rosy Wren flicked gold.");
    expect(ui.chainStory(events, 9, name, "")).toBe("");
    expect(ui.chainStory([], 9, name, "")).toBe("");
  });
});
