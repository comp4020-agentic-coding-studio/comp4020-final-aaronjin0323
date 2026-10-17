import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { boardView, rates } from "../src/board.ts";
import { integrate, N, neighbourIds, openStore, type Store, TILES } from "../src/db.ts";
import {
  accrue,
  BASE_INCOME,
  LEASE_MS,
  MARKET_CAP_PERCENT,
  rate,
  REZONE_COOLDOWN_MS,
  REZONE_COST,
  STARTING_COINS,
  ZONES,
  zoneBonus,
} from "../src/economy.ts";

// docs/adr/0009 on the store alone, with a clock the test controls: a
// rezone moves its neighbours' rates too, so income across one has to be
// exact to the cent, and the cooldown is an hour no HTTP test could wait.

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

const view = (s: Store, pid: string, now: Date) =>
  boardView(s.tiles(), pid, now, s.landmarks(), { me: s.me(pid, now), parks: s.parks() });

describe("the numbers", () => {
  it("are civic 0/0, market +15% to neighbours, factory +35% self and −10% to neighbours", () => {
    expect(ZONES).toEqual({ civic: { self: 0, neighbour: 0 }, market: { self: 0, neighbour: 15 }, factory: { self: 35, neighbour: -10 } });
    expect([REZONE_COST, REZONE_COOLDOWN_MS, MARKET_CAP_PERCENT]).toEqual([40, HOUR, 30]);
  });

  it("caps what a building receives from markets at +30%, never capping harm", () => {
    expect(zoneBonus("civic", ["market"])).toBe(15);
    expect(zoneBonus("civic", ["market", "market"])).toBe(30);
    expect(zoneBonus("civic", ["market", "market", "market"])).toBe(30);
    expect(zoneBonus("civic", Array(8).fill("market"))).toBe(30);
    // the cap is on gifts, after which harm still counts in full
    expect(zoneBonus("civic", ["market", "market", "market", "factory"])).toBe(20);
    expect(zoneBonus("factory", ["factory", "factory"])).toBe(15);
    // a zone the store doesn't know is civic
    expect(zoneBonus("bogus", ["bogus", "__proto__"])).toBe(0);
  });

  it("never puts a building under its no-neighbour base rate", () => {
    for (let level = 1; level <= 5; level++) {
      const base = BASE_INCOME * level * 100;
      expect(rate(level, 0)).toBe(base);
      expect(rate(level, 0, -10)).toBe(base);
      expect(rate(level, 0, -80)).toBe(base);
      expect(rate(level, 1, -30)).toBe(base); // +20 − 30 floors at 0, not −10
      expect(rate(level, 2, -30)).toBe((base / 100) * 110);
      // the floor is on the total, so a self term isn't eaten by harm below 0
      expect(rate(level, 0, 35 - 50)).toBe(base);
    }
    // the existing numbers are untouched with no zone terms
    expect(rate(1, 0)).toBe(1000);
    expect(rate(2, 3)).toBe(3200);
  });
});

describe("rezoning", () => {
  it("costs 40 coins, changes only your own building, and is logged for the city", () => {
    const s = memory();
    expect(s.rezone("kai", "factory", T0)).toEqual({ ok: false, reason: "no-land" });
    s.claim(cell(5, 5), "kai", "Kai", T0);
    expect(s.tiles()[cell(5, 5)].zone).toBe("civic");
    expect(s.rezone("kai", "factory", T0)).toEqual({ ok: true, zone: "factory", from: "civic", cellId: cell(5, 5) });
    expect(s.tiles()[cell(5, 5)].zone).toBe("factory");
    expect(s.me("kai", T0)).toMatchObject({ coins: STARTING_COINS - REZONE_COST, rezoneAt: at(HOUR).toISOString() });
    expect(s.events(1)[0]).toMatchObject({ type: "rezone", text: "Kai zoned a factory", cellId: cell(5, 5) });
  });

  it("refuses a bad zone and the zone you already have, charging nothing and starting no cooldown", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    for (const bad of ["", "Factory", "park", "constructor", "__proto__", "toString"]) {
      expect(s.rezone("kai", bad, T0), bad).toEqual({ ok: false, reason: "zone" });
    }
    expect(s.rezone("kai", "civic", T0)).toEqual({ ok: false, reason: "same-zone" });
    expect(s.me("kai", T0)).toMatchObject({ coins: STARTING_COINS, rezoneAt: null });
  });

  it("cools down for an hour per player: refused at 59 minutes, allowed at 60", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    expect(s.rezone("kai", "market", T0).ok).toBe(true);
    expect(s.rezone("kai", "factory", at(59 * MIN))).toEqual({ ok: false, reason: "cooldown" });
    expect(s.rezone("kai", "factory", at(HOUR - 1))).toEqual({ ok: false, reason: "cooldown" });
    expect(s.me("kai", at(HOUR - 1)).coins).toBe(STARTING_COINS - REZONE_COST);
    expect(s.rezone("kai", "factory", at(HOUR)).ok).toBe(true);
    expect(s.me("kai", at(HOUR)).coins).toBe(STARTING_COINS - 2 * REZONE_COST);
    // the cooldown is the player's: moving doesn't reset it (Mia helps
    // Kai to the 50 a move costs)
    s.claim(cell(5, 6), "mia", "Mia", at(HOUR));
    expect(s.help("mia", cell(5, 5), at(HOUR))).toBe("helped");
    expect(s.claim(cell(0, 0), "kai", "Kai", at(HOUR + MIN))).toBe("moved");
    expect(s.rezone("kai", "civic", at(HOUR + 2 * MIN))).toEqual({ ok: false, reason: "cooldown" });
  });

  it("needs 40 coins: 39 is not enough", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.park("kai", cell(0, 0), T0); // 40 left
    expect(s.rezone("kai", "market", T0).ok).toBe(true); // exactly 40
    expect(s.me("kai", T0).coins).toBe(0);
    expect(s.rezone("kai", "factory", at(HOUR))).toEqual({ ok: false, reason: "coins" });
    expect(s.tiles()[cell(5, 5)].zone).toBe("market");
  });

  it("starts a new claim civic, keeps the zone on a move, and frees a plot back to civic", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.rezone("kai", "factory", T0);
    expect(s.claim(cell(2, 2), "kai", "Kai", at(MIN))).toBe("moved");
    expect(s.tiles()[cell(2, 2)].zone).toBe("factory");
    expect(s.tiles()[cell(5, 5)].zone).toBe("civic");
    expect(s.claim(cell(5, 5), "mia", "Mia", at(MIN))).toBe("claimed");
    expect(s.tiles()[cell(5, 5)].zone).toBe("civic");
    // a lease ending frees the plot as civic: the next holder starts afresh
    s.settle(at(LEASE_MS + MIN));
    expect(s.tiles()[cell(2, 2)]).toMatchObject({ claimerId: null, zone: "civic" });
    expect(s.claim(cell(2, 2), "zoe", "Zoe", at(LEASE_MS + MIN))).toBe("claimed");
    expect(s.tiles()[cell(2, 2)].zone).toBe("civic");
  });
});

describe("what each zone does", () => {
  it("a factory earns +35% for itself and takes 10% from each other person's building beside it", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(5, 6), "mia", "Mia", T0);
    s.claim(cell(5, 7), "zoe", "Zoe", T0); // beside Mia, not Kai
    s.rezone("kai", "factory", T0);
    const v = view(s, "zoe", T0);
    expect(v.tiles[cell(5, 5)]).toMatchObject({ zone: "factory", rate: 1550 }); // 100 + 20 + 35
    expect(v.tiles[cell(5, 6)]).toMatchObject({ zone: "civic", rate: 1300 }); // 100 + 20·2 − 10
    expect(v.tiles[cell(5, 7)]).toMatchObject({ zone: "civic", rate: 1200 }); // Mia only
    expect(s.me("kai", T0).rate).toBe(1550);
    expect(s.me("mia", T0).rate).toBe(1300);
    // a free plot and a park carry no zone
    expect(v.tiles[cell(0, 0)].zone).toBeUndefined();
  });

  it("a market earns nothing extra itself and gives +15% to each other person's building beside it", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(5, 6), "mia", "Mia", T0);
    s.rezone("kai", "market", T0);
    expect(s.me("kai", T0).rate).toBe(1200);
    expect(s.me("mia", T0).rate).toBe(1350);
  });

  it("caps the market gifts one building receives at +30%", () => {
    const s = memory();
    const centre = cell(5, 5);
    s.claim(centre, "hold", "Hold", T0);
    const ring = neighbourIds(centre).slice(0, 4);
    ring.forEach((id, i) => {
      s.claim(id, `m${i}`, `M${i}`, T0);
      expect(s.rezone(`m${i}`, "market", T0).ok).toBe(true);
    });
    // 4 neighbours (+80) and four markets' worth (+60) capped at +30
    expect(s.me("hold", T0).rate).toBe(10 * (100 + 80 + 30));
    expect(view(s, "x", T0).tiles[centre].rate).toBe(2100);
  });

  it("never acts on a building held by the same person (integrate on its own)", () => {
    // one building per person makes this unreachable through the store; the
    // rule is still the code's, so it's held here directly
    const b = (id: number, pid: string, zone: string) => ({ id, pid, label: pid, level: 1, end: 24 * HOUR, pending: 0, settled: 0, zone });
    const same = integrate([b(cell(5, 5), "kai", "factory"), b(cell(5, 6), "kai", "civic")], HOUR);
    expect(same.pending.get(cell(5, 6))).toBe(60 * 1200);
    const other = integrate([b(cell(5, 5), "kai", "factory"), b(cell(5, 6), "mia", "civic")], HOUR);
    expect(other.pending.get(cell(5, 6))).toBe(60 * 1100);
  });

  it("lets nobody's rate fall under their base, on random boards of factories", () => {
    // every factory beside you is also a neighbour (+20), so it nets +10;
    // checked across many boards, not argued
    let rand = 3;
    const next = (): number => ((rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let buildings = 0;
    for (let round = 0; round < 20; round++) {
      const s = memory();
      for (let id = 0; id < TILES; id++) if (next() < 0.5) s.claim(id, `p${id}`, `P${id}`, T0);
      for (const t of s.tiles()) if (t.claimerId && next() < 0.7) s.rezone(t.claimerId, next() < 0.85 ? "factory" : "market", T0);
      const tiles = s.tiles();
      const got = rates(tiles, T0);
      for (const t of tiles) {
        if (!t.claimerId) continue;
        expect(got[t.id], `round ${round}, plot ${t.id}`).toBeGreaterThanOrEqual(BASE_INCOME * (t.level ?? 1) * 100);
        buildings++;
      }
    }
    expect(buildings).toBeGreaterThan(1000);
  });
});

describe("a rezone is a cut point", () => {
  it("pays everyone beside it the old rates up to the rezone and the new ones after, to the cent", () => {
    const s = memory();
    s.claim(cell(5, 5), "kai", "Kai", T0);
    s.claim(cell(5, 6), "mia", "Mia", T0);
    expect(s.rezone("kai", "factory", at(30 * MIN)).ok).toBe(true);
    // nobody acts after the rezone; reading at 90 minutes projects it
    const mia = 30 * 1200 + 60 * 1100;
    const kai = 30 * 1200 + 60 * 1550; // 100 + 20 + 35
    expect(s.me("mia", at(90 * MIN)).pending).toBe(mia);
    expect(s.me("kai", at(90 * MIN)).pending).toBe(kai);
    // not today's rate over the whole time
    expect(mia).not.toBe(90 * 1100);
    s.settle(at(90 * MIN));
    expect(s.tiles()[cell(5, 6)].pendingCents).toBe(mia);
  });

  // Random runs of claims, moves and rezones at whole minutes on one store,
  // against a model that reads every building's rate from the board right
  // after each action and accrues a minute at a time. If any action applied
  // a new rate to time before it (a rezone that didn't settle first), the
  // two part.
  it("agrees with a minute-by-minute model over random claims, moves and rezones", () => {
    let seed = 11;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    const zones = ["civic", "market", "factory"];
    let rezones = 0;
    let checked = 0;
    for (let round = 0; round < 25; round++) {
      const s = memory();
      const pids = ["a", "b", "c", "d", "e", "f"];
      const pending = new Map<string, number>(); // by pid: what the model says each has waiting
      let shown = rates(s.tiles(), T0);
      let tiles = s.tiles();
      for (let m = 0; m < 180; m++) {
        // a minute at the rates the last action left
        for (const t of tiles) if (t.claimerId) pending.set(t.claimerId, accrue(pending.get(t.claimerId) ?? 0, shown[t.id], MIN));
        const now = at((m + 1) * MIN);
        if (rand() < 0.35) {
          const pid = pids[Math.floor(rand() * pids.length)];
          const r = rand();
          // a small patch, so most actions land beside someone
          const spot = cell(4 + Math.floor(rand() * 3), 4 + Math.floor(rand() * 3));
          if (r < 0.5) {
            if (s.rezone(pid, zones[Math.floor(rand() * 3)], now).ok) rezones++;
          } else s.claim(spot, pid, pid.toUpperCase(), now);
        }
        tiles = s.tiles();
        shown = rates(tiles, now);
      }
      const end = at(180 * MIN);
      for (const t of tiles) {
        if (!t.claimerId) continue;
        expect(s.me(t.claimerId, end).pending, `round ${round}: ${t.claimerId}`).toBe(pending.get(t.claimerId) ?? 0);
        checked++;
      }
    }
    expect(rezones).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(100);
  });
});

describe("migration 8 (zoning) from a version-7 database", () => {
  it("makes every plot civic, changes nobody's income, and starts no cooldown", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what production held after return the favour: migrations 1-7.
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
        CREATE TABLE parks (cell_id INTEGER PRIMARY KEY, placed_by TEXT NOT NULL, label TEXT, placed_at TEXT NOT NULL, ends_at TEXT NOT NULL);
        ALTER TABLE players ADD COLUMN helped_by TEXT;
        ALTER TABLE players ADD COLUMN helped_by_at TEXT;
        PRAGMA user_version = 7;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const until = at(LEASE_MS).toISOString();
      const put = old.prepare(
        "UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, level = ?, lease_ends_at = ?, owned_since = ?, settled_at = ?, pending_cents = 300 WHERE id = ?",
      );
      put.run("ann", "Ann", T0.toISOString(), 2, until, T0.toISOString(), T0.toISOString(), cell(5, 5));
      put.run("bo", "Bo", T0.toISOString(), 1, until, T0.toISOString(), T0.toISOString(), cell(5, 6));
      old.prepare("INSERT INTO players (pid, label, coins) VALUES ('ann', 'Ann', 120)").run();
      old.prepare("INSERT INTO players (pid, label, coins) VALUES ('bo', 'Bo', 150)").run();
      old.close();

      const s = openStore(path);
      opened.push(s);
      expect(s.tiles()[cell(5, 5)]).toMatchObject({ claimerId: "ann", level: 2, pendingCents: 300, zone: "civic" });
      expect(s.tiles().every((t) => t.zone === "civic")).toBe(true);
      // the same income as before zoning: level 2 with one neighbour, level 1 with one
      expect(s.me("ann", T0)).toMatchObject({ coins: 120, rate: rate(2, 1), rezoneAt: null });
      expect(s.me("bo", T0).rate).toBe(rate(1, 1));
      expect(s.me("ann", at(HOUR)).pending).toBe(300 + 60 * 2400);
      // the new columns work straight away
      expect(s.rezone("bo", "market", T0).ok).toBe(true);
      expect(s.me("ann", T0).rate).toBe(20 * (100 + 20 + 15));
      s.close();
      opened.pop();

      const again = openStore(path); // runs nothing twice
      opened.push(again);
      expect(again.tiles()[cell(5, 6)].zone).toBe("market");
      again.close();
      opened.pop();

      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(8);
      const zone = (v.prepare("PRAGMA table_info(cells)").all() as { name: string; type: string; notnull: number; dflt_value: string }[]).find((c) => c.name === "zone");
      expect(zone).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "'civic'" });
      const last = (v.prepare("PRAGMA table_info(players)").all() as { name: string; type: string; notnull: number }[]).find((c) => c.name === "last_rezoned_at");
      expect(last).toMatchObject({ type: "TEXT", notnull: 0 });
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
