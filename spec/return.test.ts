import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { N, openStore, type Store, TILES } from "../src/db.ts";
import { HELP_GIFT, HELP_REWARD, LEASE_MS, RETURN_BONUS, RETURN_WINDOW_MS, STARTING_COINS } from "../src/economy.ts";

// docs/adr/0008 on the store alone, with a clock the test controls: helping
// back the neighbour who helped you, within the hour, pays 30 more each.

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

const coins = (s: Store, who: string, when: Date = T0): number => s.me(who, when).coins;

// Mia, Kai and Zed in a row: Mia beside Kai, Kai beside Zed. Far is two away.
const MIA = { pid: "mia-pid", id: cell(5, 4), label: "Mia" };
const KAI = { pid: "kai-pid", id: cell(5, 5), label: "Kai" };
const ZED = { pid: "zed-pid", id: cell(5, 6), label: "Zed" };
function city(): Store {
  const s = memory();
  for (const p of [MIA, KAI, ZED]) expect(s.claim(p.id, p.pid, p.label, T0)).toBe("claimed");
  return s;
}

describe("returning the favour", () => {
  it("pays 30 more to each when the helped neighbour helps back inside the hour", () => {
    const s = city();
    expect(s.help(MIA.pid, KAI.id, T0)).toBe("helped");
    expect(s.help(KAI.pid, MIA.id, at(59 * MIN))).toBe("returned");
    // Mia: +20 for helping, +50 for being helped, +30 for the return
    expect(coins(s, MIA.pid, at(59 * MIN))).toBe(STARTING_COINS + HELP_REWARD + HELP_GIFT + RETURN_BONUS);
    // Kai: +50 for being helped, +20 for helping, +30 for the return
    expect(coins(s, KAI.pid, at(59 * MIN))).toBe(STARTING_COINS + HELP_GIFT + HELP_REWARD + RETURN_BONUS);
    expect(s.events(1)[0]).toMatchObject({ type: "help", text: "Kai returned Mia's help", cellId: MIA.id });
  });

  it("pays nothing extra once the hour is up", () => {
    const s = city();
    expect(s.help(MIA.pid, KAI.id, T0)).toBe("helped");
    expect(s.help(KAI.pid, MIA.id, at(RETURN_WINDOW_MS))).toBe("helped");
    expect(coins(s, MIA.pid, at(HOUR))).toBe(STARTING_COINS + HELP_REWARD + HELP_GIFT);
    expect(coins(s, KAI.pid, at(HOUR))).toBe(STARTING_COINS + HELP_GIFT + HELP_REWARD);
  });

  it("doesn't count a third party's help, either way round", () => {
    const s = city();
    // Zed helps Kai; Kai then helps Mia, who never helped him: no bonus
    expect(s.help(ZED.pid, KAI.id, T0)).toBe("helped");
    expect(s.help(KAI.pid, MIA.id, at(MIN))).toBe("helped");
    expect(coins(s, MIA.pid, at(MIN))).toBe(STARTING_COINS + HELP_GIFT);
    expect(coins(s, KAI.pid, at(MIN))).toBe(STARTING_COINS + HELP_GIFT + HELP_REWARD);
    // and Mia, who owes Kai, helping Zed instead isn't a return either
    const t = memory();
    for (const p of [MIA, KAI]) t.claim(p.id, p.pid, p.label, T0);
    t.claim(cell(6, 4), ZED.pid, ZED.label, T0);
    expect(t.help(KAI.pid, MIA.id, T0)).toBe("helped");
    expect(t.help(MIA.pid, cell(6, 4), at(MIN))).toBe("helped");
    expect(coins(t, ZED.pid, at(MIN))).toBe(STARTING_COINS + HELP_GIFT);
  });

  it("counts only the latest helper: a newer favour replaces an older one", () => {
    const s = city();
    expect(s.help(ZED.pid, KAI.id, T0)).toBe("helped");
    expect(s.help(MIA.pid, KAI.id, at(MIN))).toBe("helped");
    expect(s.help(KAI.pid, ZED.id, at(2 * MIN))).toBe("helped"); // Zed's favour was replaced by Mia's
  });

  it("pays once: a return opens no favour back, and a doubled return pays nothing more", () => {
    const s = city();
    expect(s.help(MIA.pid, KAI.id, T0)).toBe("helped");
    const results = [s.help(KAI.pid, MIA.id, at(MIN)), s.help(KAI.pid, MIA.id, at(MIN))];
    expect(results).toEqual(["returned", "cooldown"]);
    expect(coins(s, MIA.pid, at(MIN))).toBe(STARTING_COINS + HELP_REWARD + HELP_GIFT + RETURN_BONUS);
    expect(s.me(KAI.pid, at(MIN)).returnable).toBeNull(); // spent
    expect(s.me(MIA.pid, at(MIN)).returnable).toBeNull(); // and nothing opened back
    // as soon as Mia's hour is up (still inside the hour since Kai's
    // return), her help is an ordinary one
    expect(s.help(MIA.pid, KAI.id, at(HOUR))).toBe("helped");
    expect(coins(s, KAI.pid, at(HOUR))).toBe(STARTING_COINS + 2 * HELP_GIFT + HELP_REWARD + RETURN_BONUS);
  });

  it("tells only the helped person, and only while the window is open and the helper is beside them", () => {
    const s = city();
    expect(s.me(KAI.pid, T0).returnable).toBeNull();
    expect(s.help(MIA.pid, KAI.id, T0)).toBe("helped");
    expect(s.me(KAI.pid, T0).returnable).toEqual({ cellId: MIA.id, until: at(RETURN_WINDOW_MS).toISOString() });
    expect(s.me(MIA.pid, T0).returnable).toBeNull();
    expect(s.me(ZED.pid, T0).returnable).toBeNull();
    expect(s.me(KAI.pid, at(RETURN_WINDOW_MS)).returnable).toBeNull();
    // Mia moves away: no return while she's out of reach (help is adjacent-only)
    expect(s.claim(cell(9, 9), MIA.pid, MIA.label, at(MIN))).toBe("moved");
    expect(s.me(KAI.pid, at(MIN)).returnable).toBeNull();
    expect(s.help(KAI.pid, cell(9, 9), at(MIN))).toBe("not-neighbour");
    // and comes back beside Kai inside the hour: it's open again
    expect(s.claim(cell(4, 5), MIA.pid, MIA.label, at(40 * MIN))).toBe("moved");
    expect(s.me(KAI.pid, at(40 * MIN)).returnable).toEqual({ cellId: cell(4, 5), until: at(RETURN_WINDOW_MS).toISOString() });
    expect(s.help(KAI.pid, cell(4, 5), at(41 * MIN))).toBe("returned");
  });

  it("isn't offered once the helper's lease has ended", () => {
    const s = memory();
    expect(s.claim(MIA.id, MIA.pid, "Mia", T0)).toBe("claimed");
    expect(s.claim(KAI.id, KAI.pid, "Kai", at(HOUR))).toBe("claimed");
    expect(s.help(MIA.pid, KAI.id, at(LEASE_MS - 10 * MIN))).toBe("helped");
    expect(s.me(KAI.pid, at(LEASE_MS - MIN)).returnable).not.toBeNull();
    expect(s.me(KAI.pid, at(LEASE_MS)).returnable).toBeNull();
  });
});

describe("migration 7 (return the favour) from a version-6 database", () => {
  it("adds helped_by and helped_by_at, nullable, and keeps every plot and wallet", () => {
    const dir = mkdtempSync(join(tmpdir(), "skyline-"));
    const path = join(dir, "app.db");
    try {
      // Exactly what production held after parks: migrations 1-6.
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
        PRAGMA user_version = 6;
      `);
      const seed = old.prepare("INSERT INTO cells (id) VALUES (?)");
      for (let id = 0; id < TILES; id++) seed.run(id);
      const until = at(LEASE_MS).toISOString();
      const put = old.prepare(
        "UPDATE cells SET claimer_id = ?, label = ?, claimed_at = ?, level = 1, lease_ends_at = ?, owned_since = ?, settled_at = ? WHERE id = ?",
      );
      put.run("ann", "Ann", T0.toISOString(), until, T0.toISOString(), T0.toISOString(), MIA.id);
      put.run("bo", "Bo", T0.toISOString(), until, T0.toISOString(), T0.toISOString(), KAI.id);
      // Ann helped Bo just before the deploy: the old schema can't record a favour
      old.prepare("INSERT INTO players (pid, label, coins, last_helped_at) VALUES ('ann', 'Ann', 120, ?)").run(T0.toISOString());
      old.prepare("INSERT INTO players (pid, label, coins) VALUES ('bo', 'Bo', 150)").run();
      old.close();

      const s = openStore(path);
      opened.push(s);
      expect(s.tiles()[MIA.id]).toMatchObject({ claimerId: "ann", label: "Ann", leaseEndsAt: until });
      expect(s.me("ann", T0).coins).toBe(120);
      // no favour is open for anyone: a help from before the migration is an ordinary help
      expect(s.me("bo", T0).returnable).toBeNull();
      expect(s.help("bo", MIA.id, at(MIN))).toBe("helped");
      // the new columns work straight away
      expect(s.me("ann", at(MIN)).returnable).toEqual({ cellId: KAI.id, until: at(MIN + RETURN_WINDOW_MS).toISOString() });
      s.close();
      opened.pop();

      const again = openStore(path); // runs nothing twice
      opened.push(again);
      expect(again.me("ann", at(MIN)).returnable).not.toBeNull();
      again.close();
      opened.pop();

      const v = new DatabaseSync(path);
      expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);
      const cols = (v.prepare("PRAGMA table_info(players)").all() as { name: string; type: string; notnull: number }[])
        .filter((c) => c.name.startsWith("helped_by"))
        .map((c) => [c.name, c.type, c.notnull]);
      expect(cols).toEqual([
        ["helped_by", "TEXT", 0],
        ["helped_by_at", "TEXT", 0],
      ]);
      v.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
