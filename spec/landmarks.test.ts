import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../src/log.ts";

// docs/adr/0004 over HTTP: a landmark raised is told to every open page once.
// And ADR 5's Help, which replaced the Wave: who may help whom, paid once,
// and every page told. Raising a landmark takes nine people
// on a 3x3 block, and the other spec files share the app at APP_URL and take
// the first free tiles, so like recovery.test.ts this file starts its own
// server on a free port with a throwaway database, and reads its stdout.

const N = 12;
const cell = (r: number, c: number): number => r * N + c;
const pidOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

type Raised = { cellId: number; tier: string; label: string; raisers: string[] };
type Me = { coins: number; cellId: number | null; helpAt: string | null };
type Board = {
  tiles: { id: number; state: string; height: number; label: string | null }[];
  me: Me;
  events: { type: string; text: string; cellId: number | null }[];
  version: number;
  landmarks: { count: number; cells: Record<string, { tier: string; label: string; raisers: string[] }> };
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

const help = (pid: string | null, cellId: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL("/help", base), {
    method: "POST",
    headers: { ...(pid ? { cookie: `pid=${pid}` } : {}), "content-type": "application/json", accept: "application/json", ...headers },
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

  // The ring arrives in board order round the centre: r3c3, r3c4, r3c5,
  // r4c3, ... Each claim may crown cells (ADR 6), so what this follows is
  // the centre's own crown: bronze at its 3rd neighbour, silver at its 5th,
  // gold at its 8th.
  const centreTier = (b: Board): string | undefined => b.landmarks.cells[String(centre)]?.tier;
  const news = (s: Stream): Raised[] => s.boards().flatMap((x) => (x.raised ? [x.raised] : []));

  it("tells every open page of each crown once, gold with the nine names, and the count goes up", async () => {
    const a = await listen(watcherA); // holds nothing
    const b = await listen(people[0].pid); // the holder, a raiser
    await Promise.all([a.next("board"), b.next("board")]);
    for (const p of people.slice(0, 4)) expect((await claim(p.pid, p.id, p.label)).status).toBe(200);
    // 3 neighbours: bronze, a lighter message to every page
    for (const s of [a, b]) {
      const board = JSON.parse(await s.next("board", (d) => centreTier(JSON.parse(d) as Board) === "bronze")) as Board;
      expect(board.raised).toEqual({ cellId: centre, tier: "bronze", label: "Raiser 0", raisers: raisers.slice(0, 4) });
    }
    for (const p of people.slice(4, 8)) expect((await claim(p.pid, p.id, p.label)).status).toBe(200);
    await settle();
    for (const s of [a, b]) {
      expect(s.boards().every((x) => centreTier(x) !== "gold")).toBe(true);
      expect(news(s).filter((r) => r.cellId === centre).map((r) => r.tier)).toEqual(["bronze", "silver"]);
    }

    const last = people[8];
    expect((await claim(last.pid, last.id, last.label)).status).toBe(200);
    const expected = { cellId: centre, tier: "gold", label: "Raiser 0", raisers };
    for (const s of [a, b]) {
      const board = JSON.parse(await s.next("board", (d) => centreTier(JSON.parse(d) as Board) === "gold")) as Board;
      expect(board.raised).toEqual(expected);
      expect(board.landmarks.cells[String(centre)]).toEqual({ tier: "gold", label: "Raiser 0", raisers });
      expect(board.landmarks.count).toBe(Object.keys(board.landmarks.cells).length);
    }

    // a later change carries the landmark, but never announces it again
    expect((await claim(watcherB, cell(10, 10), "Later")).status).toBe(200);
    await Promise.all([a, b].map((s) => s.next("board", (d) => d.includes('"Later"'))));
    for (const s of [a, b]) {
      expect(news(s).filter((r) => r.tier === "gold")).toHaveLength(1);
      expect(s.boards().at(-1)!.raised).toBeUndefined();
    }

    // and the log says where, which tier and who, by label: one line a row
    const centreLines = logLines("landmark").filter((l) => l.startsWith("landmark at=r4c4 "));
    expect(centreLines.map((l) => /tier=(\w+)/.exec(l)![1])).toEqual(["bronze", "silver", "gold"]);
    expect(centreLines[2]).toBe(`landmark at=r4c4 tier=gold label="Raiser 0" raisers=${raisers.map((r) => JSON.stringify(r)).join(",")}`);
    for (const l of logLines("landmark")) expect(l).toMatch(/^landmark at=r\d+c\d+ tier=(bronze|silver|gold) label="/);
  });

  it("doesn't tell a reconnecting page again: its first board has the landmark, not the news", async () => {
    for (const pid of [watcherA, people[0].pid, pidOf(0xc0)]) {
      const s = await listen(pid);
      const first = JSON.parse(await s.next("board")) as Board;
      expect(first.landmarks.count).toBeGreaterThan(1); // the block crowned its ring too
      expect(first.landmarks.cells[String(centre)]).toEqual({ tier: "gold", label: "Raiser 0", raisers });
      expect(first.raised).toBeUndefined();
    }
    // and nothing that happens on a connect replays it
    await settle();
    for (const s of streams) expect(s.boards().filter((x) => x.raised !== undefined)).toEqual([]);
  });

  it("puts the landmark in the server-rendered page too: a count, and the crowned tile's names", async () => {
    const html = await (await fetch(new URL("/", base))).text();
    const doc = new JSDOM(html).window.document;
    const crowned = [...doc.querySelectorAll<HTMLButtonElement>("button.tile[data-landmark]")];
    expect(doc.querySelector("[data-landmarks]")?.textContent).toBe(String(crowned.length));
    const gold = crowned.filter((b) => b.dataset.tier === "gold");
    expect(gold.map((b) => Number(b.value))).toEqual([centre]);
    expect(gold[0].dataset.landmark).toBe("Raiser 0");
    expect(JSON.parse(gold[0].dataset.landmarkRaisers!)).toEqual(raisers);
    // every crown says its tier, and the ring round a gold one has crowns too
    expect(crowned.every((b) => ["bronze", "silver", "gold"].includes(b.dataset.tier!))).toBe(true);
    expect(crowned.length).toBeGreaterThan(1);
  });

  it("records nothing new when the building loses a neighbour and fills again", async () => {
    const corner = people[1];
    expect((await claim(corner.pid, cell(10, 1), corner.label)).status).toBe(200); // a paid move away: 7
    const s = await listen(watcherA);
    await s.next("board");
    // someone else fills the gap (the mover is on a 30-minute cooldown)
    expect((await claim(pidOf(0xd0), corner.id, "Filler")).status).toBe(200);
    const board = JSON.parse(await s.next("board", (d) => (JSON.parse(d) as Board).tiles[corner.id].label !== null)) as Board;
    expect(board.tiles[centre].height).toBe(1 + 8);
    expect(board.landmarks.cells[String(centre)].tier).toBe("gold");
    expect(board.raised?.cellId).not.toBe(centre);
    expect(logLines("landmark").filter((l) => l.startsWith("landmark at=r4c4 tier=gold "))).toHaveLength(1);
  });
});

// Replaced by ADR 5: the "waving" tests went with /wave. Help is checked
// the same way: only a neighbour, only someone holding land, rate-limited,
// paid once, and every page hears it.
describe("helping", () => {
  // Wes helps; Tia is beside him; Xan beside him too; Far is held but not
  // adjacent; Ned holds nothing.
  const WES = { pid: pidOf(0x3e5), id: cell(8, 6), label: "Wes" };
  const TIA = { pid: pidOf(0x71a), id: cell(8, 7), label: "Tia" };
  const XAN = { pid: pidOf(0x8a0), id: cell(9, 5), label: "Xan" };
  const FAR = { pid: pidOf(0xfa0), id: cell(8, 9), label: "Far" };
  const NED = pidOf(0xed0);

  beforeAll(async () => {
    for (const p of [WES, TIA, XAN, FAR]) expect((await claim(p.pid, p.id, p.label)).status).toBe(200);
  });

  it("pays the neighbour 50 and the helper 20, each told on their own stream, and every page sees it in the log", async () => {
    const [tia, xan, wes] = await Promise.all([listen(TIA.pid), listen(XAN.pid), listen(WES.pid)]);
    const [t0, x0, w0] = (await Promise.all([tia, xan, wes].map((s) => s.next("board")))).map((d) => JSON.parse(d) as Board);

    const res = await help(WES.pid, TIA.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notice: string; board: Board };
    expect(body.notice).toBe("helped");
    expect(body.board.me.coins).toBe(w0.me.coins + 20);
    const helped = (d: string): boolean => (JSON.parse(d) as Board).events.some((e) => e.type === "help");
    const [t1, x1, w1] = (await Promise.all([tia, xan, wes].map((s) => s.next("board", helped)))).map((d) => JSON.parse(d) as Board);
    expect(t1.me.coins).toBe(t0.me.coins + 50);
    expect(w1.me.coins).toBe(w0.me.coins + 20);
    expect(x1.me.coins).toBe(x0.me.coins); // a third party's wallet doesn't move
    expect(x1.events[0]).toMatchObject({ type: "help", text: "Wes helped Tia at row 9, column 8", cellId: TIA.id });
    expect(w1.me.helpAt).not.toBeNull();
    expect(logLines("help")).toEqual([`help who=${tag(WES.pid)} at=r9c7 to=r9c8 helped=${tag(TIA.pid)}:"Tia"`]);
  });

  it("refuses a second help within the hour, at anyone, and pays nothing", async () => {
    const tia = await listen(TIA.pid);
    const before = JSON.parse(await tia.next("board")) as Board;
    const res = await help(WES.pid, XAN.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "cooldown" });
    expect((await help(TIA.pid, WES.id)).status).toBe(200); // Tia's own hour is unused
    const after = JSON.parse(await tia.next("board", (d) => (JSON.parse(d) as Board).me.coins !== before.me.coins)) as Board;
    expect(after.me.coins).toBe(before.me.coins + 20);
  });

  it("pays once when the same help is sent twice at once", async () => {
    const results = await Promise.all([help(XAN.pid, WES.id), help(XAN.pid, WES.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
  });

  it.each([
    ["a held plot that isn't next to yours", () => help(FAR.pid, TIA.id), 400, "not-neighbour"],
    ["a free plot next to yours", () => help(FAR.pid, cell(7, 9)), 400, "not-neighbour"],
    ["your own plot", () => help(FAR.pid, FAR.id), 400, "not-neighbour"],
    ["anyone, while holding no land", () => help(NED, TIA.id), 400, "no-land"],
    ["anyone, with no cookie at all", () => help(null, TIA.id), 400, "no-land"],
    ["a plot that doesn't exist", () => help(FAR.pid, 144), 400, "cell"],
  ] as const)("refuses help at %s", async (_, send, status, error) => {
    const res = await send();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("refuses help from another site's page", async () => {
    const res = await fetch(new URL("/help", base), {
      method: "POST",
      headers: { cookie: `pid=${FAR.pid}`, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ cellId: String(cell(8, 8)) }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it("answers a form with a 303 and a notice key", async () => {
    const res = await fetch(new URL("/help", base), {
      method: "POST",
      headers: { cookie: `pid=${NED}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ cellId: String(TIA.id) }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?notice=no-land");
  });

  it("has no /wave route any more", async () => {
    expect((await fetch(new URL("/wave", base), { method: "POST" })).status).toBe(404);
  });

  it("logs every refusal with its reason, and never a pid", async () => {
    await settle(50);
    const refused = logLines("help.refused");
    for (const reason of ["cooldown", "not-neighbour", "no-land", "cross-site", "cell"]) {
      expect(refused.some((l) => l.includes(` reason=${reason}`)), `no help.refused for ${reason}`).toBe(true);
    }
    expect(refused.length).toBeGreaterThan(5);
    expect(out).not.toMatch(UUID);
  });
});
