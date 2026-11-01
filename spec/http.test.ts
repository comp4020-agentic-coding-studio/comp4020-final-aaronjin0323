// The contract, against the running app, as separate visitors.
import { expect, inject, test } from "vitest";

const base = inject("baseUrl");
function visitor() {
  let cookie = "";
  const req = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(new URL(path, base), { ...init, headers: { ...(init.headers as object), ...(cookie ? { cookie } : {}) } });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const launch = (body: unknown, headers: Record<string, string> = {}) =>
    req("/launch", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const stream = async () => {
    const c = new AbortController();
    const r = await req("/events", { signal: c.signal });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const events: any[] = [];
    let wake = () => {};
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
            const data = /^data: (.*)$/m.exec(buf.slice(0, i));
            if (data) events.push(JSON.parse(data[1]));
            wake();
          }
        }
      } catch {}
    })();
    const until = async (ok: (e: any) => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      for (;;) {
        const e = events.find(ok);
        if (e) return e;
        if (Date.now() > end) throw new Error("no such event");
        await new Promise<void>((res) => {
          wake = res;
          setTimeout(res, 50);
        });
      }
    };
    return { until, events, close: () => c.abort() };
  };
  return { req, launch, stream };
}

test("the page is the arena, and the old museum's routes are gone", async () => {
  const v = visitor();
  const page = await (await v.req("/")).text();
  expect(page).toContain("data-arena");
  expect((await v.req("/stage/undo", { method: "POST", body: "{}" })).status).toBe(404);
  expect((await v.req("/hall/")).status).toBe(404);
});

test("a launch reaches another visitor's stream within 1000 ms, without any id but a tag", async () => {
  const a = visitor(), b = visitor();
  const sa = await a.stream(), sb = await b.stream();
  const me = (await sa.until((e) => e.you)).you;
  await sb.until((e) => e.robots?.some((r: any) => r.tag === me.tag));
  const at = Date.now();
  expect((await a.launch({ dir: [1, 1], power: 1, seq: 1 })).status).toBe(200);
  const e = await sb.until((x) => x.robots?.some((r: any) => r.tag === me.tag && r.seq === 1), 1000);
  expect(Date.now() - at).toBeLessThan(1000);
  expect(JSON.stringify(e)).not.toMatch(/"pid"|"name"/);
  sa.close();
  sb.close();
});

test("a launch is only a direction and a power; never a position", async () => {
  const a = visitor();
  const s = await a.stream();
  await s.until((e) => e.you);
  for (const bad of [{ dir: [1, 0], power: 2, seq: 1 }, { dir: [0, 0], power: 1, seq: 1 }, { dir: [1, 0], power: 1, seq: 1, pos: [1, 1] }, { pos: [1, 1] }]) {
    expect((await a.launch(bad)).status).toBe(400);
  }
  expect((await a.launch({ dir: [1, 0], power: 1, seq: 5 })).status).toBe(200);
  const stale = await a.launch({ dir: [1, 0], power: 1, seq: 5 });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toBe("stale-launch");
  s.close();
});

test("no stream, no robot; cross-site and oversized posts are refused", async () => {
  const a = visitor();
  expect(await (await a.launch({ dir: [1, 0], power: 1, seq: 1 })).json()).toMatchObject({ error: "no-robot" });
  expect((await a.launch({ dir: [1, 0], power: 1, seq: 1 }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await a.req("/launch", { method: "POST", body: "x".repeat(5000) })).status).toBe(413);
});

test("a fifth stream is refused for one visitor", async () => {
  const a = visitor();
  const open = [await a.stream(), await a.stream(), await a.stream(), await a.stream()];
  expect((await a.req("/events")).status).toBe(429);
  open.forEach((s) => s.close());
});

test("your collection is yours, and carries no pid", async () => {
  const a = visitor();
  const r = await a.req("/collection");
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toEqual({ items: [], catalog: {} });
});

const emptyRoom = { wall: "walnut", floor: "slate", light: "dusk", items: [] };
const saveRoom = (v: ReturnType<typeof visitor>, body: unknown, headers: Record<string, string> = {}) =>
  v.req("/room", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("the room pages are there, and a room is public but only its owner's to change", async () => {
  const a = visitor(), b = visitor();
  expect(await (await a.req("/room/")).text()).toContain("data-room");
  const me = await (await a.req("/rooms/me")).json();
  expect(me.mine).toBe(true);
  expect((await saveRoom(a, { layout: emptyRoom, was: me.rev })).status).toBe(200);

  const seen = await (await b.req(`/rooms/${me.tag}`)).json();
  expect(seen.mine).toBe(false);
  expect(seen.layout.wall).toBe("walnut");
  expect(await (await b.req(`/room/${me.tag}`)).text()).toContain("data-room");
  expect(JSON.stringify(seen)).not.toContain("shelf");

  // b has no way to name a's room: whatever it sends, it changes only b's
  expect((await saveRoom(b, { layout: { ...emptyRoom, wall: "plaster" }, was: seen.rev, tag: me.tag })).status).toBe(400);
  expect((await saveRoom(b, { layout: { ...emptyRoom, wall: "plaster" }, was: 0 })).status).toBe(200);
  expect((await v2(b, `/room/${me.tag}`)).status).toBe(404);
  expect((await v2(b, `/rooms/${me.tag}`)).status).toBe(404);
  expect((await (await a.req("/rooms/me")).json()).layout.wall).toBe("walnut");
});
const v2 = (v: ReturnType<typeof visitor>, path: string) => v.req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: emptyRoom, was: 0 }) });

test("rooms: no such room is 404, a bad cursor 400, cross-site saves 403, stale 409", async () => {
  const a = visitor();
  expect((await a.req("/rooms/00000000")).status).toBe(404);
  expect((await a.req("/room/nonsense")).status).toBe(404);
  expect((await a.req("/rooms?before=nonsense")).status).toBe(400);
  expect((await a.req("/rooms")).status).toBe(200);
  expect((await saveRoom(a, { layout: emptyRoom, was: 0 }, { origin: "https://evil.example" })).status).toBe(403);
  expect((await saveRoom(a, { layout: emptyRoom, was: 0 })).status).toBe(200);
  const stale = await saveRoom(a, { layout: emptyRoom, was: 0 });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toBe("stale-room");
});

test("the arena links to your room, in plain HTML", async () => {
  expect(await (await visitor().req("/")).text()).toMatch(/href="\/room\/"/);
});
