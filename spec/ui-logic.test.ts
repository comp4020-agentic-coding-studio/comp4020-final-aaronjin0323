// The page's decisions, held without a browser or the running app: the
// connection, which publish flow a choice means, the words for a gesture and
// the title a performance suggests. public/ui-logic.js is plain JS the page
// imports as is.
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as ui from "../public/ui-logic.js";

const who = (name: string, colour = 0) => ({ tag: name.slice(0, 6).padEnd(6, "0"), name, colour });
const exhibit = (id: number, title: string, versionCount = 1, slot: number | null = null) => ({ id, slot, latest: { title, n: versionCount }, versionCount });

describe("connection", () => {
  test("editing waits for the first state, and a drop takes it away", () => {
    let c = ui.INITIAL_CONN;
    expect(ui.canEdit(c)).toBe(false);
    c = ui.connection(c, "open");
    expect(ui.canEdit(c)).toBe(false);
    c = ui.connection(c, "state");
    expect(ui.canEdit(c)).toBe(true);
    c = ui.connection(c, "error");
    expect(ui.canEdit(c)).toBe(false);
    expect(ui.connectionMessage(c)).toMatch(/^Reconnecting/);
  });
  test("a reopened stream stays view-only until its own first state", () => {
    let c = ui.connection(ui.connection(ui.connection(ui.INITIAL_CONN, "state"), "error"), "open");
    expect(ui.canEdit(c)).toBe(false);
    c = ui.connection(c, "state");
    expect(ui.canEdit(c)).toBe(true);
    expect(ui.connectionMessage(c)).toBe("");
  });
});

describe("publishPlan", () => {
  const state = {
    slots: [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, exhibit: slot === 1 ? exhibit(10, "Loop & Lantern", 2, 1) : null })),
    storeroom: [exhibit(20, "Old Bloom", 3)],
  };
  test("an empty slot is a new exhibit, no confirm", () => {
    const p = ui.publishPlan(state, { slot: 4 }, "Mine");
    expect(p).toMatchObject({ kind: "new-slot", body: { title: "Mine", slot: 4 }, confirm: null });
    expect(p.body).not.toHaveProperty("replace");
  });
  test("a taken slot replaces only with a confirm naming what moves to the storeroom", () => {
    const p = ui.publishPlan(state, { slot: 1 }, "Mine");
    expect(p.kind).toBe("replace-slot");
    expect(p.body).toEqual({ title: "Mine", slot: 1, replace: true });
    expect(p.confirm).toMatch(/^"Loop & Lantern" \(2 versions\) moves to the storeroom/);
  });
  test("an exhibit, on show or stored, gets its next version", () => {
    expect(ui.publishPlan(state, { exhibitId: 10 }, "v")).toMatchObject({ kind: "add-version", body: { title: "v", exhibitId: 10 }, confirm: null });
    expect(ui.publishPlan(state, { exhibitId: 20 }, "v").summary).toMatch(/^Adds version 4 to "Old Bloom"/);
  });
  test("unknown targets are refused before sending", () => {
    expect(ui.publishPlan(state, { exhibitId: 99 }, "v").kind).toBe("invalid");
    expect(ui.publishPlan(state, { slot: 7 }, "v").kind).toBe("invalid");
  });
});

describe("words for a performance", () => {
  const g = (kind: string, object: string, by = "aaaaaa") => ({ kind, object, at: 1, by });
  test("a gesture in at most four words", () => {
    expect(ui.gestureLine(g("throw", "teal"), "Undid")).toBe("Undid: teal thrown");
    expect(ui.gestureLine(g("pluck", "ribbon"), "Undid")).toBe("Undid: ribbon plucked");
    expect(ui.gestureLine(g("tap", "bell"), "Undid")).toBe("Undid: bell rung");
    for (const x of [g("throw", "chrome"), g("pluck", "ribbon"), g("tap", "bell")]) expect(ui.gestureLine(x, "Undid").split(/\s+/).length).toBeLessThanOrEqual(4);
  });
  test("a suggested title: playful, from what was played, the same for the same loop, and a valid title", () => {
    const bells = { set: "orbit", gestures: [g("tap", "bell"), g("tap", "bell"), g("throw", "gold")] };
    const t = ui.playfulTitle(bells);
    expect(t).toBe(ui.playfulTitle(JSON.parse(JSON.stringify(bells))));
    expect(ui.titleProblem(t)).toBeNull();
    expect(t).toMatch(/Bell/);
    expect(ui.playfulTitle({ set: "orbit", gestures: [g("pluck", "ribbon"), g("pluck", "ribbon", "bbbbbb")] })).toMatch(/Ribbon/);
    expect(ui.playfulTitle({ set: "orbit", gestures: [g("throw", "teal"), g("throw", "dusk")] })).toMatch(/Teal|Dusk|Sphere/);
    // several players: the title says so
    const two = ui.playfulTitle({ set: "orbit", gestures: [g("tap", "bell"), g("tap", "bell", "bbbbbb"), g("tap", "bell", "cccccc")] });
    expect(two).toMatch(/Trio|Three|for Three/);
  });
});

describe("the input rules", () => {
  test("titles are 1-40 and names 1-24 characters after trimming", () => {
    expect(ui.titleProblem("  ")).not.toBeNull();
    expect(ui.titleProblem("x".repeat(40))).toBeNull();
    expect(ui.titleProblem("x".repeat(41))).not.toBeNull();
    expect(ui.nameProblem(" a ")).toBeNull();
    expect(ui.nameProblem("x".repeat(25))).not.toBeNull();
  });
  test("shared time is the same on two clocks with different offsets", () => {
    const serverTime = "2026-10-21T10:00:00.000Z";
    const a = ui.clockOffset(serverTime, Date.parse(serverTime) - 5000);
    const b = ui.clockOffset(serverTime, Date.parse(serverTime) + 3000);
    expect(ui.sharedSeconds(Date.parse(serverTime) - 5000 + 1000, a)).toBeCloseTo(ui.sharedSeconds(Date.parse(serverTime) + 3000 + 1000, b));
  });
});

describe("framing a plinth close-up", () => {
  const fov = 42;
  // the sculpture's vertical extent must sit inside the view, with a margin
  const fits = (lo: number, hi: number, aspect: number) => {
    const f = ui.frameHeight(lo, hi, fov, aspect);
    const half = Math.tan(((fov / 2) * Math.PI) / 180) * f.dist;
    return f.focusY - half < lo && f.focusY + half > hi;
  };
  test("a short sculpture keeps the usual close-up", () => {
    expect(ui.frameHeight(1.2, 2.6, fov, 1.6).dist).toBe(5.4);
  });
  test("a tall one (a lifted halo) backs the camera off until it all fits", () => {
    expect(fits(1.2, 6.5, 1.6)).toBe(true);
    expect(ui.frameHeight(1.2, 6.5, fov, 1.6).dist).toBeGreaterThan(5.4);
  });
  test("a nearer floor lets a small sculpture fill a phone's close-up", () => {
    expect(ui.frameHeight(1, 2, fov, 1.2, 1.25, 2).dist).toBeLessThan(5.4);
  });
  test("on a portrait screen the width decides too", () => {
    expect(fits(1.2, 3.5, 0.5)).toBe(true);
  });
});

describe("clearFrame: where a fitted picture may go", () => {
  const canvas = { x: 0, y: 0, w: 1440, h: 900 };
  test("the desktop's side panel, header pills and plinth row are cut away", () => {
    const covers = [
      { x: 1028, y: 12, w: 400, h: 876 }, // the panel
      { x: 20, y: 16, w: 267, h: 77 }, // the title
      { x: 800, y: 16, w: 196, h: 48 }, // who's here
      { x: 250, y: 836, w: 515, h: 48 }, // the plinth row
    ];
    expect(ui.clearFrame(canvas, covers)).toEqual({ x: 0, y: 93, w: 1028, h: 743 });
  });
  test("on a phone nothing lies over the scene, so all of it is clear", () => {
    const stage = { x: 0, y: 60, w: 390, h: 321 };
    const covers = [
      { x: 0, y: 0, w: 390, h: 60 },
      { x: 0, y: 381, w: 390, h: 56 },
      { x: 0, y: 437, w: 390, h: 407 },
    ];
    expect(ui.clearFrame(stage, covers)).toEqual({ x: 0, y: 0, w: 390, h: 321 });
  });
});

describe("viewOffsetFor: centring the camera on the clear part", () => {
  test("a clear frame that is the whole canvas needs no offset", () => {
    expect(ui.viewOffsetFor(800, 600, { x: 0, y: 0, w: 800, h: 600 })).toEqual({ fullW: 800, fullH: 600, offX: 0, offY: 0 });
  });
  test("the clear frame's centre lands on the virtual frame's centre", () => {
    const o = ui.viewOffsetFor(1440, 900, { x: 0, y: 93, w: 1028, h: 743 });
    expect(o.fullW / 2 - o.offX).toBeCloseTo(514);
    expect(o.fullH / 2 - o.offY).toBeCloseTo(93 + 743 / 2);
    expect(o.offX).toBeGreaterThanOrEqual(0);
    expect(o.offY).toBeGreaterThanOrEqual(0);
  });
});
