import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// docs/adr/0002-who-may-see-and-change-what.md, held over HTTP against the
// running app: the rules the server enforces for a client that ignores the
// page entirely. Rules claim.test.ts already holds (a held tile is a 409 and
// keeps its holder's name, one tile per person, bad input is a 400) aren't
// repeated here. Fixed personas of their own, so these never disturb the
// other files' players; nothing assumes an empty board.
const baseUrl = inject("baseUrl");

// A fresh person per test: since ADR 5 a second claim is a paid move with a
// cooldown, so a fixed persona reused across runs would be refused.
const fresh = (): string => randomUUID();
const IDA = "00000000-0000-4000-8000-0000000001da"; // only ever looks, or is refused
const UUID = /^pid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12});/;

type TileView = { id: number; state: string; aria: string; title: string | null };

async function page(pid?: string): Promise<string> {
  const res = await fetch(new URL("/", baseUrl), { headers: pid ? { cookie: `pid=${pid}` } : {} });
  expect(res.status).toBe(200);
  return res.text();
}

async function board(pid?: string): Promise<TileView[]> {
  const doc = new JSDOM(await page(pid)).window.document;
  return [...doc.querySelectorAll<HTMLButtonElement>("button.tile")].map((b) => ({
    id: Number(b.value),
    state: b.dataset.state ?? "",
    aria: b.getAttribute("aria-label") ?? "",
    title: b.getAttribute("title"),
  }));
}

function claimJson(cookie: string | null, cellId: unknown, label: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (cookie !== null) headers.cookie = cookie;
  return fetch(new URL("/claim", baseUrl), { method: "POST", headers, body: JSON.stringify({ cellId, label }) });
}

const claim = (pid: string, cellId: number, label: string): Promise<Response> =>
  claimJson(`pid=${pid}`, cellId, label);

// From the far end of the board: the other spec files run alongside this one
// and take the first free tile, and ten claims racing for the same tiles as
// them would fail both for the wrong reason.
async function freeTiles(): Promise<number[]> {
  const ids = (await board()).filter((t) => t.state === "free").map((t) => t.id).reverse();
  expect(ids.length, "the board has no free tiles left to test with").toBeGreaterThan(12);
  return ids;
}

describe("notices", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "shows nothing for ?notice=%s, a name every object inherits",
    async (key) => {
      const res = await fetch(new URL(`/?notice=${key}`, baseUrl));
      expect(res.status).toBe(200);
      const doc = new JSDOM(await res.text()).window.document;
      expect(doc.querySelector(".notice")).toBeNull();
    },
  );

  it("still shows a real notice, so the check above isn't passing on nothing", async () => {
    const doc = new JSDOM(await (await fetch(new URL("/?notice=taken", baseUrl))).text()).window.document;
    expect(doc.querySelector('.notice[data-notice="taken"]')?.textContent).toMatch(/got there first/);
  });
});

describe("one person, one tile", () => {
  it("lets ten simultaneous claims by one person leave exactly one tile theirs, and charge for one move at most", async () => {
    const GIA = fresh();
    const cells = (await freeTiles()).slice(0, 10);
    const results = await Promise.all(cells.map((cell) => claim(GIA, cell, "Gia")));
    // the first claims, one more may move (50 coins, then a 30-minute
    // cooldown), and every other is refused for the cooldown
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(2);
    expect(statuses.filter((s) => s !== 200).every((s) => s === 429)).toBe(true);
    const mine = (await board(GIA)).filter((t) => t.state === "mine");
    expect(mine).toHaveLength(1);
    expect(cells).toContain(mine[0].id);
  });
});

describe("a pid never leaves the server", () => {
  it("isn't in the page anyone else loads, with or without a cookie", async () => {
    const HAL = fresh();
    const [cell] = await freeTiles();
    expect((await claim(HAL, cell, "Hal")).status).toBe(200);
    for (const body of [await page(IDA), await page()]) {
      // the tile is there, held by Hal, so the page did render it
      const tile = new JSDOM(body).window.document.querySelector(`button.tile[value="${cell}"]`)!;
      expect([tile.getAttribute("data-state"), tile.getAttribute("title")]).toEqual(["held", "Hal"]);
      expect(body).not.toContain(HAL);
    }
  });
});

describe("who you are", () => {
  it("replaces a malformed pid cookie with a fresh one", async () => {
    // A refused label still identifies the visitor, so this claims nothing.
    const res = await claimJson("pid=not-a-uuid", 0, "");
    expect(res.status).toBe(400);
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(UUID);
    expect(set).not.toContain("not-a-uuid");
  });

  it("can't take a held tile by sending no cookie at all", async () => {
    const HAL = fresh();
    const [cell] = await freeTiles();
    expect((await claim(HAL, cell, "Hal")).status).toBe(200);
    expect((await claimJson(null, cell, "Nobody")).status).toBe(409);
    const after = (await board(HAL)).find((t) => t.id === cell)!;
    expect(after.state).toBe("mine");
    expect(after.title).toBe("Hal");
    expect(after.aria).toMatch(/\bHal\b/);
  });

  it("renames you when you claim your own tile again", async () => {
    const JOE = fresh();
    const [cell] = await freeTiles();
    expect((await claim(JOE, cell, "Joe")).status).toBe(200);
    expect((await claim(JOE, cell, "Joey")).status).toBe(200);
    const mine = (await board(JOE)).filter((t) => t.state === "mine");
    expect(mine.map((t) => t.id)).toEqual([cell]);
    expect(mine[0].title).toBe("Joey");
    expect(mine[0].aria).toMatch(/\bJoey\b/);
  });
});

describe("another site", () => {
  it.each([
    ["a foreign Origin", "https://evil.example"],
    ["Origin: null", "null"],
  ])("refuses a form post with %s, and the tile stays free", async (_, origin) => {
    const [cell] = await freeTiles();
    const res = await fetch(new URL("/claim", baseUrl), {
      method: "POST",
      headers: { cookie: `pid=${IDA}`, "content-type": "application/x-www-form-urlencoded", origin },
      body: new URLSearchParams({ cellId: String(cell), label: "Ida" }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
    expect((await board()).find((t) => t.id === cell)!.state).toBe("free");
  });
});
