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

// Parks (docs/adr/0007): a public good, placed by someone holding land.
describe("parks", () => {
  const park = (pid: string, cellId: unknown): Promise<Response> =>
    fetch(new URL("/park", baseUrl), {
      method: "POST",
      headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cellId }),
    });
  // A free plot with no free plot beside it taken by anyone this test
  // doesn't control is hard to promise on a shared board, so these take
  // plots from the far end and only ask what the server answers.
  type ParkTile = { id: number; state: string; mine: boolean };
  async function parks(pid: string): Promise<ParkTile[]> {
    const doc = new JSDOM(await page(pid)).window.document;
    return [...doc.querySelectorAll<HTMLButtonElement>('button.tile[data-state="park"]')].map((b) => ({
      id: Number(b.value),
      state: b.dataset.state ?? "",
      mine: b.dataset.yours !== undefined,
    }));
  }

  it("lets ten simultaneous parks by one person leave at most two, charging for each one placed", async () => {
    const PIA = fresh();
    const [home, ...rest] = await freeTiles();
    expect((await claim(PIA, home, "Pia")).status).toBe(200);
    const cells = rest.slice(0, 10);
    const results = await Promise.all(cells.map((cell) => park(PIA, cell)));
    const placed = results.filter((r) => r.status === 200).length;
    // 100 coins pays for one park; the second is refused for coins or the
    // limit, never placed beyond it
    expect(placed).toBeGreaterThanOrEqual(1);
    expect(placed).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 402 || r.status === 400)).toBe(true);
    const mine = (await parks(PIA)).filter((p) => p.mine);
    expect(mine).toHaveLength(placed);
    for (const p of mine) expect(cells).toContain(p.id);
  });

  it("refuses a park from someone holding no land, on a held tile, and on a bad plot", async () => {
    const LEO = fresh();
    const MAE = fresh();
    const [a, b] = await freeTiles();
    const noLand = await park(LEO, a);
    expect(noLand.status).toBe(400);
    expect(await noLand.json()).toEqual({ error: "no-land" });
    expect((await claim(LEO, a, "Leo")).status).toBe(200);
    expect((await claim(MAE, b, "Mae")).status).toBe(200);
    // Mae's building is held: nobody can park on it, nor on Leo's own
    expect((await park(LEO, b)).status).toBe(409);
    expect((await park(LEO, a)).status).toBe(409);
    expect((await board(LEO)).find((t) => t.id === b)!.state).toBe("held");
    for (const bad of [-1, 144, "x", null]) expect((await park(LEO, bad)).status).toBe(400);
  });

  it("can't be built on while it stands: a claim onto it is a 409", async () => {
    const NIA = fresh();
    const OLA = fresh();
    const [home, spot] = await freeTiles();
    expect((await claim(NIA, home, "Nia")).status).toBe(200);
    expect((await park(NIA, spot)).status).toBe(200);
    expect((await claim(OLA, spot, "Ola")).status).toBe(409);
    expect((await board(OLA)).find((t) => t.id === spot)!.state).toBe("park");
  });

  it("shows the placer's park as theirs and no one else's, and never puts a pid in the page", async () => {
    const QUY = fresh();
    const [home, spot] = await freeTiles();
    expect((await claim(QUY, home, "Quy")).status).toBe(200);
    const res = await park(QUY, spot);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(QUY);
    expect((await parks(QUY)).find((p) => p.id === spot)?.mine).toBe(true);
    for (const body of [await page(IDA), await page()]) {
      const tile = new JSDOM(body).window.document.querySelector(`button.tile[value="${spot}"]`)!;
      expect([tile.getAttribute("data-state"), tile.getAttribute("title"), tile.hasAttribute("data-yours")]).toEqual(["park", "Quy", false]);
      expect(body).not.toContain(QUY);
    }
  });

  it("refuses a park from another site's page", async () => {
    const [cell] = await freeTiles();
    const res = await fetch(new URL("/park", baseUrl), {
      method: "POST",
      headers: { cookie: `pid=${IDA}`, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: new URLSearchParams({ cellId: String(cell) }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  it("answers a form with a 303 and a notice key", async () => {
    const RAY = fresh();
    const [home, spot] = await freeTiles();
    expect((await claim(RAY, home, "Ray")).status).toBe(200);
    const form = (cellId: number) =>
      fetch(new URL("/park", baseUrl), {
        method: "POST",
        headers: { cookie: `pid=${RAY}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ cellId: String(cellId) }).toString(),
        redirect: "manual",
      });
    const ok = await form(spot);
    expect([ok.status, ok.headers.get("location")]).toEqual([303, "/?notice=parked"]);
    const poor = await form(spot); // the plot is a park now
    expect([poor.status, poor.headers.get("location")]).toEqual([303, "/?notice=taken"]);
  });
});

// Return the favour (docs/adr/0008): who helped you is private. Your own
// page learns a plot and a time; nobody's page learns a pid.
describe("returning a favour", () => {
  const help = (pid: string, cellId: number): Promise<Response> =>
    fetch(new URL("/help", baseUrl), {
      method: "POST",
      headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cellId }),
    });
  type Me = { returnable?: { cellId: number; until: string } | null };
  const meOf = async (pid?: string): Promise<Me> => {
    const doc = new JSDOM(await page(pid)).window.document;
    return (JSON.parse(doc.querySelector("script[data-board-data]")!.textContent!) as { me: Me }).me;
  };

  it("tells only the helped person which plot to help back, and never puts a pid in any page or reply", async () => {
    const SAL = fresh();
    const TOM = fresh();
    // two free plots side by side in one row, from the far end
    const free = new Set(await freeTiles());
    const a = [...free].find((id) => id % 12 !== 0 && free.has(id - 1))!;
    expect(a, "no two free plots side by side").toBeDefined();
    expect((await claim(SAL, a, "Sal")).status).toBe(200);
    expect((await claim(TOM, a - 1, "Tom")).status).toBe(200);
    const res = await help(SAL, a - 1);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SAL);
    expect(body).not.toContain(TOM);

    const tom = await meOf(TOM);
    expect(tom.returnable).toEqual({ cellId: a, until: expect.any(String) });
    expect(Object.keys(tom.returnable!).sort()).toEqual(["cellId", "until"]);
    expect((await meOf(SAL)).returnable).toBeNull();
    expect((await meOf(IDA)).returnable).toBeNull();
    for (const html of [await page(TOM), await page(SAL), await page(IDA), await page()]) {
      expect(html).not.toContain(SAL);
      expect(html).not.toContain(TOM);
    }
    const back = await help(TOM, a);
    expect(back.status).toBe(200);
    const backBody = await back.text();
    expect(JSON.parse(backBody).notice).toBe("returned");
    expect(backBody).not.toContain(SAL);
    expect(backBody).not.toContain(TOM);
  });
});

// Zoning (docs/adr/0009): only you may rezone your own building, once, for
// what it costs. The route takes no plot, so a cellId in the body is ignored.
describe("rezoning", () => {
  const rezone = (pid: string, body: object, { origin, form = false }: { origin?: string; form?: boolean } = {}): Promise<Response> => {
    const headers: Record<string, string> = { cookie: `pid=${pid}` };
    if (origin) headers.origin = origin;
    if (form) headers["content-type"] = "application/x-www-form-urlencoded";
    else Object.assign(headers, { "content-type": "application/json", accept: "application/json" });
    return fetch(new URL("/rezone", baseUrl), {
      method: "POST",
      headers,
      body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
      redirect: "manual",
    });
  };
  type ZoneTile = { id: number; zone: string | null };
  const zones = async (pid?: string): Promise<ZoneTile[]> => {
    const doc = new JSDOM(await page(pid)).window.document;
    return [...doc.querySelectorAll<HTMLButtonElement>("button.tile")].map((b) => ({ id: Number(b.value), zone: b.dataset.zone ?? null }));
  };
  const coinsOf = async (pid: string): Promise<number> => {
    const doc = new JSDOM(await page(pid)).window.document;
    return (JSON.parse(doc.querySelector("script[data-board-data]")!.textContent!) as { me: { coins: number } }).me.coins;
  };

  it("changes only the poster's own building, whatever plot the body names, and shows the zone to everyone", async () => {
    const UMA = fresh();
    const VIC = fresh();
    const [mine, theirs] = await freeTiles();
    expect((await claim(UMA, mine, "Uma")).status).toBe(200);
    expect((await claim(VIC, theirs, "Vic")).status).toBe(200);
    const res = await rezone(UMA, { zone: "factory", cellId: theirs });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ notice: "rezoned", zone: "factory" });
    expect(body).not.toContain(UMA);
    for (const viewer of [VIC, IDA, undefined]) {
      const z = await zones(viewer);
      expect(z.find((t) => t.id === mine)?.zone, "Uma's building, as anyone sees it").toBe("factory");
      expect(z.find((t) => t.id === theirs)?.zone, "Vic's building is untouched").toBe("civic");
    }
    // free plots carry no zone
    expect((await zones()).filter((t) => t.zone !== null).every((t) => ["civic", "market", "factory"].includes(t.zone!))).toBe(true);
  });

  it("charges ten simultaneous rezones once", async () => {
    const WES = fresh();
    const [home] = await freeTiles();
    expect((await claim(WES, home, "Wes")).status).toBe(200);
    const before = await coinsOf(WES);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => rezone(WES, { zone: i % 2 ? "market" : "factory" })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 429 || r.status === 400)).toBe(true);
    expect(await coinsOf(WES)).toBe(before - 40);
  });

  it("refuses with a status per reason: no land, a bad zone, the same zone, cooling down, no coins", async () => {
    const XAN = fresh();
    const YUL = fresh();
    const [a, b] = await freeTiles();
    const status = async (r: Promise<Response>): Promise<[number, unknown]> => {
      const res = await r;
      return [res.status, await res.json()];
    };
    expect(await status(rezone(XAN, { zone: "market" }))).toEqual([400, { error: "no-land" }]);
    expect((await claim(XAN, a, "Xan")).status).toBe(200);
    for (const bad of ["", "Market", "park", "constructor", 7, null]) {
      expect(await status(rezone(XAN, { zone: bad })), String(bad)).toEqual([400, { error: "zone" }]);
    }
    expect(await status(rezone(XAN, {}))).toEqual([400, { error: "zone" }]);
    expect(await status(rezone(XAN, { zone: "civic" }))).toEqual([400, { error: "same-zone" }]);
    expect((await rezone(XAN, { zone: "market" })).status).toBe(200);
    expect(await status(rezone(XAN, { zone: "factory" }))).toEqual([429, { error: "cooldown" }]);
    // coins: Yul spends 60 of his 100 on a park, leaving exactly 40
    expect((await claim(YUL, b, "Yul")).status).toBe(200);
    const spot = (await freeTiles()).find((id) => id !== a && id !== b)!;
    expect((await fetch(new URL("/park", baseUrl), { method: "POST", headers: { cookie: `pid=${YUL}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ cellId: spot }) })).status).toBe(200);
    expect((await rezone(YUL, { zone: "market" })).status).toBe(200);
    expect(await coinsOf(YUL)).toBe(0);
    // nothing a fresh player can buy leaves them under 40 without a rezone,
    // whose cooldown then answers first: the 402 is held in spec/zoning.test.ts
  });

  it("refuses another site's page, and answers a form with a 303 and a notice key", async () => {
    const ZIA = fresh();
    const [home] = await freeTiles();
    expect((await claim(ZIA, home, "Zia")).status).toBe(200);
    expect((await rezone(ZIA, { zone: "market" }, { origin: "https://evil.example", form: true })).status).toBe(403);
    expect((await zones()).find((t) => t.id === home)?.zone).toBe("civic");
    const ok = await rezone(ZIA, { zone: "market" }, { form: true });
    expect([ok.status, ok.headers.get("location")]).toEqual([303, "/?notice=rezoned"]);
    const again = await rezone(ZIA, { zone: "factory" }, { form: true });
    expect([again.status, again.headers.get("location")]).toEqual([303, "/?notice=cooldown"]);
  });
});
