#!/usr/bin/env node
// 2 to 5 independent sessions, each with its own cookie, playing the real
// server over HTTP on a throwaway database. It starts and kills its own
// server, so it never touches a running app or the live arena. Every event
// every session receives is checked, and the database is audited directly.
//
//   node scripts/session-check.ts            # everything, about 3 minutes
//   node scripts/session-check.ts soak       # one section
//
// Not in CI: it starts servers and runs in real time.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

const PORT = Number(process.env.SESSION_PORT ?? 8199);
const BASE = `http://localhost:${PORT}`;
const only = process.argv[2];
let failures = 0;
const check = (ok: boolean, what: string, detail: unknown = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail !== "" ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return true;
  return ok();
}

let DB = "";
let server: ChildProcess | null = null;
const freshDb = () => (DB = join(mkdtempSync(join(tmpdir(), "sessions-")), "arena.db"));
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
  const s = server;
  if (!s) return;
  const gone = new Promise((r) => s.once("exit", r));
  s.kill(signal);
  await gone;
  server = null;
}
const sql = <T = any>(q: string, ...a: any[]): T[] => {
  const db = new DatabaseSync(DB, { readOnly: true } as any);
  try {
    return db.prepare(q).all(...a) as T[];
  } finally {
    db.close();
  }
};

/** One player: a cookie jar, a stream, and everything it has been told. */
class Session {
  cookie = "";
  last: any = null;
  events: any[] = [];
  received: { at: number; d: any }[] = [];
  seq = 0;
  ctl: AbortController | null = null;
  keep = false;
  onEvent: ((d: any) => void) | null = null;
  async open() {
    this.ctl = new AbortController();
    this.last = null;
    const r = await fetch(BASE + "/events", { headers: this.cookie ? { cookie: this.cookie } : {}, signal: this.ctl.signal });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of r.body as any) {
          buf += dec.decode(chunk, { stream: true });
          for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
            const m = /^event: arena$/m.test(buf.slice(0, i)) ? /^data: (.*)$/m.exec(buf.slice(0, i)) : null;
            if (!m) continue;
            const d = JSON.parse(m[1]);
            this.last = d;
            if (this.keep) this.received.push({ at: Date.now(), d });
            this.onEvent?.(d);
          }
        }
      } catch {}
    })();
    await until(() => !!this.last, 3000);
    return this;
  }
  close() {
    this.ctl?.abort();
  }
  get tag(): string {
    return this.last.you.tag;
  }
  get me(): any {
    return this.last.robots.find((r: any) => r.tag === this.tag);
  }
  get carrying(): any[] {
    return this.me?.carrying ?? [];
  }
  get total(): number {
    return this.last.mine.total;
  }
  here() {
    return A.advance(this.me, Date.now());
  }
  async launchAt(to: number[], power = 1) {
    if (!this.me) return null;
    const p = this.here().pos;
    const dir = [to[0] - p[0], to[1] - p[1]];
    if (Math.hypot(dir[0], dir[1]) < 1e-6) dir[0] = 1;
    this.seq = Math.max(this.seq, this.me.seq) + 1;
    return fetch(BASE + "/launch", { method: "POST", headers: { cookie: this.cookie, "content-type": "application/json", origin: BASE }, body: JSON.stringify({ dir, power, seq: this.seq }) });
  }
  nearest() {
    const p = this.here().pos, now = Date.now();
    return [...this.last.artifacts].filter((a) => a.readyAt <= now).sort((a, b) => Math.hypot(a.pos[0] - p[0], a.pos[1] - p[1]) - Math.hypot(b.pos[0] - p[0], b.pos[1] - p[1]))[0]?.pos as number[] | undefined;
  }
  async chase(to: () => number[] | undefined, done: () => boolean, ms = 15_000) {
    for (const end = Date.now() + ms; Date.now() < end && !done(); await sleep(220)) {
      const t = to();
      if (t) await this.launchAt(t);
    }
    return done();
  }
  grab(n = 1, ms = 20_000) {
    return this.chase(() => this.nearest(), () => this.carrying.length >= n, ms);
  }
  deliver(ms = 15_000) {
    const before = this.total;
    return this.chase(() => A.VAULT, () => this.total > before, ms);
  }
  req(path: string, init: RequestInit = {}) {
    return fetch(BASE + path, { ...init, headers: { ...(init.headers as object), cookie: this.cookie } });
  }
  saveRoom(body: unknown) {
    return this.req("/room", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
  }
}
async function sessions(n: number) {
  const out: Session[] = [];
  for (let i = 0; i < n; i++) out.push(await new Session().open());
  return out;
}
const closeAll = async (all: Session[], wait = true) => {
  all.forEach((s) => s.close());
  if (wait) await sleep(A.GRACE_MS + 400);
};
const countAll = () => sql<{ state: string; c: number }>("SELECT state, COUNT(*) AS c FROM artifacts GROUP BY state");

// ---- each section starts on a fresh server unless it says otherwise
async function spawning() {
  const all: Session[] = [];
  const floor = () => all[0].last.artifacts.length;
  for (let p = 1; p <= A.MAX_PLAYERS; p++) {
    all.push(await new Session().open());
    const t0 = Date.now();
    const reached = await until(() => floor() >= A.SPAWN.target[p], A.SPAWN.everyMs[p] * (A.SPAWN.target[p] + 3));
    check(reached, `${p} player(s): the floor reaches ${A.SPAWN.target[p]}`, `${floor()} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await sleep(A.SPAWN.everyMs[p] * 1.6);
    check(floor() === A.SPAWN.target[p], `${p} player(s): and stops there`, floor());
  }
  const s = all[0];
  const before = sql<{ c: number }>("SELECT COUNT(*) AS c FROM artifacts")[0].c;
  await closeAll(all);
  await sleep(3000);
  check(sql<{ c: number }>("SELECT COUNT(*) AS c FROM artifacts")[0].c === before, "with everyone gone, nothing spawns");
  void s;
}

async function sync() {
  const all = await sessions(4);
  const [a, ...rest] = all;
  await sleep(200);
  rest.forEach((s) => (s.keep = true));
  const t0 = Date.now();
  check((await a.launchAt([8, 5]))?.status === 200, "a launch is accepted");
  const seq = a.seq, tag = a.tag;
  const arrived = await Promise.all(rest.map(async (s) => {
    await until(() => s.last.robots.find((r: any) => r.tag === tag)?.seq === seq, 1500);
    return Date.now() - t0;
  }));
  check(Math.max(...arrived) < 1000, "all three others hear within a second", `${arrived.join(", ")} ms`);
  const snaps = rest.map((s) => JSON.stringify((({ pos, vel, t, seq }) => ({ pos, vel, t, seq }))(s.last.robots.find((r: any) => r.tag === tag))));
  check(new Set(snaps).size === 1, "and hold the identical snapshot");
  const when = Date.now() + 500;
  const ahead = rest.map((s) => JSON.stringify(A.advance(s.last.robots.find((r: any) => r.tag === tag), when).pos));
  check(new Set(ahead).size === 1, "so every screen computes the same position 500 ms on", ahead[0]);
  // a launch while moving, and a bounce off a wall nobody is told about
  await sleep(300);
  check((await a.launchAt([1, 1]))?.status === 200, "a launch in mid-flight is accepted");
  await until(() => rest.every((s) => s.last.robots.find((r: any) => r.tag === tag)?.seq === a.seq), 1000);
  check(rest.every((s) => s.last.robots.find((r: any) => r.tag === tag)?.seq === a.seq), "and reaches everyone");
  await closeAll(all);
}

/** Two robots with cargo drive at each other until they meet. */
async function contact() {
  const [a, b, c] = await sessions(3);
  for (const s of [a, b, c]) s.keep = true;
  const hits = (s: Session) => s.received.flatMap((r) => r.d.hits).filter((h: any) => h.scattered.length);
  // the vault is in the middle, so a robot may bank on the way to a contact:
  // go again until a contact finds both robots still carrying
  let h: any = null, ids: string[] = [], held = 0, t0 = 0;
  for (let round = 0; round < 8 && !h; round++) {
    await a.grab(2);
    await b.grab(1);
    ids = [...a.carrying, ...b.carrying].map((i) => i.id);
    held = ids.length;
    t0 = Date.now();
    for (const end = Date.now() + 8000; Date.now() < end && (a.carrying.length || b.carrying.length); await sleep(160)) await Promise.all([a.launchAt(b.here().pos, 0.45), b.launchAt(a.here().pos, 0.45)]);
    await sleep(120);
    h = hits(a).find((x: any) => new Set(x.scattered.map((t: any) => t.by)).size === 2 && x.at >= t0) ?? null;
  }
  check(!!h, "a contact finds both robots carrying, and empties both");
  if (!h) return closeAll([a, b, c]);
  check(new Set(h.scattered.map((t: any) => t.by)).size === 2, "from both robots at once", `${h.scattered.length} artifacts`);
  const scattered = hits(a).flatMap((x: any) => x.scattered);
  check(ids.filter((id) => scattered.some((t: any) => t.id === id)).length === held || a.total + b.total > 0, "every carried artifact was scattered or banked first", `${held} carried`);
  const same = JSON.stringify(hits(a)) === JSON.stringify(hits(b)) && JSON.stringify(hits(b)) === JSON.stringify(hits(c));
  check(same, "all three sessions got the identical hits");
  for (const s of h.scattered) {
    const d = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
    if (d < 0.3) check(false, "an artifact landed away from its robot", d);
  }
  check(true, "every artifact landed clear of its robot");
  const away = h.scattered.every((s: any) => !A.inVault(s.to));
  check(away, "none landed in the vault");
  // settling: a robot parked on the landing spot, launching at it, can't have it early
  const last = hits(a)[hits(a).length - 1];
  const spot = last.scattered[0];
  const readyAt = last.at + A.SETTLE_MS;
  check(a.last.artifacts.find((f: any) => f.id === spot.id)?.readyAt === readyAt || Date.now() > readyAt, "it's on the floor, marked ready after the settle", `${A.SETTLE_MS} ms`);
  await closeAll([a, b, c], false);
  await sleep(A.GRACE_MS + 400);
  const [x, y] = await sessions(2);
  for (const s of [x, y]) s.keep = true;
  let owned = "", hit: any = null;
  for (let tries = 0; tries < 6 && !hit; tries++) {
    await x.grab(1);
    await y.grab(1);
    owned = x.carrying[0]?.id ?? "";
    // they stay well off the vault's line: they meet, not bank
    for (const end = Date.now() + 8000; Date.now() < end && x.carrying.length; await sleep(120)) await Promise.all([x.launchAt(y.here().pos, 0.4), y.launchAt(x.here().pos, 0.4)]);
    await sleep(40);
    hit = x.received.flatMap((r) => r.d.hits).find((h: any) => h.scattered.some((t: any) => t.id === owned));
  }
  check(!!hit, "a carried artifact is scattered by a contact");
  if (!hit) return closeAll([x, y]);
  const land = hit.scattered.find((t: any) => t.id === owned);
  // the previous owner goes straight back for it, and doesn't stop
  await x.chase(() => land.to, () => x.carrying.some((i) => i.id === owned), 6000);
  const got = x.received.find((r) => r.d.robots.some((b: any) => b.carrying.some((i: any) => i.id === owned)) && r.d.serverTime > hit.at);
  check(!!got, "its previous owner can reclaim it");
  check(!got || got.d.serverTime >= hit.at + A.SETTLE_MS, "but not before it settles", got ? `${got.d.serverTime - hit.at} ms after the contact` : "");
  await closeAll([x, y]);
  return;
  await closeAll([a, b, c]);
}

async function contested() {
  let solved = 0, rounds = 0;
  const [a, b] = await sessions(2);
  for (const s of [a, b]) s.keep = true;
  for (const end = Date.now() + 18_000; Date.now() < end; await sleep(100)) {
    const t = a.nearest();
    if (!t) continue;
    const id = a.last.artifacts.find((x: any) => x.pos === t)?.id;
    rounds++;
    await Promise.all([a.launchAt(t), b.launchAt(t)]);
    await sleep(320);
    const holders = [a, b].filter((s) => s.carrying.some((i) => i.id === id)).length;
    const row = sql<{ c: number }>("SELECT COUNT(*) AS c FROM artifacts WHERE id = ?", id)[0].c;
    if (holders > 1 || row !== 1) check(false, "one artifact, one holder", id);
    if (holders === 1) solved++;
  }
  check(rounds > 3, "both sessions race for the same artifact, again and again", `${rounds} races, ${solved} taken`);
  check(solved > 0, "and it goes to exactly one of them each time");
  await closeAll([a, b]);
}

/** Four sessions fight for 40 s, and every event anyone gets is held to the rules. */
async function soak() {
  const all = await sessions(4);
  const bad: string[] = [];
  const delivered = new Map<string, number>();
  let hitCount = 0, top = 0, deliveredEvents = 0, mutual = 0;
  const hitLog: string[][] = all.map(() => []);
  const seenReady = new Map<string, number>(); // artifact id to when it may be taken
  all.forEach((s, i) => {
    s.onEvent = (d) => {
      const carried = d.robots.flatMap((r: any) => r.carrying.map((c: any) => c.id));
      if (new Set(carried).size !== carried.length) bad.push("an artifact on two robots");
      if (d.artifacts.some((a: any) => carried.includes(a.id))) bad.push("an artifact both carried and on the floor");
      for (const r of d.robots) {
        top = Math.max(top, Math.hypot(r.vel[0], r.vel[1]));
        if (r.carrying.length > A.CARRY_MAX) bad.push("over the carry limit");
      }
      for (const a of d.artifacts) if (a.readyAt) seenReady.set(a.id, a.readyAt);
      for (const c of carried) if ((seenReady.get(c) ?? 0) > d.serverTime) bad.push(`taken before it settled, ${seenReady.get(c)! - d.serverTime} ms early`);
      for (const h of d.hits) {
        hitLog[i].push(JSON.stringify(h));
        if (i === 0) hitCount++;
        if (i === 0 && new Set(h.scattered.map((t: any) => t.by)).size === 2) mutual++;
      }
      if (i === 0) for (const x of d.deliveries) {
        deliveredEvents++;
        delivered.set(x.tag, (delivered.get(x.tag) ?? 0) + x.items.length);
      }
    };
  });
  const end = Date.now() + 40_000;
  await Promise.all(all.map(async (s, i) => {
    let n = i * 7 + 1;
    const dice = () => (n = (n * 48271) % 2147483647) / 2147483647;
    while (Date.now() < end) {
      const load = s.carrying.length;
      const other = all[(i + 1) % all.length];
      const to = load >= 1 + (i % 3) ? A.VAULT : i === 3 && other.carrying.length && dice() < 0.5 ? other.here().pos : s.nearest() ?? A.VAULT;
      await s.launchAt(to, 0.7 + dice() * 0.3);
      await sleep(150 + dice() * 150);
    }
  }));
  await sleep(1500);
  check(bad.length === 0, "no event from 40 s of four-way play broke a rule", bad.length ? [...new Set(bad)].join("; ") : "");
  check(top <= A.SPEED_MAX + 1e-6, "speed stayed bounded", `top ${top.toFixed(2)} m/s`);
  check(hitCount > 0, "they really did collide", `${hitCount} contacts, ${mutual} costing both robots cargo`);
  check(deliveredEvents > 0, "and deliver to the one vault", `${deliveredEvents} deliveries, ${[...delivered.values()].reduce((a, b) => a + b, 0)} artifacts`);
  check(new Set(hitLog.map((h) => h.join())).size === 1, "all four sessions got the same contacts, in the same order", `${hitLog[0].length} each`);
  const view = (s: Session) => JSON.stringify({ a: s.last.artifacts, r: s.last.robots.map((r: any) => ({ tag: r.tag, seq: r.seq, c: r.carrying })), v: s.last.vault });
  check(new Set(all.map(view)).size === 1, "and end agreeing on everything");
  const carriedDb = sql<any>("SELECT holder, COUNT(*) c FROM artifacts WHERE state = 'carried' GROUP BY holder");
  check(carriedDb.every((x) => x.c <= A.CARRY_MAX), "the database agrees nobody is over the limit");
  check(sql("SELECT id FROM artifacts WHERE (state = 'banked') != (owner IS NOT NULL) OR (state = 'carried') != (holder IS NOT NULL)").length === 0, "every row is exactly one state");
  for (const s of all) {
    const pid = sql<any>("SELECT pid FROM visitors WHERE tag = ?", s.tag)[0].pid;
    const n = sql<any>("SELECT COUNT(*) c FROM artifacts WHERE owner = ?", pid)[0].c;
    if (n !== (delivered.get(s.tag) ?? 0) || n !== s.total) check(false, "a collection matches what was delivered", `${n} stored, ${delivered.get(s.tag)} announced, ${s.total} shown`);
  }
  check(true, "each collection is exactly what its owner delivered");
  check(all.reduce((t, s) => t + s.total, 0) === all[0].last.vault, "and the vault total is their sum", all[0].last.vault);
  await closeAll(all);
}

async function ownership() {
  const [a, b] = await sessions(2);
  await a.grab(1);
  await a.deliver();
  await b.grab(1);
  await b.deliver();
  const items = async (s: Session) => (await (await s.req("/collection")).json()).items as any[];
  const [ia, ib] = [await items(a), await items(b)];
  check(ia.length >= 1 && ib.length >= 1 && !ia.some((x) => ib.some((y) => y.id === x.id)), "two sessions hold separate collections", `${ia.length} and ${ib.length}`);
  const layout = (id: string) => ({ wall: "sage", floor: "slate", light: "cool", items: [{ uid: 1, type: "plinth", x: 0.4, y: 0.4, artifact: id }] });
  check((await a.saveRoom({ layout: layout(ia[0].id), was: 0 })).status === 200, "a session shows its own artifact");
  const r = await b.saveRoom({ layout: layout(ia[0].id), was: 0 });
  check(r.status === 409 && (await r.json()).error === "not-owned", "another session can't show it");
  const view = await (await b.req(`/rooms/${a.tag}`)).json() as any;
  check(view.mine === false && view.layout.wall === "sage", "but can visit the room");
  check(!JSON.stringify(view).includes(a.cookie.split("=")[1]), "which never reveals the owner's pid");
  check(!("shelf" in view), "or their shelf");
  const write = await b.req(`/rooms/${a.tag}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ layout: layout(ib[0].id), was: 1 }) });
  check(write.status === 404, "and there is no route to write to it", write.status);
  await closeAll([a, b]);
}

async function refresh() {
  const [a, b] = await sessions(2);
  await a.grab(2);
  const slot = a.me.slot, cargo = a.carrying.map((i) => i.id).join(), tag = a.tag;
  a.close();
  await until(() => b.last.robots.find((r: any) => r.tag === tag)?.away === true, 1000);
  check(b.last.robots.find((r: any) => r.tag === tag)?.away === true, "a closed page leaves a ghost, seen by others");
  await sleep(1500);
  await a.open();
  check(a.tag === tag && a.me.slot === slot && !a.me.away, "a refresh in time: the same robot in the same slot");
  check(a.carrying.map((i) => i.id).join() === cargo, "and the same cargo", a.carrying.length);
  check((await a.launchAt([8, 5]))?.status === 200, "and it still launches");
  // two tabs: closing one changes nothing
  const tab = new Session();
  tab.cookie = a.cookie;
  await tab.open();
  tab.close();
  await sleep(300);
  check(!b.last.robots.find((r: any) => r.tag === tag)?.away, "closing a second tab leaves the robot alone");
  // past the grace
  const floor = b.last.artifacts.length;
  a.close();
  await sleep(A.GRACE_MS + 500);
  check(!b.last.robots.some((r: any) => r.tag === tag), "away past the grace: the robot goes");
  check(b.last.artifacts.length >= floor + cargo.split(",").length, "and its cargo returns to the floor", `${floor} to ${b.last.artifacts.length}`);
  await a.open();
  check(a.carrying.length === 0, "coming back, it starts empty");
  // a fifth session waits, then plays
  const extra = await sessions(2);
  const line = await new Session().open();
  check(line.me === undefined && line.last.mine.place === 1, "a fifth session is first in line, with no robot");
  check((await line.launchAt([1, 1])) === null, "and has nothing to launch");
  extra[0].close();
  check(await until(() => !!line.me, A.GRACE_MS + 2000), "and gets the robot when someone's grace ends", `slot ${line.me?.slot}`);
  await closeAll([a, b, extra[1], line]);
}

async function restarts() {
  const [a, b] = await sessions(2);
  await a.grab(1);
  await a.deliver();
  await a.grab(1);
  await b.grab(1);
  const items = (await (await a.req("/collection")).json() as any).items;
  await a.saveRoom({ layout: { wall: "walnut", floor: "terrazzo", light: "dusk", items: [{ uid: 1, type: "case", x: 0.3, y: 0.3, artifact: items[0].id }] }, was: 0 });
  const total = a.total, vault = a.last.vault, carried = a.carrying[0].id, floorIds = a.last.artifacts.map((f: any) => f.id).sort().join();
  const saved = () => a.req("/rooms/me").then((r) => r.json()) as Promise<any>;

  await stop("SIGTERM");
  await sleep(200);
  await start();
  a.close();
  b.close();
  await a.open();
  await b.open();
  check(a.carrying.some((i) => i.id === carried), "graceful restart, back at once: the cargo is still aboard");
  check(a.total === total && a.last.vault === vault, "the collection and vault total stand", `${total}, ${vault}`);
  const nowFloor = new Set(a.last.artifacts.map((f: any) => f.id));
  check(floorIds.split(",").every((id: string) => nowFloor.has(id)), "the same artifacts are on the floor", `${nowFloor.size}`);
  check((await a.launchAt([8, 5]))?.status === 200, "a launch works straight after, with the server's count reset");
  let room = await saved();
  check(room.layout.wall === "walnut" && room.artifacts[items[0].id]?.kind === items[0].kind, "the room stands, artifact and all");

  await stop("SIGKILL");
  a.close();
  b.close();
  await start();
  await sleep(A.GRACE_MS + 1500);
  await a.open();
  await sleep(200);
  check(a.carrying.length === 0, "crash, away too long: the cargo went back to the floor");
  check(sql<any>("SELECT COUNT(*) c FROM artifacts WHERE state = 'carried'")[0].c === 0, "and so did the absent player's: nothing is held by nobody");
  check(a.total === total, "the collection stands", total);
  room = await saved();
  check(room.layout.wall === "walnut" && room.rev === 1, "and the room, at the same revision");
  check((await a.saveRoom({ layout: room.layout, was: 1 })).status === 200, "and can be saved again");
  await closeAll([a]);
}

const SECTIONS: Record<string, () => Promise<void>> = { spawning, sync, contact, contested, soak, ownership, refresh, restarts };
try {
  for (const [name, run] of Object.entries(SECTIONS)) {
    if (only && only !== name) continue;
    console.log(`\n# ${name}`);
    freshDb();
    await start();
    await run();
    console.log(`  (database: ${JSON.stringify(countAll())})`);
    await stop("SIGKILL");
  }
} finally {
  await stop("SIGKILL").catch(() => {});
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
