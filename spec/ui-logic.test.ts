// The page's decisions, held without a browser or the running app: the
// throttle, what a lease looks like, the connection, and which publish flow
// a choice means. public/ui-logic.js is plain JS the page imports as is.
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as ui from "../public/ui-logic.js";

const who = (name: string, colour = 0) => ({ tag: name.slice(0, 6).padEnd(6, "0"), name, colour });
const exhibit = (id: number, title: string, versionCount = 1, slot: number | null = null) => ({ id, slot, latest: { title, n: versionCount }, versionCount });

describe("throttle", () => {
  test("the first edit and a release always send", () => {
    expect(ui.throttle({ lastSent: null, now: 0 })).toEqual({ send: true });
    expect(ui.throttle({ lastSent: 1000, now: 1001, final: true })).toEqual({ send: true });
  });
  test("within 100 ms of the last send it waits out the rest", () => {
    expect(ui.throttle({ lastSent: 1000, now: 1030 })).toEqual({ send: false, wait: 70 });
    expect(ui.throttle({ lastSent: 1000, now: 1099 })).toEqual({ send: false, wait: 1 });
  });
  test("at 100 ms or later it sends", () => {
    expect(ui.throttle({ lastSent: 1000, now: 1100 })).toEqual({ send: true });
    expect(ui.SEND_INTERVAL).toBe(100);
  });
});

describe("leaseState", () => {
  const now = Date.parse("2026-10-21T10:00:00Z");
  const lease = (part: string, secs: number, mine: boolean, holder = who("Coral Heron", 2)) => ({ part, holder, expiresAt: new Date(now + secs * 1000).toISOString(), mine });
  test("no lease is free", () => {
    expect(ui.leaseState([], "ribbon", now)).toEqual({ kind: "free" });
    expect(ui.leaseState([lease("cube", 10, false)], "ribbon", now)).toEqual({ kind: "free" });
  });
  test("someone else's live lease names them", () => {
    const s = ui.leaseState([lease("ribbon", 10, false)], "ribbon", now);
    expect(s.kind).toBe("held");
    expect(s.kind === "held" && s.holder.name).toBe("Coral Heron");
  });
  test("my own lease is mine", () => {
    expect(ui.leaseState([lease("ribbon", 10, true)], "ribbon", now).kind).toBe("mine");
  });
  test("an expired lease is free even if the server hasn't swept it", () => {
    expect(ui.leaseState([lease("ribbon", 0, false)], "ribbon", now)).toEqual({ kind: "free" });
    expect(ui.leaseState([lease("ribbon", -5, true)], "ribbon", now)).toEqual({ kind: "free" });
  });
});

describe("shownValues", () => {
  test("local values cover the server's only while they're fresh", () => {
    const server = { turns: 2, twist: 1 };
    expect(ui.shownValues(server, { values: { turns: 4 }, until: 200 }, 100)).toEqual({ turns: 4, twist: 1 });
    expect(ui.shownValues(server, { values: { turns: 4 }, until: 200 }, 300)).toEqual(server);
    expect(ui.shownValues(server, undefined, 0)).toEqual(server);
  });
});

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
    expect(ui.connectionMessage(c)).toMatch(/^Reconnecting\.\.\. you can look, but not edit/);
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

describe("benchAction and the input rules", () => {
  test("remix onto an empty bench, Replace onto a full one", () => {
    expect(ui.benchAction({ recipe: null })).toEqual({ kind: "remix", replace: false });
    expect(ui.benchAction({ recipe: "loop" })).toEqual({ kind: "replace", replace: true });
  });
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
