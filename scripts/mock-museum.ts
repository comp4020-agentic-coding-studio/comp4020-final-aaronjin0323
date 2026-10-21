#!/usr/bin/env node
// A stand-in for the museum's server, for looking at the page before the
// real one (src/server.ts) exists. In memory, nothing persists, and it will
// be replaced. It follows CLAUDE.md's contract and src/types.ts as closely as
// it can, so the page never leans on behaviour only the mock has:
//
//   PORT=8090 node scripts/mock-museum.ts
//
// MOCK_LEASE_MS shortens leases for looking at expiry.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
// @ts-ignore -- plain JS shared with the page; ignore (not expect-error) so it
// stays quiet if the server's side turns on allowJs
import { RECIPES, checkEdit, defaultParts } from "../public/recipes.js";
import type { ArchivedDraftView, Credit, DraftView, ExhibitView, LeaseView, Parts, StateEvent, VersionView, VisitorView } from "../src/types.ts";

const PORT = Number(process.env.PORT ?? 8090);
const LEASE_MS = Number(process.env.MOCK_LEASE_MS ?? 15_000);
const PUBLIC = join(import.meta.dirname, "..", "public");

type Visitor = VisitorView & { pid: string };
type Draft = {
  id: number;
  recipe: string | null;
  parts: Parts | null;
  revision: number;
  partAuthors: Record<string, VisitorView>;
  credits: Map<string, Credit>;
  basedOn: DraftView["basedOn"];
};
type Exhibit = { id: number; slot: number | null; versions: VersionView[] };
type Archived = ArchivedDraftView & { parts: Parts; basedOn: DraftView["basedOn"] };

const ADJ = ["Coral", "Teal", "Ivory", "Peach", "Dusk", "Chrome", "Gold", "Amber"];
const NOUN = ["Heron", "Finch", "Otter", "Lark", "Moth", "Wren", "Hare", "Ibis"];

const visitors = new Map<string, Visitor>();
const streams = new Set<{ res: ServerResponse; pid: string }>();
const leases = new Map<string, { pid: string; expiresAt: number }>();
const exhibits: Exhibit[] = [];
const archived: Archived[] = [];
let ids = 1;
let seq = Date.now();
let draft: Draft = emptyDraft();

function emptyDraft(): Draft {
  return { id: ids++, recipe: null, parts: null, revision: 0, partAuthors: {}, credits: new Map(), basedOn: null };
}
const view = (v: Visitor): VisitorView => ({ tag: v.tag, name: v.name, colour: v.colour });
const clone = <T>(x: T): T => structuredClone(x);

function newVisitor(): Visitor {
  const pid = randomUUID();
  const n = visitors.size;
  const v = {
    pid,
    tag: createHash("sha256").update(pid).digest("hex").slice(0, 6),
    name: `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`,
    colour: n % 8,
  };
  visitors.set(pid, v);
  return v;
}

// The three starters, version 1, published by the museum.
for (const [slot, recipe, title] of [
  [1, "loop", "Loop & Lantern"],
  [2, "arches", "Arch Totem"],
  [3, "bloom", "Glass Bloom"],
] as const) {
  const id = ids++;
  exhibits.push({
    id,
    slot,
    versions: [{ id: ids++, exhibitId: id, n: 1, title, recipe, parts: defaultParts(recipe), contributors: [], publishedBy: null, publishedAt: new Date().toISOString(), restoredFrom: null, basedOn: null }],
  });
}

const latest = (e: Exhibit): VersionView => e.versions[e.versions.length - 1];
const exhibitView = (e: Exhibit): ExhibitView => ({ id: e.id, slot: e.slot, latest: clone(latest(e)), versionCount: e.versions.length });

function liveLeases(now: number): Map<string, { pid: string; expiresAt: number }> {
  for (const [part, l] of leases) if (l.expiresAt <= now) leases.delete(part);
  return leases;
}

function stateFor(pid: string): StateEvent {
  const now = Date.now();
  const live = liveLeases(now);
  const present = [...new Set([...streams].map((s) => s.pid))].map((p) => {
    const v = visitors.get(p)!;
    return { ...view(v), editing: [...live].filter(([, l]) => l.pid === p).map(([part]) => part) };
  });
  const leaseViews: LeaseView[] = [...live].map(([part, l]) => ({ part, holder: view(visitors.get(l.pid)!), expiresAt: new Date(l.expiresAt).toISOString(), mine: l.pid === pid }));
  return {
    serverTime: new Date(now).toISOString(),
    seq,
    you: view(visitors.get(pid)!),
    present,
    draft: {
      id: draft.id,
      recipe: draft.recipe,
      parts: clone(draft.parts),
      revision: draft.revision,
      partAuthors: clone(draft.partAuthors),
      contributors: [...draft.credits.values()].map(clone),
      basedOn: clone(draft.basedOn),
    },
    leases: leaseViews,
    slots: [1, 2, 3, 4, 5, 6].map((slot) => {
      const e = exhibits.find((x) => x.slot === slot);
      return { slot, exhibit: e ? exhibitView(e) : null };
    }),
    storeroom: exhibits.filter((e) => e.slot === null).map(exhibitView),
    archivedDrafts: archived.slice().reverse().map(({ parts: _p, basedOn: _b, ...a }) => clone(a)),
  };
}

function broadcast(): void {
  seq++;
  for (const s of streams) s.res.write(`event: state\ndata: ${JSON.stringify(stateFor(s.pid))}\n\n`);
}

// Leases expire on the clock; tell everyone when one does, so pages don't
// keep showing a holder who's gone quiet.
setInterval(() => {
  const before = leases.size;
  liveLeases(Date.now());
  if (leases.size !== before) broadcast();
}, 500);

class Refusal extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (m: string) => new Refusal(400, "bad-request", m);

function archiveDraft(by: Visitor, reason: "replaced" | "cleared"): void {
  if (draft.recipe === null) return;
  archived.push({ id: draft.id, recipe: draft.recipe, archivedAt: new Date().toISOString(), reason, archivedBy: view(by), contributors: [...draft.credits.values()], parts: draft.parts!, basedOn: draft.basedOn });
  leases.clear();
}

function fillBench(by: Visitor, recipe: string, parts: Parts, basedOn: DraftView["basedOn"], replace: boolean): void {
  if (draft.recipe !== null) {
    if (!replace) throw new Refusal(409, "draft-not-empty", "The workbench has a sculpture on it. Replace the workbench to swap it (it's archived, not lost).");
    archiveDraft(by, "replaced");
  }
  draft = emptyDraft();
  draft.recipe = recipe;
  draft.parts = clone(parts);
  draft.basedOn = basedOn;
  draft.revision = 1;
}

function takeLease(v: Visitor, part: string): void {
  if (draft.recipe === null) throw new Refusal(409, "draft-empty", "The workbench is empty.");
  if (!Object.hasOwn(RECIPES[draft.recipe].parts, part)) throw bad(`no part ${part}`);
  const held = liveLeases(Date.now()).get(part);
  if (held && held.pid !== v.pid) throw new Refusal(409, "lease-held", `${visitors.get(held.pid)!.name} is shaping the ${RECIPES[draft.recipe].parts[part].name.toLowerCase()}.`);
  leases.set(part, { pid: v.pid, expiresAt: Date.now() + LEASE_MS });
}

function findVersion(id: unknown): { exhibit: Exhibit; version: VersionView } {
  if (typeof id !== "number") throw bad("versionId must be a number");
  for (const exhibit of exhibits) for (const version of exhibit.versions) if (version.id === id) return { exhibit, version };
  throw new Refusal(404, "not-found", "No such version.");
}

function title(t: unknown): string {
  if (typeof t !== "string" || t.trim().length < 1 || t.trim().length > 40) throw bad("A title is 1 to 40 characters.");
  return t.trim();
}

function slotArg(s: unknown): number {
  if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 6) throw bad("slot must be 1 to 6");
  return s;
}

function publishVersion(by: Visitor | null, exhibit: Exhibit, t: string, recipe: string, parts: Parts, contributors: Credit[], restoredFrom: number | null, basedOn: VersionView["basedOn"]): void {
  exhibit.versions.push({ id: ids++, exhibitId: exhibit.id, n: exhibit.versions.length + 1, title: t, recipe, parts: clone(parts), contributors: clone(contributors), publishedBy: by && view(by), publishedAt: new Date().toISOString(), restoredFrom, basedOn: clone(basedOn) });
}

function occupy(slot: number, replace: boolean): void {
  const there = exhibits.find((e) => e.slot === slot);
  if (!there) return;
  if (!replace) throw new Refusal(409, "slot-taken", `Plinth ${slot} holds "${latest(there).title}".`);
  there.slot = null;
}

const routes: Record<string, (v: Visitor, body: Record<string, unknown>, m: RegExpMatchArray) => unknown> = {
  "POST /me": (v, b) => {
    if (typeof b.name !== "string" || b.name.trim().length < 1 || b.name.trim().length > 24) throw bad("A name is 1 to 24 characters.");
    v.name = b.name.trim();
    return { you: view(v) };
  },
  "POST /draft/start": (v, b) => {
    if (typeof b.recipe !== "string" || !Object.hasOwn(RECIPES, b.recipe)) throw bad("unknown recipe");
    fillBench(v, b.recipe, defaultParts(b.recipe), null, false);
    return {};
  },
  "POST /draft/remix": (v, b) => {
    const { exhibit, version } = findVersion(b.versionId);
    fillBench(v, version.recipe, version.parts, { exhibitId: exhibit.id, versionId: version.id, title: version.title, n: version.n }, b.replace === true);
    return {};
  },
  "POST /draft/restore-archived": (v, b) => {
    const a = archived.find((x) => x.id === b.archivedId);
    if (!a) throw new Refusal(404, "not-found", "No such archived draft.");
    fillBench(v, a.recipe, a.parts, a.basedOn, b.replace === true);
    return {};
  },
  "POST /draft/lease": (v, b) => {
    takeLease(v, String(b.part));
    return {};
  },
  "POST /draft/release": (v, b) => {
    if (typeof b.part !== "string") throw bad("part must be a string");
    const l = leases.get(b.part);
    if (l && l.pid === v.pid) leases.delete(b.part);
    return {};
  },
  "POST /draft/edit": (v, b) => {
    const part = String(b.part);
    takeLease(v, part);
    const checked = checkEdit(draft.recipe!, part, b.values);
    if (!checked.ok) throw bad(checked.reason);
    Object.assign(draft.parts![part], checked.values);
    draft.revision++;
    draft.partAuthors[part] = view(v);
    const c = draft.credits.get(v.tag) ?? { ...view(v), edits: 0 };
    c.edits++;
    c.name = v.name;
    draft.credits.set(v.tag, c);
    return { revision: draft.revision };
  },
  "POST /draft/clear": (v) => {
    if (draft.recipe === null) throw new Refusal(409, "draft-empty", "The workbench is already empty.");
    const other = [...liveLeases(Date.now()).values()].find((l) => l.pid !== v.pid);
    if (other) throw new Refusal(409, "lease-held", `${visitors.get(other.pid)!.name} is still shaping it.`);
    archiveDraft(v, "cleared");
    draft = emptyDraft();
    return {};
  },
  "POST /publish": (v, b) => {
    if (draft.recipe === null) throw new Refusal(409, "draft-empty", "The workbench is empty.");
    const t = title(b.title);
    const credits = [...draft.credits.values()];
    if (b.exhibitId !== undefined) {
      const e = exhibits.find((x) => x.id === b.exhibitId);
      if (!e) throw new Refusal(404, "not-found", "No such exhibit.");
      publishVersion(v, e, t, draft.recipe, draft.parts!, credits, null, draft.basedOn);
      return { exhibitId: e.id };
    }
    const slot = slotArg(b.slot);
    occupy(slot, b.replace === true);
    const e: Exhibit = { id: ids++, slot, versions: [] };
    exhibits.push(e);
    publishVersion(v, e, t, draft.recipe, draft.parts!, credits, null, draft.basedOn);
    return { exhibitId: e.id };
  },
  "POST /exhibits/:id/restore": (v, b, m) => {
    const e = exhibits.find((x) => x.id === Number(m[1]));
    if (!e) throw new Refusal(404, "not-found", "No such exhibit.");
    const old = e.versions.find((x) => x.id === b.versionId);
    if (!old) throw new Refusal(404, "not-found", "No such version.");
    publishVersion(v, e, old.title, old.recipe, old.parts, old.contributors, old.id, old.basedOn);
    return {};
  },
  "POST /exhibits/:id/display": (_v, b, m) => {
    const e = exhibits.find((x) => x.id === Number(m[1]));
    if (!e) throw new Refusal(404, "not-found", "No such exhibit.");
    const slot = slotArg(b.slot);
    occupy(slot, b.replace === true);
    e.slot = slot;
    return {};
  },
  "POST /exhibits/:id/store": (_v, _b, m) => {
    const e = exhibits.find((x) => x.id === Number(m[1]));
    if (!e) throw new Refusal(404, "not-found", "No such exhibit.");
    if (e.slot === null) throw new Refusal(409, "slot-empty", "It's already in the storeroom.");
    e.slot = null;
    return {};
  },
};

function visitorOf(req: IncomingMessage, res: ServerResponse): Visitor {
  const pid = /(?:^|;\s*)pid=([0-9a-f-]{36})/.exec(req.headers.cookie ?? "")?.[1];
  const known = pid && visitors.get(pid);
  if (known) return known;
  const v = newVisitor();
  res.setHeader("Set-Cookie", `pid=${v.pid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
  return v;
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2" };

async function serveIndex(res: ServerResponse): Promise<void> {
  const html = await readFile(join(PUBLIC, "index.html"), "utf8");
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const items = [1, 2, 3, 4, 5, 6]
    .map((slot) => {
      const e = exhibits.find((x) => x.slot === slot);
      return e ? `<li>Plinth ${slot}: ${esc(latest(e).title)}, version ${e.versions.length}</li>` : `<li>Plinth ${slot}: empty</li>`;
    })
    .join("");
  res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
  res.end(html.replace("<!--museum-->", `<ol class="listing" data-listing>${items}</ol>`));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const v = visitorOf(req, res);
  try {
    if (req.method === "GET" && url.pathname === "/") return await serveIndex(res);
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const s = { res, pid: v.pid };
      streams.add(s);
      const beat = setInterval(() => res.write(": beat\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(beat);
        streams.delete(s);
        if (![...streams].some((x) => x.pid === v.pid)) for (const [part, l] of leases) if (l.pid === v.pid) leases.delete(part);
        broadcast();
      });
      broadcast();
      return;
    }
    const history = /^\/exhibits\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && history) {
      const e = exhibits.find((x) => x.id === Number(history[1]));
      if (!e) throw new Refusal(404, "not-found", "No such exhibit.");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exhibit: exhibitView(e), versions: e.versions.slice().reverse() }));
      return;
    }
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new Refusal(403, "cross-origin", "Cross-site requests are refused.");
      const path = url.pathname.replace(/^\/exhibits\/\d+\//, "/exhibits/:id/");
      const handler = routes[`POST ${path}`];
      if (!handler) throw new Refusal(404, "not-found", "No such route.");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: Record<string, unknown>;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw bad("body must be JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("body must be an object");
      const out = handler(v, body, /^\/exhibits\/(\d+)/.exec(url.pathname) ?? ([] as unknown as RegExpMatchArray));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out ?? {}));
      broadcast();
      return;
    }
    if (req.method === "GET") {
      const file = normalize(join(PUBLIC, url.pathname));
      if (!file.startsWith(PUBLIC)) throw new Refusal(404, "not-found", "No such file.");
      const data = await readFile(file).catch(() => null);
      if (!data) throw new Refusal(404, "not-found", "No such file.");
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
      return;
    }
    throw new Refusal(404, "not-found", "No such route.");
  } catch (e) {
    const r = e instanceof Refusal ? e : new Refusal(500, "bad-request", String(e));
    if (!res.headersSent) res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: r.code, message: r.message }));
  }
}).listen(PORT, () => console.log(`mock museum on http://localhost:${PORT}`));
