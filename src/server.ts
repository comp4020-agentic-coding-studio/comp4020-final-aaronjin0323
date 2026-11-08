// The arena's server: the page, the README, the stream and one POST. Bare
// node:http; the rules live in the store (src/db.ts) and the arena
// (src/arena.ts), and this file only reads requests and sends answers.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, createReadStream, mkdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { marked } from "marked";
import { openStore } from "./db.ts";
import { log } from "./log.ts";
import { createArena } from "./arena.ts";
import { createPresence } from "./presence.ts";
// @ts-ignore -- plain JS module shared with the page
import { BEAT_MS } from "../public/arena.js";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const DB_PATH = process.env.DB_PATH ?? "./.data/arena.db";
const PUBLIC = resolve("public");
const TICK_MS = 50;
const STREAMS_PER_VISITOR = 4;
const BODY_MAX = 4096;

if (DB_PATH !== ":memory:") mkdirSync(resolve(DB_PATH, ".."), { recursive: true });
const store = openStore(DB_PATH);

// ---- visitors: a cookie, and nothing else
function visitorOf(req: IncomingMessage, res: ServerResponse) {
  const m = /(?:^|;\s*)pid=([0-9a-f-]{36})/.exec(req.headers.cookie ?? "");
  const v = store.visitor(m ? m[1] : null, Date.now());
  if (v.isNew || !m) {
    res.setHeader("Set-Cookie", `pid=${v.pid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${PRODUCTION ? "; Secure" : ""}`);
    log("visitor", { tag: v.tag });
  }
  return v;
}

// ---- the stream: every open page gets every robot, on every change
type Client = { res: ServerResponse; pid: string; tag: string };
const clients = new Set<Client>();
const arena = createArena(store);
function broadcast() {
  const now = Date.now();
  const robots = arena.view(now);
  const artifacts = arena.floor();
  const hits = arena.hits();
  const deliveries = arena.deliveries();
  const exits = arena.exits();
  const vault = store.vaultTotal();
  for (const c of clients) {
    const catalog = store.catalog(c.pid);
    const mine = { catalog, total: Object.values(catalog).reduce((a, b) => a + b, 0), onShow: store.onShow(c.pid), place: arena.placeOf(c.pid) };
    c.res.write(`event: arena\ndata: ${JSON.stringify({ robots, artifacts, hits, deliveries, exits, vault, mine, you: { tag: c.tag }, serverTime: now })}\n\n`);
  }
}
// the server sees every touch: each tick walks moving robots along their steps
setInterval(() => {
  if (arena.tick(Date.now())) broadcast();
}, TICK_MS).unref();
// ---- rooms are shared (ADR 36): who's in each, and where, to everyone there
type RoomClient = { res: ServerResponse; pid: string; tag: string; room: string };
const roomClients = new Map<string, Set<RoomClient>>();
const presence = createPresence();
const revs = new Map<string, number>(); // each open room's layout revision
function roomcast(room: string) {
  const walkers = presence.walkers(room);
  const rev = revs.get(room) ?? 0;
  const now = Date.now();
  for (const c of roomClients.get(room) ?? []) c.res.write(`event: room\ndata: ${JSON.stringify({ walkers, rev, you: { tag: c.tag }, serverTime: now })}\n\n`);
}
const roomStreamsOf = (pid: string) => [...roomClients.values()].reduce((n, set) => n + [...set].filter((c) => c.pid === pid).length, 0);

setInterval(() => {
  // an event, not a comment: a page can't hear a comment, and silence is
  // how it tells that its network has gone
  for (const c of clients) c.res.write("event: beat\ndata: {}\n\n");
  for (const set of roomClients.values()) for (const c of set) c.res.write("event: beat\ndata: {}\n\n");
}, BEAT_MS).unref();

// ---- requests
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const refuse = (res: ServerResponse, r: { status: number; error: string; message: string }) => json(res, r.status, { error: r.error, message: r.message });

const TOO_LARGE = Symbol("too large");
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown> | null | typeof TOO_LARGE> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_MAX) return TOO_LARGE;
    parts.push(chunk as Buffer);
  }
  const text = Buffer.concat(parts).toString("utf8");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** A POST from another site is refused: a browser always says where it came from. */
function crossSite(req: IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
function serveStatic(path: string, res: ServerResponse): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  const file = normalize(join(PUBLIC, decoded));
  if (!file.startsWith(PUBLIC + "/") || decoded.includes("\0")) return false;
  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  const type = TYPES[extname(file)];
  if (!type) return false;
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
  return true;
}

const readme = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About the arena</title><link rel="stylesheet" href="/readme.css"></head><body><main class="readme"><p><a href="/">Back to the arena</a></p>${marked.parse(readFileSync("README.md", "utf8"), { async: false })}</main></body></html>`;

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (req.method === "GET" || req.method === "HEAD") {
    if (path === "/") {
      visitorOf(req, res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(readFileSync(join(PUBLIC, "index.html"), "utf8"));
    }
    if (path === "/readme/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readme());
    }
    if (path === "/events") {
      const v = visitorOf(req, res);
      if ([...clients].filter((c) => c.pid === v.pid).length >= STREAMS_PER_VISITOR)
        return refuse(res, { status: 429, error: "too-many-streams", message: `At most ${STREAMS_PER_VISITOR} pages open at once` });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const c: Client = { res, pid: v.pid, tag: v.tag };
      clients.add(c);
      arena.join(v.pid, Date.now());
      log("open", { tag: v.tag, open: clients.size });
      broadcast();
      req.on("close", () => {
        clients.delete(c);
        arena.leave(v.pid, Date.now());
        log("close", { tag: v.tag, open: clients.size });
        broadcast();
      });
      return;
    }
    if (path === "/room/" || /^\/room\/[0-9a-f]{8}$/.test(path)) {
      visitorOf(req, res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(readFileSync(join(PUBLIC, "room.html"), "utf8"));
    }
    if (path === "/rooms") {
      const r = store.rooms(new URL(req.url ?? "/", "http://x").searchParams.get("before"));
      if (!r.ok) return refuse(res, r);
      // the live counts that give a reason to go (ADR 37): how many, never who
      const playing = arena.view(Date.now()).filter((b: { away?: boolean }) => !b.away).length;
      return json(res, 200, { entries: r.entries.map((e: { tag: string }) => ({ ...e, here: presence.walkers(e.tag).length })), next: r.next, playing });
    }
    const live = /^\/rooms\/([0-9a-f]{8})\/live$/.exec(path);
    if (live) {
      const room = live[1];
      const v = visitorOf(req, res);
      const r = store.roomOf(room);
      if (!r) return refuse(res, { status: 404, error: "no-room", message: "No such room" });
      if (roomStreamsOf(v.pid) >= STREAMS_PER_VISITOR)
        return refuse(res, { status: 429, error: "too-many-streams", message: `At most ${STREAMS_PER_VISITOR} rooms open at once` });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const c: RoomClient = { res, pid: v.pid, tag: v.tag, room };
      let set = roomClients.get(room);
      if (!set) roomClients.set(room, (set = new Set()));
      set.add(c);
      revs.set(room, r.rev);
      presence.join(room, v.tag);
      log("enter", { room, tag: v.tag, here: set.size });
      roomcast(room);
      req.on("close", () => {
        set!.delete(c);
        if (!set!.size) {
          roomClients.delete(room);
          revs.delete(room);
        }
        if (presence.leave(room, v.tag)) log("leave", { room, tag: v.tag });
        roomcast(room);
      });
      return;
    }
    if (path === "/rooms/me") {
      const v = visitorOf(req, res);
      return json(res, 200, { ...store.roomOf(v.tag), mine: true, shelf: store.shelf(v.pid) });
    }
    const roomPath = /^\/rooms\/([0-9a-f]{8})$/.exec(path);
    if (roomPath) {
      const v = visitorOf(req, res);
      const r = store.roomOf(roomPath[1]);
      return r ? json(res, 200, { ...r, mine: roomPath[1] === v.tag }) : refuse(res, { status: 404, error: "no-room", message: "No such room" });
    }
    if (path === "/collection") {
      const v = visitorOf(req, res);
      return json(res, 200, { items: store.shelf(v.pid), catalog: store.catalog(v.pid) });
    }
    if (serveStatic(path, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "GET, POST" });
    return res.end();
  }
  if (crossSite(req)) return refuse(res, { status: 403, error: "cross-origin", message: "Posts come from the arena's own page" });
  const body = await bodyOf(req);
  if (body === TOO_LARGE) return refuse(res, { status: 413, error: "too-large", message: `A request body is at most ${BODY_MAX} bytes` });
  if (!body) return refuse(res, { status: 400, error: "bad-json", message: "The body is a JSON object" });
  if (path === "/room") {
    const who = visitorOf(req, res);
    const saved = store.saveRoom(who.pid, body, Date.now());
    if (!saved.ok) {
      log("refused", { event: "room", tag: who.tag, error: saved.error });
      return refuse(res, saved);
    }
    log("room", { tag: who.tag, rev: saved.rev });
    json(res, 200, { rev: saved.rev });
    if (roomClients.has(who.tag)) {
      revs.set(who.tag, saved.rev);
      roomcast(who.tag);
    }
    return;
  }
  const walking = /^\/rooms\/([0-9a-f]{8})\/walk$/.exec(path);
  if (walking) {
    const room = walking[1];
    const who = visitorOf(req, res);
    const r = presence.walk(room, who.tag, body, Date.now());
    if (!r.ok) {
      if (r.error === "not-in-room" && !store.roomOf(room)) return refuse(res, { status: 404, error: "no-room", message: "No such room" });
      return refuse(res, r);
    }
    json(res, 200, {});
    roomcast(room);
    return;
  }
  if (path !== "/launch") return refuse(res, { status: 404, error: "not-found", message: "No such route" });
  const v = visitorOf(req, res);
  const r = arena.launch(v.pid, body, Date.now());
  if (!r.ok) {
    log("refused", { event: "launch", tag: v.tag, error: r.error });
    // a stale launch is answered with the robot, so the page can resync
    return json(res, r.status, { error: r.error, message: r.message, ...("robot" in r ? { robot: r.robot } : {}) });
  }
  json(res, 200, { robot: { tag: v.tag, ...r.robot } });
  broadcast();
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    log("error", { message: String(e?.message ?? e) });
    if (!res.headersSent) json(res, 500, { error: "server", message: "Something went wrong" });
    else res.end();
  });
});
server.listen(PORT, "0.0.0.0", () => log("listening", { port: PORT, db: DB_PATH }));

process.on("SIGTERM", () => {
  for (const c of clients) c.res.end();
  for (const set of roomClients.values()) for (const c of set) c.res.end();
  server.close();
  server.closeAllConnections();
  store.close();
  process.exit(0);
});
