import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// The crit 8 slice, checked over HTTP against the running app: a visitor
// claims a tile and it's still theirs later, and the rules in CLAUDE.md's
// Decisions hold. The app keeps its database between runs, so nothing here
// assumes an empty board: the personas below are fixed ids, and since each
// person holds one tile, repeated runs move them rather than filling the board.
const baseUrl = inject("baseUrl");

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";
const CAROL = "00000000-0000-4000-8000-0000000ca201";
const N = 12;

type TileView = { id: number; state: string; height: number; aria: string; title: string | null };

async function board(pid?: string): Promise<TileView[]> {
  const res = await fetch(new URL("/", baseUrl), { headers: pid ? { cookie: `pid=${pid}` } : {} });
  expect(res.status).toBe(200);
  const doc = new JSDOM(await res.text()).window.document;
  return [...doc.querySelectorAll<HTMLButtonElement>("button.tile")].map((b) => ({
    id: Number(b.value),
    state: b.dataset.state ?? "",
    height: Number(b.dataset.height),
    aria: b.getAttribute("aria-label") ?? "",
    title: b.getAttribute("title"),
  }));
}

function claimJson(pid: string, cellId: unknown, label: unknown): Promise<Response> {
  return fetch(new URL("/claim", baseUrl), {
    method: "POST",
    headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ cellId, label }),
  });
}

function claimForm(pid: string, cellId: number, label: string, origin?: string): Promise<Response> {
  const headers: Record<string, string> = {
    cookie: `pid=${pid}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (origin) headers.origin = origin;
  return fetch(new URL("/claim", baseUrl), {
    method: "POST",
    headers,
    body: new URLSearchParams({ cellId: String(cellId), label }).toString(),
    redirect: "manual",
  });
}

async function freeTiles(): Promise<number[]> {
  const ids = (await board()).filter((t) => t.state === "free").map((t) => t.id);
  expect(ids.length, "the board has no free tiles left to test with").toBeGreaterThan(3);
  return ids;
}

describe("the board", () => {
  it("renders all 144 tiles as buttons in one claim form", async () => {
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    const form = doc.querySelector('form[method="post"][action="/claim"]');
    expect(form).not.toBeNull();
    expect(form!.querySelectorAll('button.tile[name="cellId"]').length).toBe(N * N);
    expect(form!.querySelector('input[name="label"]')).not.toBeNull();
  });

  it("can't claim tile 0 by pressing Enter in the name field", async () => {
    // Enter in a text field submits the form with its first submit button.
    // That has to be a disabled one, which cancels the submission, not tile 0.
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    const first = doc.querySelector('form[action="/claim"]')!.querySelector('button:not([type]), button[type="submit"]');
    expect(first).not.toBeNull();
    expect(first!.hasAttribute("disabled")).toBe(true);
    expect(first!.classList.contains("tile")).toBe(false);
  });

  it("draws every tile as a four-sided block, so any camera angle shows a solid", async () => {
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    const tiles = [...doc.querySelectorAll("button.tile")];
    expect(tiles.length).toBe(N * N);
    expect(tiles.every((t) => t.querySelector(":scope > .sides") !== null)).toBe(true);
  });

  it("serves the camera script the board page loads", async () => {
    const page = await (await fetch(new URL("/", baseUrl))).text();
    const src = new JSDOM(page).window.document.querySelector("script[src]")?.getAttribute("src");
    expect(src).toBe("/app.js");
    const res = await fetch(new URL(src!, baseUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(await res.text()).toMatch(/--spin/);
  });

  it("gives a new visitor an anonymous id cookie", async () => {
    const res = await fetch(new URL("/", baseUrl));
    expect(res.headers.get("set-cookie")).toMatch(/^pid=[0-9a-f-]{36};.*HttpOnly.*SameSite=Lax/);
  });
});

describe("claiming", () => {
  it("keeps a claim for its owner and shows it to everyone else", async () => {
    const [cell] = await freeTiles();
    const res = await claimJson(ALICE, cell, "Alice");
    expect(res.status).toBe(200);

    const mine = (await board(ALICE)).find((t) => t.id === cell)!;
    expect(mine.state).toBe("mine");
    expect(mine.aria).toMatch(/your tile, Alice/);

    const theirs = (await board()).find((t) => t.id === cell)!;
    expect(theirs.state).toBe("held");
    expect(theirs.aria).toMatch(/held by Alice/);
  });

  it("works as a plain form: 303 back to the board", async () => {
    const [cell] = await freeTiles();
    const res = await claimForm(CAROL, cell, "Carol");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?notice=claimed");
    expect((await board(CAROL)).find((t) => t.id === cell)!.state).toBe("mine");
  });

  it("lets the first claim win and refuses the second", async () => {
    const [cell] = await freeTiles();
    expect((await claimJson(ALICE, cell, "Alice")).status).toBe(200);

    expect((await claimJson(BOB, cell, "Bob")).status).toBe(409);
    const form = await claimForm(BOB, cell, "Bob");
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/?notice=taken");

    expect((await board()).find((t) => t.id === cell)!.aria).toMatch(/held by Alice/);
  });

  it("moves a person's one tile rather than giving them two", async () => {
    const [first, second] = await freeTiles();
    expect((await claimJson(BOB, first, "Bob")).status).toBe(200);
    expect((await claimJson(BOB, second, "Bob")).status).toBe(200);

    const tiles = await board(BOB);
    expect(tiles.filter((t) => t.state === "mine").map((t) => t.id)).toEqual([second]);
    expect(tiles.find((t) => t.id === first)!.state).toBe("free");
  });

  it("refuses a claim posted from another site", async () => {
    const [cell] = await freeTiles();
    const res = await claimForm(CAROL, cell, "Carol", "https://evil.example");
    expect(res.status).toBe(403);
  });
});

describe("input", () => {
  it.each([
    ["an empty name", 0, "   "],
    ["a 25-character name", 0, "x".repeat(25)],
    ["a tile past the board", N * N, "Alice"],
    ["a negative tile", -1, "Alice"],
    ["a non-numeric tile", "abc", "Alice"],
  ])("refuses %s with a 400", async (_, cellId, label) => {
    expect((await claimJson(ALICE, cellId, label)).status).toBe(400);
  });

  it("accepts a 24-character name counted in characters, not bytes", async () => {
    const [cell] = await freeTiles();
    expect((await claimJson(CAROL, cell, "é".repeat(24))).status).toBe(200);
  });

  it("shows a name as text, never as markup", async () => {
    const [cell] = await freeTiles();
    expect((await claimJson(CAROL, cell, "<b>x</b>")).status).toBe(200);
    const res = await fetch(new URL("/", baseUrl));
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector(".board b")).toBeNull();
    expect(doc.querySelector(`button[value="${cell}"]`)!.getAttribute("title")).toBe("<b>x</b>");
  });
});

describe("heights", () => {
  it("raises each claimed tile by its claimed neighbours, and leaves free ones flat", async () => {
    // Put two personas side by side so at least one height is non-zero.
    const free = new Set(await freeTiles());
    const pair = [...free].find((id) => id % N < N - 1 && free.has(id + 1));
    expect(pair, "no two adjacent free tiles to test with").toBeDefined();
    expect((await claimJson(ALICE, pair, "Alice")).status).toBe(200);
    expect((await claimJson(BOB, pair! + 1, "Bob")).status).toBe(200);

    const tiles = await board();
    const claimed = (id: number): boolean => tiles[id].state !== "free";
    for (const tile of tiles) {
      const row = Math.floor(tile.id / N);
      const col = tile.id % N;
      let expected = 0;
      if (claimed(tile.id)) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r = row + dr;
            const c = col + dc;
            if ((dr || dc) && r >= 0 && r < N && c >= 0 && c < N && claimed(r * N + c)) expected++;
          }
        }
      }
      expect(tile.height, `tile ${tile.id}`).toBe(expected);
    }
    expect(tiles[pair!].height).toBeGreaterThan(0);
  });
});
