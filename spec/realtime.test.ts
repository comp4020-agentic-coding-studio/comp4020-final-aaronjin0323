import { afterEach, describe, expect, inject, it } from "vitest";

// The brief's real-time line, as a test against the running app: a change one
// person makes reaches every other open session within about a second, with
// no reload. Each "session" here is an /events stream under its own pid.
const baseUrl = inject("baseUrl");

const DANA = "00000000-0000-4000-8000-0000000da7a0";
const EVAN = "00000000-0000-4000-8000-00000000e7a7";
const FAY = "00000000-0000-4000-8000-000000000fa7";

type TileView = { id: number; state: string; height: number; label: string | null };
type Board = { tiles: TileView[]; claimed: number; status: string };

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

function freeTile(board: Board): number {
  const tile = board.tiles.find((t) => t.state === "free");
  expect(tile, "the board has no free tile left to test with").toBeDefined();
  return tile!.id;
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
    expect((await claim(FAY, cell, "Fay")).status).toBe(200);
    const [forDana, forEvan] = await Promise.all([danaSees, evanSees]);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(forDana.tiles[cell].state).toBe("held");
    expect(forEvan.tiles[cell].state).toBe("held");
  });

  it("marks a tile as mine only in its holder's own stream", async () => {
    const fay = await listen(FAY);
    const dana = await listen(DANA);
    await fay.next(() => true);
    const cell = freeTile(await dana.next(() => true));

    const faySees = fay.next((b) => b.tiles[cell].state === "mine");
    const danaSees = dana.next((b) => b.tiles[cell].state === "held");
    expect((await claim(FAY, cell, "Fay")).status).toBe(200);
    await Promise.all([faySees, danaSees]);
  });

  it("never sends anyone's id cookie down a stream", async () => {
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
