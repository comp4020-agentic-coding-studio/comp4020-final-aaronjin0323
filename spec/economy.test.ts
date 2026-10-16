import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { boardView, heights } from "../src/board.ts";
import { isActive, N, openStore, type Store, TILES } from "../src/db.ts";
import {
  CAP_MINUTES,
  HELP_GIFT,
  HELP_REWARD,
  LEASE_MS,
  MAX_LEVEL,
  rate,
  RELOCATE_COST,
  renewOptions,
  STARTING_COINS,
  UPGRADE_COSTS,
  upgradeCost,
} from "../src/economy.ts";

// docs/adr/0005 on the store alone, with a clock the test controls: income
// over hours, leases over days, cooldowns over minutes. None of it could be
// waited for over HTTP.

const T0 = new Date("2026-10-01T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const cell = (r: number, c: number): number => r * N + c;

const opened: Store[] = [];
const memory = (): Store => {
  const s = openStore(":memory:");
  opened.push(s);
  return s;
};
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

// The person on a cell in these tests is named after it.
const pid = (id: number): string => `p${id}`;
const put = (s: Store, ids: number[], when: Date = T0): void => {
  for (const id of ids) expect(s.claim(id, pid(id), `L${id}`, when)).toBe("claimed");
};
// Coins, as a collect would pay them, at `when`.
const collectAt = (s: Store, who: string, when: Date): number => s.collect(who, when).paid;
// Coins in hand, without settling anything.
const coins = (s: Store, who: string, when: Date): number => s.me(who, when).coins;

describe("income rate", () => {
  it.each([
    [1, 0, 10],
    [1, 2, 14],
    [2, 3, 32],
    [3, 4, 54],
  ])("level %i with %i neighbours earns %i coins a minute (ADR 5's examples)", (level, n, perMin) => {
    expect(rate(level, n)).toBe(perMin * 100);
  });

  it("is a whole number of cents at every level and neighbour count, matching 10 × level × (1 + 0.2n)", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (let n = 0; n <= 8; n++) {
        const r = rate(level, n);
        expect(Number.isInteger(r), `L${level} n${n}`).toBe(true);
        expect(r).toBe((1000 * level * (5 + n)) / 5);
        expect(r / 100).toBeCloseTo(10 * level * (1 + 0.2 * n), 10);
      }
    }
  });

  it("prices upgrades 150, 400, 900, 1800, and none past level 5", () => {
    expect([1, 2, 3, 4, 5].map(upgradeCost)).toEqual([150, 400, 900, 1800, null]);
    expect(upgradeCost(0)).toBeNull();
  });

  it("offers renewals of 6, 12 and 24 hours, each refused past 48 hours from the start", () => {
    const opts = renewOptions(at(24 * HOUR), T0);
    expect(opts.map((o) => [o.hours, o.cost, o.allowed])).toEqual([
      [6, 100, true],
      [12, 180, true],
      [24, 300, true],
    ]);
    const late = renewOptions(at(40 * HOUR), T0);
    expect(late.map((o) => o.allowed)).toEqual([true, false, false]);
  });
});

describe("settling income", () => {
  it("earns each worked example over ten minutes, to the cent", () => {
    const s = memory();
    // L1 alone, at (1,1)
    put(s, [cell(1, 1)]);
    s.settle(at(10 * MIN));
    expect(s.me(pid(cell(1, 1)), at(10 * MIN)).pending).toBe(100 * 100);

    // L1 with two neighbours
    const t = memory();
    put(t, [cell(5, 5), cell(5, 4), cell(5, 6)]);
    expect(t.me(pid(cell(5, 5)), at(10 * MIN))).toMatchObject({ rate: 1400, pending: 14000 });
  });

  it("pays each level its rate: L2 with 3 neighbours 32/min, L3 with 4 neighbours 54/min", () => {
    const s = memory();
    const centre = cell(5, 5);
    const me = pid(centre);
    put(s, [centre, cell(4, 4), cell(4, 5), cell(4, 6)]); // L1, 3 neighbours: 16/min
    const t = 2 * HOUR;
    expect(collectAt(s, me, at(t))).toBe(1920);
    expect(s.upgrade(me, at(t))).toBe("upgraded");
    expect(s.me(me, at(t))).toMatchObject({ level: 2, rate: 3200 });
    expect(s.me(me, at(t + 10 * MIN)).pending).toBe(10 * 3200);
    expect(s.upgrade(me, at(t + 10 * MIN))).toBe("upgraded"); // L3, still 3 neighbours
    s.claim(cell(5, 4), "fourth", "Fourth", at(t + 10 * MIN)); // a fourth arrives
    expect(s.me(me, at(t + 20 * MIN))).toMatchObject({ level: 3, rate: 5400, pending: 10 * 3200 + 10 * 5400 });
  });

  it("integrates a neighbour arriving and leaving while you're offline, piece by piece", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    // 30 min alone (10/min), then Mia beside me for 60 min (12/min), then she moves away
    s.claim(cell(5, 6), "mia", "Mia", at(30 * MIN));
    s.claim(cell(9, 9), "kai", "Kai", at(30 * MIN)); // far off, changes nothing for me
    // Mia's lease would end at 24 h; she relocates away after an hour
    expect(s.claim(cell(0, 0), "mia", "Mia", at(90 * MIN))).toBe("moved");
    // and I look only now, two hours in: 30×10 + 60×12 + 30×10 = 1320 coins
    expect(s.me(me, at(120 * MIN)).pending).toBe(132000);
    expect(collectAt(s, me, at(120 * MIN))).toBe(1320);
    // at today's rate (10/min) over the whole two hours it would have been 1200
  });

  it("integrates leases ending at different times inside one absence, at each instant", () => {
    // Ann's lease ends at 24 h and Ben's (claimed 2 h later) at 26 h; mine I
    // renewed to 30 h. I collect at 23 h 30 and look again at 26 h 30, with
    // nobody acting in between.
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(5, 6)]);
    put(s, [cell(5, 4)], at(2 * HOUR));
    expect(s.renew(me, 6, at(2 * HOUR))).toBe("renewed");
    s.collect(me, at(23.5 * HOUR));
    expect(s.me(me, at(23.5 * HOUR)).pending).toBeLessThan(100);
    const left = s.me(me, at(23.5 * HOUR)).pending;
    // 30 min with two neighbours (14/min), 2 h with one (12/min), 30 min alone (10/min)
    const expected = left + 30 * 1400 + 120 * 1200 + 30 * 1000;
    expect(s.me(me, at(26.5 * HOUR)).pending).toBe(expected);
    // not today's rate over the whole three hours, nor the rate at the start
    expect(expected).not.toBe(left + 180 * 1000);
    expect(expected).not.toBe(left + 180 * 1400);
    // and settling writes exactly what reading projected
    s.settle(at(26.5 * HOUR));
    expect(s.tiles()[cell(5, 5)].pendingCents).toBe(expected);
    expect(s.tiles()[cell(5, 6)].claimerId).toBeNull();
    expect(s.tiles()[cell(5, 4)].claimerId).toBeNull();
  });

  it("stops at the 4-hour cap, and resumes once collected", () => {
    const s = memory();
    const me = pid(cell(2, 2));
    put(s, [cell(2, 2)]);
    expect(s.me(me, at(CAP_MINUTES * MIN)).pending).toBe(rate(1, 0) * CAP_MINUTES);
    expect(s.me(me, at(10 * HOUR)).pending).toBe(rate(1, 0) * CAP_MINUTES);
    expect(collectAt(s, me, at(10 * HOUR))).toBe(10 * CAP_MINUTES);
    expect(s.me(me, at(10 * HOUR + 10 * MIN)).pending).toBe(rate(1, 0) * 10);
  });

  it("stops at the lease end, mid-absence, and keeps those earnings collectable", () => {
    const s = memory();
    const me = pid(cell(2, 2));
    put(s, [cell(2, 2)]);
    expect(collectAt(s, me, at(LEASE_MS - 3 * HOUR))).toBe(10 * CAP_MINUTES); // collected 3 h before it ends
    // nobody looks until 30 h: income ran 3 h, then stopped at the 24 h end
    s.settle(at(30 * HOUR));
    expect(s.tiles()[cell(2, 2)].claimerId).toBeNull();
    expect(s.me(me, at(30 * HOUR))).toMatchObject({ cellId: null, pending: 3 * 60 * 1000, rate: 0 });
    expect(collectAt(s, me, at(31 * HOUR))).toBe(1800);
    expect(s.me(me, at(31 * HOUR)).pending).toBe(0);
  });

  it("keeps the leftover hundredths when it pays whole coins", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(5, 6)]); // 12 coins/min = 20 cents a second
    // 7 s at 12/min is 140 cents: one coin paid, 40 cents kept
    expect(collectAt(s, me, at(7000))).toBe(1);
    expect(s.me(me, at(7000)).pending).toBe(40);
  });
});

describe("collecting", () => {
  it("pays once for a duplicate collect at the same moment", () => {
    const s = memory();
    const me = pid(cell(3, 3));
    put(s, [cell(3, 3)]);
    expect(collectAt(s, me, at(HOUR))).toBe(600);
    expect(collectAt(s, me, at(HOUR))).toBe(0);
    expect(coins(s, me, at(HOUR))).toBe(STARTING_COINS + 600);
  });

  it("pays once when two stores on one database file collect together", () => {
    // Two processes on the same volume (a deploy overlapping the old
    // machine): each collect is its own BEGIN IMMEDIATE, so the second sees
    // the first's payout.
    const dir = mkdtempSync(join(tmpdir(), "skyline-econ-"));
    try {
      const a = openStore(join(dir, "app.db"));
      const b = openStore(join(dir, "app.db"));
      opened.push(a, b);
      a.claim(10, "ann", "Ann", T0);
      expect(a.collect("ann", at(HOUR)).paid + b.collect("ann", at(HOUR)).paid).toBe(600);
      expect(b.me("ann", at(HOUR)).coins).toBe(STARTING_COINS + 600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("upgrading", () => {
  it("climbs to level 5 one paid step at a time, then refuses", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    let t = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
      const cost = UPGRADE_COSTS[level - 1];
      // wait for income (4 h a time) until it can afford the step
      while (coins(s, me, at(t)) < cost) {
        t += 4 * HOUR;
        s.collect(me, at(t));
        // keep the lease alive: renew whenever it can, never past 48 h
        s.renew(me, 6, at(t));
      }
      const had = coins(s, me, at(t));
      expect(s.upgrade(me, at(t)), `to level ${level + 1}`).toBe("upgraded");
      expect(coins(s, me, at(t))).toBe(had - cost);
      expect(s.me(me, at(t)).level).toBe(level + 1);
      expect(s.me(me, at(t)).rate).toBe(rate(level + 1, 0));
    }
    const had = coins(s, me, at(t));
    expect(s.upgrade(me, at(t))).toBe("max-level");
    expect(coins(s, me, at(t))).toBe(had);
  });

  it("refuses with too few coins and charges nothing", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    expect(s.upgrade(me, T0)).toBe("coins");
    expect(s.me(me, T0)).toMatchObject({ coins: STARTING_COINS, level: 1 });
  });

  it("refuses someone holding no land", () => {
    expect(memory().upgrade("nobody", T0)).toBe("no-land");
  });

  it("charges once when upgrades come in back to back with coins for only one", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    s.collect(me, at(5 * MIN)); // 50 coins: 150 in all, enough for exactly one
    const results = [1, 2, 3].map(() => s.upgrade(me, at(5 * MIN)));
    expect(results).toEqual(["upgraded", "coins", "coins"]);
    expect(s.me(me, at(5 * MIN))).toMatchObject({ level: 2, coins: 0 });
  });

  it("lifts its height by one: height is level plus occupied neighbours", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(5, 6)]);
    expect(heights(s.tiles(), T0)[cell(5, 5)]).toBe(2);
    s.collect(me, at(5 * MIN));
    expect(s.upgrade(me, at(5 * MIN))).toBe("upgraded");
    expect(heights(s.tiles(), at(5 * MIN))[cell(5, 5)]).toBe(3);
    expect(heights(s.tiles(), at(5 * MIN))[cell(5, 6)]).toBe(2);
  });
});

describe("relocating", () => {
  it("moves the building for 50 coins, keeping its level, lease end and ownership start", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(5, 6)]);
    s.collect(me, at(15 * MIN)); // +180: 280
    expect(s.upgrade(me, at(15 * MIN))).toBe("upgraded"); // 130 left, level 2
    const before = s.me(me, at(15 * MIN));
    expect(s.claim(cell(0, 0), me, "Me", at(20 * MIN))).toBe("moved");
    const after = s.me(me, at(20 * MIN));
    expect(after).toMatchObject({
      cellId: cell(0, 0),
      level: 2,
      leaseEndsAt: before.leaseEndsAt,
      ownedSince: before.ownedSince,
      coins: before.coins - RELOCATE_COST,
    });
    expect(after.relocateAt).toBe(at(50 * MIN).toISOString());
    // the five minutes before the move are kept, at the rate they were earned
    expect(after.pending).toBe(5 * rate(2, 1));
    expect(s.tiles()[cell(5, 5)].claimerId).toBeNull();
  });

  it("recalculates neighbours: the old ones drop, the new ones rise", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(5, 6), cell(9, 9)]);
    expect(s.claim(cell(9, 8), me, "Me", at(MIN))).toBe("moved");
    const view = boardView(s.tiles(), me, at(MIN));
    expect(view.tiles[cell(5, 6)]).toMatchObject({ neighbours: 0, height: 1, rate: rate(1, 0) });
    expect(view.tiles[cell(9, 9)]).toMatchObject({ neighbours: 1, height: 2, rate: rate(1, 1) });
    expect(view.tiles[cell(9, 8)]).toMatchObject({ state: "mine", neighbours: 1, height: 2 });
  });

  it("refuses an occupied destination with a 'taken' and charges nothing", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5), cell(7, 7)]);
    expect(s.claim(cell(7, 7), me, "Me", at(MIN))).toBe("taken");
    expect(s.me(me, at(MIN))).toMatchObject({ cellId: cell(5, 5), coins: STARTING_COINS, relocateAt: null });
  });

  it("refuses a second move within 30 minutes, and allows it after", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    s.collect(me, at(10 * MIN)); // 200 coins
    expect(s.claim(cell(1, 1), me, "Me", at(10 * MIN))).toBe("moved");
    expect(s.claim(cell(2, 2), me, "Me", at(39 * MIN))).toBe("cooldown");
    expect(s.me(me, at(39 * MIN)).cellId).toBe(cell(1, 1));
    expect(s.claim(cell(2, 2), me, "Me", at(40 * MIN))).toBe("moved");
  });

  it("refuses a move you can't pay for", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    expect(s.renew(me, 6, T0)).toBe("renewed"); // 0 coins left
    expect(s.claim(cell(1, 1), me, "Me", T0)).toBe("coins");
    expect(s.me(me, T0).cellId).toBe(cell(5, 5));
  });

  it("renames for free when you claim your own plot again", () => {
    const s = memory();
    put(s, [cell(5, 5)]);
    expect(s.claim(cell(5, 5), pid(cell(5, 5)), "New", at(MIN))).toBe("renamed");
    expect(s.tiles()[cell(5, 5)].label).toBe("New");
    expect(s.me(pid(cell(5, 5)), at(MIN)).coins).toBe(STARTING_COINS);
  });
});

describe("renewing", () => {
  it.each([
    [6, 100],
    [12, 180],
    [24, 300],
  ])("adds %i hours for %i coins", (hours, cost) => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    s.collect(me, at(30 * MIN)); // 400 coins
    const was = Date.parse(s.me(me, at(30 * MIN)).leaseEndsAt!);
    expect(s.renew(me, hours, at(30 * MIN))).toBe("renewed");
    expect(Date.parse(s.me(me, at(30 * MIN)).leaseEndsAt!)).toBe(was + hours * HOUR);
    expect(s.me(me, at(30 * MIN)).coins).toBe(400 - cost);
  });

  it("never runs a lease past 48 hours from the ownership start", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    s.collect(me, at(4 * HOUR)); // 2500 coins
    expect(s.renew(me, 24, at(4 * HOUR))).toBe("renewed"); // ends at 48 h exactly
    for (const h of [6, 12, 24]) expect(s.renew(me, h, at(4 * HOUR))).toBe("max-lease");
    expect(s.me(me, at(4 * HOUR))).toMatchObject({ leaseEndsAt: at(48 * HOUR).toISOString(), coins: 2200 });
  });

  it("refuses an option that isn't 6, 12 or 24, and anyone without an active lease", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    expect(s.renew(me, 7, T0)).toBe("hours");
    expect(s.renew("nobody", 6, T0)).toBe("no-land");
    expect(s.renew(me, 6, at(LEASE_MS))).toBe("no-land"); // it ended a moment ago
  });

  it("keeps the 48 h cap through a move", () => {
    const s = memory();
    const me = pid(cell(5, 5));
    put(s, [cell(5, 5)]);
    s.collect(me, at(4 * HOUR));
    expect(s.claim(cell(0, 0), me, "Me", at(4 * HOUR))).toBe("moved");
    expect(s.renew(me, 24, at(4 * HOUR))).toBe("renewed");
    expect(s.renew(me, 6, at(4 * HOUR))).toBe("max-lease");
  });
});

describe("leases ending", () => {
  it("frees the plot on read at the lease end, before any sweep", () => {
    const s = memory();
    put(s, [cell(5, 5), cell(5, 6)]);
    const tiles = s.tiles(); // not settled: the rows still name their holders
    expect(tiles[cell(5, 5)].claimerId).toBe(pid(cell(5, 5)));
    const end = at(LEASE_MS);
    expect(isActive(tiles[cell(5, 5)], at(LEASE_MS - 1))).toBe(true);
    expect(isActive(tiles[cell(5, 5)], end)).toBe(false);
    expect(heights(tiles, end)[cell(5, 6)]).toBe(0);
    expect(boardView(tiles, "x", end).tiles[cell(5, 5)].state).toBe("free");
    // and anyone may claim it at once
    expect(s.claim(cell(5, 5), "new", "New", end)).toBe("claimed");
  });

  it("frees a lease that ended while the server was off, on the first settle after it starts", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-econ-"));
    try {
      const path = join(dir, "app.db");
      const before = openStore(path);
      before.claim(5, "ann", "Ann", T0);
      before.claim(6, "ben", "Ben", at(23 * HOUR));
      before.close();
      const after = openStore(path); // a day later, nothing having run
      opened.push(after);
      after.settle(at(25 * HOUR));
      expect(after.tiles()[5].claimerId).toBeNull();
      // Ann: capped at 4 h of 10/min, then the cap rose to 4 h of 12/min with Ben
      expect(after.takeExpired()).toEqual([{ cellId: 5, pid: "ann", label: "Ann", at: at(24 * HOUR).toISOString(), pendingCents: 288000 }]);
      expect(after.me("ann", at(25 * HOUR))).toMatchObject({ cellId: null, pending: 288000 });
      expect(after.events(8)[0]).toMatchObject({ type: "expire", text: "Ann's lease ended at row 1, column 6", cellId: 5 });
      // Ben earned at 12/min with Ann for an hour, then 10/min after she left at 24 h
      expect(after.me("ben", at(25 * HOUR)).pending).toBe(60 * 1200 + 60 * 1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tells the holder once that their lease ended, and keeps their coins", () => {
    const s = memory();
    put(s, [cell(5, 5)]);
    const me = pid(cell(5, 5));
    s.settle(at(LEASE_MS + HOUR));
    expect(s.visit(me, at(LEASE_MS + HOUR)).expired).toBe(true);
    expect(s.visit(me, at(LEASE_MS + HOUR)).expired).toBe(false);
    expect(s.me(me, at(LEASE_MS + HOUR)).coins).toBe(STARTING_COINS);
  });

  it("says once what a building earned while you were away", () => {
    const s = memory();
    put(s, [cell(5, 5)]);
    const me = pid(cell(5, 5));
    expect(s.visit(me, at(MIN)).welcome).toBeNull(); // a reload says nothing
    expect(s.visit(me, at(2 * HOUR)).welcome).toBe(1190); // 119 min at 10/min since the last visit
    expect(s.visit(me, at(2 * HOUR + 10 * MIN)).welcome).toBe(100);
    expect(s.visit(me, at(2 * HOUR + 10 * MIN)).welcome).toBeNull();
  });
});

describe("helping", () => {
  it("pays 50 to the neighbour and 20 to the helper, then cools down an hour", () => {
    const s = memory();
    put(s, [cell(5, 5), cell(5, 6), cell(4, 4)]);
    const me = pid(cell(5, 5));
    expect(s.help(me, cell(5, 6), T0)).toBe("helped");
    expect(coins(s, pid(cell(5, 6)), T0)).toBe(STARTING_COINS + HELP_GIFT);
    expect(coins(s, me, T0)).toBe(STARTING_COINS + HELP_REWARD);
    expect(s.help(me, cell(4, 4), at(59 * MIN))).toBe("cooldown"); // any neighbour, not just that one
    expect(s.help(me, cell(4, 4), at(60 * MIN))).toBe("helped");
    expect(s.events(1)[0]).toMatchObject({ type: "help", text: "L65 helped L52 at row 5, column 5" });
  });

  it("pays once for a doubled request", () => {
    const s = memory();
    put(s, [cell(5, 5), cell(5, 6)]);
    const results = [s.help(pid(cell(5, 5)), cell(5, 6), T0), s.help(pid(cell(5, 5)), cell(5, 6), T0)];
    expect(results).toEqual(["helped", "cooldown"]);
    expect(coins(s, pid(cell(5, 6)), T0)).toBe(STARTING_COINS + HELP_GIFT);
  });

  it("refuses a building that isn't next to yours, a free plot, yourself, and anyone holding no land", () => {
    const s = memory();
    put(s, [cell(5, 5), cell(5, 7), cell(0, 11), cell(1, 0)]);
    const me = pid(cell(5, 5));
    expect(s.help(me, cell(5, 7), T0)).toBe("not-neighbour"); // two along
    expect(s.help(me, cell(5, 6), T0)).toBe("not-neighbour"); // free
    expect(s.help(me, cell(5, 5), T0)).toBe("not-neighbour"); // me
    expect(s.help(pid(cell(0, 11)), cell(1, 0), T0)).toBe("not-neighbour"); // adjacent ids, opposite edges
    expect(s.help("nobody", cell(5, 5), T0)).toBe("no-land");
    expect(coins(s, me, T0)).toBe(STARTING_COINS);
  });

  it("refuses a neighbour whose lease has ended", () => {
    const s = memory();
    put(s, [cell(5, 6)]);
    put(s, [cell(5, 5)], at(HOUR));
    expect(s.help(pid(cell(5, 5)), cell(5, 6), at(LEASE_MS))).toBe("not-neighbour");
  });
});

describe("the city log", () => {
  it("records claims, upgrades, moves, renewals, expiries and help as public lines, newest first", () => {
    const s = memory();
    s.claim(cell(4, 2), "emma", "Emma", T0);
    s.claim(cell(4, 3), "kai", "Kai", T0);
    s.collect("emma", at(10 * MIN));
    s.upgrade("emma", at(10 * MIN));
    s.renew("kai", 6, at(10 * MIN));
    s.help("kai", cell(4, 2), at(11 * MIN));
    s.collect("emma", at(12 * MIN));
    s.claim(cell(9, 9), "emma", "Emma", at(12 * MIN));
    s.settle(at(31 * HOUR));
    const lines = s.events(8).map((e) => e.text);
    expect(lines).toEqual([
      "Kai's lease ended at row 5, column 4",
      "Emma's lease ended at row 10, column 10",
      "Emma moved their Townhouse to row 10, column 10",
      "Kai helped Emma at row 5, column 3",
      "Kai renewed their lease at row 5, column 4 by 6 hours",
      "Emma upgraded to a Townhouse at row 5, column 3",
      "Kai built a Small House at row 5, column 4",
      "Emma built a Small House at row 5, column 3",
    ]);
    expect(JSON.stringify(s.events(100))).not.toMatch(/"(emma|kai)"/);
  });
});

describe("landmarks (ADR 4, counted by occupied neighbours; gold since ADR 6)", () => {
  const golds = (s: Store, now: Date): number[] => s.raise(now).filter((l) => l.tier === "gold").map((l) => l.cellId);
  it("raises gold when all 8 neighbours are occupied, whatever their levels", () => {
    const s = memory();
    const ring = [cell(4, 4), cell(4, 5), cell(4, 6), cell(5, 4), cell(5, 6), cell(6, 4), cell(6, 5)];
    put(s, [cell(5, 5), ...ring]);
    expect(golds(s, T0)).toEqual([]);
    put(s, [cell(6, 6)]);
    expect(golds(s, T0)).toEqual([cell(5, 5)]);
    expect(heights(s.tiles(), T0)[cell(5, 5)]).toBe(9); // level 1 + 8
  });

  it("doesn't count a neighbour whose lease has ended", () => {
    const s = memory();
    put(s, [cell(4, 4)]);
    const later = at(LEASE_MS); // the first neighbour's lease ends as the rest arrive
    put(
      s,
      [cell(4, 5), cell(4, 6), cell(5, 4), cell(5, 5), cell(5, 6), cell(6, 4), cell(6, 5), cell(6, 6)],
      later,
    );
    expect(golds(s, later)).toEqual([]);
  });
});

describe("migration 4 from a crit-10 database (user_version 3)", () => {
  it("keeps every claim as a level-1 building with a 24-hour lease from the migration, and gives each holder 100 coins", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-econ-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what crit 10 held: migrations 1-3, user_version 3, with a
      // fresh claim, one dormant for days, a displacement and a landmark.
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE cells (id INTEGER PRIMARY KEY, claimer_id TEXT, label TEXT, claimed_at TEXT);
        CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL;
        ALTER TABLE cells ADD COLUMN last_seen_at TEXT;
        CREATE TABLE displaced (claimer_id TEXT PRIMARY KEY, label TEXT NOT NULL, cell_id INTEGER NOT NULL, displaced_at TEXT NOT NULL);
        CREATE TABLE landmarks (id INTEGER PRIMARY KEY, cell_id INTEGER, label TEXT, raisers TEXT, raised_at TEXT);
        CREATE UNIQUE INDEX one_landmark_each ON landmarks(cell_id);
        PRAGMA user_version = 3;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const claim = old.prepare("UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, last_seen_at = ? WHERE id = ?");
      claim.run("ann", "Ann", "2026-10-13T09:00:00.000Z", "2026-10-13T09:00:00.000Z", 40);
      claim.run("ben", "Ben", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z", 41); // dormant for days
      old.prepare("INSERT INTO displaced VALUES (?, ?, ?, ?)").run("cat", "Cat", 3, "2026-10-05T00:00:00.000Z");
      old.prepare("INSERT INTO landmarks (cell_id, label, raisers, raised_at) VALUES (?, ?, ?, ?)").run(77, "Dee", "[]", "2026-10-10T00:00:00.000Z");
      old.close();

      const before = Date.now();
      const s = openStore(path);
      opened.push(s);
      const after = Date.now();
      const now = new Date(after);
      const held = s.tiles().filter((t) => isActive(t, now));
      expect(held.map((t) => [t.id, t.claimerId, t.label])).toEqual([
        [40, "ann", "Ann"],
        [41, "ben", "Ben"],
      ]);
      for (const t of held) {
        expect(t.level).toBe(1);
        expect(t.pendingCents).toBe(0);
        expect(t.ownedSince).toBe(t.settledAt);
        const since = Date.parse(t.ownedSince!);
        expect(since).toBeGreaterThanOrEqual(before - 1000);
        expect(since).toBeLessThanOrEqual(after + 1000);
        expect(Date.parse(t.leaseEndsAt!) - since).toBe(LEASE_MS);
      }
      expect(s.me("ann", now)).toMatchObject({ coins: 100, cellId: 40, level: 1 });
      expect(s.me("ben", now)).toMatchObject({ coins: 100, cellId: 41 });
      // and from migration 5, it's gold with the tiers below it
      expect(s.landmarks().map((l) => `${l.cellId}:${l.tier}`).sort()).toEqual(["77:bronze", "77:gold", "77:silver"]);
      // income starts from the migration, at the neighbours' rate
      expect(s.me("ann", new Date(Date.parse(held[0].settledAt!) + 10 * MIN)).pending).toBe(10 * rate(1, 1));
      s.close();
      opened.pop();

      // opening again runs nothing twice; the old columns and table are kept
      const again = openStore(path);
      opened.push(again);
      expect(again.me("ann", now).coins).toBe(100);
      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(5);
      expect(v.prepare("SELECT COUNT(*) AS n FROM displaced").get()).toEqual({ n: 1 });
      expect(v.prepare("SELECT last_seen_at FROM cells WHERE id = 41").get()).toEqual({ last_seen_at: "2026-10-02T09:00:00.000Z" });
      expect(v.prepare("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 2 });
      // coins can never go below zero, in the database itself
      expect(() => v.prepare("UPDATE players SET coins = -1 WHERE pid = 'ann'").run()).toThrow(/CHECK/);
      expect(JSON.stringify(v.prepare("SELECT * FROM events").all())).not.toMatch(/"ann"|"ben"/);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
