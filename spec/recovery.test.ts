import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore } from "../src/db.ts";
import { LEASE_MS } from "../src/economy.ts";
import { tag } from "../src/log.ts";

// What happens across a restart, a redeploy, a dropped stream and time passing
// while nobody is looking. None of it can be done to the app at APP_URL (the
// spec can't restart it, read its stdout or wind its clock), so like
// log.test.ts this file starts its own copies of src/server.ts on free ports,
// each on a throwaway DB_PATH, and stops them itself.

const ANA = "00000000-0000-4000-8000-000000000a7a";
const BEN = "00000000-0000-4000-8000-000000000be7";
const SAM1 = "00000000-0000-4000-8000-0000000005a1";
const SAM2 = "00000000-0000-4000-8000-0000000005a2";
const HOUR = 60 * 60 * 1000;

type TileView = { id: number; state: string; height: number; label: string | null; leaseEndsAt: string | null; rate: number };
type Me = { coins: number; pending: number; cellId: number | null; welcome?: number; expired?: true };
type Board = { tiles: TileView[]; claimed: number; status: string; version: number; me: Me; events: { type: string; text: string }[] };

type App = { base: string; out: () => string; proc: ChildProcess; stop(): Promise<number | null> };
const running = new Set<App>();
const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skyline-recovery-"));
  dirs.push(dir);
  return join(dir, "app.db");
}

async function start(dbPath: string, env: Record<string, string> = {}): Promise<App> {
  let out = "";
  const proc = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DB_PATH: dbPath, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.setEncoding("utf8").on("data", (s: string) => (out += s));
  proc.stderr!.setEncoding("utf8").on("data", (s: string) => (out += s));
  const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start line:\n${out}`)), 10_000);
    proc.stdout!.on("data", () => {
      const m = /^start port=(\d+)/m.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
  const app: App = {
    base: `http://127.0.0.1:${port}`,
    out: () => out,
    proc,
    async stop() {
      running.delete(app);
      if (proc.exitCode === null) proc.kill("SIGTERM");
      return exited;
    },
  };
  running.add(app);
  return app;
}

afterAll(async () => {
  await Promise.all([...running].map((a) => a.stop()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const claim = (app: App, pid: string | null, cellId: number, label: string): Promise<Response> =>
  fetch(new URL("/claim", app.base), {
    method: "POST",
    headers: {
      ...(pid ? { cookie: `pid=${pid}` } : {}),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ cellId, label }),
  });

// An /events stream that keeps every raw block and every board it was sent.
type Stream = {
  raw: () => string;
  boards: Board[];
  next(test: (b: Board) => boolean, timeoutMs?: number): Promise<Board>;
  ended: Promise<void>;
  close(): void;
};

async function listen(app: App, pid: string): Promise<Stream> {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", app.base), { headers: { cookie: `pid=${pid}` }, signal: controller.signal });
  expect(res.status).toBe(200);
  let text = "";
  let raw = "";
  const boards: Board[] = [];
  let read = 0;
  let wake = (): void => {};
  const decoder = new TextDecoder();
  const ended = (async () => {
    try {
      for await (const chunk of res.body!) {
        text += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = text.indexOf("\n\n")) !== -1) {
          const block = text.slice(0, end);
          text = text.slice(end + 2);
          raw += block + "\n\n";
          const data = block.startsWith("event: board") && block.split("\n").find((l) => l.startsWith("data: "));
          if (data) boards.push(JSON.parse(data.slice(6)) as Board);
        }
        wake();
      }
    } catch {
      // aborted
    }
    wake();
  })();
  return {
    raw: () => raw,
    boards,
    ended,
    close: () => controller.abort(),
    async next(test, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (read < boards.length) {
          const b = boards[read++];
          if (test(b)) return b;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no matching board within ${timeoutMs} ms`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
  };
}

describe("persistence across a restart (6.1)", () => {
  it("keeps every claim, owner and label when the server process is replaced on the same database", async () => {
    const db = tempDb();
    const first = await start(db);
    expect((await claim(first, ANA, 40, "Ana")).status).toBe(200);
    expect((await claim(first, BEN, 41, "Ben")).status).toBe(200);
    expect(await first.stop()).toBe(0);

    const second = await start(db);
    const ana = await listen(second, ANA);
    const board = await ana.next(() => true);
    ana.close();
    expect(board.tiles[40]).toMatchObject({ state: "mine", label: "Ana", height: 2 });
    expect(board.tiles[41]).toMatchObject({ state: "held", label: "Ben", height: 2 });
    expect(board.claimed).toBe(2);
    // and the cookie still proves who's who: Ben can't take Ana's tile
    expect((await claim(second, BEN, 40, "Ben")).status).toBe(409);
  });
});

describe("version (5.1: stale data can't overwrite newer)", () => {
  it("rises with every broadcast, and keeps rising across a restart", async () => {
    const db = tempDb();
    const first = await start(db);
    const watcher = await listen(first, BEN);
    const v0 = (await watcher.next(() => true)).version;
    const seen: number[] = [v0];
    for (const [i, cell] of [10, 11, 12].entries()) {
      const res = await claim(first, `00000000-0000-4000-8000-0000000a0a0${i}`, cell, "Ana");
      const body = (await res.json()) as { board: Board };
      const streamed = await watcher.next((b) => b.tiles[cell].label === "Ana");
      // a claim's response and its stream event are the same moment
      expect(body.board.version).toBe(streamed.version);
      seen.push(streamed.version);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i], `broadcast ${i}`).toBeGreaterThan(seen[i - 1]);
    watcher.close();
    await first.stop();

    const second = await start(db);
    const again = await listen(second, BEN);
    const after = await again.next(() => true);
    again.close();
    expect(after.version).toBeGreaterThan(seen.at(-1)!);
    // and the page a refresh renders carries a version no older than the stream's
    const html = await (await fetch(new URL("/", second.base), { headers: { cookie: `pid=${BEN}` } })).text();
    expect(Number(/data-version="(\d+)"/.exec(html)?.[1])).toBeGreaterThanOrEqual(after.version);
  });
});

describe("recovery (5.4)", () => {
  let app: App;
  beforeAll(async () => {
    app = await start(tempDb(), { HEARTBEAT_MS: "200" });
  });

  it("tells the browser when to reconnect, sends the whole board first, and keeps the line alive", async () => {
    const s = await listen(app, ANA);
    const first = await s.next(() => true);
    expect(s.raw().startsWith("retry: 2000\n\n")).toBe(true);
    expect(first.tiles).toHaveLength(144);
    await new Promise((r) => setTimeout(r, 500));
    expect(s.raw()).toMatch(/^: hb$/m);
    s.close();
  });

  it("gives a reconnecting page the full current board, including what changed while it was away", async () => {
    const s = await listen(app, ANA);
    await s.next(() => true);
    s.close();
    expect((await claim(app, BEN, 99, "Ben")).status).toBe(200); // while Ana's page is gone
    const back = await listen(app, ANA);
    const board = await back.next(() => true);
    back.close();
    expect(board.tiles[99]).toMatchObject({ state: "held", label: "Ben" });
  });

  it("ends every open stream on SIGTERM and exits cleanly", async () => {
    const own = await start(tempDb());
    const a = await listen(own, ANA);
    const b = await listen(own, BEN);
    await Promise.all([a.next(() => true), b.next(() => true)]);
    const code = await own.stop();
    // both readers see their stream finish rather than hang
    await Promise.race([
      Promise.all([a.ended, b.ended]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("a stream was left hanging")), 3000)),
    ]);
    expect(code).toBe(0);
    expect(own.out()).toMatch(/^shutdown signal=SIGTERM open=2$/m);
  });
});

describe("shutdown after a page went away", () => {
  it("still exits at once, so the database is closed before Fly gives up waiting", async () => {
    // A page load left its keep-alive socket idle, then a page's stream
    // dropped. Before closeAllConnections() this held the exit ~4 s.
    const own = await start(tempDb());
    expect((await fetch(new URL("/", own.base))).status).toBe(200);
    const gone = await listen(own, SAM1);
    await gone.next(() => true);
    gone.close();
    await new Promise((r) => setTimeout(r, 100));
    const t = performance.now();
    expect(await own.stop()).toBe(0);
    expect(performance.now() - t, "the server took too long to exit").toBeLessThan(1000);
  });
});

// Rewritten for ADR 5: a lease ends on the clock, not on absence. The old
// "dormant on the first request after a day off", "crossing into dormancy
// from the sweep" and "a visit moves safeUntil" tests went with dormancy.
describe("expiry (6.2)", () => {
  it("frees a plot whose lease ended while the server was off, on the first request, with no sweep", async () => {
    // Claimed 25 hours ago, as if the machine had been stopped since. The
    // sweep is pushed out of reach, so only boot and read-time can show it.
    const db = tempDb();
    const seed = openStore(db);
    // Ben first: a claim settles everyone, and Ana's lease must still be
    // standing when the store closes, for the server to be the one to end it
    seed.claim(31, BEN, "Ben", new Date(Date.now() - 1 * HOUR));
    seed.claim(30, ANA, "Ana", new Date(Date.now() - 25 * HOUR));
    seed.close();

    const app = await start(db, { SWEEP_MS: String(HOUR) });
    const sam = await listen(app, SAM1);
    const board = await sam.next(() => true);
    expect(board.tiles[30]).toMatchObject({ state: "free", label: null, leaseEndsAt: null });
    expect(board.tiles[31]).toMatchObject({ state: "held", height: 1, rate: 1000 }); // nobody beside him now
    expect(board.events[0]).toMatchObject({ type: "expire", text: "Ana's lease ended at row 3, column 7" });
    expect(app.out()).toMatch(new RegExp(`^expire at=r3c7 holder=${tag(ANA)}:"Ana" ended="[^"]+" unclaimed=\\d+( dropped=\\S+)?$`, "m"));

    const taken = sam.next((b) => b.tiles[30].label === "Sam");
    expect((await claim(app, SAM1, 30, "Sam")).status).toBe(200);
    const settled = await taken;
    expect(settled.tiles[30].state).toBe("mine");
    expect(settled.tiles[31].height).toBe(2); // settling there lifts Ben again
    sam.close();
    // and Ben's, an hour old, still can't be taken
    expect((await claim(app, SAM2, 31, "Sam")).status).toBe(409);

    // Ana is told once, keeps her coins, and her ended building's earnings wait for her
    const ana = await listen(app, ANA);
    const hers = await ana.next(() => true);
    ana.close();
    expect(hers.me).toMatchObject({ coins: 100, cellId: null, expired: true });
    expect(hers.me.pending).toBeGreaterThan(0);
    const again = await listen(app, ANA);
    expect((await again.next(() => true)).me.expired).toBeUndefined();
    again.close();
    await app.stop();
  });

  it("pushes a lease ending to open pages from the sweep alone, and lowers the neighbours", async () => {
    // Claimed just under a day ago, so it ends a moment after boot.
    const db = tempDb();
    const seed = openStore(db);
    seed.claim(50, ANA, "Ana", new Date(Date.now() - LEASE_MS + 1000));
    seed.claim(51, BEN, "Ben", new Date());
    seed.close();

    const app = await start(db, { SWEEP_MS: "300" });
    // watched by someone holding nothing, so only the sweep can trigger a send
    const watcher = await listen(app, SAM2);
    const first = await watcher.next(() => true);
    expect(first.tiles[50].state).toBe("held");
    expect(first.tiles[51]).toMatchObject({ height: 2, rate: 1200 });
    const ended = await watcher.next((b) => b.tiles[50].state === "free", 3000);
    watcher.close();
    // the same broadcast lowers her neighbour's height and income
    expect(ended.tiles[51]).toMatchObject({ height: 1, rate: 1000 });
    expect(ended.version).toBeGreaterThan(first.version);
    expect(app.out()).toMatch(new RegExp(`^expire at=r5c3 holder=${tag(ANA)}:"Ana" ended="[^"]+" unclaimed=\\d+ dropped=${tag(BEN)}:"Ben"$`, "m"));
    await app.stop();
  });
});

describe("concurrent claims (5.2)", () => {
  it("lets exactly one of many people racing for one tile win, and every page shows that winner", async () => {
    const app = await start(tempDb());
    const watchers = await Promise.all([listen(app, ANA), listen(app, BEN)]);
    await Promise.all(watchers.map((w) => w.next(() => true)));
    const racers = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-0000000c0de${i}`);
    const results = await Promise.all(racers.map((pid, i) => claim(app, pid, 77, `Racer ${i}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(racers.length - 1);
    for (const r of results.filter((r) => r.status === 409)) {
      expect(await r.json()).toEqual({ error: "taken" });
    }
    const winner = `Racer ${statuses.indexOf(200)}`;
    const finals = await Promise.all(watchers.map((w) => w.next((b) => b.tiles[77].label !== null)));
    for (const b of finals) {
      expect(b.tiles[77]).toMatchObject({ state: "held", label: winner });
      expect(b.claimed).toBe(1);
    }
    // no later board shows anyone else there
    await new Promise((r) => setTimeout(r, 100));
    for (const w of watchers) {
      expect(w.boards.filter((b) => b.tiles[77].label !== null && b.tiles[77].label !== winner)).toEqual([]);
      w.close();
    }
    await app.stop();
  });
});

describe("identity (5.3)", () => {
  it("keeps two people both called Sam apart, on the board, in their power and in the logs", async () => {
    const app = await start(tempDb());
    expect((await claim(app, SAM1, 20, "Sam")).status).toBe(200);
    expect((await claim(app, SAM2, 21, "Sam")).status).toBe(200);

    const one = await listen(app, SAM1);
    const two = await listen(app, SAM2);
    const [b1, b2] = await Promise.all([one.next(() => true), two.next(() => true)]);
    expect([b1.tiles[20].state, b1.tiles[21].state]).toEqual(["mine", "held"]);
    expect([b2.tiles[20].state, b2.tiles[21].state]).toEqual(["held", "mine"]);
    // distinct people, so distinct hues even with the same name
    expect((b1.tiles[20] as TileView & { hue: number }).hue).not.toBe((b1.tiles[21] as TileView & { hue: number }).hue);
    one.close();
    two.close();

    // Same name gives no power: the second Sam can't take or rename the first's tile
    expect((await claim(app, SAM2, 20, "Sam")).status).toBe(409);
    expect((await claim(app, null, 20, "Sam")).status).toBe(409); // nor can someone with no cookie

    await new Promise((r) => setTimeout(r, 50));
    const claims = app.out().split("\n").filter((l) => l.startsWith("claim "));
    expect(claims).toEqual([
      `claim who=${tag(SAM1)} label="Sam" at=r2c9`,
      `claim who=${tag(SAM2)} label="Sam" at=r2c10 lifted=${tag(SAM1)}:"Sam"`,
    ]);
    expect(tag(SAM1)).not.toBe(tag(SAM2));
    await app.stop();
  });

  it("recognises the same cookie on a later request, so a refresh keeps your tile", async () => {
    const app = await start(tempDb());
    const res = await fetch(new URL("/", app.base));
    const pid = /^pid=([0-9a-f-]{36});/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    expect(pid).toBeDefined();
    expect((await claim(app, pid!, 5, "Kim")).status).toBe(200);
    const again = await fetch(new URL("/", app.base), { headers: { cookie: `pid=${pid}` } });
    expect(again.headers.get("set-cookie")).toBeNull(); // not re-issued
    const doc = new JSDOM(await again.text()).window.document;
    expect(doc.querySelector<HTMLButtonElement>('button.tile[value="5"]')?.dataset.state).toBe("mine");
    await app.stop();
  });
});
