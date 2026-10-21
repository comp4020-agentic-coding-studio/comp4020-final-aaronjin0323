import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../src/log.ts";
import type { PosesEvent, PoseView } from "../src/types.ts";
import { open, post, sleep, stateOf, visitor, type Visitor } from "./helpers.ts";

// First person (ADR 17): each page sends where it stands and looks to
// POST /pose, the server keeps the newest per visitor in memory, and every
// stream gets a `poses` event at most every 100 ms. Poses are never stored
// and never in `state`. Other spec files act on the same app in parallel,
// so the shared-app tests find their own visitors by tag; the tests that
// need a quiet room (no state broadcast, the 5 s window, the throttle, the
// log) start their own server, like spec/log.test.ts.

const pose = (x: number, extra: Record<string, unknown> = {}) => ({ at: [x, -2.25], look: [0.5, -0.1], reach: [x, 1.1, -1.5], holding: null, ...extra });
const mine = (e: PosesEvent, who: Visitor): PoseView | undefined => e.poses.find((p) => p.tag === tag(who.pid));

describe("poses on the running app", { concurrent: false }, () => {
  it("sends a pose to another visitor's stream within a second, with who but never the pid, and to the sender too", async () => {
    const mia = visitor();
    const kai = visitor();
    await post(mia, "/me", { name: "Mia Pose" });
    const own = await open(mia);
    const other = await open(kai);
    try {
      await own.first();
      await other.first();
      const seen = other.nextPoses((e) => mine(e, mia)?.at[0] === 1.25, 1000);
      const self = own.nextPoses((e) => mine(e, mia)?.at[0] === 1.25, 1000);
      const sent = performance.now();
      const r = await post(mia, "/pose", pose(1.25, { holding: "teal" }));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
      const { poses, at } = await seen;
      expect(at - sent).toBeLessThan(1000);
      expect(typeof poses.t).toBe("number");
      const p = mine(poses, mia)!;
      expect(Object.keys(p).sort()).toEqual(["age", "at", "colour", "holding", "look", "name", "reach", "tag"]);
      expect(p).toMatchObject({ name: "Mia Pose", at: [1.25, -2.25], look: [0.5, -0.1], reach: [1.25, 1.1, -1.5], holding: "teal" });
      expect(typeof p.colour).toBe("number");
      expect(p.age).toBeGreaterThanOrEqual(0);
      expect(p.age).toBeLessThan(1000);
      expect(mine((await self).poses, mia)).toBeDefined();
      const wire = other.events.filter((e) => e.event === "poses").map((e) => e.data).join("\n");
      expect(wire).not.toContain(mia.pid);
      expect(wire).not.toMatch(/"pid"/);
    } finally {
      own.close();
      other.close();
    }
  });

  it("never puts a pose in a state event or the POST's answer", async () => {
    const mia = visitor();
    const own = await open(mia);
    try {
      await own.first();
      const r = await post(mia, "/pose", pose(3.375));
      expect(r.body).toEqual({ ok: true });
      await own.nextPoses((e) => mine(e, mia)?.at[0] === 3.375, 1000);
      const state = await stateOf(mia);
      expect(JSON.stringify(state)).not.toContain("3.375");
      expect(Object.keys(state)).not.toContain("poses");
      for (const e of own.events.filter((e) => e.event === "state")) expect(e.data).not.toContain("3.375");
    } finally {
      own.close();
    }
  });

  it("refuses a malformed pose with 400", async () => {
    const mia = visitor();
    const cases: unknown[] = [
      {},
      { at: [0, 0] },
      { look: [0, 0] },
      { ...pose(0), extra: 1 },
      { ...pose(0), constructor: 1 },
      { ...pose(0), at: [0] },
      { ...pose(0), at: [0, 0, 0] },
      { ...pose(0), at: ["0", 0] },
      { ...pose(0), at: [9.5, 0] },
      { ...pose(0), at: [0, -9.01] },
      { ...pose(0), at: { x: 0, z: 0 } },
      { ...pose(0), look: [1001, 0] },
      { ...pose(0), look: [0, 1.6] },
      { ...pose(0), look: [0, null] },
      { ...pose(0), reach: [0, 0] },
      { ...pose(0), reach: [0, 11, 0] },
      { ...pose(0), reach: "up" },
      { ...pose(0), holding: "ribbon" },
      { ...pose(0), holding: "bell" },
      { ...pose(0), holding: 1 },
      [0, 0],
      "null",
      "{",
    ];
    for (const body of cases) {
      const r = await post(mia, "/pose", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("bad-request");
      expect(typeof r.body.message).toBe("string");
    }
    // the optional keys may be left out, and a pose may be at the very edge
    expect((await post(visitor(), "/pose", { at: [9, -9], look: [-1000, 1.5] })).body).toEqual({ ok: true });
    expect((await post(visitor(), "/pose", { at: [0, 0], look: [0, 0], reach: null, holding: "dusk" })).body).toEqual({ ok: true });
  });

  it("ignores a second pose within 100 ms, and never sends it on", async () => {
    const mia = visitor();
    const own = await open(mia);
    try {
      await own.first();
      const first = await post(mia, "/pose", pose(4.5));
      const second = await post(mia, "/pose", pose(5.5));
      expect(first.body).toEqual({ ok: true });
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ ok: true, ignored: true });
      await own.nextPoses((e) => mine(e, mia)?.at[0] === 4.5, 1000);
      await sleep(300);
      expect(own.poses().some((e) => mine(e, mia)?.at[0] === 5.5)).toBe(false);
      // past 100 ms, the next is taken
      expect((await post(mia, "/pose", pose(6.5))).body).toEqual({ ok: true });
      await own.nextPoses((e) => mine(e, mia)?.at[0] === 6.5, 1000);
    } finally {
      own.close();
    }
  });

  it("drops a pose when the visitor's last stream closes", async () => {
    const mia = visitor();
    const kai = visitor();
    const one = await open(mia);
    const two = await open(mia);
    const other = await open(kai);
    try {
      await one.first();
      await two.first();
      await other.first();
      await post(mia, "/pose", pose(-3.125));
      await other.nextPoses((e) => mine(e, mia)?.at[0] === -3.125, 1000);
      one.close();
      await sleep(300);
      // a second tab is still open: still here
      expect(mine(other.poses().at(-1)!, mia)).toBeDefined();
      const gone = other.nextPoses((e) => !mine(e, mia), 1000);
      two.close();
      await gone;
    } finally {
      one.close();
      two.close();
      other.close();
    }
  });

  it("sends no pose for a visitor with no open stream", async () => {
    const ghost = visitor();
    const kai = visitor();
    const other = await open(kai);
    try {
      await other.first();
      expect((await post(ghost, "/pose", pose(-6.75))).body).toEqual({ ok: true });
      // someone present moves, so a `poses` event goes out: the ghost isn't in it
      await post(kai, "/pose", pose(-5.75));
      await other.nextPoses((e) => mine(e, kai)?.at[0] === -5.75, 1000);
      await sleep(200);
      expect(other.poses().some((e) => mine(e, ghost))).toBe(false);
    } finally {
      other.close();
    }
  });

  it("refuses a cross-site pose with 403", async () => {
    const r = await post(visitor(), "/pose", pose(0), { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("cross-origin");
  });
});

// A server of our own, with the 5 s window cut to 400 ms (POSE_TTL_MS, read
// only so this test can watch a pose run out), where nobody else acts.
describe("poses on a quiet server", { concurrent: false }, () => {
  const TTL = 400;
  let app: ChildProcess;
  let dir: string;
  let base: string;
  let out = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "museum-poses-"));
    app = spawn(process.execPath, ["src/server.ts"], {
      env: { ...process.env, PORT: "0", DB_PATH: join(dir, "museum.db"), NODE_ENV: "test", POSE_TTL_MS: String(TTL) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    app.stdout!.setEncoding("utf8").on("data", (s: string) => (out += s));
    app.stderr!.setEncoding("utf8").on("data", (s: string) => (out += s));
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no start line:\n${out}`)), 10_000);
      app.stdout!.on("data", () => {
        const m = /^start port=(\d+)/m.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
    });
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    app?.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  });

  it("broadcasts no state for a pose", async () => {
    const mia = visitor();
    const kai = visitor();
    const own = await open(mia, base);
    const other = await open(kai, base);
    try {
      await own.first();
      await other.first();
      await sleep(200);
      const states = other.events.filter((e) => e.event === "state").length;
      await post(mia, "/pose", pose(2), {}, base);
      await other.nextPoses((e) => mine(e, mia)?.at[0] === 2, 1000);
      await sleep(200);
      expect(other.events.filter((e) => e.event === "state").length).toBe(states);
    } finally {
      own.close();
      other.close();
    }
  });

  it("drops a pose older than the window while the stream stays open", async () => {
    const mia = visitor();
    const kai = visitor();
    const own = await open(mia, base);
    const other = await open(kai, base);
    try {
      await own.first();
      await other.first();
      await post(mia, "/pose", pose(-1.5), {}, base);
      const { at: seen } = await other.nextPoses((e) => mine(e, mia)?.at[0] === -1.5, 1000);
      const { at: gone } = await other.nextPoses((e) => !mine(e, mia), TTL + 1000);
      expect(gone - seen).toBeGreaterThan(TTL - 150);
    } finally {
      own.close();
      other.close();
    }
  });

  it("sends poses at most every 100 ms, and nothing when nothing changed", async () => {
    const people = [visitor(), visitor(), visitor(), visitor()];
    const streams = await Promise.all(people.map((p) => open(p, base)));
    const watcher = streams[0];
    try {
      await Promise.all(streams.map((s) => s.first()));
      await sleep(TTL + 300);
      const before = watcher.events.filter((e) => e.event === "poses").length;
      for (let round = 0; round < 3; round++) {
        await Promise.all(people.map((p, i) => post(p, "/pose", pose(i + round / 10), {}, base)));
        await sleep(110);
      }
      await sleep(TTL + 300);
      const times = watcher.events.filter((e) => e.event === "poses").slice(before).map((e) => e.at);
      expect(times.length).toBeGreaterThan(1);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(80);
      // once everything ran out, the room is quiet
      const settled = watcher.events.filter((e) => e.event === "poses").length;
      await sleep(400);
      expect(watcher.events.filter((e) => e.event === "poses").length).toBe(settled);
    } finally {
      for (const s of streams) s.close();
    }
  });

  it("logs a refused pose, and no line for an accepted one", async () => {
    const mia = visitor();
    await post(mia, "/pose", pose(0), {}, base);
    await post(mia, "/pose", { at: [0, 0] }, {}, base);
    await sleep(50);
    const lines = out.split("\n");
    expect(lines.filter((l) => l.startsWith("pose.refused ")).some((l) => l.startsWith(`pose.refused who=${tag(mia.pid)} status=400 error=bad-request`))).toBe(true);
    expect(lines.filter((l) => /^pose /.test(l))).toEqual([]);
  });
});
