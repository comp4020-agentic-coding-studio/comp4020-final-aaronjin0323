import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { boardView, isNotice, renderBoard } from "./board.ts";
import { isDormant, type Landmark, N, openStore, TILES } from "./db.ts";
import { at, claimEffects, dormancyDrops, holder, log, people, quote, raw, who } from "./log.ts";
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
// whole board as its own visitor sees it: "mine" depends on who's asking, and
// a pid never leaves the server. A full board, not a diff, means a stream
// that drops and reconnects is back in sync from its first event.
// Both can be shortened by the environment so a test can watch them happen.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 15_000; // Fly's proxy closes connections idle ~30-60 s
const SWEEP_MS = Number(process.env.SWEEP_MS) || 60_000; // dormancy is time-based, so look for changes each minute

type Stream = { pid: string; res: ServerResponse };
const streams = new Set<Stream>();

// Every board carries a version that goes up with each change, so a page
// that gets the same moment twice (a claim's response and its stream event)
// or out of order can keep the newest. Seeded from the clock so it keeps
// rising across a restart, when every page reconnects.
let version = Date.now();
const view = (pid: string, now: Date) => boardView(store.tiles(), pid, now, store.landmarks());
const versioned = (pid: string, now: Date) => ({ ...view(pid, now), version });

// A landmark just raised, as the one broadcast after it carries it. Only the
// newest if two were finished by the same change; both are in `landmarks`.
type Raised = { cellId: number; label: string; raisers: string[] };

function sendBoard(stream: Stream, now: Date, raised?: Raised): void {
  const board = raised ? { ...versioned(stream.pid, now), raised } : versioned(stream.pid, now);
  stream.res.write(`event: board\ndata: ${JSON.stringify(board)}\n\n`);
}

// Called after every change, and only then. Every change that can lift a
// tower (a claim, a visit that wakes a tile) broadcasts, so this is where a
// landmark is noticed: in the same synchronous turn as the change, so no other
// request comes between them. One just raised is logged and goes out on this
// broadcast only: a stream that connects later gets it in `landmarks` but
// never as `raised`, so a reconnecting page doesn't celebrate it again.
function broadcast(now = new Date()): void {
  version = Math.max(version + 1, Date.now());
  const raised = store.raise(now);
  for (const l of raised) logLandmark(l);
  const last = raised.at(-1);
  const news = last ? { cellId: last.cellId, label: last.label, raisers: last.raisers } : undefined;
  for (const stream of streams) sendBoard(stream, now, news);
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
  // An open page is a visit. A holder's visit changes what everyone else sees
  // of their tile (it wakes, or its safeUntil moves), so they all hear it.
  if (visit(pid, now)) broadcast(now);
  else sendBoard(stream, now);
  req.on("close", () => {
    // A shutdown already cleared the set; don't log every stream twice.
    if (!streams.delete(stream)) return;
    log("stream.close", { who: who(pid), open: streams.size, secs: Math.round((Date.now() - now.getTime()) / 1000) });
  });
}

// Marks a visit. True if the visitor holds a tile, so its safeUntil (and
// maybe its state) just changed for everyone else: the caller broadcasts, or
// pages would count down to a time the server no longer holds, and a page
// reconnecting would be sent the new safeUntil under the old version and keep
// its stale one.
function visit(pid: string, now: Date): boolean {
  const holds = store.tiles().some((t) => t.claimerId === pid);
  if (store.touch(pid, now)) logWake(pid);
  return holds;
}

function logWake(pid: string): void {
  const tile = store.tiles().find((t) => t.claimerId === pid);
  log("wake", { who: who(pid), at: tile ? at(tile.id) : undefined, label: tile?.label });
}

// Comments keep idle streams under the proxy's timeout; the browser ignores
// them.
setInterval(() => {
  for (const { res } of streams) res.write(": hb\n\n");
}, HEARTBEAT_MS).unref();

// Once a minute: holders with an open page count as visiting (which moves
// their safeUntil), and if that happened or any tile crossed into dormancy
// since the last look, every open page hears about it.
// Only the sweep logs a tile going dormant: a claim or a wake changes the key
// too, and those log themselves.
let lastDormant = "";
const dormantKey = (now: Date): string =>
  store
    .tiles()
    .filter((t) => isDormant(t, now))
    .map((t) => t.id)
    .join(",");
setInterval(() => {
  const now = new Date();
  const tiles = store.tiles();
  let moved = false; // some open page's holder had their safeUntil pushed on
  for (const pid of new Set([...streams].map((s) => s.pid))) {
    if (tiles.some((t) => t.claimerId === pid)) moved = true;
    store.touch(pid, now);
  }
  const key = dormantKey(now);
  const crossed = key !== lastDormant;
  if (crossed) {
    const was = new Set(lastDormant.split(","));
    for (const t of store.tiles()) {
      if (isDormant(t, now) && !was.has(String(t.id))) {
        log("dormant", { at: at(t.id), holder: holder(t), dropped: people(dormancyDrops(tiles, t.id)) });
      }
    }
    lastDormant = key;
  }
  // The clock alone only lowers towers; a visit above that woke one is
  // `moved`, so broadcast() looks for landmarks whenever one could be new.
  if (crossed || moved) broadcast(now);
}, SWEEP_MS).unref();
lastDormant = dormantKey(new Date());
// A tower already standing at 8 when the server starts (say, a database from
// before migration 3) is recorded now. It's logged, not celebrated: nobody
// watched it happen, and the first broadcast shouldn't replay it.
for (const l of store.raise(new Date())) logLandmark(l);

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

// A cross-site form can't claim on someone's behalf: a browser always sends
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

async function postClaim(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Script clients ask for JSON and get real status codes; a plain form always
  // gets a 303 back to the board, where the notice says what happened.
  const wantsJson = (req.headers.accept ?? "").includes("application/json");
  const fail = (status: number, notice: string): void =>
    wantsJson ? sendJson(res, status, { error: notice }) : redirect(res, `/?notice=${notice}`);
  // A refusal names who tried, what, and why; any typed text is cut short.
  const cut = (v: unknown): string | undefined =>
    v === undefined ? undefined : Array.from(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 40).join("");
  const refused = (pid: string | null, status: number, reason: string, fields: Record<string, unknown> = {}): void => {
    const tile = validCell(fields.cellId);
    log("claim.refused", {
      who: pid ? who(pid) : raw("-"),
      status,
      reason: raw(reason),
      at: tile === null ? undefined : at(tile),
      cell: tile === null ? cut(fields.cellId) : undefined,
      label: cut(fields.label),
      held: reason === "taken" && tile !== null ? holder(store.tiles()[tile]) : undefined,
    });
  };

  if (!sameOrigin(req)) {
    const cookie = cookies(req).pid;
    refused(cookie && PID.test(cookie) ? cookie : null, 403, "cross-site");
    return send(res, 403, "text/plain; charset=utf-8", "Cross-site claim refused");
  }
  const pid = identify(req, res);
  const body = await readBody(req);
  if (body === null) {
    refused(pid, 413, "too-large");
    return send(res, 413, "text/plain; charset=utf-8", "Too large");
  }

  const fields = parseFields(req, body);
  const cellId = validCell(fields.cellId);
  if (cellId === null) {
    refused(pid, 400, "cell", fields);
    return fail(400, "cell");
  }
  const label = validLabel(fields.label);
  if (label === null) {
    refused(pid, 400, "label", fields);
    return fail(400, "label");
  }

  const now = new Date();
  const before = store.tiles();
  if (store.claim(cellId, pid, label, now) === "taken") {
    refused(pid, 409, "taken", fields);
    return fail(409, "taken");
  }
  const after = store.tiles();
  const did = claimEffects(before, after, pid, cellId, now);
  log("claim", {
    who: who(pid),
    label,
    at: at(cellId),
    from: did.from === null ? undefined : at(did.from),
    renamed: did.renamedFrom ?? undefined,
    took: did.tookFrom ? holder(did.tookFrom) : undefined,
    lifted: people(did.lifted),
    dropped: people(did.dropped),
  });
  broadcast(now);
  lastDormant = dormantKey(now);
  // A script client gets the board as the claimer now sees it, so the page
  // updates at once without waiting for its stream.
  if (wantsJson) return sendJson(res, 200, { cellId, label, board: versioned(pid, now) });
  redirect(res, "/?notice=claimed");
}

// --- waves (docs/adr/0004) ---
// A live gesture between neighbours: checked like a claim, pushed only to the
// person waved at, and never stored. The rate limit is held in memory, keyed
// by both pids, so a restart forgets it, which costs nothing.
const WAVE_EVERY_MS = 10_000;
const lastWave = new Map<string, number>();

// 8-neighbours: one step in any direction, never wrapping round an edge.
const besides = (a: number, b: number): boolean =>
  a !== b && Math.abs(Math.floor(a / N) - Math.floor(b / N)) <= 1 && Math.abs((a % N) - (b % N)) <= 1;

async function postWave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const refused = (pid: string | null, status: number, reason: string, target: number | null = null): void => {
    log("wave.refused", {
      who: pid ? who(pid) : raw("-"),
      status,
      reason: raw(reason),
      to: target === null ? undefined : at(target),
    });
    if (status === 403) return send(res, 403, "text/plain; charset=utf-8", "Cross-site wave refused");
    if (status === 413) return send(res, 413, "text/plain; charset=utf-8", "Too large");
    sendJson(res, status, { error: reason });
  };

  if (!sameOrigin(req)) {
    const cookie = cookies(req).pid;
    return refused(cookie && PID.test(cookie) ? cookie : null, 403, "cross-site");
  }
  const pid = identify(req, res);
  const body = await readBody(req);
  if (body === null) return refused(pid, 413, "too-large");
  const target = validCell(parseFields(req, body).cellId);
  if (target === null) return refused(pid, 400, "cell");

  const tiles = store.tiles();
  const mine = tiles.find((t) => t.claimerId === pid);
  if (!mine) return refused(pid, 409, "no-tile", target);
  // A faded neighbour is still a person, so they can be waved at.
  const them = tiles[target];
  if (them.claimerId === null || them.claimerId === pid || !besides(mine.id, target)) {
    return refused(pid, 400, "not-neighbour", target);
  }
  const pair = `${pid} ${them.claimerId}`;
  const now = Date.now();
  if (now - (lastWave.get(pair) ?? -Infinity) < WAVE_EVERY_MS) return refused(pid, 429, "too-soon", target);
  lastWave.set(pair, now);
  for (const [key, when] of lastWave) if (now - when >= WAVE_EVERY_MS) lastWave.delete(key);

  // From a cell and the label already on the board: nothing typed with the
  // wave, and no pid.
  const wave = JSON.stringify({ from: mine.id, label: mine.label ?? "" });
  for (const stream of streams) {
    if (stream.pid === them.claimerId) stream.res.write(`event: wave\ndata: ${wave}\n\n`);
  }
  log("wave", { who: who(pid), at: at(mine.id), to: who(them.claimerId) });
  sendJson(res, 200, { ok: true });
}

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
    // Loading the page is a visit: it keeps your tile from going dormant, or
    // wakes it if it already had.
    log("page", { who: who(pid), new: res.hasHeader("Set-Cookie") || undefined });
    if (visit(pid, now)) broadcast(now);
    const notice = url.searchParams.get("notice");
    const displaced = store.takeDisplacement(pid) !== null;
    if (displaced) log("displaced.seen", { who: who(pid) });
    const tiles = store.tiles();
    const myLabel = tiles.find((t) => t.claimerId === pid)?.label ?? "";
    const html = renderBoard(boardView(tiles, pid, now, store.landmarks()), myLabel, {
      notice: isNotice(notice) ? notice : null,
      displaced,
      version,
    });
    return send(res, 200, "text/html; charset=utf-8", html);
  }
  if (path === "/claim" && req.method === "POST") return postClaim(req, res);
  if (path === "/wave" && req.method === "POST") return postWave(req, res);
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
  log("start", { port, db: DB_PATH, dormant: lastDormant ? lastDormant.split(",").length : 0 });
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
