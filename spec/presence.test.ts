// Who is in a room, and where (ADR 36): memory only, checked for shape and
// membership, one walker per visitor, at most PRESENCE_MAX shown.
import { expect, test } from "vitest";
import { createPresence, PRESENCE_MAX } from "../src/presence.ts";

const step = { x: 0.4, y: 0.6, face: [1, 0], moving: true, sitting: false, seat: null };

test("a visitor who joins a room is a walker there, and only there", () => {
  const p = createPresence();
  p.join("aaaa0001", "t1");
  expect(p.walkers("aaaa0001").map((w) => w.tag)).toEqual(["t1"]);
  expect(p.walkers("bbbb0002")).toEqual([]);
});

test("a walk moves your walker, and everyone in the room reads the same", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  p.join("room0001", "t2");
  expect(p.walk("room0001", "t1", step, 1000)).toEqual({ ok: true });
  const w = p.walkers("room0001").find((x) => x.tag === "t1")!;
  expect([w.x, w.y, w.moving, w.sitting, w.seat]).toEqual([0.4, 0.6, true, false, null]);
});

test("you can only walk in a room you have open", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  const r = p.walk("room0002", "t1", step, 1000);
  expect(r).toMatchObject({ ok: false, status: 409, error: "not-in-room" });
});

test("a walk is checked for shape: inside the room, a facing, a real seat", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  const bad = [
    { ...step, x: 1.5 },
    { ...step, y: -0.1 },
    { ...step, x: "0.4" },
    { ...step, x: Number.NaN },
    { ...step, face: [1] },
    { ...step, face: [Infinity, 0] },
    { ...step, moving: "yes" },
    { ...step, sitting: true, seat: null },
    { ...step, sitting: true, seat: "plinth" },
    { ...step, sitting: true, seat: "__proto__" },
  ];
  for (const b of bad) expect(p.walk("room0001", "t1", b, 1000)).toMatchObject({ ok: false, status: 400, error: "bad-walk" });
  expect(p.walk("room0001", "t1", { ...step, moving: false, sitting: true, seat: "bench" }, 1000)).toEqual({ ok: true });
});

test("a facing is kept as a direction, whatever its length", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  p.walk("room0001", "t1", { ...step, face: [0.03, 0.04] }, 1000);
  const f = p.walkers("room0001")[0].face;
  expect(Math.hypot(f[0], f[1])).toBeCloseTo(1, 6);
});

test("walks faster than a page sends them are refused", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  expect(p.walk("room0001", "t1", step, 1000)).toEqual({ ok: true });
  expect(p.walk("room0001", "t1", step, 1010)).toMatchObject({ ok: false, status: 429, error: "too-fast" });
  expect(p.walk("room0001", "t1", step, 1100)).toEqual({ ok: true });
});

test("two tabs are one walker, and it stays until the last one closes", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  p.join("room0001", "t1");
  expect(p.walkers("room0001")).toHaveLength(1);
  expect(p.leave("room0001", "t1")).toBe(false);
  expect(p.walkers("room0001")).toHaveLength(1);
  expect(p.leave("room0001", "t1")).toBe(true);
  expect(p.walkers("room0001")).toEqual([]);
});

test(`a room shows at most ${PRESENCE_MAX} walkers, the earliest there`, () => {
  const p = createPresence();
  for (let i = 0; i < PRESENCE_MAX + 3; i++) p.join("room0001", `t${i}`);
  const shown = p.walkers("room0001").map((w) => w.tag);
  expect(shown).toHaveLength(PRESENCE_MAX);
  expect(shown[0]).toBe("t0");
  expect(shown).not.toContain(`t${PRESENCE_MAX}`);
  p.leave("room0001", "t0");
  expect(p.walkers("room0001").map((w) => w.tag)).toContain(`t${PRESENCE_MAX}`);
});

test("a new walker starts at the room's door, standing", () => {
  const p = createPresence();
  p.join("room0001", "t1");
  const w = p.walkers("room0001")[0];
  expect(w.moving).toBe(false);
  expect(w.sitting).toBe(false);
  expect(w.x).toBeGreaterThan(0);
  expect(w.x).toBeLessThanOrEqual(1);
});
