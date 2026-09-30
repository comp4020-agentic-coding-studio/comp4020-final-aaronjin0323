import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { isNotice, renderBoard } from "./board.ts";
import { allTiles, claim, TILES } from "./db.ts";
import { renderReadme } from "./readme.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PRODUCTION = process.env.NODE_ENV === "production";
const MAX_BODY = 4096;
const ONE_YEAR = 60 * 60 * 24 * 365;
const PID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
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

  if (!sameOrigin(req)) return send(res, 403, "text/plain; charset=utf-8", "Cross-site claim refused");
  const pid = identify(req, res);
  const body = await readBody(req);
  if (body === null) return send(res, 413, "text/plain; charset=utf-8", "Too large");

  const fields = parseFields(req, body);
  const cellId = validCell(fields.cellId);
  if (cellId === null) return fail(400, "cell");
  const label = validLabel(fields.label);
  if (label === null) return fail(400, "label");

  if (claim(cellId, pid, label) === "taken") return fail(409, "taken");
  if (wantsJson) return sendJson(res, 200, { cellId, label });
  redirect(res, "/?notice=claimed");
}

// Static files from a fixed root, never outside it.
async function serveFile(res: ServerResponse, root: string, rel: string): Promise<void> {
  const base = resolve(root);
  const file = resolve(base, normalize(rel));
  const type = TYPES[extname(file).toLowerCase()];
  if (!file.startsWith(base + sep) || !type) return notFound(res);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=300" });
    res.end(data);
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
    const notice = url.searchParams.get("notice");
    return send(res, 200, "text/html; charset=utf-8", renderBoard(allTiles(), pid, isNotice(notice) ? notice : null));
  }
  if (path === "/claim" && req.method === "POST") return postClaim(req, res);
  if (path === "/readme") return redirect(res, "/readme/");
  if (path === "/readme/" && (req.method === "GET" || req.method === "HEAD")) {
    return send(res, 200, "text/html; charset=utf-8", renderReadme());
  }
  if (path.startsWith("/readme/docs/")) return serveFile(res, "docs", path.slice("/readme/docs/".length));
  if (path === "/style.css") return serveFile(res, "public", "style.css");
  notFound(res);
}

createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Something went wrong");
    else res.end();
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${PORT}`);
});
