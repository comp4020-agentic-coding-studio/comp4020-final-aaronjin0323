// The shared rule (CLAUDE.md, "Moving", "Hitting"): pure, no server.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

const speed = (r: any) => Math.hypot(r.vel[0], r.vel[1]);
const still = (pos: number[] = [8, 2]) => A.standing(pos, 0);
const full = (dir: number[], seq = 1) => ({ dir, power: 1, seq });

describe("load", () => {
  test("every artifact lowers the cap and keeps more old velocity", () => {
    for (let n = 1; n <= A.CARRY_MAX; n++) {
      expect(A.loadCap(n)).toBeLessThan(A.loadCap(n - 1));
      expect(A.loadKeep(n)).toBeGreaterThan(A.loadKeep(n - 1));
    }
    expect(A.loadCap(0)).toBe(A.LAUNCH_MAX);
    expect(A.loadKeep(0)).toBe(0);
    expect(A.loadKeep(A.CARRY_MAX)).toBeLessThan(1); // a full robot can still turn
  });
  test("a loaded launch is slower", () => {
    expect(speed(A.launch(still(), full([1, 0]), 0, 0))).toBeCloseTo(A.LAUNCH_MAX, 6);
    expect(speed(A.launch(still(), full([1, 0]), 0, A.CARRY_MAX))).toBeCloseTo(A.loadCap(A.CARRY_MAX) * (1 - A.loadKeep(A.CARRY_MAX)), 6);
  });
  test("a loaded robot turns less sharply than an empty one", () => {
    const going = { ...still([3, 5]), vel: [4, 0] };
    const empty = A.launch(going, full([0, 1]), 0, 0);
    const heavy = A.launch(going, full([0, 1]), 0, A.CARRY_MAX);
    expect(empty.vel[0]).toBe(0);
    expect(heavy.vel[0]).toBeGreaterThan(0);
  });
});

describe("launching while moving", () => {
  test("a launch takes hold in mid-flight, in the new direction", () => {
    let r = A.launch(still([2, 5]), full([1, 0], 1), 0, 0);
    r = A.advance(r, 200);
    const again = A.launch(r, full([-1, 0], 2), 200, 0);
    expect(again.vel[0]).toBeCloseTo(-A.LAUNCH_MAX, 6);
  });
  test("launches never add up, at any load", () => {
    for (let n = 0; n <= A.CARRY_MAX; n++) {
      let r = still([8, 2]);
      for (let i = 1; i < 60; i++) {
        r = A.launch(A.advance(r, i * 20), full([1, i % 2 ? 0.3 : -0.3], i), i * 20, n);
        expect(speed(r)).toBeLessThanOrEqual(A.loadCap(n) + 1e-9);
      }
    }
  });
  test("picking up mid-flight caps the next launch even if it was going faster", () => {
    const fast = { ...still([3, 5]), vel: [A.LAUNCH_MAX, 0] };
    expect(speed(A.launch(fast, full([1, 0]), 0, A.CARRY_MAX))).toBeLessThanOrEqual(A.loadCap(A.CARRY_MAX) + 1e-9);
  });
});

describe("speed is bounded", () => {
  test("a head-on collision can't exceed SPEED_MAX", () => {
    const a = { ...still([5, 5]), vel: [A.SPEED_MAX, 0] };
    const b = { ...still([5.7, 5]), vel: [-A.SPEED_MAX, 0] };
    const c: any = A.collide(a, b);
    expect(speed(c.a)).toBeLessThanOrEqual(A.SPEED_MAX + 1e-9);
    expect(speed(c.b)).toBeLessThanOrEqual(A.SPEED_MAX + 1e-9);
  });
  test("a struck still robot, hit at speed, stays under SPEED_MAX and moves off", () => {
    const c: any = A.collide({ ...still([5, 5]), vel: [A.SPEED_MAX, 0] }, still([5.7, 5]));
    expect(c.b.vel[0]).toBeGreaterThan(0);
    expect(speed(c.b)).toBeLessThanOrEqual(A.SPEED_MAX + 1e-9);
  });
});

describe("the vault and the floor", () => {
  test("no spot is in reach of the vault, and there are plenty", () => {
    expect(A.SPOTS.length).toBeGreaterThanOrEqual(A.SPAWN.target[A.MAX_PLAYERS] * 2);
    for (const p of A.SPOTS) expect(A.inVault([p[0], p[1]])).toBe(false);
    for (const p of A.SPOTS) expect(Math.hypot(p[0] - A.VAULT[0], p[1] - A.VAULT[1])).toBeGreaterThan(A.VAULT_R + A.ROBOT_R + A.ARTIFACT_R);
  });
  test("scattered artifacts land outward, inside the walls, out of the vault", () => {
    const spots = A.scatterSpots([5, 5], [-1, 0], A.CARRY_MAX);
    expect(spots).toHaveLength(A.CARRY_MAX);
    for (const p of spots) expect(p[0]).toBeLessThan(5.01);
    expect(new Set(spots.map((p: number[]) => p.join())).size).toBe(A.CARRY_MAX);
    for (const p of A.scatterSpots([A.VAULT[0] - 1, A.VAULT[1]], [1, 0], 5)) expect(A.inVault(p)).toBe(false);
    for (const p of A.scatterSpots([0.6, 0.6], [-0.7, -0.7], 5)) expect(Math.min(p[0], p[1])).toBeGreaterThanOrEqual(A.ARTIFACT_R);
  });
  test("spawns are four, inside the walls, clear of each other", () => {
    expect(A.SPAWNS).toHaveLength(A.MAX_PLAYERS);
    for (const s of A.SPAWNS) expect(s[0] > A.ROBOT_R && s[1] > A.ROBOT_R).toBe(true);
  });
});

describe("the page's pull", () => {
  test("is measured from where the press began, wherever the robot is", async () => {
    const { aimFromPull } = await import("../public/arena-ui.js");
    expect(aimFromPull([10, 5], [10.1, 5])).toBeNull();
    const a = aimFromPull([10, 5], [10 - A.PULL_MAX, 5])!;
    expect(a.dir).toEqual([1, 0]);
    expect(a.power).toBe(1);
  });
});

describe("supply and rarity", () => {
  const P = [1, 2, 3, 4];
  test("both the floor and the spawn rate grow more slowly than players", () => {
    for (const p of P.slice(1)) {
      expect(A.SPAWN.target[p]).toBeGreaterThan(A.SPAWN.target[p - 1]);
      expect(A.SPAWN.target[p] / p).toBeLessThan(A.SPAWN.target[p - 1] / (p - 1));
      expect(A.SPAWN.everyMs[p]).toBeLessThan(A.SPAWN.everyMs[p - 1]);
      expect(1000 / A.SPAWN.everyMs[p] / p).toBeLessThan(1000 / A.SPAWN.everyMs[p - 1] / (p - 1));
    }
  });
  test("every extra player makes rare and mythic likelier", () => {
    const share = (p: number, tier: string) => {
      const w: any = A.SPAWN.rarity[p];
      return w[tier] / (w.common + w.rare + w.mythic);
    };
    for (const p of P.slice(1)) {
      expect(share(p, "rare")).toBeGreaterThan(share(p - 1, "rare"));
      expect(share(p, "mythic")).toBeGreaterThan(share(p - 1, "mythic"));
    }
  });
  test("a roll lands on the tiers by weight, and reaches every material", () => {
    const seen = (p: number) => {
      const out: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) for (const r of [0.25, 0.75]) {
        const m = A.rollMaterial(p, (i + 0.5) / 1000, r);
        out[m] = (out[m] ?? 0) + 1;
      }
      return out;
    };
    expect(Object.keys(seen(4)).sort()).toEqual(Object.keys(A.MATERIALS).sort());
    expect((seen(4).starlight ?? 0)).toBeGreaterThan((seen(1).starlight ?? 0));
  });
  test("a roll obeys a table it's given", () => {
    const only = { ...A.SPAWN, rarity: A.SPAWN.rarity.map(() => ({ common: 0, rare: 0, mythic: 1 })) };
    expect(A.rollMaterial(1, 0.5, 0.5, only)).toBe("starlight");
  });
  test("the catalog is every kind in every material", () => {
    expect(A.CATALOG).toHaveLength(A.KINDS.length * Object.keys(A.MATERIALS).length);
    expect(new Set(A.CATALOG).size).toBe(A.CATALOG.length);
  });
});

test("the rule uses only arithmetic every engine rounds the same", () => {
  const src = readFileSync("public/arena.js", "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  expect(src).not.toMatch(/Math\.(sin|cos|tan|atan2?|pow|exp|log|hypot|random)|\*\*/);
});
