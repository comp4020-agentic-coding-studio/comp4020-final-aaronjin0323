import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { VISITOR_COLOURS } from "../public/recipes.js";
import { openStore } from "./db.ts";
import { MARK, renderMuseum, SHELL } from "./html.ts";
import { log, raw, who } from "./log.ts";
import { renderDoc, renderReadme } from "./readme.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const ONE_YEAR = 60 * 60 * 24 * 365;
const PID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DB_PATH = process.env.DB_PATH ?? "./.data/museum.db";
const store = openStore(DB_PATH);

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

// --- presence (filled in with the stream) ---

function presentPids(): string[] {
  return [];
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

export const sendJson = (res: ServerResponse, status: number, value: unknown): void =>
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
  log("shutdown", { signal: raw(signal) });
  server.close(() => {
    store.close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
