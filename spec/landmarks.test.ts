import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../src/log.ts";

// docs/adr/0004 over HTTP: a landmark raised is told to every open page once,
// and a wave reaches only the person waved at. Raising one takes nine people
// on a 3x3 block, and the other spec files share the app at APP_URL and take
// the first free tiles, so like recovery.test.ts this file starts its own
// server on a free port with a throwaway database, and reads its stdout.

const N = 12;
const cell = (r: number, c: number): number => r * N + c;
const pidOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

type Raised = { cellId: number; label: string; raisers: string[] };
type Board = {
  tiles: { id: number; state: string; height: number; label: string | null }[];
  version: number;
  landmarks: { count: number; cells: Record<string, { label: string; raisers: string[] }> };
  raised?: Raised;
};
type Event = { name: string; data: string };

let proc: ChildProcess;
let dir: string;
let base: string;
let out = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "skyline-landmarks-"));
  proc = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DB_PATH: join(dir, "app.db"), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.setEncoding("utf8").on("data", (s: string) => (out += s));
  proc.stderr!.setEncoding("utf8").on("data", (s: string) => (out += s));
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
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  proc?.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
});

const claim = (pid: string, cellId: number, label: string): Promise<Response> =>
  fetch(new URL("/claim", base), {
    method: "POST",
    headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ cellId, label }),
  });

const wave = (pid: string | null, cellId: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL("/wave", base), {
    method: "POST",
    headers: { ...(pid ? { cookie: `pid=${pid}` } : {}), "content-type": "application/json", ...headers },
    body: JSON.stringify({ cellId }),
  });

// An /events stream that keeps every event it was sent, by name.
type Stream = {
  events: Event[];
  boards: () => Board[];
  next(name: string, test?: (data: string) => boolean, timeoutMs?: number): Promise<string>;
  close(): void;
};

const streams: Stream[] = [];
const wavesSeen: string[] = []; // every wave payload any stream got, across tests
afterEach(() => {
  for (const s of streams.splice(0)) s.close();
});

async function listen(pid: string): Promise<Stream> {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", base), { headers: { cookie: `pid=${pid}` }, signal: controller.signal });
  expect(res.status).toBe(200);
  const events: Event[] = [];
  let text = "";
  let wake = (): void => {};
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for await (const chunk of res.body!) {
        text += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = text.indexOf("\n\n")) !== -1) {
          const block = text.slice(0, end).split("\n");
          text = text.slice(end + 2);
          const name = block.find((l) => l.startsWith("event: "))?.slice(7);
          const data = block.find((l) => l.startsWith("data: "))?.slice(6);
          if (name && data !== undefined) events.push({ name, data });
          if (name === "wave" && data !== undefined) wavesSeen.push(data);
        }
        wake();
      }
    } catch {
      // aborted
    }
  })();
  let read = 0;
  const stream: Stream = {
    events,
    boards: () => events.filter((e) => e.name === "board").map((e) => JSON.parse(e.data) as Board),
    close: () => controller.abort(),
    async next(name, test = () => true, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (read < events.length) {
          const e = events[read++];
          if (e.name === name && test(e.data)) return e.data;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no ${name} event within ${timeoutMs} ms`);
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
  streams.push(stream);
  return stream;
}

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));
const logLines = (event: string): string[] => out.split("\n").filter((l) => l.startsWith(event + " "));

describe("raising a landmark", () => {
  // Nine people on the 3x3 block round r4c4 (cell 39), holder first.
  const centre = cell(3, 3);
  const block: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) block.push(cell(3 + dr, 3 + dc));
  const order = [centre, ...block.filter((id) => id !== centre)];
  const people = order.map((id, i) => ({ id, pid: pidOf(0x100 + i), label: `Raiser ${i}` }));
  const raisers = people.map((p) => p.label);
  const watcherA = pidOf(0xa0);
  const watcherB = pidOf(0xb0);

  it("tells every open page once, with the nine names, and the count goes up", async () => {
    const a = await listen(watcherA); // holds nothing
    const b = await listen(people[0].pid); // the holder, a raiser
    await Promise.all([a.next("board"), b.next("board")]);
    for (const p of people.slice(0, 8)) expect((await claim(p.pid, p.id, p.label)).status).toBe(200);
    await settle();
    for (const s of [a, b]) {
      expect(s.boards().every((x) => x.landmarks.count === 0 && x.raised === undefined)).toBe(true);
    }

    const last = people[8];
    expect((await claim(last.pid, last.id, last.label)).status).toBe(200);
    const expected = { cellId: centre, label: "Raiser 0", raisers };
    for (const s of [a, b]) {
      const board = JSON.parse(await s.next("board", (d) => (JSON.parse(d) as Board).landmarks.count === 1)) as Board;
      expect(board.raised).toEqual(expected);
      expect(board.landmarks).toEqual({ count: 1, cells: { [centre]: { label: "Raiser 0", raisers } } });
    }

    // a later change carries the landmark, but never announces it again
    expect((await claim(watcherB, cell(10, 10), "Later")).status).toBe(200);
    await Promise.all([a, b].map((s) => s.next("board", (d) => d.includes('"Later"'))));
    for (const s of [a, b]) {
      const boards = s.boards();
      expect(boards.filter((x) => x.raised !== undefined)).toHaveLength(1);
      expect(boards.at(-1)!.landmarks.count).toBe(1);
      expect(boards.at(-1)!.raised).toBeUndefined();
    }

    // and the log says where and who, by label
    expect(logLines("landmark")).toEqual([`landmark at=r4c4 label="Raiser 0" raisers=${raisers.map((r) => JSON.stringify(r)).join(",")}`]);
  });

  it("doesn't tell a reconnecting page again: its first board has the landmark, not the news", async () => {
    for (const pid of [watcherA, people[0].pid, pidOf(0xc0)]) {
      const s = await listen(pid);
      const first = JSON.parse(await s.next("board")) as Board;
      expect(first.landmarks.count).toBe(1);
      expect(first.landmarks.cells[String(centre)].raisers).toEqual(raisers);
      expect(first.raised).toBeUndefined();
    }
    // the holder's visit broadcasts (it moves their safeUntil): still no news
    await settle();
    for (const s of streams) expect(s.boards().filter((x) => x.raised !== undefined)).toEqual([]);
  });

  it("puts the landmark in the server-rendered page too: a count, and the crowned tile's names", async () => {
    const html = await (await fetch(new URL("/", base))).text();
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("[data-landmarks]")?.textContent).toBe("1");
    const crowned = [...doc.querySelectorAll<HTMLButtonElement>("button.tile[data-landmark]")];
    expect(crowned.map((b) => Number(b.value))).toEqual([centre]);
    expect(crowned[0].dataset.landmark).toBe("Raiser 0");
    expect(JSON.parse(crowned[0].dataset.landmarkRaisers!)).toEqual(raisers);
  });

  it("records nothing new when the tower drops and reaches 8 again", async () => {
    const corner = people[1];
    expect((await claim(corner.pid, cell(10, 1), corner.label)).status).toBe(200); // away: 7
    const s = await listen(watcherA);
    await s.next("board");
    expect((await claim(corner.pid, corner.id, corner.label)).status).toBe(200); // back: 8
    const board = JSON.parse(await s.next("board", (d) => (JSON.parse(d) as Board).tiles[corner.id].label !== null)) as Board;
    expect(board.tiles[centre].height).toBe(8);
    expect(board.landmarks.count).toBe(1);
    expect(board.raised).toBeUndefined();
    expect(logLines("landmark")).toHaveLength(1);
  });
});

describe("waving", () => {
  // Wes waves; Tia is beside him; Xan is beside him too (a third party);
  // Far is held but not adjacent; Ned holds nothing.
  const WES = { pid: pidOf(0x3e5), id: cell(8, 6), label: "Wes" };
  const TIA = { pid: pidOf(0x71a), id: cell(8, 7), label: "Tia" };
  const XAN = { pid: pidOf(0x8a0), id: cell(9, 5), label: "Xan" };
  const FAR = { pid: pidOf(0xfa0), id: cell(8, 9), label: "Far" };
  const NED = pidOf(0xed0);

  beforeAll(async () => {
    for (const p of [WES, TIA, XAN, FAR]) expect((await claim(p.pid, p.id, p.label)).status).toBe(200);
  });

  it("reaches only the person waved at, as the waver's tile and label, and is logged by tag", async () => {
    const [tia, xan, wes] = await Promise.all([listen(TIA.pid), listen(XAN.pid), listen(WES.pid)]);
    const tia2 = await listen(TIA.pid); // a second tab of hers
    await Promise.all([tia, xan, wes, tia2].map((s) => s.next("board")));

    const res = await wave(WES.pid, TIA.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    for (const s of [tia, tia2]) {
      expect(JSON.parse(await s.next("wave"))).toEqual({ from: WES.id, label: "Wes" });
    }
    await settle();
    expect(xan.events.filter((e) => e.name === "wave")).toEqual([]);
    expect(wes.events.filter((e) => e.name === "wave")).toEqual([]);
    expect(logLines("wave")).toEqual([`wave who=${tag(WES.pid)} at=r9c7 to=${tag(TIA.pid)}`]);
  });

  it("refuses a second wave at the same person within 10 s, but not one at someone else", async () => {
    const res = await wave(WES.pid, TIA.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too-soon" });
    expect((await wave(WES.pid, XAN.id)).status).toBe(200); // a different pair
    expect((await wave(TIA.pid, WES.id)).status).toBe(200); // and she can wave back
  });

  it.each([
    ["a held tile that isn't next to yours", () => wave(WES.pid, FAR.id), 400, "not-neighbour"],
    ["a free tile next to yours", () => wave(WES.pid, cell(7, 6)), 400, "not-neighbour"],
    ["your own tile", () => wave(WES.pid, WES.id), 400, "not-neighbour"],
    ["anyone, while holding no tile", () => wave(NED, TIA.id), 409, "no-tile"],
    ["anyone, with no cookie at all", () => wave(null, TIA.id), 409, "no-tile"],
  ] as const)("refuses a wave at %s", async (_, send, status, error) => {
    const tia = await listen(TIA.pid);
    await tia.next("board");
    const res = await send();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    await settle(100);
    expect(tia.events.filter((e) => e.name === "wave")).toEqual([]);
  });

  it("refuses a wave from another site's page", async () => {
    const tia = await listen(TIA.pid);
    await tia.next("board");
    const res = await fetch(new URL("/wave", base), {
      method: "POST",
      headers: { cookie: `pid=${XAN.pid}`, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ cellId: String(TIA.id) }).toString(),
    });
    expect(res.status).toBe(403);
    await settle(100);
    expect(tia.events.filter((e) => e.name === "wave")).toEqual([]);
  });

  it("logs every refusal with its reason, and never a pid in any wave line or payload", async () => {
    await settle(50);
    const refused = logLines("wave.refused");
    for (const reason of ["too-soon", "not-neighbour", "no-tile", "cross-site"]) {
      expect(refused.some((l) => l.includes(` reason=${reason}`)), `no wave.refused for ${reason}`).toBe(true);
    }
    expect(refused).toContain(`wave.refused who=${tag(WES.pid)} status=429 reason=too-soon to=r9c8`);
    const waves = [...logLines("wave"), ...refused];
    expect(waves.length).toBeGreaterThan(5);
    for (const l of waves) expect(l).not.toMatch(UUID);
    expect(out).not.toMatch(UUID);
    expect(wavesSeen.length).toBeGreaterThanOrEqual(2); // Tia's two tabs
    for (const data of wavesSeen) {
      expect(Object.keys(JSON.parse(data) as object).sort()).toEqual(["from", "label"]);
      expect(data).not.toMatch(UUID);
    }
  });
});
