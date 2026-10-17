import { afterEach, describe, expect, it } from "vitest";
import { boardView, mayorsOf, rates } from "../src/board.ts";
import { district, DISTRICTS, N, openStore, seats, type Store, TILES } from "../src/db.ts";
import {
  accrue,
  BASE_INCOME,
  DISTRICT_SIZE,
  MAYOR_BONUS_PERCENT,
  MAYOR_CAP_PERCENT,
  MAYOR_MIN_LEVEL,
  MAYOR_MIN_OTHERS,
  mayorBonus,
  rate,
} from "../src/economy.ts";

// docs/adr/0010 on the store alone, with a clock the test controls. A mayor
// is derived from which buildings stand and their levels, so it can only
// change at a claim, a move, an upgrade or a lease end: every one already a
// settle-first cut point. These hold the rules and that income across a
// change of mayor is exact to the cent.

const T0 = new Date("2026-10-01T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const cell = (r: number, c: number): number => r * N + c;
// four hours on: every building has earned enough to reach Lv4
const RICH = at(4 * HOUR);

const opened: Store[] = [];
const memory = (): Store => {
  const s = openStore(":memory:");
  opened.push(s);
  return s;
};
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

// Buildings at the levels given, all claimed at T0 and upgraded at RICH
// from four hours' income. [plot, pid, level]
function build(list: [number, string, number][]): Store {
  const s = memory();
  for (const [id, pid] of list) expect(s.claim(id, pid, pid.toUpperCase(), T0)).toBe("claimed");
  for (const [, pid, level] of list) {
    s.collect(pid, RICH);
    for (let l = 1; l < level; l++) expect(s.upgrade(pid, RICH), `${pid} to ${l + 1}`).toBe("upgraded");
  }
  return s;
}
const view = (s: Store, pid: string, now = RICH) => boardView(s.tiles(), pid, now, s.landmarks(), { me: s.me(pid, now), parks: s.parks() });
const mayors = (s: Store, now = RICH) => view(s, "nobody", now).mayors;

describe("the numbers", () => {
  it("are 4×4 districts, Lv2 to qualify, 1 other, +8% each, at most +40%", () => {
    expect([DISTRICT_SIZE, MAYOR_MIN_LEVEL, MAYOR_MIN_OTHERS, MAYOR_BONUS_PERCENT, MAYOR_CAP_PERCENT]).toEqual([4, 2, 1, 8, 40]);
    expect([0, 1, 2, 5, 6, 8].map(mayorBonus)).toEqual([0, 8, 16, 40, 40, 40]);
  });

  it("splits the board into nine districts of sixteen plots, row-major", () => {
    expect(DISTRICTS).toBe(9);
    for (let id = 0; id < TILES; id++) {
      const r = Math.floor(id / N);
      const c = id % N;
      expect(district(id), `plot ${id}`).toBe(Math.floor(r / 4) * 3 + Math.floor(c / 4));
    }
    expect([cell(0, 0), cell(0, 3), cell(0, 4), cell(0, 11), cell(4, 0), cell(5, 5), cell(11, 11)].map(district)).toEqual([0, 0, 1, 2, 3, 4, 8]);
    const sizes = Array(9).fill(0);
    for (let id = 0; id < TILES; id++) sizes[district(id)]++;
    expect(sizes).toEqual(Array(9).fill(16));
    // every tile carries it, free or built
    const s = build([[cell(5, 5), "kai", 1]]);
    expect(view(s, "kai").tiles.map((t) => t.district)).toEqual(Array.from({ length: TILES }, (_, id) => district(id)));
  });
});

describe("who is mayor", () => {
  it("is the one holder of the highest Lv2+ building, over someone else's Lv2+, and earns +8% for it", () => {
    // Kai Lv3 and Mia Lv2 in district 5 (the centre), not adjacent
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 2]]);
    expect(mayors(s)).toEqual([{ district: 4, cellId: cell(4, 4), label: "KAI" }]);
    expect(s.me("kai", RICH).rate).toBe(rate(3, 0, 8)); // 30 × 108
    expect(view(s, "x").tiles[cell(4, 4)].rate).toBe(3240);
    expect(s.me("mia", RICH).rate).toBe(rate(2, 0)); // no penalty for not being mayor
  });

  it("needs Lv2: a Small House neither qualifies nor counts as someone to be mayor over", () => {
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 1]]);
    expect(mayors(s)).toEqual([]);
    expect(s.me("kai", RICH).rate).toBe(rate(3, 0));
    // two Small Houses: nobody, however many
    const t = build([[cell(4, 4), "kai", 1], [cell(7, 7), "mia", 1], [cell(6, 6), "zoe", 1]]);
    expect(mayors(t)).toEqual([]);
    // and a Small House beside a Lv2 doesn't make a mayor of it
    const u = build([[cell(4, 4), "kai", 2], [cell(7, 7), "mia", 1]]);
    expect(mayors(u)).toEqual([]);
  });

  it("needs at least one other qualifier: alone at the top of a district is not a mayor", () => {
    const s = build([[cell(4, 4), "kai", 4]]);
    expect(mayors(s)).toEqual([]);
    expect(s.me("kai", RICH).rate).toBe(rate(4, 0));
  });

  it("is nobody on a tie for the highest level, and the tie is broken only by a level", () => {
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 3], [cell(6, 4), "zoe", 2]]);
    expect(mayors(s)).toEqual([]);
    expect(s.me("kai", RICH).rate).toBe(rate(3, 0));
    expect(s.me("mia", RICH).rate).toBe(rate(3, 0));
    // one more level takes the seat, over both others
    expect(s.upgrade("mia", RICH)).toBe("upgraded");
    expect(mayors(s)).toEqual([{ district: 4, cellId: cell(7, 7), label: "MIA" }]);
    expect(s.me("mia", RICH).rate).toBe(rate(4, 0, 16));
  });

  it("pays +8% per other qualifier, capped at +40%", () => {
    // the centre district: Kai Lv3 at r5c5, six Lv2s spread so none touch him
    const spots = [cell(4, 7), cell(5, 7), cell(6, 7), cell(7, 4), cell(7, 5), cell(7, 6)];
    const others: [number, string, number][] = spots.map((id, i) => [id, `p${i}`, 2]);
    for (let k = 1; k <= 6; k++) {
      const s = build([[cell(4, 4), "kai", 3], ...others.slice(0, k)]);
      const want = Math.min(40, 8 * k);
      expect(s.me("kai", RICH).rate, `${k} others`).toBe(rate(3, 0, want));
      expect(mayors(s)[0], `${k} others`).toEqual({ district: 4, cellId: cell(4, 4), label: "KAI" });
    }
    // and not 48% with six
    expect(build([[cell(4, 4), "kai", 3], ...others]).me("kai", RICH).rate).not.toBe(rate(3, 0, 48));
  });

  it("counts only its own district", () => {
    // Kai Lv3 at r5c5 (district 4), Mia Lv2 at r5c9 (district 5), apart
    const s = build([[cell(4, 4), "kai", 3], [cell(4, 9), "mia", 2]]);
    expect(mayors(s)).toEqual([]);
    expect(district(cell(4, 4))).not.toBe(district(cell(4, 9)));
  });

  it("never counts a park, which has no level", () => {
    // Kai Lv3 alone in the centre; Mia's two parks there and her Lv2 outside it
    const s = build([[cell(4, 4), "kai", 3], [cell(0, 0), "mia", 2]]);
    expect(s.park("mia", cell(7, 7), RICH)).toBe("parked");
    expect(s.park("mia", cell(6, 6), RICH)).toBe("parked");
    expect(mayors(s)).toEqual([]);
    expect(s.me("kai", RICH).rate).toBe(rate(3, 0));
  });

  it("never counts the mayor's own buildings as others (seats on its own)", () => {
    // one building per person makes this unreachable through the store; the
    // rule is the code's, so it's held directly
    const kai = [{ id: cell(4, 4), pid: "kai", level: 3 }, { id: cell(7, 7), pid: "kai", level: 2 }];
    expect(seats(kai).size).toBe(0);
    // two of his own at the top is not a tie
    expect(seats([...kai, { id: cell(6, 6), pid: "kai", level: 3 }, { id: cell(5, 7), pid: "mia", level: 2 }]).get(4)).toEqual({
      district: 4,
      cellId: cell(4, 4),
      pid: "kai",
      others: 1,
    });
    expect(seats([...kai, { id: cell(5, 7), pid: "mia", level: 2 }]).get(4)?.others).toBe(1);
  });

  it("goes when the rival leaves: a move out of the district unseats the mayor", () => {
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 2]]);
    expect(mayors(s)).toHaveLength(1);
    expect(s.claim(cell(0, 0), "mia", "MIA", RICH)).toBe("moved"); // Lv2 still, district 0
    expect(mayors(s)).toEqual([]);
    // moving back in makes Kai mayor again; moving the mayor carries no seat
    expect(s.claim(cell(4, 5), "kai", "KAI", at(5 * HOUR))).toBe("moved");
    expect(mayors(s, at(5 * HOUR))).toEqual([]);
  });

  it("never puts anyone under their base rate, on random boards with mayors and factories", () => {
    let seed = 5;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    let buildings = 0;
    let mayorsSeen = 0;
    for (let round = 0; round < 6; round++) {
      const s = memory();
      for (let id = 0; id < TILES; id++) if (rand() < 0.5) s.claim(id, `p${id}`, `P${id}`, T0);
      for (const t of s.tiles()) {
        if (!t.claimerId) continue;
        s.collect(t.claimerId, RICH);
        const ups = Math.floor(rand() * 4);
        for (let i = 0; i < ups; i++) s.upgrade(t.claimerId, RICH);
        if (rand() < 0.7) s.rezone(t.claimerId, "factory", RICH);
      }
      const tiles = s.tiles();
      const got = rates(tiles, RICH);
      mayorsSeen += mayorsOf(tiles, RICH).size;
      for (const t of tiles) {
        if (!t.claimerId) continue;
        expect(got[t.id], `round ${round}, plot ${t.id}`).toBeGreaterThanOrEqual(BASE_INCOME * (t.level ?? 1) * 100);
        buildings++;
      }
    }
    expect(buildings).toBeGreaterThan(300);
    expect(mayorsSeen).toBeGreaterThan(10);
    // the floor itself: a mayor term on top of any harm still floors at base
    for (let level = 1; level <= 5; level++) expect(rate(level, 0, -80 + 40)).toBe(BASE_INCOME * level * 100);
  });
});

describe("income across a change of mayor", () => {
  it("pays the mayor's rate up to the upgrade that ties them, and the plain rate after, to the cent", () => {
    // Kai Lv3, Mia Lv2, apart in the centre district: Kai is mayor (+8%)
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 2]]);
    s.collect("kai", RICH);
    s.collect("mia", RICH);
    const start = s.me("kai", RICH).pending; // leftover hundredths
    // thirty minutes on, Mia upgrades to Lv3: a tie, so nobody
    expect(s.upgrade("mia", at(4 * HOUR + 30 * MIN))).toBe("upgraded");
    const kai = start + 30 * rate(3, 0, 8) + 60 * rate(3, 0);
    expect(s.me("kai", at(4 * HOUR + 90 * MIN)).pending).toBe(kai);
    // not the plain rate, nor the mayor's, over the whole time
    expect(kai).not.toBe(start + 90 * rate(3, 0));
    expect(kai).not.toBe(start + 90 * rate(3, 0, 8));
    // and a settlement writes the same
    s.settle(at(4 * HOUR + 90 * MIN));
    expect(s.tiles()[cell(4, 4)].pendingCents).toBe(kai);
  });

  it("stops paying the mayor when their rival's lease ends, at the lease end", () => {
    // Mia's lease ends at T0 + 24 h; Kai renews past it, so he stands on
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 2]]);
    s.collect("kai", RICH);
    expect(s.renew("kai", 24, RICH)).toBe("renewed");
    s.collect("kai", at(22 * HOUR)); // empty it before the cap matters
    const start = s.me("kai", at(22 * HOUR)).pending;
    // two hours as mayor, then an hour after Mia's lease ended
    const end = at(25 * HOUR);
    expect(s.me("kai", end).pending).toBe(accrue(accrue(start, rate(3, 0, 8), 2 * HOUR), rate(3, 0), HOUR));
    expect(mayors(s, end)).toEqual([]);
  });

  // Random runs of claims, moves, helps, collects and upgrades at whole
  // minutes, in one district, against a model that reads every building's
  // rate from the board right after each action and accrues a minute at a
  // time. If an upgrade or a move applied a new mayor to time before it,
  // the two part.
  it("agrees with a minute-by-minute model over random claims, moves, helps, collects and upgrades", () => {
    let seed = 23;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    let upgrades = 0;
    let mayorMinutes = 0;
    let changes = 0;
    let checked = 0;
    for (let round = 0; round < 12; round++) {
      const s = memory();
      const pids = ["a", "b", "c", "d", "e"];
      const pending = new Map<string, number>();
      let tiles = s.tiles();
      let shown = rates(tiles, T0);
      let seated = "";
      for (let m = 0; m < 240; m++) {
        for (const t of tiles) if (t.claimerId) pending.set(t.claimerId, accrue(pending.get(t.claimerId) ?? 0, shown[t.id], MIN));
        const now = at((m + 1) * MIN);
        if (rand() < 0.45) {
          const pid = pids[Math.floor(rand() * pids.length)];
          const r = rand();
          // the centre district and the plots just outside it, so moves
          // carry buildings in and out
          const spot = cell(3 + Math.floor(rand() * 6), 3 + Math.floor(rand() * 6));
          if (r < 0.3) {
            const { paid } = s.collect(pid, now);
            if (paid > 0) pending.set(pid, (pending.get(pid) ?? 0) % 100);
          } else if (r < 0.6) {
            if (s.upgrade(pid, now) === "upgraded") upgrades++;
          } else if (r < 0.75) {
            const mine = s.tiles().find((t) => t.claimerId === pid);
            const them = s.tiles().find((t) => t.claimerId && t.claimerId !== pid && mine && Math.abs(t.id - mine.id) === 1);
            if (them) s.help(pid, them.id, now);
          } else s.claim(spot, pid, pid.toUpperCase(), now);
        }
        tiles = s.tiles();
        shown = rates(tiles, now);
        const seats = mayorsOf(tiles, now);
        mayorMinutes += seats.size;
        const key = [...seats.values()].map((x) => `${x.district}:${x.pid}`).join(",");
        if (key !== seated) changes++;
        seated = key;
      }
      const end = at(240 * MIN);
      for (const t of tiles) {
        if (!t.claimerId) continue;
        expect(s.me(t.claimerId, end).pending, `round ${round}: ${t.claimerId}`).toBe(pending.get(t.claimerId) ?? 0);
        checked++;
      }
    }
    expect(upgrades).toBeGreaterThan(60);
    expect(mayorMinutes).toBeGreaterThan(500);
    expect(changes).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(40);
  });
});

describe("what everyone sees", () => {
  it("names each district's mayor by label and plot, and never a pid, in any viewer's board", () => {
    const s = build([[cell(4, 4), "kai-secret-pid", 3], [cell(7, 7), "mia-secret-pid", 2], [cell(0, 0), "zoe-secret-pid", 2], [cell(1, 2), "ivy-secret-pid", 3]]);
    // the centre's and the top-left's: Kai over Mia, Ivy over Zoe
    for (const who of ["kai-secret-pid", "mia-secret-pid", "nobody"]) {
      const v = view(s, who);
      expect(v.mayors).toEqual([
        { district: 0, cellId: cell(1, 2), label: "IVY-SECRET-PID" },
        { district: 4, cellId: cell(4, 4), label: "KAI-SECRET-PID" },
      ]);
      expect(Object.keys(v.mayors[0]).sort()).toEqual(["cellId", "district", "label"]);
      // labels here are the pids upper-cased, so a pid shows only if leaked
      expect(JSON.stringify(v)).not.toMatch(/[a-z]+-secret-pid/);
    }
  });
});

describe("the city log", () => {
  it("says who became mayor of which district, once, by label, in districts people count from 1", () => {
    const s = build([[cell(4, 4), "kai", 3]]);
    expect(s.elect(RICH)).toEqual([]);
    expect(s.claim(cell(7, 7), "mia", "Mia", RICH)).toBe("claimed");
    expect(s.elect(RICH)).toEqual([]); // a Small House is nobody to be mayor over
    s.collect("mia", at(5 * HOUR)); // an hour alone: 100 + 600 coins
    expect(s.upgrade("mia", at(5 * HOUR))).toBe("upgraded");
    const changes = s.elect(at(5 * HOUR));
    expect(changes).toEqual([{ district: 4, pid: "kai", label: "KAI", cellId: cell(4, 4), from: null, fromLabel: null }]);
    expect(s.events(1)[0]).toMatchObject({ type: "mayor", text: "KAI became mayor of district 5", cellId: cell(4, 4) });
    // nothing changed: nothing said
    expect(s.elect(at(5 * HOUR))).toEqual([]);
    expect(s.events(1)[0].text).toBe("KAI became mayor of district 5");
    expect(JSON.stringify(s.events(8))).not.toMatch(/"(kai|mia)"/);
  });

  it("records the seats at boot without a word, so a restart doesn't announce them again", () => {
    const s = build([[cell(4, 4), "kai", 3], [cell(7, 7), "mia", 2]]);
    const before = s.events(8).length;
    expect(s.elect(RICH, false)).toHaveLength(1);
    expect(s.events(8).length).toBe(before);
    expect(s.elect(RICH)).toEqual([]);
  });
});
