// The store: one SQLite file (on /data in production). Every rule about who
// may change what lives here, and spec/store.test.ts holds it over
// `:memory:` with an injected clock (`now`, in ms).
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
// @ts-ignore -- plain JS module shared with the page
import { MAX_GESTURES, MAX_PER_VISITOR, checkGesture } from "../public/fountain.js";
// @ts-ignore -- plain JS module shared with the page
import { CARRY_MAX, DISPLAY_SLOTS, HOMES, KINDS, MAX_AVAILABLE, SPOTS, touches } from "../public/hall.js";

export type Who = { tag: string; name: string; colour: number };
export type Gesture = { kind: string; at: number; by: string; seq: number; [k: string]: unknown };
export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

export const COLOURS = 8;
export const SLOTS = 6;
const ARCHIVE_SHOWN = 10;

const ADJ = ["Coral", "Amber", "Misty", "Lunar", "Copper", "Velvet", "Sunny", "Quiet", "Indigo", "Silver", "Mossy", "Rosy"];
const NOUN = ["Heron", "Otter", "Lark", "Finch", "Hare", "Moth", "Wren", "Ibis", "Owl", "Newt", "Fox", "Crane"];

/** Every change to the schema, in order; `user_version` says how many are
 * applied. Add to the end, never edit one that has shipped. */
export const MIGRATIONS = [
  `CREATE TABLE visitors (pid TEXT PRIMARY KEY, tag TEXT NOT NULL UNIQUE, name TEXT NOT NULL, colour INTEGER NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE loops (id INTEGER PRIMARY KEY, gestures TEXT NOT NULL, based_on INTEGER, next_seq INTEGER NOT NULL DEFAULT 1, started_at INTEGER NOT NULL, archived_at INTEGER);
   CREATE UNIQUE INDEX one_live_loop ON loops ((archived_at IS NULL)) WHERE archived_at IS NULL;
   CREATE TABLE exhibits (id INTEGER PRIMARY KEY, slot INTEGER UNIQUE CHECK (slot BETWEEN 1 AND 6), created_at INTEGER NOT NULL);
   CREATE TABLE versions (id INTEGER PRIMARY KEY, exhibit_id INTEGER NOT NULL REFERENCES exhibits(id), n INTEGER NOT NULL, title TEXT NOT NULL,
     gestures TEXT NOT NULL, credits TEXT NOT NULL, left_by TEXT NOT NULL, restored_from INTEGER, created_at INTEGER NOT NULL, UNIQUE (exhibit_id, n));
   CREATE TRIGGER versions_no_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;
   CREATE TRIGGER versions_no_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;`,
  // 2: collecting in the hall (ADR 25). An artifact is one row in exactly one state.
  `CREATE TABLE artifacts (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('fish', 'cloud', 'door')), x REAL NOT NULL, y REAL NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('available', 'carried', 'deposited')),
     holder TEXT REFERENCES visitors(pid), owner TEXT REFERENCES visitors(pid),
     spawned_at INTEGER NOT NULL, picked_at INTEGER, deposited_at INTEGER,
     CHECK ((state = 'available' AND holder IS NULL AND owner IS NULL)
         OR (state = 'carried' AND holder IS NOT NULL AND owner IS NULL)
         OR (state = 'deposited' AND holder IS NULL AND owner IS NOT NULL)));
   CREATE INDEX artifacts_available ON artifacts (state) WHERE state = 'available';
   CREATE INDEX artifacts_carried ON artifacts (holder) WHERE state = 'carried';
   CREATE INDEX artifacts_owned ON artifacts (owner, kind) WHERE state = 'deposited';
   CREATE TRIGGER artifacts_one_way BEFORE UPDATE ON artifacts
     WHEN NOT ((OLD.state = 'available' AND NEW.state = 'carried') OR (OLD.state = 'carried' AND NEW.state = 'deposited'))
     BEGIN SELECT RAISE(ABORT, 'an artifact only goes available, carried, deposited'); END;
   CREATE TRIGGER artifacts_kept BEFORE DELETE ON artifacts BEGIN SELECT RAISE(ABORT, 'artifacts are never deleted'); END;
   CREATE TABLE hall_players (pid TEXT PRIMARY KEY REFERENCES visitors(pid), home INTEGER NOT NULL, joined_at INTEGER NOT NULL);
   CREATE TABLE display_slots (pid TEXT NOT NULL REFERENCES visitors(pid), slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
     kind TEXT NOT NULL CHECK (kind IN ('fish', 'cloud', 'door')), PRIMARY KEY (pid, slot), UNIQUE (pid, kind));`,
  // 3: knocks (ADR 26). A carried artifact can be knocked loose, back to
  // available; it can be picked up only from ready_at. Deposited stays final.
  `ALTER TABLE artifacts ADD COLUMN ready_at INTEGER NOT NULL DEFAULT 0;
   DROP TRIGGER artifacts_one_way;
   CREATE TRIGGER artifacts_one_way BEFORE UPDATE ON artifacts
     WHEN NOT ((OLD.state = 'available' AND NEW.state = 'carried') OR (OLD.state = 'carried' AND NEW.state IN ('deposited', 'available')))
     BEGIN SELECT RAISE(ABORT, 'an artifact goes available, carried, then deposited (or back to available by a knock)'); END;`,
];

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
  const who = (r: Row): Who => ({ tag: r.tag, name: r.name, colour: r.colour });
  const byPid = (pid: string) => db.prepare("SELECT * FROM visitors WHERE pid = ?").get(pid) as Row | undefined;
  const byTag = (tag: string) => db.prepare("SELECT * FROM visitors WHERE tag = ?").get(tag) as Row | undefined;

  function liveLoop(now: number): Row {
    const r = db.prepare("SELECT * FROM loops WHERE archived_at IS NULL").get() as Row | undefined;
    if (r) return r;
    db.prepare("INSERT INTO loops (gestures, started_at) VALUES ('[]', ?)").run(now);
    return liveLoop(now);
  }
  const gesturesOf = (r: Row): Gesture[] => JSON.parse(r.gestures);
  const saveGestures = (id: number, g: Gesture[], nextSeq?: number) =>
    nextSeq === undefined
      ? db.prepare("UPDATE loops SET gestures = ? WHERE id = ?").run(JSON.stringify(g), id)
      : db.prepare("UPDATE loops SET gestures = ?, next_seq = ? WHERE id = ?").run(JSON.stringify(g), nextSeq, id);

  /** Who played in a set of gestures, counted per gesture, names as they are now. */
  function credits(g: Gesture[]): (Who & { count: number })[] {
    const count = new Map<string, number>();
    for (const x of g) count.set(x.by, (count.get(x.by) ?? 0) + 1);
    return [...count].map(([tag, n]) => {
      const v = byTag(tag);
      return { ...(v ? who(v) : { tag, name: "Someone", colour: 0 }), count: n };
    });
  }

  const archive = (id: number, now: number) => db.prepare("UPDATE loops SET archived_at = ? WHERE id = ?").run(now, id);
  /** A new live loop holding these gestures (renumbered), archiving the old one. */
  function replaceLive(g: Gesture[], basedOn: number | null, now: number) {
    archive(liveLoop(now).id, now);
    const fresh = g.map((x, i) => ({ ...x, seq: i + 1 }));
    db.prepare("INSERT INTO loops (gestures, based_on, next_seq, started_at) VALUES (?, ?, ?, ?)").run(JSON.stringify(fresh), basedOn, fresh.length + 1, now);
  }

  const versionRow = (id: number) => db.prepare("SELECT * FROM versions WHERE id = ?").get(id) as Row | undefined;
  const exhibitRow = (id: number) => db.prepare("SELECT * FROM exhibits WHERE id = ?").get(id) as Row | undefined;
  const latestOf = (exhibitId: number) => db.prepare("SELECT * FROM versions WHERE exhibit_id = ? ORDER BY n DESC LIMIT 1").get(exhibitId) as Row;
  const versionView = (v: Row) => ({
    id: v.id,
    n: v.n,
    title: v.title,
    gestures: JSON.parse(v.gestures),
    credits: JSON.parse(v.credits),
    leftBy: JSON.parse(v.left_by),
    restoredFrom: v.restored_from,
    createdAt: new Date(v.created_at).toISOString(),
  });
  const exhibitView = (e: Row) => {
    const count = (db.prepare("SELECT COUNT(*) AS c FROM versions WHERE exhibit_id = ?").get(e.id) as Row).c as number;
    return { id: e.id, slot: e.slot, latest: versionView(latestOf(e.id)), versionCount: count };
  };

  function addVersion(exhibitId: number, title: string, g: Gesture[], cr: unknown, leftBy: Who, restoredFrom: number | null, now: number) {
    const n = ((db.prepare("SELECT MAX(n) AS n FROM versions WHERE exhibit_id = ?").get(exhibitId) as Row).n ?? 0) + 1;
    db.prepare("INSERT INTO versions (exhibit_id, n, title, gestures, credits, left_by, restored_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      exhibitId,
      n,
      title,
      JSON.stringify(g),
      JSON.stringify(cr),
      JSON.stringify(leftBy),
      restoredFrom,
      now,
    );
  }

  const validSlot = (s: unknown): s is number => Number.isInteger(s) && (s as number) >= 1 && (s as number) <= SLOTS;
  /** Frees a slot for a new exhibit: refused if taken, unless `replace`, which moves its exhibit to the storeroom. */
  function freeSlot(slot: number, replace: boolean): Fail | null {
    const there = db.prepare("SELECT * FROM exhibits WHERE slot = ?").get(slot) as Row | undefined;
    if (!there) return null;
    if (!replace) return fail(409, "slot-taken", `Plinth ${slot} holds "${latestOf(there.id).title}"`);
    db.prepare("UPDATE exhibits SET slot = NULL WHERE id = ?").run(there.id);
    return null;
  }

  /** How many of each kind a visitor has, counted from what they delivered. */
  function collection(pid: string): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries((KINDS as string[]).map((k) => [k, 0]));
    for (const r of db.prepare("SELECT kind, COUNT(*) AS c FROM artifacts WHERE state = 'deposited' AND owner = ? GROUP BY kind").all(pid) as Row[]) out[r.kind] = r.c;
    return out;
  }

  function displayOf(pid: string): (string | null)[] {
    const out: (string | null)[] = Array(DISPLAY_SLOTS).fill(null);
    for (const r of db.prepare("SELECT slot, kind FROM display_slots WHERE pid = ?").all(pid) as Row[]) out[r.slot - 1] = r.kind;
    return out;
  }

  return {
    db,
    close: () => db.close(),

    /** The visitor for a cookie's pid, made new when there's none or it's unknown. */
    visitor(pid: string | null, now: number) {
      const found = pid ? byPid(pid) : undefined;
      if (found) return { pid: found.pid as string, ...who(found), isNew: false };
      const fresh = randomUUID();
      const tag = tagOf(fresh);
      const h = parseInt(tag.slice(0, 6), 16);
      const name = `${ADJ[h % ADJ.length]} ${NOUN[Math.floor(h / ADJ.length) % NOUN.length]}`;
      const colour = Math.floor(h / 144) % COLOURS;
      db.prepare("INSERT INTO visitors (pid, tag, name, colour, created_at) VALUES (?, ?, ?, ?, ?)").run(fresh, tag, name, colour, now);
      return { pid: fresh, tag, name, colour, isNew: true };
    },
    who: (pid: string): Who | null => {
      const v = byPid(pid);
      return v ? who(v) : null;
    },

    rename(pid: string, name: unknown) {
      if (typeof name !== "string") return fail(400, "bad-name", "A name is text");
      const t = name.trim();
      if (t.length < 1 || t.length > 24) return fail(400, "bad-name", "A name is 1 to 24 characters");
      db.prepare("UPDATE visitors SET name = ? WHERE pid = ?").run(t, pid);
      return { ok: true as const, visitor: who(byPid(pid)!) };
    },

    addGesture(pid: string, raw: unknown, now: number) {
      const c = checkGesture(raw);
      if (!c.ok) return fail(400, "bad-gesture", c.error);
      const tag = tagOf(pid);
      return tx(() => {
        const loop = liveLoop(now);
        let g = gesturesOf(loop);
        g.push({ ...(c.gesture as { kind: string; at: number }), by: tag, seq: loop.next_seq });
        // past your own cap your oldest drops; past the loop's, the oldest of all
        const mine = g.filter((x) => x.by === tag);
        if (mine.length > MAX_PER_VISITOR) g = g.filter((x) => x !== mine[0]);
        if (g.length > MAX_GESTURES) {
          const oldest = g.reduce((a, b) => (b.seq < a.seq ? b : a));
          g = g.filter((x) => x !== oldest);
        }
        saveGestures(loop.id, g, loop.next_seq + 1);
        return { ok: true as const };
      });
    },

    undo(pid: string) {
      const tag = tagOf(pid);
      return tx(() => {
        const loop = liveLoop(Date.now());
        const g = gesturesOf(loop);
        const mine = g.filter((x) => x.by === tag);
        if (!mine.length) return fail(409, "nothing-to-undo", "None of your gestures are in this loop");
        const newest = mine.reduce((a, b) => (b.seq > a.seq ? b : a));
        saveGestures(
          loop.id,
          g.filter((x) => x !== newest),
        );
        return { ok: true as const };
      });
    },

    clear(_pid: string, now: number) {
      return tx(() => {
        const loop = liveLoop(now);
        if (!gesturesOf(loop).length) return fail(409, "stage-empty", "The stage is already quiet");
        replaceLive([], null, now);
        return { ok: true as const };
      });
    },

    bringBack(archivedId: unknown, replace: boolean, now: number) {
      if (!Number.isInteger(archivedId)) return fail(400, "bad-id", "archivedId is a number");
      return tx(() => {
        const old = db.prepare("SELECT * FROM loops WHERE id = ? AND archived_at IS NOT NULL").get(archivedId as number) as Row | undefined;
        if (!old) return fail(404, "not-found", "No such cleared loop");
        if (gesturesOf(liveLoop(now)).length && !replace) return fail(409, "stage-busy", "The stage has a loop playing");
        replaceLive(gesturesOf(old), old.based_on, now);
        return { ok: true as const };
      });
    },

    publish(pid: string, body: { title?: unknown; slot?: unknown; exhibitId?: unknown; replace?: unknown }, now: number) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (title.length < 1 || title.length > 40) return fail(400, "bad-title", "A title is 1 to 40 characters");
      const toSlot = body.slot !== undefined;
      if (toSlot === (body.exhibitId !== undefined)) return fail(400, "bad-target", "Say a slot or an exhibitId");
      if (toSlot && !validSlot(body.slot)) return fail(400, "bad-slot", `A slot is 1 to ${SLOTS}`);
      if (!toSlot && !Number.isInteger(body.exhibitId)) return fail(400, "bad-id", "exhibitId is a number");
      return tx(() => {
        const g = gesturesOf(liveLoop(now));
        if (!g.length) return fail(409, "stage-empty", "Play something first");
        const leftBy = who(byPid(pid)!);
        let exhibitId: number;
        if (toSlot) {
          const f = freeSlot(body.slot as number, body.replace === true);
          if (f) return f;
          exhibitId = Number(db.prepare("INSERT INTO exhibits (slot, created_at) VALUES (?, ?)").run(body.slot as number, now).lastInsertRowid);
        } else {
          if (!exhibitRow(body.exhibitId as number)) return fail(404, "not-found", "No such exhibit");
          exhibitId = body.exhibitId as number;
        }
        addVersion(exhibitId, title, g, credits(g), leftBy, null, now);
        return { ok: true as const, exhibitId };
      });
    },

    restore(exhibitId: number, versionId: unknown, pid: string, now: number) {
      if (!Number.isInteger(versionId)) return fail(400, "bad-id", "versionId is a number");
      return tx(() => {
        const v = versionRow(versionId as number);
        if (!v || v.exhibit_id !== exhibitId) return fail(404, "not-found", "No such version of this exhibit");
        addVersion(exhibitId, v.title, JSON.parse(v.gestures), JSON.parse(v.credits), who(byPid(pid)!), v.n, now);
        return { ok: true as const };
      });
    },

    join(versionId: unknown, replace: boolean, now: number) {
      if (!Number.isInteger(versionId)) return fail(400, "bad-id", "versionId is a number");
      return tx(() => {
        const v = versionRow(versionId as number);
        if (!v) return fail(404, "not-found", "No such version");
        if (gesturesOf(liveLoop(now)).length && !replace) return fail(409, "stage-busy", "The stage has a loop playing");
        replaceLive(JSON.parse(v.gestures), v.id, now);
        return { ok: true as const };
      });
    },

    display(exhibitId: number, slot: unknown, replace: boolean) {
      if (!validSlot(slot)) return fail(400, "bad-slot", `A slot is 1 to ${SLOTS}`);
      return tx(() => {
        const e = exhibitRow(exhibitId);
        if (!e) return fail(404, "not-found", "No such exhibit");
        if (e.slot === slot) return { ok: true as const };
        const f = freeSlot(slot, replace);
        if (f) return f;
        db.prepare("UPDATE exhibits SET slot = ? WHERE id = ?").run(slot, exhibitId);
        return { ok: true as const };
      });
    },

    store(exhibitId: number) {
      const e = exhibitRow(exhibitId);
      if (!e) return fail(404, "not-found", "No such exhibit");
      if (e.slot === null) return fail(409, "slot-empty", "It's already in the storeroom");
      db.prepare("UPDATE exhibits SET slot = NULL WHERE id = ?").run(exhibitId);
      return { ok: true as const };
    },

    history(exhibitId: number) {
      const e = exhibitRow(exhibitId);
      if (!e) return fail(404, "not-found", "No such exhibit");
      const versions = (db.prepare("SELECT * FROM versions WHERE exhibit_id = ? ORDER BY n DESC").all(exhibitId) as Row[]).map(versionView);
      return { ok: true as const, exhibit: { id: e.id, slot: e.slot }, versions };
    },

    archivedBefore(before: number) {
      const rows = db.prepare("SELECT * FROM loops WHERE archived_at IS NOT NULL AND id < ? ORDER BY id DESC LIMIT ?").all(before, ARCHIVE_SHOWN + 1) as Row[];
      return { loops: rows.slice(0, ARCHIVE_SHOWN).map((r) => ({ id: r.id, gestures: gesturesOf(r), credits: credits(gesturesOf(r)), archivedAt: new Date(r.archived_at).toISOString() })), more: rows.length > ARCHIVE_SHOWN };
    },

    // ---- collecting in the hall (ADR 25). Every change is one conditional
    // statement, so it's atomic, and repeating it changes nothing.

    /** The visitor's delivery zone (an index into HOMES), assigned once. */
    hallHome(pid: string, now: number): number {
      return tx(() => {
        const r = db.prepare("SELECT home FROM hall_players WHERE pid = ?").get(pid) as Row | undefined;
        if (r) return r.home as number;
        const n = (db.prepare("SELECT COUNT(*) AS c FROM hall_players").get() as Row).c as number;
        db.prepare("INSERT INTO hall_players (pid, home, joined_at) VALUES (?, ?, ?)").run(pid, n % HOMES.length, now);
        return n % HOMES.length;
      });
    },

    /** Tops the floor up to MAX_AVAILABLE, at free safe spots no robot in
     * `avoid` is touching. How many it added. */
    fillFloor(now: number, avoid: number[][] = [], random: () => number = Math.random): number {
      return tx(() => {
        const taken = db.prepare("SELECT x, y FROM artifacts WHERE state = 'available'").all() as Row[];
        let free = (SPOTS as number[][]).filter((p) => !taken.some((t) => t.x === p[0] && t.y === p[1]) && !avoid.some((r) => touches(r, p)));
        let added = 0;
        for (let n = taken.length; n < MAX_AVAILABLE && free.length; n++, added++) {
          const p = free[Math.floor(random() * free.length)];
          free = free.filter((q) => q !== p);
          const kind = KINDS[Math.floor(random() * KINDS.length)];
          db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, ?, ?, ?, 'available', ?)").run(randomUUID(), kind, p[0], p[1], now);
        }
        return added;
      });
    },
    floor: () => (db.prepare("SELECT id, kind, x, y, ready_at FROM artifacts WHERE state = 'available' ORDER BY spawned_at, id").all() as Row[]).map((r) => ({ id: r.id as string, kind: r.kind as string, pos: [r.x, r.y], readyAt: r.ready_at as number })),
    cargo: (pid: string) => (db.prepare("SELECT id, kind FROM artifacts WHERE state = 'carried' AND holder = ? ORDER BY picked_at, id").all(pid) as Row[]).map((r) => ({ id: r.id as string, kind: r.kind as string })),

    /** A touch: the artifact is the visitor's to carry if it's still
     * available and they carry fewer than CARRY_MAX. */
    pickUp(pid: string, id: string, now: number) {
      const r = db
        .prepare(`UPDATE artifacts SET state = 'carried', holder = ?, picked_at = ? WHERE id = ? AND state = 'available' AND ready_at <= ?
                  AND (SELECT COUNT(*) FROM artifacts WHERE state = 'carried' AND holder = ?) < ?`)
        .run(pid, now, id, now, pid, CARRY_MAX);
      return { ok: true as const, picked: r.changes === 1 };
    },
    /** A knock (ADR 26): the visitor's newest carried artifact goes back on
     * the floor at `pos`, ready to pick up from `readyAt`. Null if they
     * carry nothing. Delivered artifacts are never touched. */
    knockLoose(pid: string, now: number, pos: number[], readyAt: number) {
      return tx(() => {
        const r = db.prepare("SELECT id, kind FROM artifacts WHERE state = 'carried' AND holder = ? ORDER BY picked_at DESC, id DESC LIMIT 1").get(pid) as Row | undefined;
        if (!r) return null;
        const u = db
          .prepare("UPDATE artifacts SET state = 'available', holder = NULL, picked_at = NULL, x = ?, y = ?, ready_at = ? WHERE id = ? AND state = 'carried' AND holder = ?")
          .run(pos[0], pos[1], readyAt, r.id, pid);
        return u.changes === 1 ? { id: r.id as string, kind: r.kind as string } : null;
      });
    },
    /** A display as anyone may see it: its kinds and the owner's real counts. */
    publicDisplay(pid: string) {
      const have = collection(pid);
      return displayOf(pid).map((k) => (k ? { kind: k, count: have[k] } : null));
    },

    /** In their zone: everything the visitor carries becomes theirs. */
    deliver(pid: string, now: number) {
      const r = db.prepare("UPDATE artifacts SET state = 'deposited', owner = holder, holder = NULL, deposited_at = ? WHERE state = 'carried' AND holder = ?").run(now, pid);
      return { ok: true as const, delivered: Number(r.changes) };
    },
    collection,

    displayOf,
    /** The visitor's display: DISPLAY_SLOTS entries, each null or a kind
     * they own, each kind once. Replaces the whole layout at once. */
    arrange(pid: string, slots: unknown) {
      if (!Array.isArray(slots) || slots.length !== DISPLAY_SLOTS) return fail(400, "bad-display", `The display is ${DISPLAY_SLOTS} slots`);
      if (!slots.every((k) => k === null || (KINDS as string[]).includes(k))) return fail(400, "bad-display", "Each slot is empty or a kind of artifact");
      const kinds = slots.filter((k): k is string => k !== null);
      if (new Set(kinds).size !== kinds.length) return fail(400, "bad-display", "Each kind goes in one slot; its count shows there");
      return tx(() => {
        const have = collection(pid);
        const missing = kinds.find((k) => !have[k]);
        if (missing) return fail(409, "not-owned", `You haven't collected a ${missing} yet`);
        db.prepare("DELETE FROM display_slots WHERE pid = ?").run(pid);
        slots.forEach((k, i) => k && db.prepare("INSERT INTO display_slots (pid, slot, kind) VALUES (?, ?, ?)").run(pid, i + 1, k));
        return { ok: true as const, display: slots as (string | null)[] };
      });
    },

    /** The whole state every page gets: the stage, the plinths, the
     * storeroom, the newest cleared loops, and who's here (by pid). */
    state(presentPids: string[]) {
      const loop = liveLoop(Date.now());
      const g = gesturesOf(loop);
      const based = loop.based_on ? versionRow(loop.based_on) : undefined;
      const exhibits = db.prepare("SELECT * FROM exhibits").all() as Row[];
      const slots = Array.from({ length: SLOTS }, (_, i) => {
        const e = exhibits.find((x) => x.slot === i + 1);
        return { slot: i + 1, exhibit: e ? exhibitView(e) : null };
      });
      const archivedRows = db.prepare("SELECT * FROM loops WHERE archived_at IS NOT NULL ORDER BY id DESC LIMIT ?").all(ARCHIVE_SHOWN) as Row[];
      const here = [...new Set(presentPids)].map(byPid).filter((x): x is Row => !!x).map(who);
      return {
        stage: { gestures: g, credits: credits(g), basedOn: based ? { versionId: based.id, exhibitId: based.exhibit_id, n: based.n, title: based.title } : null },
        slots,
        storeroom: exhibits.filter((e) => e.slot === null).map(exhibitView),
        archived: archivedRows.map((r) => ({ id: r.id, gestures: gesturesOf(r), credits: credits(gesturesOf(r)), archivedAt: new Date(r.archived_at).toISOString() })),
        archivedTotal: (db.prepare("SELECT COUNT(*) AS c FROM loops WHERE archived_at IS NOT NULL").get() as Row).c as number,
        here,
      };
    },
  };
}

export type Store = ReturnType<typeof openStore>;
