// The museum's server: the page, the README, the routes and the stream.
// Bare node:http (ADR 22); every rule about what may change lives in the
// store (src/db.ts), and this file only reads requests and sends answers.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { marked } from "marked";
import { openStore } from "./db.ts";
// @ts-ignore -- plain JS module shared with the page
import { checkGesture } from "../public/fountain.js";
import { log } from "./log.ts";
import { renderListing } from "./html.ts";
import { createHall } from "./hall.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const DB_PATH = process.env.DB_PATH ?? "./.data/gallery.db";
const PUBLIC = resolve("public");
const HEARTBEAT_MS = 15_000;
const POINTER_TTL_MS = 4_000;
const POINTER_EVERY_MS = 100;

if (DB_PATH !== ":memory:") {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(resolve(DB_PATH, ".."), { recursive: true });
}
const store = openStore(DB_PATH);

// ---- visitors: a cookie, and nothing else
const COOKIE = "pid";
function visitorOf(req: IncomingMessage, res: ServerResponse) {
  const m = /(?:^|;\s*)pid=([0-9a-f-]{36})/.exec(req.headers.cookie ?? "");
  const v = store.visitor(m ? m[1] : null, Date.now());
  if (v.isNew || !m) {
    res.setHeader("Set-Cookie", `${COOKIE}=${v.pid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${PRODUCTION ? "; Secure" : ""}`);
    log("visitor", { tag: v.tag, name: v.name });
  }
  return v;
}

// ---- the stream: every open page, who it is, and the state it last got
type Client = { res: ServerResponse; pid: string; tag: string; welcome?: unknown };
const clients = new Set<Client>();
type Aim = { ball: string; v: number[] };
const pointers = new Map<string, { tag: string; name: string; colour: number; p: number[]; aim?: Aim; at: number }>();

const send = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function stateFor(c: Client, base: ReturnType<typeof store.state>) {
  return { ...base, you: store.who(c.pid), serverTime: new Date().toISOString() };
}
function broadcast() {
  const base = store.state([...clients].map((c) => c.pid));
  for (const c of clients) send(c.res, "state", stateFor(c, base));
}
let pointerTimer: NodeJS.Timeout | null = null;
function pointersSoon() {
  if (pointerTimer) return;
  pointerTimer = setTimeout(() => {
    pointerTimer = null;
    const now = Date.now();
    for (const [k, p] of pointers) if (now - p.at > POINTER_TTL_MS) pointers.delete(k);
    const list = [...pointers.values()].map(({ tag, name, colour, p, aim }) => ({ tag, name, colour, p, ...(aim ? { aim } : {}) }));
    for (const c of clients) send(c.res, "pointers", list);
  }, POINTER_EVERY_MS);
}
// ---- the hall's streams: robots' snapshots, the floor, and your own
// collection, on every change (ADR 24, 25)
const hall = createHall(store);
const hallClients = new Set<Client>();
const HALL_TICK_MS = 50;
const HALL_STREAMS_PER_VISITOR = 4;
const BODY_MAX = 4096;
function hallBroadcast() {
  const now = Date.now();
  const robots = hall.view((pid) => store.who(pid) ?? { tag: "", name: "Someone", colour: 0 }, now);
  const artifacts = hall.floor();
  const news = hall.news(); // what just happened, sent once, to everyone
  for (const c of hallClients) {
    const mine: Record<string, unknown> = { home: hall.homeOf(c.pid), collection: store.collection(c.pid), display: store.displayOf(c.pid) };
    // how their join went, once, in the first event of their stream
    if (c.welcome) {
      mine.welcome = c.welcome;
      delete c.welcome;
    }
    send(c.res, "hall", { robots, artifacts, news, mine, you: store.who(c.pid), serverTime: now });
  }
}
// the server sees every touch: each tick walks moving robots along their steps
setInterval(() => {
  if (hall.tick(Date.now())) hallBroadcast();
}, HALL_TICK_MS).unref();

setInterval(() => {
  for (const c of [...clients, ...hallClients]) c.res.write(": beat\n\n");
}, HEARTBEAT_MS).unref();

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

const page = () => readFileSync(join(PUBLIC, "index.html"), "utf8").replace("<!--museum-->", renderListing(store.state([])));
const readme = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About the Impossible Museum</title><link rel="stylesheet" href="/readme.css"></head><body><main class="readme"><p><a href="/">Back to the museum</a></p>${marked.parse(readFileSync("README.md", "utf8"), { async: false })}</main></body></html>`;

const isPointer = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.abs(p[0]) <= 8 && Math.abs(p[2]) <= 8 && p[1] >= 0 && p[1] <= 4;
/** An aim is a flick being made: its ball and speed, checked as a flick is (ADR 23). */
function aimOf(a: unknown): Aim | null {
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).some((k) => k !== "ball" && k !== "v")) return null;
  const r = checkGesture({ kind: "flick", ...(a as object), at: 0 });
  return r.ok ? { ball: (r.gesture as any).ball, v: (r.gesture as any).v } : null;
}
const idIn = (path: string, re: RegExp) => {
  const m = re.exec(path);
  return m ? Number(m[1]) : null;
};

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (req.method === "GET" || req.method === "HEAD") {
    if (path === "/") {
      visitorOf(req, res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(page());
    }
    if (path === "/hall/") {
      visitorOf(req, res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(readFileSync(join(PUBLIC, "hall.html"), "utf8"));
    }
    if (path === "/hall/displays") {
      const d = store.directory(url.searchParams.get("before"));
      return d.ok ? json(res, 200, { entries: d.entries, next: d.next }) : refuse(res, d);
    }
    if (path === "/hall/events") {
      const v = visitorOf(req, res);
      if ([...hallClients].filter((c) => c.pid === v.pid).length >= HALL_STREAMS_PER_VISITOR)
        return refuse(res, { status: 429, error: "too-many-streams", message: `At most ${HALL_STREAMS_PER_VISITOR} hall pages open at once` });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const c: Client = { res, pid: v.pid, tag: v.tag };
      hallClients.add(c);
      c.welcome = hall.join(v.pid, Date.now());
      log("hall-open", { tag: v.tag, open: hallClients.size });
      hallBroadcast();
      req.on("close", () => {
        hallClients.delete(c);
        hall.leave(v.pid, Date.now());
        log("hall-close", { tag: v.tag, open: hallClients.size });
        hallBroadcast();
      });
      return;
    }
    if (path === "/readme/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readme());
    }
    if (path === "/me") {
      const v = visitorOf(req, res);
      return json(res, 200, { tag: v.tag, name: v.name, colour: v.colour });
    }
    if (path === "/events") {
      const v = visitorOf(req, res);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const c: Client = { res, pid: v.pid, tag: v.tag };
      clients.add(c);
      log("stream-open", { tag: v.tag, open: clients.size });
      broadcast();
      req.on("close", () => {
        clients.delete(c);
        if (![...clients].some((x) => x.pid === c.pid)) pointers.delete(c.tag);
        log("stream-close", { tag: v.tag, open: clients.size });
        broadcast();
        pointersSoon();
      });
      return;
    }
    if (path === "/archive") {
      const before = url.searchParams.get("before");
      if (!before || !/^\d+$/.test(before)) return refuse(res, { status: 400, error: "bad-before", message: "before is a loop id" });
      return json(res, 200, store.archivedBefore(Number(before)));
    }
    const ex = idIn(path, /^\/exhibits\/(\d+)$/);
    if (ex !== null) {
      const h = store.history(ex);
      return h.ok ? json(res, 200, { exhibit: h.exhibit, versions: h.versions }) : refuse(res, h);
    }
    if (serveStatic(path, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "GET, POST" });
    return res.end();
  }
  if (crossSite(req)) return refuse(res, { status: 403, error: "cross-origin", message: "Posts come from the museum's own page" });
  const body = await bodyOf(req);
  if (body === TOO_LARGE) return refuse(res, { status: 413, error: "too-large", message: `A request body is at most ${BODY_MAX} bytes` });
  if (!body) return refuse(res, { status: 400, error: "bad-json", message: "The body is a JSON object" });
  const v = visitorOf(req, res);
  const now = Date.now();
  const done = (r: { ok: boolean } & Record<string, any>, event: string, fields: Record<string, unknown> = {}) => {
    if (!r.ok) {
      log("refused", { event, tag: v.tag, error: r.error });
      return refuse(res, r as any);
    }
    log(event, { tag: v.tag, ...fields });
    json(res, 200, r);
    broadcast();
  };

  if (path === "/pointer") {
    const aim = body.aim === undefined ? undefined : aimOf(body.aim);
    if (aim === null || (aim && body.p === null)) return refuse(res, { status: 400, error: "bad-aim", message: "aim is { ball, v } for a flick, with a pointer" });
    if (body.p === null) pointers.delete(v.tag);
    else if (isPointer(body.p)) pointers.set(v.tag, { tag: v.tag, name: v.name, colour: v.colour, p: body.p.map((x) => Math.round(x * 1000) / 1000), aim, at: now });
    else return refuse(res, { status: 400, error: "bad-pointer", message: "p is [x, y, z] in the room, or null" });
    pointersSoon();
    return json(res, 200, { ok: true });
  }
  if (path === "/hall/launch") {
    const r = hall.launch(v.pid, body, now);
    if (!r.ok) {
      log("refused", { event: "launch", tag: v.tag, error: r.error });
      // a stale launch is answered with the robot, so the page can resync
      return json(res, r.status, { error: r.error, message: r.message, ...("robot" in r ? { robot: r.robot } : {}) });
    }
    json(res, 200, { robot: { ...store.who(v.pid), ...r.robot } });
    return hallBroadcast();
  }
  if (path === "/hall/display") {
    if (Object.keys(body).some((k) => k !== "slots" && k !== "was") || !("was" in body))
      return refuse(res, { status: 400, error: "bad-display", message: "A display change is { slots, was }: the new layout and the one it was made from" });
    const r = store.arrange(v.pid, body.slots, body.was, now);
    if (!r.ok) {
      log("refused", { event: "display", tag: v.tag, error: r.error });
      return json(res, r.status, { error: r.error, message: r.message, ...("display" in r ? { display: r.display } : {}) });
    }
    log("display", { tag: v.tag, slots: r.display.join(",") });
    json(res, 200, r);
    return hallBroadcast();
  }
  if (path === "/me") return done(store.rename(v.pid, body.name), "rename", { name: body.name });
  if (path === "/stage/gesture") return done(store.addGesture(v.pid, body.gesture, now), "gesture", { kind: (body.gesture as any)?.kind });
  if (path === "/stage/undo") return done(store.undo(v.pid), "undo");
  if (path === "/stage/clear") return done(store.clear(v.pid, now), "clear");
  if (path === "/stage/bring-back") return done(store.bringBack(body.archivedId, body.replace === true, now), "bring-back", { archivedId: body.archivedId });
  if (path === "/stage/join") return done(store.join(body.versionId, body.replace === true, now), "join", { versionId: body.versionId });
  if (path === "/publish") return done(store.publish(v.pid, body, now), "publish", { title: body.title, slot: body.slot, exhibitId: body.exhibitId });
  const restore = idIn(path, /^\/exhibits\/(\d+)\/restore$/);
  if (restore !== null) return done(store.restore(restore, body.versionId, v.pid, now), "restore", { exhibitId: restore });
  const display = idIn(path, /^\/exhibits\/(\d+)\/display$/);
  if (display !== null) return done(store.display(display, body.slot, body.replace === true), "display", { exhibitId: display, slot: body.slot });
  const away = idIn(path, /^\/exhibits\/(\d+)\/store$/);
  if (away !== null) return done(store.store(away), "store", { exhibitId: away });
  return refuse(res, { status: 404, error: "not-found", message: "No such route" });
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
  for (const c of [...clients, ...hallClients]) c.res.end();
  server.close();
  server.closeAllConnections();
  store.close();
  process.exit(0);
});
