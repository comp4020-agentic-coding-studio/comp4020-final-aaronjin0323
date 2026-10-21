import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkEdit, checkSculpture, defaultParts, RECIPES } from "../public/recipes.js";
import type { ArchivedDraftView, Credit, DraftView, ExhibitHistory, ExhibitView, Parts, VersionView, VisitorView } from "./types.ts";

// The museum's store: one SQLite file, every write one BEGIN IMMEDIATE
// transaction, every time-dependent function given `now` so tests can run
// it over ":memory:" with their own clock (CLAUDE.md, Build sketch).
//
// A pid is the only proof of who anyone is, so it stays in here and in the
// server. Everything this module hands out for display is a VisitorView:
// tag, name, colour.

/** A lease lasts this long, renewed by every accepted edit (CLAUDE.md). */
export const LEASE_MS = 15_000;
export const SLOTS = 6;
/** How many archived drafts the state event lists, newest first. */
export const ARCHIVE_LIST = 12;

export const tagOf = (pid: string): string => createHash("sha256").update(pid).digest("hex").slice(0, 6);

// The starters (CLAUDE.md, "Three starters are seeded once"): each recipe's
// defaults with a few numbers moved so the three plinths don't look like
// one recipe at rest. Written out as data, not computed at migration time,
// so a later change to a default can't change what migration 2 meant.
const STARTERS: { slot: number; title: string; recipe: string; parts: Parts }[] = [
  {
    slot: 1,
    title: "Loop & Lantern",
    recipe: "loop",
    parts: {
      ribbon: { lift: 0, turn: 0, scale: 1, turns: 3, twist: 2.5, radius: 1, colour: 2, speed: 0.4 },
      cube: { lift: 0, turn: 0, scale: 1, size: 0.8, colour: 3, spin: 0.4, tilt: 30 },
      spheres: { lift: 0.1, turn: 0, scale: 1, count: 6, orbit: 1.5, size: 0.16, colour: 5, bob: 0.4 },
    },
  },
  {
    slot: 2,
    title: "Arch Totem",
    recipe: "arches",
    parts: {
      stack: { lift: 0, turn: 0, scale: 1, segments: 5, height: 0.34, taper: 0.5, colour: 0 },
      arch: { lift: 0.2, turn: 0, scale: 1, count: 3, span: 1.2, colour: 1, sway: 0.3 },
      halo: { lift: 0.6, turn: 0, scale: 1, radius: 1, thickness: 0.05, colour: 7, tilt: 40 },
    },
  },
  {
    slot: 3,
    title: "Glass Bloom",
    recipe: "bloom",
    parts: {
      petals: { lift: 0, turn: 0, scale: 1, count: 9, curl: 0.65, length: 1, colour: 3 },
      stem: { lift: 0, turn: 0, scale: 1, height: 1.3, bend: 0.4, colour: 4 },
      motes: { lift: 0, turn: 0, scale: 1, count: 14, spread: 1.3, colour: 7, drift: 0.5 },
    },
  },
];

const sq = (s: string): string => `'${s.replace(/'/g, "''")}'`;

// Numbered migrations; PRAGMA user_version records how many have run. A
// committed migration is never edited: the volume outlives every deploy.
export const MIGRATIONS: string[] = [
  // 1. The museum's schema (docs/adr/0012). A fresh file: Skyline's tables
  // are left alone in app.db.
  `CREATE TABLE visitors (
     pid        TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     colour     INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   -- One live draft (archived_at NULL) at most; an empty workbench has none.
   -- part_authors is JSON: part id -> VisitorView as they were.
   CREATE TABLE drafts (
     id             INTEGER PRIMARY KEY,
     recipe         TEXT NOT NULL,
     parts          TEXT NOT NULL,
     revision       INTEGER NOT NULL DEFAULT 1,
     part_authors   TEXT NOT NULL DEFAULT '{}',
     based_on       INTEGER REFERENCES versions(id),
     created_at     TEXT NOT NULL,
     archived_at    TEXT,
     archived_by    TEXT,
     archive_reason TEXT CHECK (archive_reason IN ('replaced', 'cleared'))
   );
   CREATE UNIQUE INDEX one_live_draft ON drafts((archived_at IS NULL)) WHERE archived_at IS NULL;
   CREATE TABLE draft_credits (
     draft_id INTEGER NOT NULL REFERENCES drafts(id),
     pid      TEXT NOT NULL,
     name     TEXT NOT NULL,
     colour   INTEGER NOT NULL,
     edits    INTEGER NOT NULL DEFAULT 0,
     first_at TEXT NOT NULL,
     PRIMARY KEY (draft_id, pid)
   );
   CREATE TABLE leases (
     part       TEXT PRIMARY KEY,
     draft_id   INTEGER NOT NULL REFERENCES drafts(id),
     pid        TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE exhibits (
     id         INTEGER PRIMARY KEY,
     slot       INTEGER UNIQUE CHECK (slot BETWEEN 1 AND 6),
     created_at TEXT NOT NULL
   );
   CREATE TABLE versions (
     id               INTEGER PRIMARY KEY,
     exhibit_id       INTEGER NOT NULL REFERENCES exhibits(id),
     n                INTEGER NOT NULL,
     title            TEXT NOT NULL,
     recipe           TEXT NOT NULL,
     parts            TEXT NOT NULL,
     published_by     TEXT,
     publisher_name   TEXT,
     publisher_colour INTEGER,
     published_at     TEXT NOT NULL,
     restored_from    INTEGER,
     based_on         INTEGER REFERENCES versions(id),
     UNIQUE (exhibit_id, n)
   );
   CREATE TABLE version_credits (
     version_id INTEGER NOT NULL REFERENCES versions(id),
     pid        TEXT NOT NULL,
     name       TEXT NOT NULL,
     colour     INTEGER NOT NULL,
     edits      INTEGER NOT NULL,
     ord        INTEGER NOT NULL,
     PRIMARY KEY (version_id, pid)
   );
   -- Versions are immutable (CLAUDE.md): no route changes one, and the
   -- database refuses to as well, credits included.
   CREATE TRIGGER versions_no_update BEFORE UPDATE ON versions
     BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;
   CREATE TRIGGER versions_no_delete BEFORE DELETE ON versions
     BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;
   CREATE TRIGGER version_credits_no_update BEFORE UPDATE ON version_credits
     BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;
   CREATE TRIGGER version_credits_no_delete BEFORE DELETE ON version_credits
     BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;`,

  // 2. The three starters in slots 1-3, version 1 each, published by the
  // museum. A migration, so a redeploy never seeds them again.
  STARTERS.map(
    (s, i) =>
      `INSERT INTO exhibits (id, slot, created_at) VALUES (${i + 1}, ${s.slot}, '2026-10-21T00:00:00.000Z');
       INSERT INTO versions (id, exhibit_id, n, title, recipe, parts, published_at)
         VALUES (${i + 1}, ${i + 1}, 1, ${sq(s.title)}, ${sq(s.recipe)}, ${sq(JSON.stringify(s.parts))}, '2026-10-21T00:00:00.000Z');`,
  ).join("\n"),
];

export function migrate(db: DatabaseSync, migrations = MIGRATIONS): void {
  const { user_version: from } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (from > migrations.length) {
    throw new Error(`database is at version ${from}, but this code only knows ${migrations.length}`);
  }
  for (let v = from; v < migrations.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export type Visitor = { pid: string; name: string; colour: number };

/** A lease as the server sees it: the holder's pid stays server-side. */
export type Lease = { part: string; pid: string; holder: VisitorView; expiresAt: string };

/** The museum minus anything that depends on who's asking. */
export type Snapshot = {
  draft: DraftView;
  leases: Lease[];
  slots: { slot: number; exhibit: ExhibitView | null }[];
  storeroom: ExhibitView[];
  archivedDrafts: ArchivedDraftView[];
};

type Refusal<E extends string> = { ok: false; error: E; message: string };
const refuse = <E extends string>(error: E, message: string): Refusal<E> => ({ ok: false, error, message });

export type HeldRefusal = Refusal<"lease-held"> & { holder: VisitorView; expiresAt: string };

export type PublishInput = { title: string; slot?: number; exhibitId?: number; replace?: boolean };

export type Store = {
  /** The visitor for a pid, created with this name and colour if new. */
  ensureVisitor(pid: string, name: string, colour: number, now: Date): { visitor: Visitor; created: boolean };
  visitor(pid: string): Visitor | null;
  rename(pid: string, name: string): { ok: true; from: string };
  view(pid: string): VisitorView;

  snapshot(now: Date): Snapshot;
  /** Unexpired leases only: an expired lease is free on every read. */
  leases(now: Date): Lease[];
  history(exhibitId: number): ExhibitHistory | null;

  start(pid: string, recipe: string, now: Date): { ok: true; draftId: number } | Refusal<"draft-not-empty" | "bad-request">;
  remix(
    pid: string,
    versionId: number,
    replace: boolean,
    now: Date,
  ): { ok: true; draftId: number; archivedId: number | null } | Refusal<"draft-not-empty" | "not-found">;
  restoreArchived(
    pid: string,
    archivedId: number,
    replace: boolean,
    now: Date,
  ): { ok: true; draftId: number; archivedId: number | null } | Refusal<"draft-not-empty" | "not-found">;
  lease(pid: string, part: string, now: Date): { ok: true; taken: boolean; expiresAt: string } | HeldRefusal | Refusal<"draft-empty" | "bad-request">;
  release(pid: string, part: string, now: Date): { ok: true; released: boolean };
  /** Releases every lease a visitor holds (their last stream closed). */
  releaseAll(pid: string): string[];
  edit(
    pid: string,
    part: string,
    values: unknown,
    now: Date,
  ): { ok: true; revision: number; values: Record<string, number>; taken: boolean } | HeldRefusal | Refusal<"draft-empty" | "bad-request">;
  clear(pid: string, now: Date): { ok: true; archivedId: number } | HeldRefusal | Refusal<"draft-empty">;
  publish(
    pid: string,
    input: PublishInput,
    now: Date,
  ):
    | { ok: true; exhibitId: number; versionId: number; n: number; stored: number | null }
    | Refusal<"draft-empty" | "not-found" | "bad-request">
    | (Refusal<"slot-taken"> & { exhibit: ExhibitView });
  restoreVersion(pid: string, exhibitId: number, versionId: number, now: Date): { ok: true; versionId: number; n: number; from: number } | Refusal<"not-found">;
  display(
    exhibitId: number,
    slot: number,
    replace: boolean,
  ): { ok: true; stored: number | null } | Refusal<"not-found" | "bad-request"> | (Refusal<"slot-taken"> & { exhibit: ExhibitView });
  storeAway(exhibitId: number): { ok: true; slot: number } | Refusal<"not-found" | "slot-empty">;
  /** Deletes leases that ran out by `now`, and returns them. */
  expire(now: Date): Lease[];
  close(): void;
};

type DraftRow = {
  id: number;
  recipe: string;
  parts: string;
  revision: number;
  part_authors: string;
  based_on: number | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: "replaced" | "cleared" | null;
};
type VersionRow = {
  id: number;
  exhibit_id: number;
  n: number;
  title: string;
  recipe: string;
  parts: string;
  published_by: string | null;
  publisher_name: string | null;
  publisher_colour: number | null;
  published_at: string;
  restored_from: number | null;
  based_on: number | null;
};
type ExhibitRow = { id: number; slot: number | null };
type CreditRow = { pid: string; name: string; colour: number; edits: number };

// `leaseMs` is for a test that watches a lease run out; the museum's is LEASE_MS.
export function openStore(path: string, { leaseMs = LEASE_MS }: { leaseMs?: number } = {}): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  function tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const q = {
    visitor: db.prepare("SELECT pid, name, colour FROM visitors WHERE pid = ?"),
    insertVisitor: db.prepare("INSERT OR IGNORE INTO visitors (pid, name, colour, created_at) VALUES (?, ?, ?, ?)"),
    rename: db.prepare("UPDATE visitors SET name = ? WHERE pid = ?"),
    live: db.prepare("SELECT * FROM drafts WHERE archived_at IS NULL"),
    draft: db.prepare("SELECT * FROM drafts WHERE id = ?"),
    insertDraft: db.prepare("INSERT INTO drafts (recipe, parts, part_authors, based_on, created_at) VALUES (?, ?, ?, ?, ?)"),
    archive: db.prepare("UPDATE drafts SET archived_at = ?, archived_by = ?, archive_reason = ? WHERE id = ? AND archived_at IS NULL"),
    setParts: db.prepare("UPDATE drafts SET parts = ?, part_authors = ?, revision = revision + 1 WHERE id = ?"),
    archived: db.prepare("SELECT * FROM drafts WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id DESC LIMIT ?"),
    draftCredits: db.prepare("SELECT pid, name, colour, edits FROM draft_credits WHERE draft_id = ? ORDER BY first_at, rowid"),
    credit: db.prepare(
      `INSERT INTO draft_credits (draft_id, pid, name, colour, edits, first_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (draft_id, pid) DO UPDATE SET edits = edits + 1, name = excluded.name, colour = excluded.colour`,
    ),
    copyCredits: db.prepare(
      "INSERT INTO draft_credits (draft_id, pid, name, colour, edits, first_at) SELECT ?, pid, name, colour, edits, first_at FROM draft_credits WHERE draft_id = ?",
    ),
    leases: db.prepare("SELECT part, pid, expires_at FROM leases WHERE expires_at > ? ORDER BY part"),
    lease: db.prepare("SELECT part, pid, expires_at FROM leases WHERE part = ? AND expires_at > ?"),
    setLease: db.prepare(
      "INSERT INTO leases (part, draft_id, pid, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (part) DO UPDATE SET draft_id = excluded.draft_id, pid = excluded.pid, expires_at = excluded.expires_at",
    ),
    dropLease: db.prepare("DELETE FROM leases WHERE part = ? AND pid = ?"),
    dropLeasesOf: db.prepare("DELETE FROM leases WHERE pid = ? RETURNING part"),
    dropAllLeases: db.prepare("DELETE FROM leases"),
    expired: db.prepare("DELETE FROM leases WHERE expires_at <= ? RETURNING part, pid, expires_at"),
    exhibit: db.prepare("SELECT id, slot FROM exhibits WHERE id = ?"),
    inSlot: db.prepare("SELECT id, slot FROM exhibits WHERE slot = ?"),
    onDisplay: db.prepare("SELECT id, slot FROM exhibits WHERE slot IS NOT NULL ORDER BY slot"),
    storeroom: db.prepare(
      "SELECT e.id, e.slot FROM exhibits e WHERE e.slot IS NULL ORDER BY (SELECT MAX(v.published_at) FROM versions v WHERE v.exhibit_id = e.id) DESC, e.id DESC",
    ),
    insertExhibit: db.prepare("INSERT INTO exhibits (slot, created_at) VALUES (?, ?)"),
    setSlot: db.prepare("UPDATE exhibits SET slot = ? WHERE id = ?"),
    version: db.prepare("SELECT * FROM versions WHERE id = ?"),
    latest: db.prepare("SELECT * FROM versions WHERE exhibit_id = ? ORDER BY n DESC LIMIT 1"),
    versionsOf: db.prepare("SELECT * FROM versions WHERE exhibit_id = ? ORDER BY n DESC"),
    countOf: db.prepare("SELECT COUNT(*) AS c FROM versions WHERE exhibit_id = ?"),
    insertVersion: db.prepare(
      `INSERT INTO versions (exhibit_id, n, title, recipe, parts, published_by, publisher_name, publisher_colour, published_at, restored_from, based_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    versionCredits: db.prepare("SELECT pid, name, colour, edits FROM version_credits WHERE version_id = ? ORDER BY ord"),
    insertVersionCredit: db.prepare("INSERT INTO version_credits (version_id, pid, name, colour, edits, ord) VALUES (?, ?, ?, ?, ?, ?)"),
  };

  const visitorOf = (pid: string): Visitor | null => (q.visitor.get(pid) as Visitor | undefined) ?? null;
  const viewOf = (pid: string): VisitorView => {
    const v = visitorOf(pid);
    return { tag: tagOf(pid), name: v?.name ?? "Someone", colour: v?.colour ?? 0 };
  };
  const credits = (rows: CreditRow[]): Credit[] => rows.map((r) => ({ tag: tagOf(r.pid), name: r.name, colour: r.colour, edits: r.edits }));
  const liveDraft = (): DraftRow | null => (q.live.get() as DraftRow | undefined) ?? null;
  const versionRow = (id: number): VersionRow | null => (q.version.get(id) as VersionRow | undefined) ?? null;

  function basedOn(versionId: number | null): VersionView["basedOn"] {
    if (versionId === null) return null;
    const v = versionRow(versionId);
    return v ? { exhibitId: v.exhibit_id, versionId: v.id, title: v.title, n: v.n } : null;
  }

  function versionView(v: VersionRow): VersionView {
    return {
      id: v.id,
      exhibitId: v.exhibit_id,
      n: v.n,
      title: v.title,
      recipe: v.recipe,
      parts: JSON.parse(v.parts) as Parts,
      contributors: credits(q.versionCredits.all(v.id) as CreditRow[]),
      publishedBy: v.published_by === null ? null : { tag: tagOf(v.published_by), name: v.publisher_name ?? "", colour: v.publisher_colour ?? 0 },
      publishedAt: v.published_at,
      restoredFrom: v.restored_from,
      basedOn: basedOn(v.based_on),
    };
  }

  function exhibitView(e: ExhibitRow): ExhibitView {
    const latest = q.latest.get(e.id) as VersionRow;
    const { c } = q.countOf.get(e.id) as { c: number };
    return { id: e.id, slot: e.slot, latest: versionView(latest), versionCount: c };
  }

  const EMPTY: DraftView = { id: 0, recipe: null, parts: null, revision: 0, partAuthors: {}, contributors: [], basedOn: null };

  function draftView(d: DraftRow | null): DraftView {
    if (!d) return EMPTY;
    return {
      id: d.id,
      recipe: d.recipe,
      parts: JSON.parse(d.parts) as Parts,
      revision: d.revision,
      partAuthors: JSON.parse(d.part_authors) as Record<string, VisitorView>,
      contributors: credits(q.draftCredits.all(d.id) as CreditRow[]),
      basedOn: basedOn(d.based_on),
    };
  }

  function leaseView(row: { part: string; pid: string; expires_at: string }): Lease {
    return { part: row.part, pid: row.pid, holder: viewOf(row.pid), expiresAt: row.expires_at };
  }
  const heldBy = (part: string, now: Date): Lease | null => {
    const row = q.lease.get(part, now.toISOString()) as { part: string; pid: string; expires_at: string } | undefined;
    return row ? leaseView(row) : null;
  };
  const held = (l: Lease): HeldRefusal => ({
    ok: false,
    error: "lease-held",
    message: `${l.holder.name} is shaping this part`,
    holder: l.holder,
    expiresAt: l.expiresAt,
  });

  // Archive the live draft (if any) and drop its leases. Inside a caller's
  // transaction: replacing archives first, in the same transaction.
  function archiveLive(pid: string, reason: "replaced" | "cleared", now: Date): number | null {
    const d = liveDraft();
    if (!d) return null;
    q.archive.run(now.toISOString(), pid, reason, d.id);
    q.dropAllLeases.run();
    return d.id;
  }

  // Put a new live draft on the bench, archiving the old one first when
  // `replace` says so.
  function bench(
    pid: string,
    replace: boolean,
    now: Date,
    make: () => number,
  ): { ok: true; draftId: number; archivedId: number | null } | Refusal<"draft-not-empty"> {
    if (liveDraft() && !replace) return refuse("draft-not-empty", "The workbench already holds a sculpture");
    const archivedId = archiveLive(pid, "replaced", now);
    return { ok: true, draftId: make(), archivedId };
  }

  const partOf = (recipe: string, part: string): boolean => Object.hasOwn(RECIPES[recipe]?.parts ?? {}, part);

  // Who holds a slot, for a slot-taken refusal.
  function slotTaken(slot: number): (Refusal<"slot-taken"> & { exhibit: ExhibitView }) | null {
    const there = q.inSlot.get(slot) as ExhibitRow | undefined;
    if (!there) return null;
    const exhibit = exhibitView(there);
    return { ok: false, error: "slot-taken", message: `Slot ${slot} holds "${exhibit.latest.title}"`, exhibit };
  }

  function addVersion(
    exhibitId: number,
    pid: string,
    v: { title: string; recipe: string; parts: string; restoredFrom: number | null; basedOn: number | null },
    creditRows: CreditRow[],
    now: Date,
  ): { versionId: number; n: number } {
    const { c } = q.countOf.get(exhibitId) as { c: number };
    const n = c + 1;
    const me = viewOf(pid);
    const { lastInsertRowid } = q.insertVersion.run(
      exhibitId,
      n,
      v.title,
      v.recipe,
      v.parts,
      pid,
      me.name,
      me.colour,
      now.toISOString(),
      v.restoredFrom,
      v.basedOn,
    );
    const versionId = Number(lastInsertRowid);
    creditRows.forEach((r, i) => q.insertVersionCredit.run(versionId, r.pid, r.name, r.colour, r.edits, i));
    return { versionId, n };
  }

  const leasesAt = (now: Date): Lease[] =>
    (q.leases.all(now.toISOString()) as { part: string; pid: string; expires_at: string }[]).map(leaseView);

  return {
    ensureVisitor(pid, name, colour, now) {
      const existing = visitorOf(pid);
      if (existing) return { visitor: existing, created: false };
      return tx(() => {
        const { changes } = q.insertVisitor.run(pid, name, colour, now.toISOString());
        return { visitor: visitorOf(pid)!, created: Number(changes) > 0 };
      });
    },
    visitor: visitorOf,
    rename(pid, name) {
      return tx(() => {
        const from = visitorOf(pid)?.name ?? "";
        q.rename.run(name, pid);
        return { ok: true as const, from };
      });
    },
    view: viewOf,

    leases: leasesAt,

    snapshot(now) {
      const shown = new Map((q.onDisplay.all() as ExhibitRow[]).map((e) => [e.slot!, e]));
      return {
        draft: draftView(liveDraft()),
        leases: leasesAt(now),
        slots: Array.from({ length: SLOTS }, (_, i) => {
          const e = shown.get(i + 1);
          return { slot: i + 1, exhibit: e ? exhibitView(e) : null };
        }),
        storeroom: (q.storeroom.all() as ExhibitRow[]).map(exhibitView),
        archivedDrafts: (q.archived.all(ARCHIVE_LIST) as DraftRow[]).map((d) => ({
          id: d.id,
          recipe: d.recipe,
          archivedAt: d.archived_at!,
          reason: d.archive_reason!,
          archivedBy: d.archived_by === null ? null : viewOf(d.archived_by),
          contributors: credits(q.draftCredits.all(d.id) as CreditRow[]),
        })),
      };
    },

    history(exhibitId) {
      const e = q.exhibit.get(exhibitId) as ExhibitRow | undefined;
      if (!e) return null;
      return { exhibit: exhibitView(e), versions: (q.versionsOf.all(exhibitId) as VersionRow[]).map(versionView) };
    },

    start(pid, recipe, now) {
      if (!Object.hasOwn(RECIPES, recipe)) return refuse("bad-request", "No such recipe");
      return tx(() => {
        const out = bench(pid, false, now, () =>
          Number(q.insertDraft.run(recipe, JSON.stringify(defaultParts(recipe)), "{}", null, now.toISOString()).lastInsertRowid),
        );
        return out.ok ? { ok: true as const, draftId: out.draftId } : out;
      });
    },

    remix(pid, versionId, replace, now) {
      return tx(() => {
        const v = versionRow(versionId);
        if (!v) return refuse("not-found", "No such version");
        return bench(pid, replace, now, () => Number(q.insertDraft.run(v.recipe, v.parts, "{}", v.id, now.toISOString()).lastInsertRowid));
      });
    },

    restoreArchived(pid, archivedId, replace, now) {
      return tx(() => {
        const old = q.draft.get(archivedId) as DraftRow | undefined;
        if (!old || old.archived_at === null) return refuse("not-found", "No such archived draft");
        return bench(pid, replace, now, () => {
          const id = Number(q.insertDraft.run(old.recipe, old.parts, old.part_authors, old.based_on, now.toISOString()).lastInsertRowid);
          q.copyCredits.run(id, old.id);
          return id;
        });
      });
    },

    lease(pid, part, now) {
      return tx(() => {
        const d = liveDraft();
        if (!d) return refuse("draft-empty", "The workbench is empty");
        if (!partOf(d.recipe, part)) return refuse("bad-request", "No such part on this sculpture");
        const current = heldBy(part, now);
        if (current && current.pid !== pid) return held(current);
        const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
        q.setLease.run(part, d.id, pid, expiresAt);
        return { ok: true as const, taken: !current, expiresAt };
      });
    },

    release(pid, part) {
      return tx(() => ({ ok: true as const, released: Number(q.dropLease.run(part, pid).changes) > 0 }));
    },

    releaseAll(pid) {
      return tx(() => (q.dropLeasesOf.all(pid) as { part: string }[]).map((r) => r.part));
    },

    edit(pid, part, values, now) {
      return tx(() => {
        const d = liveDraft();
        if (!d) return refuse("draft-empty", "The workbench is empty");
        if (!partOf(d.recipe, part)) return refuse("bad-request", "No such part on this sculpture");
        const current = heldBy(part, now);
        if (current && current.pid !== pid) return held(current);
        const checked = checkEdit(d.recipe, part, values);
        if (!checked.ok) return refuse("bad-request", checked.reason);
        const parts = JSON.parse(d.parts) as Parts;
        parts[part] = { ...parts[part], ...checked.values };
        // belt and braces: what's stored is always something the page can draw
        const whole = checkSculpture(d.recipe, parts);
        if (!whole.ok) return refuse("bad-request", whole.reason);
        const me = viewOf(pid);
        const authors = JSON.parse(d.part_authors) as Record<string, VisitorView>;
        authors[part] = me;
        q.setParts.run(JSON.stringify(parts), JSON.stringify(authors), d.id);
        q.credit.run(d.id, pid, me.name, me.colour, now.toISOString());
        q.setLease.run(part, d.id, pid, new Date(now.getTime() + leaseMs).toISOString());
        return { ok: true as const, revision: d.revision + 1, values: checked.values, taken: !current };
      });
    },

    clear(pid, now) {
      return tx(() => {
        if (!liveDraft()) return refuse("draft-empty", "The workbench is already empty");
        const other = leasesAt(now).find((l) => l.pid !== pid);
        if (other) return held(other);
        return { ok: true as const, archivedId: archiveLive(pid, "cleared", now)! };
      });
    },

    publish(pid, input, now) {
      return tx(() => {
        const d = liveDraft();
        if (!d) return refuse("draft-empty", "The workbench is empty");
        const creditRows = q.draftCredits.all(d.id) as CreditRow[];
        const v = { title: input.title, recipe: d.recipe, parts: d.parts, restoredFrom: null, basedOn: d.based_on };
        if (input.exhibitId !== undefined) {
          const e = q.exhibit.get(input.exhibitId) as ExhibitRow | undefined;
          if (!e) return refuse("not-found", "No such exhibit");
          const { versionId, n } = addVersion(e.id, pid, v, creditRows, now);
          return { ok: true as const, exhibitId: e.id, versionId, n, stored: null };
        }
        const slot = input.slot!;
        const taken = slotTaken(slot);
        if (taken && !input.replace) return taken;
        // Never silent: the old exhibit moves to the storeroom, all its
        // versions with it, before the new one takes the slot.
        if (taken) q.setSlot.run(null, taken.exhibit.id);
        const exhibitId = Number(q.insertExhibit.run(slot, now.toISOString()).lastInsertRowid);
        const { versionId, n } = addVersion(exhibitId, pid, v, creditRows, now);
        return { ok: true as const, exhibitId, versionId, n, stored: taken ? taken.exhibit.id : null };
      });
    },

    restoreVersion(pid, exhibitId, versionId, now) {
      return tx(() => {
        const v = versionRow(versionId);
        if (!v || v.exhibit_id !== exhibitId) return refuse("not-found", "No such version of this exhibit");
        const creditRows = q.versionCredits.all(v.id) as CreditRow[];
        const out = addVersion(exhibitId, pid, { title: v.title, recipe: v.recipe, parts: v.parts, restoredFrom: v.n, basedOn: v.based_on }, creditRows, now);
        return { ok: true as const, ...out, from: v.n };
      });
    },

    display(exhibitId, slot, replace) {
      return tx(() => {
        const e = q.exhibit.get(exhibitId) as ExhibitRow | undefined;
        if (!e) return refuse("not-found", "No such exhibit");
        if (e.slot !== null) return refuse("bad-request", `It's already on display in slot ${e.slot}`);
        const taken = slotTaken(slot);
        if (taken && !replace) return taken;
        if (taken) q.setSlot.run(null, taken.exhibit.id);
        q.setSlot.run(slot, e.id);
        return { ok: true as const, stored: taken ? taken.exhibit.id : null };
      });
    },

    storeAway(exhibitId) {
      return tx(() => {
        const e = q.exhibit.get(exhibitId) as ExhibitRow | undefined;
        if (!e) return refuse("not-found", "No such exhibit");
        if (e.slot === null) return refuse("slot-empty", "It's already in the storeroom");
        q.setSlot.run(null, e.id);
        return { ok: true as const, slot: e.slot };
      });
    },

    expire(now) {
      return tx(() => (q.expired.all(now.toISOString()) as { part: string; pid: string; expires_at: string }[]).map(leaseView));
    },

    close() {
      db.close();
    },
  };
}
