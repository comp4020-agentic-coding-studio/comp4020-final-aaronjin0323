#!/usr/bin/env node
// Restarts, played for real: this starts and stops its own server on a
// throwaway database, so it never touches a running app or the live arena.
// A visitor banks and carries, then goes through a graceful restart and a
// crash, and comes back with the same cookie.
//
//   node scripts/restart-check.ts
//
// Not in CI (it starts servers). A redeploy on Fly is the same restart, but
// has not been tested there.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const DB = join(mkdtempSync(join(tmpdir(), "restart-")), "arena.db");
let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ChildProcess | null = null;
async function start() {
  server = spawn(process.execPath, ["src/server.ts"], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: "" }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(BASE);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("the server didn't start");
}
async function stop(signal: "SIGTERM" | "SIGKILL") {
  const s = server!;
  const gone = new Promise((r) => s.once("exit", r));
  s.kill(signal);
  await gone;
}

// a visitor: a cookie and a stream, playing by launches alone
let cookie = "";
let last: any = null;
const ctl = { now: new AbortController() };
let seq = 0;
async function open() {
  ctl.now = new AbortController();
  last = null;
  const r = await fetch(BASE + "/events", { headers: cookie ? { cookie } : {}, signal: ctl.now.signal });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of r.body as any) {
        buf += dec.decode(chunk, { stream: true });
        for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
          const m = /^data: (.*)$/m.exec(buf.slice(0, i));
          if (m) last = JSON.parse(m[1]);
        }
      }
    } catch {}
  })();
  while (!last) await sleep(20);
}
const me = () => last.robots.find((r: any) => r.tag === last.you.tag);
const here = () => A.advance(me(), Date.now());
async function launchTo(to: number[], power = 1) {
  const p = here().pos;
  seq = Math.max(seq, me().seq) + 1;
  await fetch(BASE + "/launch", { method: "POST", headers: { cookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ dir: [to[0] - p[0], to[1] - p[1]], power, seq }) });
}
/** Launches at `to` until `done`, at most ms. */
async function chase(to: () => number[], done: () => boolean, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end && !done(); await sleep(250)) await launchTo(to());
  return done();
}
const nearest = () => [...last.artifacts].sort((a, b) => Math.hypot(a.pos[0] - here().pos[0], a.pos[1] - here().pos[1]) - Math.hypot(b.pos[0] - here().pos[0], b.pos[1] - here().pos[1]))[0].pos;
const banked = () => Object.values(last.mine.collection as Record<string, number>).reduce((a, b) => a + b, 0);

await start();
try {
  await open();
  check(await chase(nearest, () => me().carrying.length >= 1), "picks an artifact up by launching at it");
  check(await chase(() => A.VAULT, () => banked() >= 1), "banks it by flying through the vault");
  check(await chase(nearest, () => me().carrying.length >= 1), "picks up another");
  const bank = banked();
  const before = last.vault;

  await stop("SIGTERM");
  await start();
  await open();
  await sleep(200);
  check(me().carrying.length >= 1, "graceful restart, back in time: still carrying");
  check(banked() === bank && last.vault === before, "the bank and the vault total survive", `${banked()}, ${last.vault}`);

  ctl.now.abort();
  await sleep(100);
  await stop("SIGKILL");
  await start();
  await sleep(A.GRACE_MS + 1600);
  await open();
  await sleep(200);
  check(me().carrying.length === 0, "crash, away past the grace: the cargo left the robot");
  check(banked() === bank, "the bank survives a crash, same cookie, same visitor");
  const n = last.artifacts.length;
  await sleep(1500);
  check(last.artifacts.length === n, "the cargo came back once");
} finally {
  ctl.now.abort();
  await stop("SIGKILL").catch(() => {});
}
process.exit(failures ? 1 : 0);
