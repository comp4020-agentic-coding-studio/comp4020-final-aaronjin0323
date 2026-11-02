// The journey's words and steps: pure, so they're held without a browser.
import { expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as U from "../public/arena-ui.js";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

test("the Room button calls when something of yours isn't on show", () => {
  expect(U.roomCalls({ total: 0, onShow: 0 })).toBe(false);
  expect(U.roomCalls({ total: 3, onShow: 3 })).toBe(false);
  expect(U.roomCalls({ total: 3, onShow: 1 })).toBe(true);
});
test("guidance marks one thing, in order, in three words at most, and stops", () => {
  expect(U.guide({ launched: false, carrying: 0, total: 0 })?.mark).toBe("pull");
  expect(U.guide({ launched: true, carrying: 0, total: 0 })?.mark).toBe("artifact");
  expect(U.guide({ launched: true, carrying: 1, total: 0 })?.mark).toBe("vault");
  expect(U.guide({ launched: false, carrying: 1, total: 0 })?.mark).toBe("vault");
  expect(U.guide({ launched: false, carrying: 0, total: 1 })).toBe(null);
  expect(U.guide({ launched: true, carrying: 3, total: 1 })).toBe(null);
  for (const g of [[false, 0], [true, 0], [true, 1]] as [boolean, number][]) {
    const words = U.guide({ launched: g[0], carrying: g[1], total: 0 })!.words;
    expect(words.split(/\s+/).length).toBeLessThanOrEqual(3);
  }
});
test("what's said is short, about you, and names what was kept", () => {
  expect(U.deliveryWords([{ kind: "fish", material: "gold" }])).toBe("Gold flying fish kept!");
  expect(U.deliveryWords([{ kind: "fish", material: "gold" }, { kind: "door", material: "tin" }])).toBe("2 kept!");
  expect(U.dropWords(1)).toBe("Dropped 1!");
  expect(U.dropWords(3)).toBe("Dropped 3!");
});
test("the room counts what's waiting", () => {
  const shelf = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(U.waitingCount(shelf, [{ artifact: "a" }, {}])).toBe(2);
  expect(U.waitingCount(shelf.slice(0, 1), [{ artifact: "a" }])).toBe(0);
  expect(U.waitingCount([], [])).toBe(0);
});

test("silence counts as lost, but not a moment's quiet", () => {
  expect(U.silent(1000, 1000 + A.BEAT_MS)).toBe(false);
  expect(U.silent(1000, 1000 + A.BEAT_MISS_MS - 1)).toBe(false);
  expect(U.silent(1000, 1000 + A.BEAT_MISS_MS + 1)).toBe(true);
  expect(A.BEAT_MISS_MS).toBeGreaterThanOrEqual(A.BEAT_MS * 2); // one lost beat isn't enough
});
