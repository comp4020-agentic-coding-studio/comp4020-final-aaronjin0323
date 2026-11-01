// The store: one SQLite file (on /data in production). Every rule about
// artifacts lives here, and spec/store.test.ts holds it. Every change is one
// conditional statement, so it's atomic, and repeating it changes nothing.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
// @ts-ignore -- plain JS module shared with the page
import { CARRY_MAX, KINDS, SPOTS, VAULT, touches } from "../public/arena.js";
// @ts-ignore -- plain JS module shared with the page
import { DEFAULT_ROOM, checkLayout, roomName } from "../public/room.js";

/** Every change to the schema, in order; `user_version` says how many are
 * applied. Never edit one that has shipped. */
const MIGRATIONS = [
  `CREATE TABLE visitors (pid TEXT PRIMARY KEY, tag TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
   CREATE TABLE artifacts (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     x REAL NOT NULL, y REAL NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('available', 'carried', 'banked')),
     holder TEXT REFERENCES visitors(pid),
     owner TEXT REFERENCES visitors(pid),
     spawned_at INTEGER NOT NULL, picked_at INTEGER, banked_at INTEGER,
     ready_at INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX artifacts_available ON artifacts (state) WHERE state = 'available';
   CREATE INDEX artifacts_carried ON artifacts (holder) WHERE state = 'carried';
   CREATE INDEX artifacts_owned ON artifacts (owner, kind) WHERE state = 'banked';
   CREATE TRIGGER artifacts_banked_final BEFORE UPDATE OF state ON artifacts WHEN OLD.state = 'banked'
     BEGIN SELECT RAISE(ABORT, 'banked is final'); END;
   CREATE TRIGGER artifacts_kept BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'artifacts are never deleted'); END;`,
  // 2: what an artifact is made of, and the seed of its details (ADR 30)
  `ALTER TABLE artifacts ADD COLUMN material TEXT NOT NULL DEFAULT 'tin';
   ALTER TABLE artifacts ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;`,
  // 3: exhibition rooms (ADR 31), one to a visitor
  `CREATE TABLE rooms (pid TEXT PRIMARY KEY REFERENCES visitors(pid), layout TEXT NOT NULL, rev INTEGER NOT NULL, changed_at INTEGER NOT NULL, on_show INTEGER NOT NULL);
   CREATE INDEX rooms_directory ON rooms (changed_at DESC) WHERE on_show > 0;`,
];
/** How many rooms a page of the directory holds. */
export const ROOMS_PAGE = 12;
/** How many artifacts a shelf shows. */
export const SHELF_MAX = 60;

/**
 * Brings a database up to the newest migration. Before changing a file that
 * already has data, it copies it beside itself (`<path>.before-v<n>-<now>`),
 * and each migration runs in a transaction that rolls back whole if any
 * statement fails, so a failed upgrade leaves the file as it was.
 */
export function migrate(db: DatabaseSync, path: string, migrations: string[], now: number) {
  const from = (db.prepare("PRAGMA user_version").get() as Row).user_version as number;
  if (from >= migrations.length) return { from, to: from, backup: null };
  let backup: string | null = null;
  if (from > 0 && path !== ":memory:") {
    backup = `${path}.before-v${from}-${now}`;
    db.prepare("VACUUM INTO ?").run(backup);
  }
  for (let i = from; i < migrations.length; i++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { from, to: migrations.length, backup };
}

type Row = Record<string, any>;
type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;");
  migrate(db, path, MIGRATIONS, Date.now());

  const tx = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const tagOf = (pid: string) => createHash("sha256").update(pid).digest("hex").slice(0, 8);
  const backOnFloor = db.prepare("UPDATE artifacts SET state = 'available', holder = NULL, picked_at = NULL, x = ?, y = ?, ready_at = ? WHERE id = ? AND state = 'carried' AND holder = ?");

  return {
    db,
    close: () => db.close(),
    /** The visitor with this pid, or a new one. */
    visitor(pid: string | null, now: number) {
      if (pid) {
        const r = db.prepare("SELECT tag FROM visitors WHERE pid = ?").get(pid) as Row | undefined;
        if (r) return { pid, tag: r.tag as string, isNew: false };
      }
      const fresh = randomUUID();
      const tag = tagOf(fresh);
      db.prepare("INSERT INTO visitors (pid, tag, created_at) VALUES (?, ?, ?)").run(fresh, tag, now);
      return { pid: fresh, tag, isNew: true };
    },
    who(pid: string) {
      const r = db.prepare("SELECT tag FROM visitors WHERE pid = ?").get(pid) as Row | undefined;
      return r ? { tag: r.tag as string } : null;
    },

    /** One new artifact at a free spot no robot in `avoid` is touching, of
     * the material `roll` gives. False if there's no room. */
    spawn(now: number, avoid: number[][] = [], random: () => number = Math.random, roll: () => string = () => "tin"): boolean {
      const taken = db.prepare("SELECT x, y FROM artifacts WHERE state = 'available'").all() as Row[];
      const free = (SPOTS as number[][]).filter((p) => !taken.some((t) => touches([t.x, t.y], p)) && !avoid.some((r) => touches(r, p)));
      if (!free.length) return false;
      const p = free[Math.floor(random() * free.length)];
      const kind = KINDS[Math.floor(random() * KINDS.length)];
      db.prepare("INSERT INTO artifacts (id, kind, material, seed, x, y, state, spawned_at) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)").run(randomUUID(), kind, roll(), Math.floor(random() * 1_000_000), p[0], p[1], now);
      return true;
    },
    floor: () => (db.prepare("SELECT id, kind, material, seed, x, y, ready_at FROM artifacts WHERE state = 'available' ORDER BY spawned_at, id").all() as Row[]).map((r) => ({ id: r.id as string, kind: r.kind as string, material: r.material as string, seed: r.seed as number, pos: [r.x, r.y], readyAt: r.ready_at as number })),
    cargo: (pid: string) => (db.prepare("SELECT id, kind, material, seed FROM artifacts WHERE state = 'carried' AND holder = ? ORDER BY picked_at, id").all(pid) as Row[]).map((r) => ({ id: r.id as string, kind: r.kind as string, material: r.material as string, seed: r.seed as number })),

    /** A touch: theirs to carry if it's still available and ready, and they
     * carry fewer than CARRY_MAX. */
    pickUp(pid: string, id: string, now: number) {
      const r = db
        .prepare(`UPDATE artifacts SET state = 'carried', holder = ?, picked_at = ? WHERE id = ? AND state = 'available' AND ready_at <= ?
                  AND (SELECT COUNT(*) FROM artifacts WHERE state = 'carried' AND holder = ?) < ?`)
        .run(pid, now, id, now, pid, CARRY_MAX);
      return { ok: true as const, picked: r.changes === 1 };
    },
    /** A contact: everything each robot carries back on the floor at its
     * spots, free from `readyAt`, all at once. What moved, and from whom. */
    scatter(robots: { pid: string; spots: number[][] }[], readyAt: number) {
      return tx(() => {
        const out: { pid: string; id: string; kind: string; to: number[] }[] = [];
        for (const { pid, spots } of robots) {
          const carried = db.prepare("SELECT id, kind FROM artifacts WHERE state = 'carried' AND holder = ? ORDER BY picked_at, id").all(pid) as Row[];
          carried.forEach((r, i) => {
            const to = spots[i];
            if (to && backOnFloor.run(to[0], to[1], readyAt, r.id, pid).changes === 1) out.push({ pid, id: r.id, kind: r.kind, to });
          });
        }
        return out;
      });
    },
    /** A departed robot's cargo back on the floor, ready at once. Each goes
     * only from carried by its holder, so twice is once. How many. */
    releaseCargo(pid: string, now: number, spots: number[][]) {
      return tx(() => {
        const carried = db.prepare("SELECT id FROM artifacts WHERE state = 'carried' AND holder = ? ORDER BY picked_at, id").all(pid) as Row[];
        let n = 0;
        carried.forEach((r, i) => {
          const pos = spots[i] ?? spots[spots.length - 1] ?? (SPOTS as number[][])[0] ?? VAULT;
          n += backOnFloor.run(pos[0], pos[1], now, r.id, pid).changes as number;
        });
        return n;
      });
    },
    /** Everyone carrying anything right now. */
    holders: () => (db.prepare("SELECT DISTINCT holder FROM artifacts WHERE state = 'carried' ORDER BY holder").all() as Row[]).map((r) => r.holder as string),
    /** In the vault: everything the visitor carries is banked, for good. */
    bank(pid: string, now: number) {
      const r = db.prepare("UPDATE artifacts SET state = 'banked', owner = holder, holder = NULL, banked_at = ? WHERE state = 'carried' AND holder = ?").run(now, pid);
      return { ok: true as const, banked: r.changes as number };
    },
    /** What a visitor has banked, by kind. */
    collection(pid: string): Record<string, number> {
      const out: Record<string, number> = Object.fromEntries((KINDS as string[]).map((k) => [k, 0]));
      for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM artifacts WHERE state = 'banked' AND owner = ? GROUP BY kind").all(pid) as Row[]) out[r.kind] = r.c;
      return out;
    },
    /** How many of each catalog entry a visitor has banked: only those found. */
    catalog(pid: string): Record<string, number> {
      const out: Record<string, number> = {};
      for (const r of db.prepare("SELECT kind, material, COUNT(*) AS c FROM artifacts WHERE state = 'banked' AND owner = ? GROUP BY kind, material").all(pid) as Row[]) out[`${r.kind}:${r.material}`] = r.c;
      return out;
    },
    /** A visitor's newest banked artifacts. */
    shelf: (pid: string) =>
      (db.prepare("SELECT id, kind, material, seed, banked_at FROM artifacts WHERE state = 'banked' AND owner = ? ORDER BY banked_at DESC, id LIMIT ?").all(pid, SHELF_MAX) as Row[]).map((r) => ({ id: r.id as string, kind: r.kind as string, material: r.material as string, seed: r.seed as number, at: r.banked_at as number })),
    // ---- rooms (ADR 31)
    /** A room, as anyone may see it: never a pid. Null if there's no such visitor. */
    roomOf(tag: string) {
      const v = db.prepare("SELECT pid FROM visitors WHERE tag = ?").get(tag) as Row | undefined;
      if (!v) return null;
      const r = db.prepare("SELECT layout, rev FROM rooms WHERE pid = ?").get(v.pid) as Row | undefined;
      const layout = r ? JSON.parse(r.layout) : DEFAULT_ROOM;
      const artifacts: Record<string, unknown> = {};
      for (const i of layout.items) {
        if (!i.artifact) continue;
        const a = db.prepare("SELECT kind, material, seed, banked_at FROM artifacts WHERE id = ? AND owner = ? AND state = 'banked'").get(i.artifact, v.pid) as Row | undefined;
        if (a) artifacts[i.artifact] = { kind: a.kind, material: a.material, seed: a.seed, at: a.banked_at };
      }
      return { tag, name: roomName(tag) as string, layout, rev: (r?.rev ?? 0) as number, artifacts };
    },
    /** Saves a visitor's own room, and only theirs: there's no room to name.
     * From revision `was`, with artifacts they've banked. */
    saveRoom(pid: string, body: unknown, now: number) {
      const b = body as { layout?: unknown; was?: unknown } | null;
      if (!b || typeof b !== "object" || Object.keys(b).some((k) => k !== "layout" && k !== "was")) return fail(400, "bad-room", "A save is { layout, was }");
      if (!Number.isInteger(b.was)) return fail(400, "bad-room", "was is the revision you changed");
      const c = checkLayout(b.layout);
      if (!c.ok) return fail(400, "bad-room", c.error);
      return tx(() => {
        const rev = ((db.prepare("SELECT rev FROM rooms WHERE pid = ?").get(pid) as Row | undefined)?.rev ?? 0) as number;
        if (rev !== b.was) return fail(409, "stale-room", "Your room changed somewhere else; here it is now");
        const shown = (c.layout as Row).items.filter((i: Row) => i.artifact);
        for (const i of shown) {
          if (!db.prepare("SELECT 1 FROM artifacts WHERE id = ? AND owner = ? AND state = 'banked'").get(i.artifact, pid)) return fail(409, "not-owned", "Only what you've collected can stand in your room");
        }
        db.prepare(`INSERT INTO rooms (pid, layout, rev, changed_at, on_show) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (pid) DO UPDATE SET layout = excluded.layout, rev = excluded.rev, changed_at = excluded.changed_at, on_show = excluded.on_show`).run(pid, JSON.stringify(c.layout), rev + 1, now, shown.length);
        return { ok: true as const, rev: rev + 1 };
      });
    },
    /** The directory: rooms with something on show, newest change first.
     * `before` is the cursor a page gave as `next`: "<changed_at>.<tag>". */
    rooms(before: string | null) {
      let after: [number, string] | null = null;
      if (before !== null) {
        const m = /^(\d{1,15})\.([0-9a-f]{8})$/.exec(before);
        if (!m) return fail(400, "bad-cursor", "before is a cursor from a page of rooms");
        after = [Number(m[1]), m[2]];
      }
      const rows = db
        .prepare(
          `SELECT r.changed_at AS at, r.on_show AS n, r.layout, v.tag FROM rooms r JOIN visitors v ON v.pid = r.pid
           WHERE r.on_show > 0 AND (? IS NULL OR r.changed_at < ? OR (r.changed_at = ? AND v.tag < ?))
           ORDER BY r.changed_at DESC, v.tag DESC LIMIT ?`,
        )
        .all(after?.[0] ?? null, after?.[0] ?? null, after?.[0] ?? null, after?.[1] ?? null, ROOMS_PAGE + 1) as Row[];
      const page = rows.slice(0, ROOMS_PAGE);
      const last = page[page.length - 1];
      return {
        ok: true as const,
        entries: page.map((r) => ({ tag: r.tag as string, name: roomName(r.tag) as string, onShow: r.n as number, changedAt: r.at as number, wall: JSON.parse(r.layout).wall as string })),
        next: rows.length > ROOMS_PAGE && last ? `${last.at}.${last.tag}` : null,
      };
    },
    /** Everything anyone has ever banked. */
    vaultTotal: () => (db.prepare("SELECT COUNT(*) AS c FROM artifacts WHERE state = 'banked' AND owner IS NOT NULL").get() as Row).c as number,
  };
}

export type Store = ReturnType<typeof openStore>;
