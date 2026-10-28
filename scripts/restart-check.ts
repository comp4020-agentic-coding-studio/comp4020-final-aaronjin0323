#!/usr/bin/env node
// Restarts, played for real (ADR 27): this starts and stops its own server
// processes on a throwaway database, so it never touches a running app or
// the live museum. One visitor collects, delivers and arranges a display
// through the real routes, then carries an artifact through:
//
//   1. a graceful restart (SIGTERM), coming back within the grace:
//      still carrying, collection and display intact;
//   2. a crash (SIGKILL), staying away past the grace:
//      the cargo is back on the floor, once; collection and display intact;
//   3. a new session with the same cookie: the same visitor.
//
//   node scripts/restart-check.ts
//
// Not in CI (it needs to start servers); run it before committing a change
// to the store, the hall or the server. A redeploy on Fly is the same
// restart, but has not been tested there.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// @ts-ignore -- plain JS module shared with the page
import * as H from "../public/hall.js";

const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const DB = join(mkdtempSync(join(tmpdir(), "restart-")), "gallery.db");
let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- a server process of our own
let server: ChildProcess | null = null;
async function start() {
  server = spawn(process.execPath, ["src/server.ts"], { env: { ...process.env, PORT: String(PORT), DB_PATH: DB, NODE_ENV: "" }, stdio: ["ignore", "pipe", "inherit"] });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(BASE + "/me");
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
  server = null;
}

// ---- a visitor: a cookie jar and the hall's stream
function visitor(cookie = "") {
  const req = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(BASE + path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const post = async (path: string, body: unknown) => {
    const r = await req(path, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  let last: any = null, lastAt = 0, first: any = null, ctl: AbortController | null = null;
  async function open() {
    ctl = new AbortController();
    first = null;
    const r = await req("/hall/events", { signal: ctl.signal });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const data = /^data: (.+)$/m.exec(buf.slice(0, i))?.[1];
            buf = buf.slice(i + 2);
            if (data) {
              last = JSON.parse(data);
              lastAt = Date.now();
              first ??= last;
            }
          }
        }
      } catch {
        /* closed */
      }
    })();
    for (let i = 0; i < 50 && !first; i++) await sleep(50);
    return first;
  }
  const close = () => ctl?.abort();
  const me = () => last.robots.find((r: any) => r.tag === last.you.tag);
  const now = () => H.advance(me(), Date.now() + (last.serverTime - lastAt));
  let seq = 0;
  const wait = async (ok: (d: any) => boolean, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (last && ok(last)) return true;
    return false;
  };
  /** As a player would: one launch if it reaches, else full-power hops towards it. */
  async function reach(target: number[], ok: (p: number[]) => boolean) {
    for (let hop = 0; hop < 6; hop++) {
      await wait(() => now().vel[0] === 0 && now().vel[1] === 0);
      const from = now();
      seq = Math.max(seq, from.seq);
      const dir = [target[0] - from.pos[0], target[1] - from.pos[1]];
      let power = 1, hits = false;
      for (let p = 0.2; p <= 1.0001; p += 0.05) {
        if ((H.path(from, { dir, power: Math.min(1, p), seq: 0 }) as number[][]).some(ok)) {
          power = Math.min(1, p);
          hits = true;
          break;
        }
      }
      await post("/hall/launch", { dir, power, seq: ++seq });
      if (hits) return true;
    }
    return false;
  }
  return { req, post, open, close, me, now, wait, reach, last: () => last, cookie: () => cookie };
}

const nearest = (d: any, from: number[]) => [...d.artifacts].filter((a: any) => a.readyAt <= d.serverTime).sort((p: any, q: any) => Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1]) - Math.hypot(q.pos[0] - from[0], q.pos[1] - from[1]))[0];
async function collectOne(a: ReturnType<typeof visitor>) {
  const t = nearest(a.last(), a.now().pos);
  await a.reach(t.pos, (p) => H.touches(p, t.pos));
  return (await a.wait((d) => d.robots.find((r: any) => r.tag === d.you.tag).carrying.some((c: any) => c.id === t.id))) ? t : null;
}

try {
  await start();
  const a = visitor();
  await a.open();
  // collect, deliver, arrange: through the real routes
  const kept = await collectOne(a);
  check(!!kept, "a visitor picks one up");
  const home = H.HOMES[a.me().home];
  await a.reach(home, (p) => H.atHome(p, home));
  check(await a.wait((d) => d.mine.collection[kept.kind] === 1), "and keeps it in their zone");
  const r = await a.post("/hall/display", { slots: [kept.kind, null, null, null], was: [null, null, null, null] });
  check(r.status === 200, "and puts it on their display");
  // carry one more out into the hall
  const carried = await collectOne(a);
  check(!!carried, "then carries another");
  const collection = { ...a.last().mine.collection };

  // 1. a graceful restart, back within the grace
  await stop("SIGTERM");
  await start();
  const back = await a.open();
  check(back?.mine.welcome?.kind === "recovered", "after a graceful restart, back within the grace: recovered", JSON.stringify(back?.mine.welcome));
  check(a.me().carrying.some((c: any) => c.id === carried.id), "still carrying what it carried");
  check(JSON.stringify(back.mine.collection) === JSON.stringify(collection) && back.mine.display[0] === kept.kind, "collection and display unchanged");
  check(H.atHome(a.me().pos, home) && a.me().carrying.length === 1, "standing in its zone, and nothing delivered for coming back");

  // 2. a crash, away past the grace
  await stop("SIGKILL");
  await start();
  const watcher = visitor();
  await watcher.open();
  const released = await watcher.wait((d) => d.artifacts.some((x: any) => x.id === carried.id), H.GRACE_MS + 4000);
  check(released, "after a crash, away past the grace: the cargo is back on the floor");
  const dbv = new DatabaseSync(DB, { readOnly: true });
  const row = dbv.prepare("SELECT state, holder, owner FROM artifacts WHERE id = ?").get(carried.id) as any;
  check(row.state === "available" && row.holder === null && row.owner === null, "free, in one state, held by nobody", JSON.stringify(row));
  const dupes = dbv.prepare("SELECT COUNT(*) AS c FROM artifacts WHERE id = ?").get(carried.id) as any;
  check(dupes.c === 1, "once, not twice");
  dbv.close();
  const again = await a.open();
  check(again?.mine.welcome?.kind === "new" && again.mine.welcome.released === 1, "they're told on return", JSON.stringify(again?.mine.welcome));
  check(again.mine.collection[kept.kind] === collection[kept.kind] && again.mine.display[0] === kept.kind, "and their collection and display are still there");
  a.close();

  // 3. a new session with the same cookie: the same visitor
  const same = visitor(a.cookie());
  const s3 = await same.open();
  check(s3.you.tag === a.last().you.tag && s3.mine.collection[kept.kind] === collection[kept.kind], "a new session with the same cookie is the same visitor, with the same collection");
  const fresh = visitor();
  const s4 = await fresh.open();
  check(s4.you.tag !== s3.you.tag && Object.values(s4.mine.collection).every((n) => n === 0), "a new cookie (cleared data, another device) is a new visitor, with nothing");
  const dir = (await (await fetch(BASE + "/hall/displays")).json()) as any;
  check(dir.entries.some((e: any) => e.tag === s3.you.tag), "the old display is in the directory either way");
  same.close();
  fresh.close();
  watcher.close();
} finally {
  if (server) await stop("SIGTERM");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall restart checks passed");
process.exit(failures ? 1 : 0);
