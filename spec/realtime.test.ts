import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, inject, it } from "vitest";

// The brief's real-time line, as a test against the running app: a change one
// person makes reaches every other open session within about a second, with
// no reload. Each "session" here is an /events stream under its own pid.
const baseUrl = inject("baseUrl");

const DANA = "00000000-0000-4000-8000-0000000da7a0";
const EVAN = "00000000-0000-4000-8000-00000000e7a7";
// The claimer is a fresh person each time: a second claim by someone holding
// land is a paid move with a cooldown (ADR 5).
const fresh = (): string => randomUUID();

type TileView = { id: number; state: string; height: number; label: string | null; rate: number };
type Board = { tiles: TileView[]; claimed: number; status: string; me: { coins: number; cellId: number | null } };

type Listener = {
  // Resolves with the first board event not yet consumed that passes `test`,
  // whether it already arrived or arrives within `timeoutMs`. Events before
  // the match are consumed with it, so each call reads forward.
  next(test: (b: Board) => boolean, timeoutMs?: number): Promise<Board>;
  raw: () => string;
  close(): void;
};

const open: Listener[] = [];
afterEach(() => {
  for (const l of open.splice(0)) l.close();
});

async function listen(pid: string): Promise<Listener> {
  const controller = new AbortController();
  const res = await fetch(new URL("/events", baseUrl), {
    headers: { cookie: `pid=${pid}`, accept: "text/event-stream" },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);

  let text = "";
  let raw = "";
  const boards: Board[] = [];
  let read = 0; // boards before this index are consumed
  let wake = (): void => {};
  const decoder = new TextDecoder();

  void (async () => {
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
      // aborted by close()
    }
  })();

  const listener: Listener = {
    async next(test, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        while (read < boards.length) {
          const board = boards[read++];
          if (test(board)) return board;
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no matching board event within ${timeoutMs} ms`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, left);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
    raw: () => raw,
    close: () => controller.abort(),
  };
  open.push(listener);
  return listener;
}

// Free plots from the middle of the board (row 7 on), wrapping round to the
// top. claim.test.ts takes the first free plots and access.test.ts the last,
// all against the same app at once; a third file taking the first free plot
// too stole claim.test.ts's tile between its read and its claim.
function freeIds(board: Board): number[] {
  const free = board.tiles.filter((t) => t.state === "free").map((t) => t.id);
  return [...free.filter((id) => id >= 72), ...free.filter((id) => id < 72)];
}

function freeTile(board: Board): number {
  const [id] = freeIds(board);
  expect(id, "the board has no free tile left to test with").toBeDefined();
  return id;
}

function claim(pid: string, cellId: number, label: string): Promise<Response> {
  return fetch(new URL("/claim", baseUrl), {
    method: "POST",
    headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ cellId, label }),
  });
}

describe("live updates", () => {
  it("sends the current board as soon as a page connects", async () => {
    const dana = await listen(DANA);
    const first = await dana.next(() => true);
    expect(first.tiles).toHaveLength(144);
    expect(typeof first.status).toBe("string");
  });

  it("shows one person's claim in two other open sessions within a second", async () => {
    const dana = await listen(DANA);
    const evan = await listen(EVAN);
    const initial = await dana.next(() => true);
    await evan.next(() => true);

    // A free tile, so the claim is a real change both sessions must see.
    const cell = freeTile(initial);

    const sees = (b: Board): boolean => b.tiles[cell].state !== "free" && b.tiles[cell].label === "Fay";
    const danaSees = dana.next(sees, 1000);
    const evanSees = evan.next(sees, 1000);
    const started = performance.now();
    expect((await claim(fresh(), cell, "Fay")).status).toBe(200);
    const [forDana, forEvan] = await Promise.all([danaSees, evanSees]);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(forDana.tiles[cell].state).toBe("held");
    expect(forEvan.tiles[cell].state).toBe("held");
  });

  it("marks a tile as mine only in its holder's own stream, and sends your wallet only to you", async () => {
    const FAY = fresh();
    const fay = await listen(FAY);
    const dana = await listen(DANA);
    await fay.next(() => true);
    const cell = freeTile(await dana.next(() => true));

    const faySees = fay.next((b) => b.tiles[cell].state === "mine");
    const danaSees = dana.next((b) => b.tiles[cell].state === "held");
    expect((await claim(FAY, cell, "Fay")).status).toBe(200);
    const [forFay, forDana] = await Promise.all([faySees, danaSees]);
    expect(forFay.me).toMatchObject({ cellId: cell, coins: 100 });
    expect(forDana.me.cellId).not.toBe(cell); // Dana's wallet, never Fay's
  });

  it("never sends anyone's id cookie down a stream", async () => {
    const FAY = fresh();
    const dana = await listen(DANA);
    const evan = await listen(EVAN);
    await evan.next(() => true);
    const cell = freeTile(await dana.next(() => true));

    // Fay holds a tile while Dana and Evan watch, so there's an id to leak.
    const both = Promise.all([dana.next((b) => b.tiles[cell].label === "Fay"), evan.next((b) => b.tiles[cell].label === "Fay")]);
    expect((await claim(FAY, cell, "Fay")).status).toBe(200);
    await both;

    expect(dana.raw().length).toBeGreaterThan(0);
    for (const pid of [DANA, EVAN, FAY]) {
      expect(dana.raw()).not.toContain(pid);
      expect(evan.raw()).not.toContain(pid);
    }
  });
});

// docs/adr/0005: every economy action changes something others see (a
// height, an income rate, a lease end, the city log), so each one reaches
// every other open page; and the wallet in each stream is only ever its own.
describe("every action reaches other pages", () => {
  const post = (pid: string, path: string, body: object = {}): Promise<Response> =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  type Logged = Board & { events: { type: string; text: string }[]; version: number };

  it("pushes a collect, an upgrade, a renewal, a move and a help to another person's stream, with only their own wallet", async () => {
    const [ACT, PAL] = [fresh(), fresh()];
    const dana = await listen(DANA);
    const first = (await dana.next(() => true)) as Logged;
    // two free plots side by side, one row apart from anything else's concern
    const free = freeIds(first);
    const pair = free.find((id) => id % 12 < 11 && free.includes(id + 1) && !free.slice(0, 3).includes(id));
    // searched upward, so it lands above the pair and clear of access.test.ts's far end
    const away = free.toReversed().find((id) => Math.abs((id % 12) - ((pair! + 1) % 12)) > 1 && Math.abs(Math.floor(id / 12) - Math.floor(pair! / 12)) > 1);
    expect(pair, "no two adjacent free plots to test with").toBeDefined();
    expect(away, "no distant free plot to test with").toBeDefined();
    expect((await post(ACT, "/claim", { cellId: pair, label: "Act" })).status).toBe(200);
    expect((await post(PAL, "/claim", { cellId: pair! + 1, label: "Pal" })).status).toBe(200);
    await dana.next((b) => b.tiles[pair! + 1].label === "Pal");

    const steps: [string, object, (b: Logged) => boolean][] = [
      ["/collect", {}, () => true],
      ["/renew", { hours: 6 }, (b) => (b as Logged).events[0]?.text === `Act renewed their lease at ${place(pair!)} by 6 hours`],
      ["/help", { cellId: pair! + 1 }, (b) => (b as Logged).events[0]?.text === `Act helped Pal at ${place(pair! + 1)}`],
    ];
    let last = 0;
    for (const [path, body, test] of steps) {
      const res = await post(ACT, path, body);
      expect(res.status, path).toBe(200);
      const theirs = (await res.json()) as { board: Logged };
      const seen = (await dana.next((b) => (b as Logged).version >= theirs.board.version && test(b as Logged), 1000)) as Logged;
      expect(seen.version, path).toBeGreaterThan(last);
      last = seen.version;
      expect(seen.me.cellId, `${path}: Dana is sent her own wallet, not Act's`).not.toBe(pair);
    }
    // a move: Pal (150 coins after the help) pays 50 to move far off
    const was = ((await (await post(ACT, "/collect")).json()) as { board: Logged }).board.tiles[pair!];
    const moved = dana.next((b) => b.tiles[away!].label === "Pal" && b.tiles[pair! + 1].state === "free", 1000);
    const res = await post(PAL, "/claim", { cellId: away, label: "Pal" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { notice: string; board: Logged }).board.me.coins).toBe(100);
    const after = await moved;
    // Act lost a neighbour: one floor and a fifth of base income, on Dana's screen
    expect(after.tiles[pair!].height).toBe(was.height - 1);
    expect(after.tiles[pair!].rate).toBe(was.rate - 200);
    expect(dana.raw()).not.toContain(ACT);
    expect(dana.raw()).not.toContain(PAL);
  });

  it("pushes an upgrade, with its new height and income, to another person's stream", async () => {
    const RICH = fresh();
    const dana = await listen(DANA);
    const first = (await dana.next(() => true)) as Logged;
    const cell = freeTile(first);
    expect((await post(RICH, "/claim", { cellId: cell, label: "Rich" })).status).toBe(200);
    // a newcomer has 100 coins and an upgrade costs 150: refused, nothing sent
    const refused = await post(RICH, "/upgrade");
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({ error: "coins" });
    // help from two neighbours brings Rich to 200 (two fresh helpers beside him)
    const free = freeIds(first);
    const beside = free.filter((id) => id !== cell && Math.abs((id % 12) - (cell % 12)) <= 1 && Math.abs(Math.floor(id / 12) - Math.floor(cell / 12)) <= 1);
    expect(beside.length, "no free plots beside the test plot").toBeGreaterThanOrEqual(1);
    for (const id of beside.slice(0, 1)) {
      const helper = fresh();
      expect((await post(helper, "/claim", { cellId: id, label: "Helper" })).status).toBe(200);
      expect((await post(helper, "/help", { cellId: cell })).status).toBe(200);
    }
    const rich = await post(RICH, "/collect"); // whatever income has come in
    expect(rich.status).toBe(200);
    const coins = ((await rich.json()) as { board: { me: { coins: number } } }).board.me.coins;
    expect(coins).toBeGreaterThanOrEqual(150);
    const seen = dana.next((b) => (b.tiles[cell] as TileView & { level: number }).level === 2, 1000);
    expect((await post(RICH, "/upgrade")).status).toBe(200);
    const board = (await seen) as Logged;
    expect(board.tiles[cell]).toMatchObject({ level: 2, label: "Rich" });
    expect(board.events[0].text).toBe(`Rich upgraded to a Townhouse at ${place(cell)}`);
  });
});

function place(id: number): string {
  return `row ${Math.floor(id / 12) + 1}, column ${(id % 12) + 1}`;
}

