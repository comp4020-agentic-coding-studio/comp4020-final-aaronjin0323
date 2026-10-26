// The hall page's decisions, as pure functions (public/hall-ui.js), held
// without a browser: aiming by a pull and by keys, the aim in words, and
// which snapshot of your own robot to trust while a launch is in flight.
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as hallUi from "../public/hall-ui.js";
// @ts-ignore -- plain JS module shared with the page
import { MIN_PULL, PULL_MAX, checkLaunch } from "../public/hall.js";

const ui: any = hallUi;

describe("aiming by pulling back", () => {
  test("the launch goes away from the pull, harder the further, full at PULL_MAX and no further", () => {
    const a = ui.aimFromPull([5, 5], [4, 5]); // pulled left
    expect(a.dir[0]).toBeCloseTo(1, 9);
    expect(a.dir[1]).toBeCloseTo(0, 9);
    expect(a.power).toBeCloseTo(1 / PULL_MAX, 9);
    expect(ui.aimFromPull([5, 5], [5, 5 + PULL_MAX * 3]).power).toBe(1);
    expect(ui.aimFromPull([5, 5], [5, 5 + PULL_MAX * 3]).dir[1]).toBeCloseTo(-1, 9);
  });
  test("a pull shorter than MIN_PULL is no aim: letting go cancels", () => {
    expect(ui.aimFromPull([5, 5], [5 + MIN_PULL * 0.9, 5])).toBeNull();
  });
  test("what it makes is a launch the server takes", () => {
    const a = ui.aimFromPull([2, 3], [9, 9]);
    expect(checkLaunch({ dir: a.dir, power: a.power, seq: 1 }).ok).toBe(true);
  });
});

describe("aiming by keys", () => {
  const start = ui.KEY_AIM_START;
  test("arrows turn the aim and change the power, within bounds", () => {
    expect(ui.keyAim(start, "ArrowRight").aim.angle).toBe(start.angle + ui.KEY_TURN);
    expect(ui.keyAim(start, "ArrowLeft").aim.angle).toBe((start.angle - ui.KEY_TURN + 360) % 360);
    let a = start;
    for (let i = 0; i < 30; i++) a = ui.keyAim(a, "ArrowUp").aim;
    expect(a.power).toBe(1);
    for (let i = 0; i < 30; i++) a = ui.keyAim(a, "ArrowDown").aim;
    expect(a.power).toBeGreaterThan(0);
  });
  test("Enter and Space launch, Escape cancels, anything else isn't the robot's", () => {
    expect(ui.keyAim(start, "Enter").act).toBe("launch");
    expect(ui.keyAim(start, " ").act).toBe("launch");
    expect(ui.keyAim(start, "Escape").act).toBe("cancel");
    expect(ui.keyAim(start, "a")).toBeNull();
  });
  test("a key aim makes a launch the server takes", () => {
    const k = ui.keyAim(start, "ArrowRight").aim;
    const l = ui.launchOfKeyAim(k);
    expect(checkLaunch({ ...l, seq: 1 }).ok).toBe(true);
  });
});

describe("the aim in words", () => {
  test("says the way and the power", () => {
    expect(ui.aimWords({ dir: [1, 0], power: 0.6 })).toBe("Aiming right, power 60%");
    expect(ui.aimWords({ dir: [0, 1], power: 1 })).toBe("Aiming down, power 100%");
    expect(ui.aimWords({ dir: [-0.7071, -0.7071], power: 0.25 })).toBe("Aiming up-left, power 25%");
  });
});

describe("your own robot while a launch is in flight", () => {
  const snap = (seq: number, x: number) => ({ pos: [x, 1], vel: [0, 0], t: 0, seq });
  test("a snapshot from before your newest launch doesn't undo your prediction", () => {
    expect(ui.trust(snap(5, 1), snap(4, 9))).toEqual(snap(5, 1));
  });
  test("the server's snapshot of your launch, or a later one, wins", () => {
    expect(ui.trust(snap(5, 1), snap(5, 2))).toEqual(snap(5, 2));
    expect(ui.trust(snap(5, 1), snap(6, 3))).toEqual(snap(6, 3));
    expect(ui.trust(null, snap(0, 3))).toEqual(snap(0, 3));
  });
});

// ADR 25: cargo and the display, in words and slots
describe("cargo", () => {
  test("three slots behind the robot: what it carries, then the room left", () => {
    expect(ui.cargoSlots([{ id: "a", kind: "door" }])).toEqual(["door", null, null]);
    expect(ui.cargoSlots([])).toEqual([null, null, null]);
  });
  test("in words, with the room left and what to do when full", () => {
    expect(ui.cargoWords([])).toBe("Carrying nothing. Room for 3.");
    expect(ui.cargoWords([{ id: "a", kind: "fish" }, { id: "b", kind: "door" }])).toBe("Carrying 2 of 3: luminous fish, door onto stars. Room for 1 more.");
    expect(ui.cargoWords([{ id: "a", kind: "fish" }, { id: "b", kind: "fish" }, { id: "c", kind: "cloud" }])).toBe("Full: 3 of 3 (luminous fish, luminous fish, rain cloud). Take them to your zone.");
  });
  test("behind a moving robot is the way it came; behind a still one is below it", () => {
    const b = ui.behind([3, 4]);
    expect(b[0]).toBeCloseTo(-0.6, 9);
    expect(b[1]).toBeCloseTo(-0.8, 9);
    expect(ui.behind([0, 0])).toEqual([0, 1]);
  });
});

describe("arranging the display", () => {
  const have = { fish: 2, cloud: 0, door: 1 };
  test("a slot offers empty, and every kind you own", () => {
    expect(ui.slotChoices(have)).toEqual([null, "fish", "door"]);
  });
  test("putting a kind in a slot moves it there if it was shown elsewhere, swapping what was there", () => {
    expect(ui.placeIn([null, null, null, null], 2, "fish")).toEqual([null, null, "fish", null]);
    expect(ui.placeIn(["fish", null, "door", null], 2, "fish")).toEqual(["door", null, "fish", null]);
    expect(ui.placeIn(["fish", null, null, null], 0, null)).toEqual([null, null, null, null]);
  });
  test("whatever it makes has each kind once", () => {
    let d: (string | null)[] = [null, null, null, null];
    for (const [slot, kind] of [[0, "fish"], [1, "door"], [3, "fish"], [1, "fish"], [2, "door"]] as const) d = ui.placeIn(d, slot, kind);
    const kinds = d.filter((k) => k);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
