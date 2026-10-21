import { describe, expect, it } from "vitest";
import { checkSculpture, defaultParts, RECIPES } from "../public/recipes.js";
import { CATCH, SPHERES, dropOn, dropPoint, nearestU, ribbonPoint, sphereAt } from "../public/orbit.js";

// The one rule that connects Orbit's pieces (CLAUDE.md, "Orbit"; ADR 15): a
// placed sphere near the ribbon rides it, and anyone's ribbon edit moves it.

const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the Orbit recipe", () => {
  it("is a ribbon and four spheres, every sphere on the shelf to start", () => {
    expect(Object.keys(RECIPES.orbit.parts)).toEqual(["ribbon", ...SPHERES]);
    expect(SPHERES).toHaveLength(4);
    const d = defaultParts("orbit");
    for (const s of SPHERES) expect(d[s].placed, s).toBe(0);
    expect(checkSculpture("orbit", d)).toEqual({ ok: true });
  });
});

describe("the catch rule", () => {
  const ribbon = defaultParts("orbit").ribbon;
  // a sphere as the page saves it when dropped at point p
  const dropped = (p: number[]) => ({ ...dropOn(ribbon, p), size: 0.18, colour: 5 });
  const onRibbon = (u: number) => dropped(ribbonPoint(ribbon, u));

  it("a sphere on the shelf is neither drawn on the sculpture nor caught", () => {
    const s = { ...onRibbon(0.2), placed: 0 };
    expect(sphereAt(ribbon, s, 0)).toMatchObject({ onSculpture: false, caught: false });
  });

  it("a sphere dropped on the ribbon is caught, and rides the path", () => {
    const s = onRibbon(0.3);
    const a = sphereAt(ribbon, s, 0);
    const b = sphereAt(ribbon, s, 2);
    expect(a.caught).toBe(true);
    // always on the path, and moving along it
    expect(dist(a.pos, ribbonPoint(ribbon, a.u))).toBeLessThan(1e-6);
    expect(dist(b.pos, ribbonPoint(ribbon, b.u))).toBeLessThan(1e-6);
    expect(dist(a.pos, b.pos)).toBeGreaterThan(0.1);
    // starting from the point nearest where it was dropped
    expect(Math.abs(a.u - 0.3)).toBeLessThan(0.02);
  });

  it("a sphere dropped far from the ribbon rests where it was dropped", () => {
    const s = dropped([0.05, 0.8, 0]);
    expect(nearestU(ribbon, dropPoint(s)).d).toBeGreaterThan(CATCH);
    expect(s.ride).toBe(0);
    const a = sphereAt(ribbon, s, 0);
    const b = sphereAt(ribbon, s, 2);
    expect(a.caught).toBe(false);
    expect(dist(a.pos, b.pos)).toBe(0);
    expect(dist(a.pos, dropPoint(s))).toBeLessThan(1e-6);
  });

  it("someone else reshaping the ribbon moves a caught sphere, with no edit to the sphere", () => {
    const s = onRibbon(0.15);
    const before = sphereAt(ribbon, s, 1);
    const bent = { ...ribbon, turns: ribbon.turns + 1, radius: ribbon.radius + 0.2 };
    const after = sphereAt(bent, s, 1);
    expect(before.caught && after.caught).toBe(true);
    expect(dist(after.pos, ribbonPoint(bent, after.u))).toBeLessThan(1e-6);
    expect(dist(before.pos, after.pos)).toBeGreaterThan(0.05);
  });

  it("no bend of the ribbon ever knocks a caught sphere off it", () => {
    const p = RECIPES.orbit.parts.ribbon.params;
    for (let u = 0; u < 1; u += 0.05) {
      const s = onRibbon(u);
      for (let turns = p.turns.min; turns <= p.turns.max; turns++) {
        for (const radius of [p.radius.min, 1, p.radius.max]) {
          for (const tilt of [p.tilt.min, p.tilt.max]) {
            const at = sphereAt({ ...ribbon, turns, radius, tilt }, s, 2);
            expect(at.caught, `u ${u.toFixed(2)} turns ${turns} radius ${radius} tilt ${tilt}`).toBe(true);
          }
        }
      }
    }
  });

  // the shared clock as the page reads it: seconds since 1970, not 0
  const NOW = 1_792_000_000.25;

  it("a sphere dropped on the ribbon appears exactly where it was dropped, at a real clock time", () => {
    for (const u of [0.1, 0.37, 0.8]) {
      const p = ribbonPoint(ribbon, u);
      const s = { ...dropOn(ribbon, p, NOW), size: 0.18, colour: 5 };
      const at = sphereAt(ribbon, s, NOW);
      expect(at.caught).toBe(true);
      expect(dist(at.pos, p), `u ${u}`).toBeLessThan(0.04);
    }
  });

  it("a sphere dropped off the ribbon rests within a centimetre or so of the drop", () => {
    for (const p of [[1.7, 0.63, 0.4], [-0.3, -0.71, 1.83], [0.05, 0.8, 0]]) {
      const s = { ...dropOn(ribbon, p, NOW), size: 0.18, colour: 5 };
      expect(s.ride).toBe(0);
      expect(dist(sphereAt(ribbon, s, NOW).pos, p)).toBeLessThan(0.02);
    }
  });

  it("is the same on every screen: same numbers and time, same place", () => {
    const s = onRibbon(0.6);
    expect(sphereAt(ribbon, s, 3.7)).toEqual(sphereAt({ ...ribbon }, { ...s }, 3.7));
  });
});
