import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { VISITOR_COLOURS } from "../public/recipes.js";
import { openStore, SLOTS, type Snapshot } from "./db.ts";
import { MARK, renderMuseum, SHELL } from "./html.ts";
import { log, person, raw, type Value, values, who } from "./log.ts";
import { renderDoc, renderReadme } from "./readme.ts";
import type { ErrorCode, ExhibitView, Refusal, StateEvent, VisitorView } from "./types.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const ONE_YEAR = 60 * 60 * 24 * 365;
const PID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DB_PATH = process.env.DB_PATH ?? "./.data/museum.db";
// LEASE_MS (like SWEEP_MS and HEARTBEAT_MS below) is shortened by the
// environment only so the log test can watch a lease run out.
const store = openStore(DB_PATH, { leaseMs: Number(process.env.LEASE_MS) || undefined });

// --- who is who ---

// A generated display name: two small word lists, so a new visitor is
// "Coral Heron" until they choose otherwise (CLAUDE.md, Who is who).
const FIRST = ["Coral", "Teal", "Ivory", "Peach", "Amber", "Dusk", "Silver", "Saffron", "Indigo", "Jade", "Copper", "Misty", "Lunar", "Velvet", "Glass", "Honey"];
const SECOND = ["Heron", "Finch", "Otter", "Wren", "Lynx", "Moth", "Kestrel", "Fox", "Ibis", "Marten", "Lark", "Swift", "Hare", "Newt", "Owl", "Crane"];
const newName = (): string => `${FIRST[randomInt(FIRST.length)]} ${SECOND[randomInt(SECOND.length)]}`;

// A new visitor's colour: one nobody here now is wearing, if there is one.
function newColour(): number {
  const used = new Set(presentPids().map((pid) => store.visitor(pid)?.colour));
  const free = VISITOR_COLOURS.map((_, i) => i).filter((i) => !used.has(i));
  return free.length ? free[randomInt(free.length)] : randomInt(VISITOR_COLOURS.length);
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    try {
      out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      // a malformed cookie is ignored, not fatal
    }
  }
  return out;
}

// The visitor's identity: an existing well-formed pid cookie, or a new one
// set on this response. The visitors row is made on first sight. Nothing the
// page sends is identity except this cookie.
function identify(req: IncomingMessage, res: ServerResponse): string {
  let pid = cookies(req).pid;
  if (!pid || !PID.test(pid)) {
    pid = randomUUID();
    const flags = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${ONE_YEAR}`];
    if (PRODUCTION) flags.push("Secure");
    res.setHeader("Set-Cookie", `pid=${pid}; ${flags.join("; ")}`);
  }
  if (!store.visitor(pid)) {
    const { visitor, created } = store.ensureVisitor(pid, newName(), newColour(), new Date());
    if (created) log("visitor.new", { who: who(pid), name: visitor.name, colour: visitor.colour });
  }
  return pid;
}

// --- responses ---

function reply(res: ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer): void {
  const accepts = /\bgzip\b/.test(String(res.req.headers["accept-encoding"] ?? ""));
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  if (accepts && bytes.length > 1024 && /^(text\/|application\/json|image\/svg)/.test(headers["Content-Type"] ?? "")) {
    res.writeHead(status, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    res.end(res.req.method === "HEAD" ? undefined : gzipSync(bytes));
  } else {
    res.writeHead(status, { ...headers, Vary: "Accept-Encoding" });
    res.end(res.req.method === "HEAD" ? undefined : bytes);
  }
}

const send = (res: ServerResponse, status: number, type: string, body: string | Buffer): void =>
  reply(res, status, { "Content-Type": type, "Cache-Control": "no-store" }, body);

const sendJson = (res: ServerResponse, status: number, value: unknown): void =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

const notFound = (res: ServerResponse): void => send(res, 404, "text/plain; charset=utf-8", "Not found");

// --- static files ---

// Only these extensions are ever served, each with its own type. ES modules
// are `no-cache` so a deploy reaches every page on its next load.
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// A file under a fixed root, never outside it, and never a dotfile.
async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return notFound(res);
  }
  if (decoded.includes("\0") || decoded.split(/[/\\]/).some((seg) => seg.startsWith("."))) return notFound(res);
  const base = resolve(root);
  const file = resolve(base, decoded);
  const type = TYPES[extname(file).toLowerCase()];
  if (!file.startsWith(base + sep) || !type) return notFound(res);
  try {
    const data = await readFile(file);
    reply(res, 200, { "Content-Type": type, "Cache-Control": "no-cache" }, data);
  } catch {
    notFound(res);
  }
}

// Markdown under docs/, rendered: only a fixed shape of path, never outside.
function serveDoc(res: ServerResponse, rel: string): void {
  if (!/^docs\/[a-z0-9/-]+\.md$/.test(rel) || rel.includes("..")) return notFound(res);
  try {
    send(res, 200, "text/html; charset=utf-8", renderDoc(rel));
  } catch {
    notFound(res);
  }
}

// --- the page ---

// public/index.html (the page's own markup) with the six plinths rendered
// in place of <!--museum-->, so the museum reads without JS. Read on every
// request: it's small, and a deploy or an edit shows at once.
async function servePage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pid = identify(req, res);
  log("page", { who: who(pid), new: res.hasHeader("Set-Cookie") || undefined });
  let html: string;
  try {
    html = await readFile("public/index.html", "utf8");
  } catch {
    html = SHELL;
  }
  const listing = renderMuseum(store.snapshot(new Date()));
  send(res, 200, "text/html; charset=utf-8", html.replace(MARK, () => listing));
}

// --- live updates (SSE) ---
// Every open page holds a stream. After any change each one is sent the
// whole museum as its own visitor sees it (`you` and `lease.mine` depend on
// who's asking, and a pid never leaves the server). A whole state, not a
// diff, so a stream that reconnects is right from its first event. Both
// intervals can be shortened by the environment so a test can watch them.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 15_000; // Fly's proxy closes idle connections
const SWEEP_MS = Number(process.env.SWEEP_MS) || 5_000; // leases end on the clock

type Stream = { pid: string; res: ServerResponse; since: number };
const streams = new Set<Stream>();

// Goes up with every broadcast, so a page that gets the same moment twice
// (a POST's answer and the stream's event) keeps the newer. Seeded from the
// clock so it keeps rising across a restart.
let seq = Date.now();

// Present: everyone with at least one open stream, in the order they came.
function presentPids(): string[] {
  return [...new Set([...streams].map((s) => s.pid))];
}

function stateFor(pid: string, snap: Snapshot, now: Date): StateEvent {
  const editing = (p: string): string[] => snap.leases.filter((l) => l.pid === p).map((l) => l.part);
  return {
    serverTime: now.toISOString(),
    seq,
    you: store.view(pid),
    present: presentPids().map((p) => ({ ...store.view(p), editing: editing(p) })),
    draft: snap.draft,
    leases: snap.leases.map((l) => ({ part: l.part, holder: l.holder, expiresAt: l.expiresAt, mine: l.pid === pid })),
    slots: snap.slots,
    storeroom: snap.storeroom,
    archivedDrafts: snap.archivedDrafts,
  };
}

const sendState = (stream: Stream, snap: Snapshot, now: Date): void => {
  stream.res.write(`event: state\ndata: ${JSON.stringify(stateFor(stream.pid, snap, now))}\n\n`);
};

// After every change, and only then: every stream gets its own copy.
function broadcast(now = new Date()): Snapshot {
  seq = Math.max(seq + 1, Date.now());
  const snap = store.snapshot(now);
  for (const stream of streams) sendState(stream, snap, now);
  return snap;
}

function openStream(req: IncomingMessage, res: ServerResponse): void {
  const pid = identify(req, res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // how long the browser waits before reconnecting a dropped stream
  res.write("retry: 2000\n\n");
  const arriving = !presentPids().includes(pid);
  const stream: Stream = { pid, res, since: Date.now() };
  streams.add(stream);
  log("stream.open", { who: who(pid), open: streams.size });
  const now = new Date();
  // Someone new is here: everyone's presence list changes. A second tab of
  // someone already here changes nothing, so only it is sent the state.
  if (arriving) broadcast(now);
  else sendState(stream, store.snapshot(now), now);
  req.on("close", () => {
    // a shutdown already cleared the set; don't log every stream twice
    if (!streams.delete(stream)) return;
    const leaving = !presentPids().includes(pid);
    const released = leaving ? store.releaseAll(pid) : [];
    log("stream.close", {
      who: who(pid),
      open: streams.size,
      secs: Math.round((Date.now() - stream.since) / 1000),
      released: released.length ? raw(released.join(",")) : undefined,
    });
    // Gone, and their leases with them, at once (CLAUDE.md).
    if (leaving) broadcast();
  });
}

// Comments keep idle streams under the proxy's timeout; the browser ignores them.
setInterval(() => {
  for (const { res } of streams) res.write(": hb\n\n");
}, HEARTBEAT_MS).unref();

// A lease that ran out is already free on every read; the sweep makes sure
// every page hears it, even when nobody acts.
setInterval(() => {
  const now = new Date();
  const ended = store.expire(now);
  for (const l of ended) log("lease.expire", { who: who(l.pid), part: raw(l.part), at: l.expiresAt });
  if (ended.length) broadcast(now);
}, SWEEP_MS).unref();

// --- actions ---

const MAX_BODY = 4096;

// A cross-site page can't act on someone's behalf: a browser sends Origin
// on every POST, and it has to be this host.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return null;
  }
  return body;
}

// A refusal: what the route answers, and what the log says about it.
class Refused {
  status: number;
  error: ErrorCode;
  message: string;
  extra: Partial<Refusal>;
  constructor(status: number, error: ErrorCode, message: string, extra: Partial<Refusal> = {}) {
    this.status = status;
    this.error = error;
    this.message = message;
    this.extra = extra;
  }
}
const bad = (message: string): Refused => new Refused(400, "bad-request", message);

const STATUS: Record<ErrorCode, number> = {
  "bad-request": 400,
  "cross-origin": 403,
  "not-found": 404,
  "lease-held": 409,
  "no-lease": 409,
  "draft-not-empty": 409,
  "draft-empty": 409,
  "slot-taken": 409,
  "slot-empty": 409,
};

type StoreRefusal = { error: ErrorCode; message: string; holder?: VisitorView; expiresAt?: string; exhibit?: ExhibitView };

// A store refusal as a route refusal, keeping its extra fields.
function fromStore(r: StoreRefusal): Refused {
  const extra: Partial<Refusal> = {};
  if (r.holder) extra.holder = r.holder;
  if (r.expiresAt) extra.expiresAt = r.expiresAt;
  if (r.exhibit) extra.exhibit = r.exhibit;
  return new Refused(STATUS[r.error], r.error, r.message, extra);
}

function check<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw fromStore(r as unknown as StoreRefusal);
  return r as Extract<T, { ok: true }>;
}

type Body = Record<string, unknown>;

// 1..max characters after trimming, counted as characters, no control or
// line-separator characters. Anything else is refused, never truncated.
function text(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw bad(`${field} must be text`);
  const s = v.trim();
  const n = Array.from(s).length;
  if (n < 1 || n > max) throw bad(`${field} must be 1 to ${max} characters`);
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(s)) throw bad(`${field} can't hold control characters`);
  return s;
}
function id(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw bad(`${field} must be a positive whole number`);
  return v;
}
function slotOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > SLOTS) throw bad(`slot must be 1 to ${SLOTS}`);
  return v;
}
function flag(v: unknown, field: string): boolean {
  if (v === undefined) return false;
  if (typeof v !== "boolean") throw bad(`${field} must be true or false`);
  return v;
}
// A recipe or part id: checked against recipes.js by the store; here only
// its shape, so the log can print it raw.
function word(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^[a-z]{1,24}$/.test(v)) throw bad(`no such ${field}`);
  return v;
}
// Only the keys a route knows: anything else is a mistake worth hearing about.
function only(body: Body, keys: string[]): void {
  const extra = Object.keys(body).filter((k) => !keys.includes(k));
  if (extra.length) throw bad(`unexpected ${extra.join(", ")}`);
}

// What an action did: fields for the log line, and fields for the answer.
// `quiet`: nothing changed, so nobody else needs telling.
type Done = { log?: Record<string, Value>; json?: Record<string, unknown>; quiet?: boolean };
type Act = (pid: string, body: Body, now: Date, params: string[]) => Done;
type Route = (req: IncomingMessage, res: ServerResponse, params?: string[]) => Promise<void>;

// One POST, the same shape for every route: same origin, the requester's own
// pid, a small JSON body, then the store's one transaction. Success is a 200
// with the museum as the requester now sees it, and a broadcast; a refusal
// is { error, message } with its status. Every outcome is one log line.
function action(name: string, act: Act): Route {
  return async (req, res, params = []) => {
    if (!sameOrigin(req)) {
      const c = cookies(req).pid;
      log(`${name}.refused`, { who: c && PID.test(c) ? who(c) : raw("-"), status: 403, error: raw("cross-origin") });
      return sendJson(res, 403, { error: "cross-origin", message: "Cross-site request refused" });
    }
    const pid = identify(req, res);
    const now = new Date();
    try {
      const text = await readBody(req);
      if (text === null) throw bad(`the body must be at most ${MAX_BODY} bytes`);
      let body: unknown = {};
      if (text.trim() !== "") {
        try {
          body = JSON.parse(text);
        } catch {
          throw bad("the body must be JSON");
        }
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("the body must be a JSON object");
      const done = act(pid, body as Body, now, params);
      log(name, { who: who(pid), ...done.log });
      const snap = done.quiet ? store.snapshot(now) : broadcast(now);
      sendJson(res, 200, { ok: true, ...done.json, state: stateFor(pid, snap, now) });
    } catch (err) {
      if (!(err instanceof Refused)) throw err;
      log(`${name}.refused`, {
        who: who(pid),
        status: err.status,
        error: raw(err.error),
        holder: err.extra.holder ? person(err.extra.holder) : undefined,
        message: err.message,
      });
      sendJson(res, err.status, { error: err.error, message: err.message, ...err.extra });
    }
  };
}

const postMe = action("rename", (pid, body) => {
  only(body, ["name"]);
  const name = text(body.name, "name", 24);
  const { from } = store.rename(pid, name);
  return { log: { from, to: name } };
});

const postStart = action("draft.start", (pid, body, now) => {
  only(body, ["recipe"]);
  const recipe = word(body.recipe, "recipe");
  const r = check(store.start(pid, recipe, now));
  return { log: { recipe: raw(recipe), draft: r.draftId }, json: { draftId: r.draftId } };
});

const postRemix = action("draft.remix", (pid, body, now) => {
  only(body, ["versionId", "replace"]);
  const versionId = id(body.versionId, "versionId");
  const r = check(store.remix(pid, versionId, flag(body.replace, "replace"), now));
  return {
    log: { version: versionId, draft: r.draftId, archived: r.archivedId ?? undefined },
    json: { draftId: r.draftId, archivedId: r.archivedId },
  };
});

const postRestoreArchived = action("draft.restore-archived", (pid, body, now) => {
  only(body, ["archivedId", "replace"]);
  const archivedId = id(body.archivedId, "archivedId");
  const r = check(store.restoreArchived(pid, archivedId, flag(body.replace, "replace"), now));
  return {
    log: { from: archivedId, draft: r.draftId, archived: r.archivedId ?? undefined },
    json: { draftId: r.draftId, archivedId: r.archivedId },
  };
});

const postLease = action("lease", (pid, body, now) => {
  only(body, ["part"]);
  const part = word(body.part, "part");
  const r = check(store.lease(pid, part, now));
  // A renewal moves expiresAt, which pages count down to, so it broadcasts too.
  return { log: { part: raw(part), taken: r.taken || undefined }, json: { expiresAt: r.expiresAt } };
});

const postRelease = action("release", (pid, body, now) => {
  only(body, ["part"]);
  const part = word(body.part, "part");
  const r = store.release(pid, part, now);
  return { log: { part: raw(part), released: r.released }, json: { released: r.released }, quiet: !r.released };
});

const postEdit = action("edit", (pid, body, now) => {
  only(body, ["part", "values", "revision"]);
  const part = word(body.part, "part");
  // The revision the page last saw: checked for shape, not enforced. The
  // part's lease already keeps two people off the same numbers.
  if (body.revision !== undefined && (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 0)) {
    throw bad("revision must be a whole number");
  }
  const r = check(store.edit(pid, part, body.values, now));
  return { log: { part: raw(part), values: values(r.values), rev: r.revision }, json: { revision: r.revision, values: r.values } };
});

const postClear = action("draft.clear", (pid, body, now) => {
  only(body, []);
  const r = check(store.clear(pid, now));
  return { log: { archived: r.archivedId }, json: { archivedId: r.archivedId } };
});

const postPublish = action("publish", (pid, body, now) => {
  only(body, ["title", "slot", "exhibitId", "replace"]);
  const title = text(body.title, "title", 40);
  const hasSlot = body.slot !== undefined;
  if (hasSlot === (body.exhibitId !== undefined)) throw bad("give a slot for a new exhibit or an exhibitId for a new version, not both");
  const replace = flag(body.replace, "replace");
  const input = hasSlot ? { title, slot: slotOf(body.slot), replace } : { title, exhibitId: id(body.exhibitId, "exhibitId") };
  const r = check(store.publish(pid, input, now));
  return {
    log: { title, exhibit: r.exhibitId, n: r.n, slot: input.slot, stored: r.stored ?? undefined },
    json: { exhibitId: r.exhibitId, versionId: r.versionId, n: r.n, stored: r.stored },
  };
});

const postRestoreVersion = action("restore", (pid, body, now, [exhibit]) => {
  only(body, ["versionId"]);
  const versionId = id(body.versionId, "versionId");
  const r = check(store.restoreVersion(pid, Number(exhibit), versionId, now));
  return { log: { exhibit: Number(exhibit), from: r.from, n: r.n }, json: { versionId: r.versionId, n: r.n } };
});

const postDisplay = action("display", (_pid, body, _now, [exhibit]) => {
  only(body, ["slot", "replace"]);
  const slot = slotOf(body.slot);
  const r = check(store.display(Number(exhibit), slot, flag(body.replace, "replace")));
  return { log: { exhibit: Number(exhibit), slot, stored: r.stored ?? undefined }, json: { stored: r.stored } };
});

const postStore = action("store", (_pid, body, _now, [exhibit]) => {
  only(body, []);
  const r = check(store.storeAway(Number(exhibit)));
  return { log: { exhibit: Number(exhibit), slot: r.slot }, json: { slot: r.slot } };
});

const POSTS: Record<string, Route> = {
  "/me": postMe,
  "/draft/start": postStart,
  "/draft/remix": postRemix,
  "/draft/restore-archived": postRestoreArchived,
  "/draft/lease": postLease,
  "/draft/release": postRelease,
  "/draft/edit": postEdit,
  "/draft/clear": postClear,
  "/publish": postPublish,
};
const EXHIBIT_POSTS: Record<string, Route> = {
  restore: postRestoreVersion,
  display: postDisplay,
  store: postStore,
};

// --- routing ---

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const reading = req.method === "GET" || req.method === "HEAD";

  if (path === "/" && reading) return servePage(req, res);
  if (path === "/index.html" && reading) return redirect(res, "/");
  if (path === "/readme" && reading) return redirect(res, "/readme/");
  if (path === "/readme/" && reading) return send(res, 200, "text/html; charset=utf-8", renderReadme());
  if (path.startsWith("/readme/docs/") && reading) {
    const rel = path.slice("/readme/".length);
    return rel.endsWith(".md") ? serveDoc(res, rel) : serveFile(res, "docs", rel.slice("docs/".length));
  }
  if (path === "/events" && req.method === "GET") return openStream(req, res);
  const exhibit = /^\/exhibits\/(\d{1,9})(?:\/(restore|display|store))?$/.exec(path);
  if (req.method === "POST") {
    if (Object.hasOwn(POSTS, path)) return POSTS[path](req, res);
    if (exhibit?.[2]) return EXHIBIT_POSTS[exhibit[2]](req, res, [exhibit[1]]);
    return sendJson(res, 404, { error: "not-found", message: "No such action" });
  }
  if (exhibit && !exhibit[2] && reading) {
    const history = store.history(Number(exhibit[1]));
    return history ? sendJson(res, 200, history) : sendJson(res, 404, { error: "not-found", message: "No such exhibit" });
  }
  if (reading && path.length > 1) return serveFile(res, "public", path.slice(1));
  notFound(res);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log("error", { method: req.method ?? "", path: (req.url ?? "").split("?")[0], message });
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "bad-request", message: "Something went wrong" });
    else res.end();
  });
}).listen(PORT, "0.0.0.0", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  log("start", { port, db: DB_PATH });
});

// Fly sends SIGTERM before stopping the machine (a redeploy, or no traffic).
// close() waits for every socket to go quiet, so closeAllConnections() too,
// or the platform may kill the process before the database closes. Every
// write is synchronous and already committed, so nothing is cut short.
function shutdown(signal: string): void {
  log("shutdown", { signal: raw(signal), open: streams.size });
  for (const { res } of streams) res.end();
  streams.clear();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
