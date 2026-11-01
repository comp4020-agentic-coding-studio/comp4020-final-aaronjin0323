// The journey's words and steps: pure, so they're held without a browser.
import { expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as U from "../public/arena-ui.js";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

test("the step comes from what you hold", () => {
  expect(U.journeyStep({ carrying: 0, total: 0, onShow: 0 })).toBe(1);
  expect(U.journeyStep({ carrying: 2, total: 0, onShow: 0 })).toBe(2);
  expect(U.journeyStep({ carrying: 2, total: 9, onShow: 0 })).toBe(2);
  expect(U.journeyStep({ carrying: 0, total: 3, onShow: 0 })).toBe(3);
  expect(U.journeyStep({ carrying: 0, total: 3, onShow: 1 })).toBe(1);
});
test("guidance is one line, in order, and stops", () => {
  expect(U.coach({ launched: false, carrying: 0, total: 0 })).toMatch(/drag back/i);
  expect(U.coach({ launched: true, carrying: 0, total: 0 })).toMatch(/touch an artifact/i);
  expect(U.coach({ launched: true, carrying: 1, total: 0 })).toMatch(/vault/i);
  expect(U.coach({ launched: false, carrying: 0, total: 1 })).toBe("");
  expect(U.coach({ launched: true, carrying: 3, total: 1 })).toBe("");
});
test("weight reads as top speed, falling with each artifact", () => {
  expect(U.speedShare(0)).toBe(100);
  for (let n = 1; n <= A.CARRY_MAX; n++) expect(U.speedShare(n)).toBeLessThan(U.speedShare(n - 1));
  expect(U.speedShare(A.CARRY_MAX)).toBe(50);
});
test("what's said is about you, and names what was kept", () => {
  expect(U.deliveryWords([{ kind: "fish", material: "gold" }])).toBe("Gold flying fish kept for good");
  expect(U.deliveryWords([{ kind: "fish", material: "gold" }, { kind: "door", material: "tin" }])).toBe("2 artifacts kept for good");
  expect(U.dropWords(1)).toBe("You dropped 1. Grab it once it settles.");
  expect(U.dropWords(3)).toBe("You dropped 3. Grab them once they settle.");
});
test("the room asks for what's waiting", () => {
  const shelf = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(U.waitingWords(shelf, [{ artifact: "a" }, {}])).toBe("2 of yours aren't on show.");
  expect(U.waitingWords(shelf.slice(0, 2), [{ artifact: "a" }])).toBe("1 of yours isn't on show.");
  expect(U.waitingWords(shelf.slice(0, 1), [{ artifact: "a" }])).toBe("");
  expect(U.waitingWords([], [])).toBe("");
});
