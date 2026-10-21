import { describe, expect, it } from "vitest";
import { checkEdit, checkSculpture, defaultParts, PALETTE, RECIPES, VISITOR_COLOURS } from "../public/recipes.js";

// The one copy of the recipes, imported by the server to refuse and by the
// page to draw (CLAUDE.md, "The shared module is held by a test").

const onStep = (min: number, step: number, v: number): boolean => {
  const k = (v - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-6;
};

describe("the recipes", () => {
  it("has three recipes of three parts each", () => {
    expect(Object.keys(RECIPES)).toEqual(["loop", "arches", "bloom"]);
    for (const r of Object.values(RECIPES)) expect(Object.keys(r.parts)).toHaveLength(3);
  });

  it("puts every default in range and on its step", () => {
    let seen = 0;
    for (const [rid, r] of Object.entries(RECIPES)) {
      for (const [pid, part] of Object.entries(r.parts)) {
        for (const [key, p] of Object.entries(part.params)) {
          const where = `${rid}.${pid}.${key}`;
          expect(p.min, where).toBeLessThan(p.max);
          expect(p.step, where).toBeGreaterThan(0);
          expect(p.default, where).toBeGreaterThanOrEqual(p.min);
          expect(p.default, where).toBeLessThanOrEqual(p.max);
          expect(onStep(p.min, p.step, p.default), `${where} default ${p.default} is off its step`).toBe(true);
          if (p.kind === "colour") expect(p.max, where).toBe(PALETTE.length - 1);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it("has defaults that pass checkSculpture", () => {
    for (const rid of Object.keys(RECIPES)) expect(checkSculpture(rid, defaultParts(rid)), rid).toEqual({ ok: true });
  });

  it("has eight visitor colours", () => {
    expect(VISITOR_COLOURS).toHaveLength(8);
    for (const c of VISITOR_COLOURS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("checkEdit", () => {
  it("accepts a known parameter in range, snapped to its step", () => {
    expect(checkEdit("loop", "ribbon", { turns: 3 })).toEqual({ ok: true, values: { turns: 3 } });
    expect(checkEdit("loop", "ribbon", { twist: 2.6 })).toEqual({ ok: true, values: { twist: 2.5 } });
    expect(checkEdit("loop", "cube", { lift: 0.1 + 0.2 })).toEqual({ ok: true, values: { lift: 0.3 } });
  });

  it("refuses unknown recipes, parts and keys, including inherited names", () => {
    expect(checkEdit("nope", "ribbon", { turns: 2 }).ok).toBe(false);
    expect(checkEdit("constructor", "ribbon", { turns: 2 }).ok).toBe(false);
    expect(checkEdit("loop", "toString", { turns: 2 }).ok).toBe(false);
    expect(checkEdit("loop", "ribbon", { wings: 2 })).toEqual({ ok: false, reason: "unknown parameter wings" });
    expect(checkEdit("loop", "ribbon", { constructor: 2 })).toEqual({ ok: false, reason: "unknown parameter constructor" });
    expect(checkEdit("loop", "ribbon", JSON.parse('{"__proto__": 2}')).ok).toBe(false);
    expect(checkEdit("loop", "ribbon", { hasOwnProperty: 2 }).ok).toBe(false);
  });

  it("refuses non-numbers", () => {
    for (const v of ["2", null, true, [2], { n: 2 }, NaN, Infinity]) {
      expect(checkEdit("loop", "ribbon", { turns: v }).ok, String(v)).toBe(false);
    }
    expect(checkEdit("loop", "ribbon", null).ok).toBe(false);
    expect(checkEdit("loop", "ribbon", [1]).ok).toBe(false);
    expect(checkEdit("loop", "ribbon", {}).ok).toBe(false);
  });

  it("refuses out-of-range values rather than clamping them", () => {
    expect(checkEdit("loop", "ribbon", { turns: 6 })).toEqual({ ok: false, reason: "turns must be between 1 and 5" });
    expect(checkEdit("loop", "ribbon", { turns: 0 }).ok).toBe(false);
    expect(checkEdit("loop", "cube", { colour: 8 }).ok).toBe(false);
    expect(checkEdit("loop", "cube", { colour: -1 }).ok).toBe(false);
  });
});

describe("checkSculpture", () => {
  it("refuses a missing part, a missing parameter, an extra part or a bad value", () => {
    const p = defaultParts("bloom");
    const { motes: _gone, ...missing } = p;
    expect(checkSculpture("bloom", missing).ok).toBe(false);
    const { drift: _d, ...motes } = p.motes;
    expect(checkSculpture("bloom", { ...p, motes }).ok).toBe(false);
    expect(checkSculpture("bloom", { ...p, extra: {} }).ok).toBe(false);
    expect(checkSculpture("bloom", { ...p, stem: { ...p.stem, height: 9 } }).ok).toBe(false);
    expect(checkSculpture("loop", p).ok).toBe(false);
  });
});
