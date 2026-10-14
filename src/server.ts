import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { boardView, isNotice, renderBoard } from "./board.ts";
import { type Expiry, isActive, type Landmark, openStore, TILES, type Visit } from "./db.ts";
import { at, claimEffects, expiryDrops, holder, log, people, quote, raw, tag, type Value, who } from "./log.ts";
import { renderDoc, renderReadme } from "./readme.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const MAX_BODY = 4096;
const ONE_YEAR = 60 * 60 * 24 * 365;
const PID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DB_PATH = process.env.DB_PATH ?? "./.data/app.db";
const store = openStore(DB_PATH);

// --- live updates (SSE) ---
// Every open page holds a stream. After any change each one is sent the
// whole board as its own visitor sees it: "mine" and the wallet (`me`) depend
// on who's asking, and a pid never leaves the server. A full board, not a
// diff, means a stream that drops and reconnects is back in sync from its
// first event. Both can be shortened by the environment so a test can watch
// them happen.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 15_000; // Fly's proxy closes connections idle ~30-60 s
const SWEEP_MS = Number(process.env.SWEEP_MS) || 60_000; // leases end on the clock, so look each minute

type Stream = { pid: string; res: ServerResponse };
const streams = new Set<Stream>();

// Every board carries a version that goes up with each change, so a page
// that gets the same moment twice (an action's response and its stream
// event) or out of order can keep the newest. Seeded from the clock so it
// keeps rising across a restart, when every page reconnects.
let version = Date.now();
const EVENTS = 8;
const view = (pid: string, now: Date, visit: Visit | null = null) =>
  boardView(store.tiles(), pid, now, store.landmarks(), { me: store.me(pid, now), events: store.events(EVENTS), visit });
const versioned = (pid: string, now: Date, visit: Visit | null = null) => ({ ...view(pid, now, visit), version });

// A landmark just raised, as the one broadcast after it carries it. Only the
// newest if two were finished by the same change; both are in `landmarks`.
type Raised = { cellId: number; label: string; raisers: string[] };

function sendBoard(stream: Stream, now: Date, raised?: Raised, visit: Visit | null = null): void {
  const board = versioned(stream.pid, now, visit);
  stream.res.write(`event: board\ndata: ${JSON.stringify(raised ? { ...board, raised } : board)}\n\n`);
}

// Called after every change, and only then. Every change that can fill a
// landmark broadcasts, so this is where one is noticed: in the same
// synchronous turn as the change, so no other request comes between them.
// One just raised is logged and goes out on this broadcast only: a stream
// that connects later gets it in `landmarks` but never as `raised`, so a
// reconnecting page doesn't celebrate it again. Leases the change's
// settlement ended are logged here too.
function broadcast(now = new Date()): void {
  logExpired(store.takeExpired(), now);
  version = Math.max(version + 1, Date.now());
  const raised = store.raise(now);
  for (const l of raised) logLandmark(l);
  const last = raised.at(-1);
  const news = last ? { cellId: last.cellId, label: last.label, raisers: last.raisers } : undefined;
  for (const stream of streams) sendBoard(stream, now, news);
}

// Logs leases a settlement ended, and says whether there were any (so a
// read that ended one can broadcast it).
function logExpired(list: Expiry[], now: Date): boolean {
  const tiles = store.tiles();
  for (const e of list) {
    log("expire", {
      at: at(e.cellId),
      holder: raw(`${tag(e.pid)}:${quote(e.label)}`),
      ended: e.at,
      unclaimed: e.pendingCents,
      dropped: people(expiryDrops(tiles, e.cellId, now)),
    });
  }
  return list.length > 0;
}

function logLandmark(l: Landmark): void {
  log("landmark", { at: at(l.cellId), label: l.label, raisers: raw(l.raisers.map(quote).join(",")) });
}

function openStream(req: IncomingMessage, res: ServerResponse): void {
  const pid = identify(req, res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // retry: how long the browser waits before reconnecting a dropped stream
  res.write("retry: 2000\n\n");
  const stream = { pid, res };
  streams.add(stream);
  const now = new Date();
  log("stream.open", { who: who(pid), open: streams.size });
  // An open page is a visit: its first board carries the once-only welcome
  // and lease-ended notices, if the page load didn't already show them.
  const visit = store.visit(pid, now);
  // A lease that ended before anyone looked ends on this read: everyone hears.
  if (logExpired(store.takeExpired(), now)) broadcast(now);
  sendBoard(stream, now, undefined, visit);
  req.on("close", () => {
    // A shutdown already cleared the set; don't log every stream twice.
    if (!streams.delete(stream)) return;
    store.seen(pid, new Date()); // gone from here: a later visit's welcome counts from now
    log("stream.close", { who: who(pid), open: streams.size, secs: Math.round((Date.now() - now.getTime()) / 1000) });
  });
}

// Comments keep idle streams under the proxy's timeout; the browser ignores
// them.
setInterval(() => {
  for (const { res } of streams) res.write(": hb\n\n");
}, HEARTBEAT_MS).unref();

// Once a minute: settle everyone's income and end every lease that ran out,
// so every page sees the land free and the neighbours' heights and rates
// drop. A page open now counts as its holder being here.
function sweep(now: Date): void {
  store.settle(now);
  for (const pid of new Set([...streams].map((s) => s.pid))) store.seen(pid, now);
  const ended = store.takeExpired();
  if (ended.length) {
    logExpired(ended, now);
    broadcast(now);
  }
}
setInterval(() => sweep(new Date()), SWEEP_MS).unref();

// Leases that ended while the server was off end now, before anyone asks.
// A building already standing in a full ring when the server starts (say, a
// database from before migration 4) is recorded now too. Both are logged, not
// celebrated: nobody watched them happen.
{
  const now = new Date();
  store.settle(now);
  logExpired(store.takeExpired(), now);
  for (const l of store.raise(now)) logLandmark(l);
}

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

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
// set on this response. A label never decides who anyone is.
function identify(req: IncomingMessage, res: ServerResponse): string {
  const existing = cookies(req).pid;
  if (existing && PID.test(existing)) return existing;
  const pid = randomUUID();
  const flags = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${ONE_YEAR}`];
  if (PRODUCTION) flags.push("Secure");
  res.setHeader("Set-Cookie", `pid=${pid}; ${flags.join("; ")}`);
  return pid;
}

// A cross-site form can't act on someone's behalf: a browser always sends
// Origin on a POST, and it has to be this host.
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

function parseFields(req: IncomingMessage, body: string): Record<string, unknown> {
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

// 1-24 characters after trimming, counted as characters rather than UTF-16
// units, and no control characters.
function validLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim();
  const length = Array.from(label).length;
  if (length < 1 || length > 24 || /\p{Cc}/u.test(label)) return null;
  return label;
}

function validCell(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : raw;
  if (typeof s !== "string" || !/^\d{1,3}$/.test(s)) return null;
  const id = Number(s);
  return id < TILES ? id : null;
}

// A renewal's `hours` as the client sent it; whether it's one of the options
// is the store's rule (src/economy.ts).
function validHours(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : raw;
  return typeof s === "string" && /^\d{1,3}$/.test(s) ? Number(s) : null;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, value: unknown): void =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

// The status each refusal key answers with (CLAUDE.md, ADR 5).
const STATUS: Record<string, number> = {
  taken: 409,
  coins: 402,
  cooldown: 429,
  cell: 400,
  label: 400,
  hours: 400,
  "max-level": 400,
  "max-lease": 400,
  "not-neighbour": 400,
  "no-land": 400,
};

// One POST action, the same shape for each route: same-origin, the
// requester's own pid, a small body, then the store's one transaction.
// `act` returns a notice key: an `ok` one is a 200 (JSON, with the board as
// the requester now sees it) or a 303 to /?notice=<key> (a form); any other
// is a refusal with its own status. Every outcome is one log line.
type Outcome = { ok: boolean; key: string; fields?: Record<string, Value>; json?: object };
type Act = (pid: string, fields: Record<string, unknown>, now: Date) => Outcome;

function action(name: string, act: Act) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const wantsJson = (req.headers.accept ?? "").includes("application/json");
    // A refusal names who tried, what, and why; any typed text is cut short.
    const refused = (pid: string | null, status: number, reason: string, fields: Outcome["fields"] = {}): void =>
      log(`${name}.refused`, { who: pid ? who(pid) : raw("-"), status, reason: raw(reason), ...fields });

    if (!sameOrigin(req)) {
      const cookie = cookies(req).pid;
      refused(cookie && PID.test(cookie) ? cookie : null, 403, "cross-site");
      return send(res, 403, "text/plain; charset=utf-8", "Cross-site request refused");
    }
    const pid = identify(req, res);
    const body = await readBody(req);
    if (body === null) {
      refused(pid, 413, "too-large");
      return send(res, 413, "text/plain; charset=utf-8", "Too large");
    }
    const now = new Date();
    const out = act(pid, parseFields(req, body), now);
    if (!out.ok) {
      const status = STATUS[out.key] ?? 400;
      refused(pid, status, out.key, out.fields);
      // the settlement still ran; a lease it ended is news for everyone
      if (logExpired(store.takeExpired(), now)) broadcast(now);
      return wantsJson ? sendJson(res, status, { error: out.key }) : redirect(res, `/?notice=${out.key}`);
    }
    if (out.fields) log(name === "claim" && out.key === "moved" ? "relocate" : name, { who: who(pid), ...out.fields });
    broadcast(now);
    if (wantsJson) return sendJson(res, 200, { ...out.json, notice: out.key, board: versioned(pid, now) });
    redirect(res, `/?notice=${out.key}`);
  };
}

const cut = (v: unknown): string | undefined =>
  v === undefined ? undefined : Array.from(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 40).join("");

// Claim a free plot; claim your own again to rename; or, holding land,
// move to a free plot (docs/adr/0005: 50 coins, 30-minute cooldown).
const postClaim = action("claim", (pid, fields, now) => {
  const cellId = validCell(fields.cellId);
  const where = { at: cellId === null ? undefined : at(cellId), cell: cellId === null ? cut(fields.cellId) : undefined, label: cut(fields.label) };
  if (cellId === null) return { ok: false, key: "cell", fields: where };
  const label = validLabel(fields.label);
  if (label === null) return { ok: false, key: "label", fields: where };
  const before = store.tiles();
  const result = store.claim(cellId, pid, label, now);
  if (result === "taken" || result === "coins" || result === "cooldown") {
    const held = before[cellId];
    return {
      ok: false,
      key: result,
      fields: { ...where, held: result === "taken" && isActive(held, now) ? holder(held) : undefined },
    };
  }
  const did = claimEffects(before, store.tiles(), pid, cellId, now);
  return {
    ok: true,
    key: result === "moved" ? "moved" : "claimed",
    json: { cellId, label },
    fields: {
      label,
      at: at(cellId),
      from: did.from === null ? undefined : at(did.from),
      renamed: did.renamedFrom ?? undefined,
      lifted: people(did.lifted),
      dropped: people(did.dropped),
    },
  };
});

const postCollect = action("collect", (pid, _fields, now) => {
  const { paid } = store.collect(pid, now);
  return {
    ok: true,
    key: paid > 0 ? "collected" : "nothing-to-collect",
    json: { paid },
    fields: { paid, coins: store.me(pid, now).coins },
  };
});

const postUpgrade = action("upgrade", (pid, _fields, now) => {
  const result = store.upgrade(pid, now);
  if (result !== "upgraded") return { ok: false, key: result };
  const me = store.me(pid, now);
  return { ok: true, key: "upgraded", json: { level: me.level }, fields: { at: me.cellId === null ? undefined : at(me.cellId), level: me.level, coins: me.coins } };
});

const postRenew = action("renew", (pid, fields, now) => {
  const hours = validHours(fields.hours);
  if (hours === null) return { ok: false, key: "hours", fields: { hours: cut(fields.hours) } };
  const result = store.renew(pid, hours, now);
  if (result !== "renewed") return { ok: false, key: result, fields: { hours } };
  const me = store.me(pid, now);
  return {
    ok: true,
    key: "renewed",
    json: { leaseEndsAt: me.leaseEndsAt },
    fields: { at: me.cellId === null ? undefined : at(me.cellId), hours, until: me.leaseEndsAt, coins: me.coins },
  };
});

// Help one neighbour an hour: +50 to them, +20 to you, one transaction.
const postHelp = action("help", (pid, fields, now) => {
  const cellId = validCell(fields.cellId);
  if (cellId === null) return { ok: false, key: "cell", fields: { cell: cut(fields.cellId) } };
  const them = store.tiles()[cellId];
  const result = store.help(pid, cellId, now);
  if (result !== "helped") return { ok: false, key: result, fields: { to: at(cellId) } };
  const me = store.me(pid, now);
  return {
    ok: true,
    key: "helped",
    json: { cellId },
    fields: { at: me.cellId === null ? undefined : at(me.cellId), to: at(cellId), helped: holder(them) },
  };
});

// Static files from a fixed root, never outside it.
async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  const base = resolve(root);
  const file = resolve(base, normalize(rel));
  const type = TYPES[extname(file).toLowerCase()];
  if (!file.startsWith(base + sep) || !type) return notFound(res);
  try {
    const data = await readFile(file);
    const fresh = type.startsWith("text/javascript") || type.startsWith("text/css");
    res.writeHead(200, { "Content-Type": type, "Cache-Control": fresh ? "no-cache" : "public, max-age=300" });
    res.end(data);
  } catch {
    notFound(res);
  }
}

// Markdown under docs/, rendered: only a fixed shape of path, never outside.
async function serveDoc(res: ServerResponse, rel: string): Promise<void> {
  if (!/^docs\/[a-z0-9/-]+\.md$/.test(rel) || rel.includes("..")) return notFound(res);
  try {
    send(res, 200, "text/html; charset=utf-8", renderDoc(rel, "Skyline: decision record"));
  } catch {
    notFound(res);
  }
}

const notFound = (res: ServerResponse): void => send(res, 404, "text/plain; charset=utf-8", "Not found");

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/" && (req.method === "GET" || req.method === "HEAD")) {
    const pid = identify(req, res);
    const now = new Date();
    log("page", { who: who(pid), new: res.hasHeader("Set-Cookie") || undefined });
    // Loading the page is a visit: it's where "welcome back" and "your lease
    // ended" are told, once.
    const visit = store.visit(pid, now);
    if (visit.welcome) log("welcome", { who: who(pid), coins: visit.welcome });
    if (visit.expired) log("expired.seen", { who: who(pid) });
    if (logExpired(store.takeExpired(), now)) broadcast(now);
    const notice = url.searchParams.get("notice");
    const tiles = store.tiles();
    const myLabel = tiles.find((t) => t.claimerId === pid && isActive(t, now))?.label ?? store.label(pid) ?? "";
    const html = renderBoard(view(pid, now, visit), myLabel, {
      notice: isNotice(notice) ? notice : null,
      version,
    });
    return send(res, 200, "text/html; charset=utf-8", html);
  }
  if (path === "/claim" && req.method === "POST") return postClaim(req, res);
  if (path === "/collect" && req.method === "POST") return postCollect(req, res);
  if (path === "/upgrade" && req.method === "POST") return postUpgrade(req, res);
  if (path === "/renew" && req.method === "POST") return postRenew(req, res);
  if (path === "/help" && req.method === "POST") return postHelp(req, res);
  if (path === "/events" && req.method === "GET") return openStream(req, res);
  if (path === "/readme") return redirect(res, "/readme/");
  if (path === "/readme/" && (req.method === "GET" || req.method === "HEAD")) {
    return send(res, 200, "text/html; charset=utf-8", renderReadme());
  }
  if (path.startsWith("/readme/docs/") && path.endsWith(".md")) return serveDoc(res, path.slice("/readme/".length));
  if (path.startsWith("/readme/docs/")) return serveFile(res, "docs", path.slice("/readme/docs/".length));
  if (path === "/style.css") return serveFile(res, "public", "style.css");
  if (path === "/app.js") return serveFile(res, "public", "app.js");
  if (path === "/diff.js") return serveFile(res, "public", "diff.js");
  // the artwork and the font the stylesheet loads (the font's licence too)
  if (path.startsWith("/art/") || path.startsWith("/fonts/")) return serveFile(res, "public", path.slice(1));
  notFound(res);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log("error", { method: req.method ?? "", path: (req.url ?? "").split("?")[0], message });
    console.error(err);
    if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Something went wrong");
    else res.end();
  });
}).listen(PORT, "0.0.0.0", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const now = new Date();
  log("start", { port, db: DB_PATH, held: store.tiles().filter((t) => isActive(t, now)).length });
});

// Fly sends SIGTERM before stopping the machine (a redeploy, or no traffic).
// Ending the streams first makes every page reconnect at once instead of
// hanging on a dead connection; closing the database flushes its WAL.
function shutdown(signal: string): void {
  log("shutdown", { signal: raw(signal), open: streams.size });
  for (const { res } of streams) res.end();
  streams.clear();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // close() waits for every socket to go quiet, and a stream the browser
  // dropped can hold its socket for seconds, close to Fly's kill timeout, so
  // the database would never be closed. Every write is synchronous and
  // already committed, so nothing is cut short by closing them now.
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
