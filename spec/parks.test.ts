import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { boardView, heights, neighbourCounts } from "../src/board.ts";
import { integrate, N, neighbourIds, openStore, type ParkSpan, type Store, TILES } from "../src/db.ts";
import { accrue, GOLD_PEOPLE, LEASE_MS, PARK_COST, PARK_LIMIT, PARK_MS, STARTING_COINS, tiersReached, ZONES } from "../src/economy.ts";

// docs/adr/0007 on the store alone, with a clock the test controls: a park
// runs two hours, and income across its start and end has to be exact to
// the cent, which no HTTP test could wait for.

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

// Coins for a player who needs more than they start with: neighbours help
// them (+50 each), so nothing is written behind the store's back.
function fund(s: Store, who: string, home: number, helpers: number, when: Date): void {
  const spots = neighbourIds(home).filter((id) => s.tiles()[id].claimerId === null).slice(0, helpers);
  expect(spots).toHaveLength(helpers);
  for (const [i, id] of spots.entries()) {
    expect(s.claim(id, `helper-${who}-${i}`, `H${i}`, when)).toBe("claimed");
    expect(s.help(`helper-${who}-${i}`, home, when)).toBe("helped");
  }
}

const view = (s: Store, pid: string, now: Date) =>
  boardView(s.tiles(), pid, now, s.landmarks(), { me: s.me(pid, now), parks: s.parks() });

describe("placing a park", () => {
  it("costs 60 coins, needs land, and stands for 2 hours on a free plot", () => {
    const s = memory();
    expect(s.park("kai", cell(5, 6), T0)).toBe("no-land");
    expect(s.claim(cell(5, 5), "kai", "Kai", T0)).toBe("claimed");
    expect(s.park("kai", cell(5, 6), T0)).toBe("parked");
    expect(s.me("kai", T0)).toMatchObject({ coins: STARTING_COINS - PARK_COST, parks: 1, parkLimit: PARK_LIMIT });
    expect(s.parks()).toEqual([
      { cellId: cell(5, 6), placedBy: "kai", label: "Kai", placedAt: T0.toISOString(), endsAt: at(PARK_MS).toISOString() },
    ]);
    expect(s.events(1)[0]).toMatchObject({ type: "park", text: "Kai opened a park at row 6, column 7", cellId: cell(5, 6) });
    expect([PARK_COST, PARK_MS, PARK_LIMIT]).toEqual([60, 2 * HOUR, 2]);
  });

  it("refuses a held plot or a running park as taken, and charges nothing", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(5, 7), "mia", "Mia", T0);
    expect(s.park("kai", cell(5, 7), T0)).toBe("taken");
    expect(s.park("kai", cell(5, 5), T0)).toBe("taken"); // his own building too
    expect(s.park("mia", cell(5, 6), T0)).toBe("parked");
    expect(s.park("kai", cell(5, 6), T0)).toBe("taken");
    expect(s.me("kai", T0).coins).toBe(STARTING_COINS);
  });

  it("allows two running at once, refuses a third, and allows another once one ends", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    fund(s, "kai", cell(5, 5), 2, T0); // 200 coins
    expect(s.park("kai", cell(0, 0), T0)).toBe("parked");
    expect(s.park("kai", cell(0, 2), at(30 * MIN))).toBe("parked");
    expect(s.park("kai", cell(0, 4), at(30 * MIN))).toBe("park-limit");
    expect(s.me("kai", at(30 * MIN)).coins).toBe(200 - 2 * PARK_COST);
    // the first ends at 2 h: a third may go down, and the first's plot is free
    expect(s.park("kai", cell(0, 4), at(PARK_MS - 1))).toBe("park-limit");
    expect(s.me("kai", at(PARK_MS)).parks).toBe(1);
    expect(s.park("kai", cell(0, 4), at(PARK_MS))).toBe("parked"); // 80 left after two: one more is 60
    expect(s.me("kai", at(PARK_MS)).coins).toBe(200 - 3 * PARK_COST);
  });

  it("checks coins: 59 is not enough", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.park("kai", cell(0, 0), T0); // 40 left
    expect(s.park("kai", cell(0, 2), T0)).toBe("coins");
    expect(s.parks()).toHaveLength(1);
  });

  it("is never renewed: when it ends its plot is free, for a park or a building", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(9, 9), "mia", "Mia", T0);
    s.park("kai", cell(5, 6), T0);
    expect(s.claim(cell(5, 6), "zoe", "Zoe", at(PARK_MS - MIN))).toBe("taken"); // a park blocks building
    expect(s.claim(cell(9, 9), "mia", "Mia", at(PARK_MS - MIN))).toBe("renamed");
    expect(s.claim(cell(5, 6), "mia", "Mia", at(PARK_MS - MIN))).toBe("taken"); // nor a move onto it
    expect(s.claim(cell(5, 6), "zoe", "Zoe", at(PARK_MS))).toBe("claimed");
  });
});

describe("a park ending", () => {
  it("is gone on read at its end, before any sweep, and the sweep deletes it and tells the log", () => {
    const s = memory();
    s.claim(cell(5, 5), "mia", "Mia", T0);
    s.claim(cell(0, 0), "kai", "Kai", T0);
    s.park("kai", cell(5, 6), T0);
    const before = view(s, "zoe", at(PARK_MS - 1));
    expect(before.tiles[cell(5, 6)]).toMatchObject({ state: "park", label: "Kai", mine: false });
    expect(before.tiles[cell(5, 5)]).toMatchObject({ neighbours: 1, height: 2, rate: 1200 });
    // nothing has swept yet; the row is still there
    const after = view(s, "zoe", at(PARK_MS));
    expect(s.parks()).toHaveLength(1);
    expect(after.tiles[cell(5, 6)].state).toBe("free");
    expect(after.tiles[cell(5, 5)]).toMatchObject({ neighbours: 0, height: 1, rate: 1000 });
    expect(s.me("kai", at(PARK_MS)).parks).toBe(0);
    s.settle(at(PARK_MS + 5 * MIN));
    expect(s.parks()).toEqual([]);
    expect(s.takeParksEnded()).toEqual([{ cellId: cell(5, 6), pid: "kai", label: "Kai", at: at(PARK_MS).toISOString() }]);
    expect(s.takeParksEnded()).toEqual([]);
    expect(s.events(1)[0]).toMatchObject({ type: "park-end", text: "Kai's park ended at row 6, column 7", at: at(PARK_MS).toISOString() });
  });
});

describe("who a park counts for", () => {
  it("lifts every building round it but its placer's own: height, neighbours and income", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(5, 7), "mia", "Mia", T0);
    s.park("kai", cell(5, 6), T0); // between Kai's and Mia's
    const v = view(s, "kai", T0);
    expect(v.tiles[cell(5, 5)]).toMatchObject({ state: "mine", neighbours: 0, height: 1, rate: 1000 });
    expect(v.tiles[cell(5, 7)]).toMatchObject({ state: "held", neighbours: 1, height: 2, rate: 1200 });
    expect(v.tiles[cell(5, 6)]).toMatchObject({ state: "park", label: "Kai", mine: true, height: 0, rate: 0, hue: null });
    expect(s.me("kai", T0).rate).toBe(1000);
    expect(s.me("mia", T0).rate).toBe(1200);
    // Mia sees the same park as someone else's
    expect(view(s, "mia", T0).tiles[cell(5, 6)].mine).toBe(false);
    expect(heights(s.tiles(), T0, s.parks())[cell(5, 7)]).toBe(2);
    expect(neighbourCounts(s.tiles(), T0, s.parks())[cell(5, 5)]).toBe(0);
    // a park isn't a plot anyone holds: the count of buildings leaves it out
    expect(v.claimed).toBe(2);
  });

  it("never names a pid on the board, only the placer's label", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai-secret-pid", "Kai", T0);
    s.park("kai-secret-pid", cell(5, 6), T0);
    for (const who of ["mia", "kai-secret-pid"]) expect(JSON.stringify(view(s, who, T0))).not.toContain("kai-secret-pid");
  });
});

describe("income across a park (integrate)", () => {
  it("pays the park's +20% exactly while it stands, and not a minute after it ends", () => {
    const s = memory();
    s.claim(cell(5, 5), "mia", "Mia", T0);
    s.claim(cell(0, 0), "kai", "Kai", T0);
    // 10 min alone, then Kai's park beside her for 2 h, then alone again for
    // 30 min; nobody acts after the park goes down
    expect(s.park("kai", cell(5, 6), at(10 * MIN))).toBe("parked");
    const end = 10 * MIN + PARK_MS;
    const expected = 10 * 1000 + 120 * 1200 + 30 * 1000;
    expect(s.me("mia", at(end + 30 * MIN)).pending).toBe(expected);
    // not today's rate over the whole time, nor the park's
    expect(expected).not.toBe(160 * 1000);
    expect(expected).not.toBe(10 * 1000 + 150 * 1200);
    // and settling writes exactly what reading projected
    s.settle(at(end + 30 * MIN));
    expect(s.tiles()[cell(5, 5)].pendingCents).toBe(expected);
    expect(s.collect("mia", at(end + 30 * MIN)).paid).toBe(expected / 100);
  });

  it("never pays the placer for their own park, while paying the neighbour beside both", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(4, 6), "mia", "Mia", T0); // beside Kai, and beside the park
    s.park("kai", cell(5, 6), T0);
    // Kai: Mia only (12/min). Mia: Kai and Kai's park (14/min).
    expect(s.me("kai", at(HOUR)).pending).toBe(60 * 1200);
    expect(s.me("mia", at(HOUR)).pending).toBe(60 * 1400);
    // Mia's own park beside Kai lifts Kai, but never Mia
    s.claim(cell(9, 9), "zed", "Zed", at(HOUR));
    expect(s.park("mia", cell(4, 5), at(HOUR))).toBe("parked");
    expect(s.me("kai", at(2 * HOUR)).pending).toBe(60 * 1200 + 60 * 1400);
    expect(s.me("mia", at(2 * HOUR)).pending).toBe(60 * 1400 + 60 * 1400);
  });

  it("counts a park placed mid-interval only from when it was placed", () => {
    // integrate() on its own: Mia settled at 0, a park placed at 25 min and
    // ending at 70, nothing settled in between (as a read made later sees it)
    const mia = { id: cell(5, 5), pid: "mia", label: "Mia", level: 2, end: 24 * HOUR, pending: 500, settled: 0 };
    const park: ParkSpan = { id: cell(5, 6), by: "kai", start: 25 * MIN, end: 70 * MIN };
    const p = integrate([mia], 100 * MIN, [park]);
    // level 2: 20/min alone, 24/min with the park
    expect(p.pending.get(cell(5, 5))).toBe(500 + 25 * 2000 + 45 * 2400 + 30 * 2000);
    // placed by Mia herself, it pays her nothing
    expect(integrate([mia], 100 * MIN, [{ ...park, by: "mia" }]).pending.get(cell(5, 5))).toBe(500 + 100 * 2000);
    // a park that ended before the interval, or starts after it, counts for nothing
    expect(integrate([mia], 100 * MIN, [{ ...park, start: -3 * HOUR, end: -HOUR }]).pending.get(cell(5, 5))).toBe(500 + 100 * 2000);
    expect(integrate([mia], 100 * MIN, [{ ...park, start: 100 * MIN, end: 200 * MIN }]).pending.get(cell(5, 5))).toBe(500 + 100 * 2000);
  });

  it("stops a building at its own lease end even while a park beside it runs on", () => {
    const s = memory();
    s.claim(cell(5, 5), "mia", "Mia", T0);
    s.collect("mia", at(LEASE_MS - HOUR)); // empty the 4-hour cap first
    s.claim(cell(0, 0), "kai", "Kai", at(LEASE_MS - HOUR));
    s.park("kai", cell(5, 6), at(LEASE_MS - HOUR)); // runs an hour past Mia's lease
    s.settle(at(LEASE_MS + HOUR));
    // Mia's lease ended; her last hour was at 12/min, then nothing
    expect(s.tiles()[cell(5, 5)].claimerId).toBeNull();
    expect(s.me("mia", at(LEASE_MS + HOUR)).pending).toBe(60 * 1200);
  });

  // A reference model: step the clock a minute at a time, work out every
  // building's neighbours at that minute from scratch, and accrue one minute.
  // integrate() must agree to the cent on random boards with buildings
  // ending and parks starting and ending inside the interval, and every
  // building in a random zone (docs/adr/0009): the model works out each
  // zone's terms from the table in ZONES by hand, cap and floor included,
  // not from zoneBonus(), so a mistake there can't agree with itself.
  it("agrees with a minute-by-minute model on random boards with parks and zones", () => {
    // mulberry32, as spec/diff.test.ts uses: a seeded generator that doesn't
    // lose precision and fall into a short cycle
    let s32 = 7;
    const rand = (): number => {
      s32 = (s32 + 0x6d2b79f5) >>> 0;
      let t = s32;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    const minutes = (n: number): number => Math.floor(rand() * n) * MIN;
    let checked = 0;
    let parkMinutes = 0;
    let factoryMinutes = 0;
    let cappedMinutes = 0;
    const zoneNames = Object.keys(ZONES) as (keyof typeof ZONES)[];
    for (let round = 0; round < 60; round++) {
      const span = 180 * MIN;
      const buildings = [];
      const used = new Set<number>();
      const pids = ["a", "b", "c", "d"];
      for (let id = cell(3, 3); id <= cell(7, 7); id++) {
        if (rand() < 0.4) {
          used.add(id);
          buildings.push({
            id,
            pid: pids[Math.floor(rand() * pids.length)] + id,
            label: `L${id}`,
            level: 1 + Math.floor(rand() * 5),
            end: rand() < 0.4 ? minutes(180) + MIN : 24 * HOUR,
            pending: Math.floor(rand() * 5000),
            settled: 0,
            // markets weighted up, so some buildings are ringed past the cap
            zone: rand() < 0.25 ? "civic" : rand() < 0.6 ? "market" : zoneNames[Math.floor(rand() * zoneNames.length)],
          });
        }
      }
      const parks: ParkSpan[] = [];
      for (let id = cell(3, 3); id <= cell(7, 7); id++) {
        if (used.has(id) || rand() > 0.3) continue;
        const start = minutes(240) - 60 * MIN;
        // placed by one of the buildings' holders, sometimes a neighbour of its own
        const by = buildings.length && rand() < 0.6 ? buildings[Math.floor(rand() * buildings.length)].pid : `stranger${id}`;
        parks.push({ id, by, start, end: start + (rand() < 0.5 ? PARK_MS : minutes(90) + MIN) });
      }
      const now = span;
      const got = integrate(buildings, now, parks);

      // the model
      const pending = new Map(buildings.map((b) => [b.id, b.pending]));
      const ended = new Map<number, number>();
      for (let m = 0; m < now; m += MIN) {
        const live = buildings.filter((b) => b.end > m);
        for (const b of buildings) if (b.end <= m && !ended.has(b.id)) ended.set(b.id, pending.get(b.id)!);
        const liveIds = new Set(live.map((b) => b.id));
        const running = parks.filter((p) => p.start <= m && p.end > m);
        for (const b of live) {
          const n = neighbourIds(b.id).filter((id) => liveIds.has(id) || running.some((p) => p.id === id && p.by !== b.pid)).length;
          if (running.some((p) => neighbourIds(b.id).includes(p.id))) parkMinutes++;
          // zones: each live building beside it held by someone else
          const others = live.filter((x) => x.pid !== b.pid && neighbourIds(b.id).includes(x.id));
          const markets = others.filter((x) => x.zone === "market").length * 15;
          const factories = others.filter((x) => x.zone === "factory").length * -10;
          if (factories < 0) factoryMinutes++;
          if (markets > 30) cappedMinutes++;
          const bonus = Math.max(0, 20 * n + (b.zone === "factory" ? 35 : 0) + Math.min(30, markets) + factories);
          pending.set(b.id, accrue(pending.get(b.id)!, 10 * b.level * (100 + bonus), MIN));
        }
      }
      for (const b of buildings) if (b.end <= now && !ended.has(b.id)) ended.set(b.id, pending.get(b.id)!);

      for (const b of buildings) {
        if (ended.has(b.id)) {
          expect(got.pending.has(b.id), `round ${round}: ${b.id} ended`).toBe(false);
          expect(got.expired.find((e) => e.cellId === b.id)?.pendingCents, `round ${round}: ${b.id} at its end`).toBe(ended.get(b.id));
        } else {
          expect(got.pending.get(b.id), `round ${round}: building ${b.id}`).toBe(pending.get(b.id));
        }
        checked++;
      }
    }
    // not a vacuous pass: parks really did stand beside buildings
    expect(checked).toBeGreaterThan(300);
    expect(parkMinutes).toBeGreaterThan(5000);
    expect(factoryMinutes).toBeGreaterThan(2000);
    expect(cappedMinutes).toBeGreaterThan(200);
  });
});

describe("landmarks with parks (ADR 6 as amended by ADR 7)", () => {
  it("lets two people raise bronze: one neighbour and two of their parks", () => {
    const s = memory();
    // Kai has exactly 100 coins: one park, then Mia helps him to a second
    s.claim(cell(5, 5), "mia", "Mia", T0);
    s.claim(cell(5, 6), "kai", "Kai", T0);
    expect(s.park("kai", cell(4, 5), T0)).toBe("parked");
    expect(s.help("mia", cell(5, 6), T0)).toBe("helped");
    expect(s.park("kai", cell(6, 5), T0)).toBe("parked");
    const raised = s.raise(T0);
    // Mia: Kai's building and his two parks. Kai: Mia only (his own parks
    // never count for him), so no crown for him.
    expect(raised.map((l) => [l.cellId, l.tier])).toEqual([[cell(5, 5), "bronze"]]);
    // the raisers are people, each once: Mia, then Kai (his building and parks)
    expect(raised[0].raisers).toEqual(["Mia", "Kai"]);
    expect(view(s, "mia", T0).tiles[cell(5, 6)].neighbours).toBe(1);
  });

  it("raises gold over parks from 3 or more people, naming each person once", () => {
    const s = memory();
    const centre = cell(5, 5);
    s.claim(centre, "hold", "Hold", T0);
    const ring = neighbourIds(centre);
    // six buildings, then two parks by the first of them
    ring.slice(0, 6).forEach((id, i) => expect(s.claim(id, `p${i}`, `P${i}`, T0)).toBe("claimed"));
    fund(s, "p0", ring[0], 1, T0);
    expect(s.park("p0", ring[6], T0)).toBe("parked");
    expect(s.park("p0", ring[7], T0)).toBe("parked");
    const gold = s.raise(T0).find((l) => l.cellId === centre && l.tier === "gold");
    expect(gold?.raisers).toEqual(["Hold", "P0", "P1", "P2", "P3", "P4", "P5"]);
    // ended parks un-count on read: a building filling again later records nothing new
    expect(view(s, "x", at(PARK_MS)).tiles[centre].neighbours).toBe(6);
  });

  it("needs 3 distinct people for gold, never for bronze or silver", () => {
    expect(GOLD_PEOPLE).toBe(3);
    expect(tiersReached(8, 2)).toEqual(["bronze", "silver"]);
    expect(tiersReached(8, 3)).toEqual(["bronze", "silver", "gold"]);
    expect(tiersReached(5, 1)).toEqual(["bronze", "silver"]);
    expect(tiersReached(3, 1)).toEqual(["bronze"]);
    expect(tiersReached(2, 9)).toEqual([]);
  });
});

describe("migration 6 (parks) from a version-5 database", () => {
  it("adds the parks table, keeps every plot, wallet and landmark, and leaves the one-plot index alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what production held after landmark tiers: migrations 1-5.
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE cells (id INTEGER PRIMARY KEY, claimer_id TEXT, label TEXT, claimed_at TEXT);
        CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL;
        ALTER TABLE cells ADD COLUMN last_seen_at TEXT;
        CREATE TABLE displaced (claimer_id TEXT PRIMARY KEY, label TEXT NOT NULL, cell_id INTEGER NOT NULL, displaced_at TEXT NOT NULL);
        CREATE TABLE landmarks (id INTEGER PRIMARY KEY, cell_id INTEGER, label TEXT, raisers TEXT, raised_at TEXT);
        CREATE TABLE players (
          pid TEXT PRIMARY KEY, label TEXT,
          coins INTEGER NOT NULL DEFAULT 100 CHECK (coins >= 0),
          unclaimed_cents INTEGER NOT NULL DEFAULT 0 CHECK (unclaimed_cents >= 0),
          created_at TEXT, last_relocated_at TEXT, last_helped_at TEXT,
          earned_cents INTEGER NOT NULL DEFAULT 0, seen_at TEXT,
          seen_earned_cents INTEGER NOT NULL DEFAULT 0, lease_lost_at TEXT
        );
        ALTER TABLE cells ADD COLUMN level INTEGER;
        ALTER TABLE cells ADD COLUMN lease_ends_at TEXT;
        ALTER TABLE cells ADD COLUMN owned_since TEXT;
        ALTER TABLE cells ADD COLUMN pending_cents INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE cells ADD COLUMN settled_at TEXT;
        CREATE TABLE events (id INTEGER PRIMARY KEY, type TEXT, text TEXT, cell_id INTEGER, at TEXT);
        ALTER TABLE landmarks ADD COLUMN tier TEXT NOT NULL DEFAULT 'gold';
        CREATE UNIQUE INDEX one_landmark_per_tier ON landmarks(cell_id, tier);
        PRAGMA user_version = 5;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const until = at(LEASE_MS).toISOString();
      old
        .prepare("UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, level = 2, lease_ends_at = ?, owned_since = ?, settled_at = ?, pending_cents = 300 WHERE id = ?")
        .run("ann", "Ann", T0.toISOString(), until, T0.toISOString(), T0.toISOString(), 42);
      old.prepare("INSERT INTO players (pid, label, coins) VALUES ('ann', 'Ann', 250)").run();
      old.prepare("INSERT INTO landmarks (cell_id, tier, label, raisers, raised_at) VALUES (77, 'bronze', 'Mia', '[\"Mia\"]', 't')").run();
      old.close();

      const s = openStore(path);
      opened.push(s);
      expect(s.tiles()[42]).toMatchObject({ claimerId: "ann", label: "Ann", level: 2, pendingCents: 300, leaseEndsAt: until });
      expect(s.me("ann", T0).coins).toBe(250);
      expect(s.landmarks()).toHaveLength(1);
      expect(s.parks()).toEqual([]);
      // the new table works straight away
      expect(s.park("ann", 43, T0)).toBe("parked");
      expect(s.parks()).toHaveLength(1);
      s.close();
      opened.pop();

      const again = openStore(path); // runs nothing twice
      opened.push(again);
      expect(again.parks()).toHaveLength(1);
      again.close();
      opened.pop();

      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(8);
      const cols = (v.prepare("PRAGMA table_info(parks)").all() as { name: string; notnull: number; pk: number }[]).map((c) => [c.name, c.notnull, c.pk]);
      expect(cols).toEqual([
        ["cell_id", 0, 1],
        ["placed_by", 1, 0],
        ["label", 0, 0],
        ["placed_at", 1, 0],
        ["ends_at", 1, 0],
      ]);
      // one park per plot, held by the table itself
      expect(() => v.prepare("INSERT INTO parks VALUES (43, 'x', 'X', 't', 't')").run()).toThrow(/UNIQUE|PRIMARY/);
      // the one-plot-per-player index is exactly what it was
      expect(v.prepare("SELECT sql FROM sqlite_master WHERE name = 'one_tile_each'").get()).toEqual({
        sql: "CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id) WHERE claimer_id IS NOT NULL",
      });
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
