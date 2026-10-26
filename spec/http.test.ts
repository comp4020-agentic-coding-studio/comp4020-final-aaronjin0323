// The museum over HTTP, against the running app (APP_URL): who is who, the
// routes' refusals, and that a change reaches another visitor within a
// second. There is one shared stage, so these run in order, in one file,
// and never assume it starts quiet.
import { describe, expect, inject, test } from "vitest";

const BASE: string = inject("baseUrl");

/** A visitor: a cookie jar, and a stream when asked for one. */
function visitor() {
  let cookie = "";
  const req = async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (cookie) headers.cookie = cookie;
    const r = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const post = async (path: string, body: unknown = {}, origin = BASE) => {
    const r = await req(path, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  /** Opens a stream (/events unless told) and collects every event as it arrives. */
  async function stream(path = "/events") {
    const ctl = new AbortController();
    const r = await req(path, { signal: ctl.signal });
    const events: { type: string; data: any; at: number }[] = [];
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "message";
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (data) events.push({ type, data: JSON.parse(data), at: Date.now() });
          }
        }
      } catch {
        /* closed */
      }
    })();
    const next = async (type: string, ok: (d: any) => boolean, ms = 1000) => {
      const end = Date.now() + ms;
      for (let seen = 0; Date.now() < end; await new Promise((r) => setTimeout(r, 10))) {
        for (; seen < events.length; seen++) if (events[seen].type === type && ok(events[seen].data)) return events[seen];
      }
      return null;
    };
    return { events, next, close: () => ctl.abort() };
  }
  return { req, post, stream, me: async () => (await (await req("/me")).json()) as { tag: string; name: string; colour: number } };
}

describe("visitors and the page", { concurrent: false }, () => {
  test("/ is the museum page, listing what's on display without a script", async () => {
    const r = await fetch(BASE + "/");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/<h1[^>]*>Impossible Museum<\/h1>/);
    expect(html).toMatch(/data-listing/);
  });
  test("two cookie jars are two visitors; one jar is the same visitor every time", async () => {
    const a = visitor(), b = visitor();
    const ma = await a.me(), mb = await b.me();
    expect(ma.tag).toMatch(/^[0-9a-f]{8}$/);
    expect(ma.tag).not.toBe(mb.tag);
    expect((await a.me()).tag).toBe(ma.tag);
  });
  test("the cookie is HttpOnly and SameSite=Lax", async () => {
    const r = await fetch(BASE + "/me");
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(r.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });
  test("rename shows in /me; a bad name is a 400", async () => {
    const a = visitor();
    expect((await a.post("/me", { name: "  Pat  " })).status).toBe(200);
    expect((await a.me()).name).toBe("Pat");
    expect((await a.post("/me", { name: "x".repeat(25) })).status).toBe(400);
    expect((await a.post("/me", { name: "" })).json.error).toBeTruthy();
  });
  test("a cross-site POST is a 403; JSON that doesn't parse is a 400", async () => {
    const a = visitor();
    const r = await a.post("/stage/gesture", { gesture: { kind: "ring", at: 1 } }, "https://evil.example");
    expect(r).toMatchObject({ status: 403, json: { error: "cross-origin" } });
    const bad = await a.req("/stage/gesture", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "{nope" });
    expect(bad.status).toBe(400);
  });
  test("static files are served, nothing outside public/", async () => {
    const js = await fetch(BASE + "/fountain.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    // an encoded slash gets past URL normalisation, so the server has to hold the line itself
    for (const p of ["/../src/db.ts", "/%2e%2e/package.json", "/..%2fpackage.json", "/..%2fnode_modules%2fmarked%2flib%2fmarked.esm.js"]) expect((await fetch(BASE + p)).status).toBe(404);
  });
});

describe("the stage, live", { concurrent: false }, () => {
  test("a gesture from one visitor reaches another's stream within a second", async () => {
    const a = visitor(), b = visitor();
    await a.me();
    const s = await b.stream();
    expect(await s.next("state", () => true)).not.toBeNull();
    const at = Math.round(Math.random() * 18000) / 1000;
    const sent = Date.now();
    expect((await a.post("/stage/gesture", { gesture: { kind: "ring", at } })).status).toBe(200);
    const got = await s.next("state", (d) => d.stage.gestures.some((g: any) => g.at === at && g.kind === "ring"), 1000);
    s.close();
    expect(got, "no state with the gesture within 1000 ms").not.toBeNull();
    expect(got!.at - sent).toBeLessThan(1000);
  });
  test("every state carries the server's time and who's here, without pids", async () => {
    const a = visitor(), b = visitor();
    const sa = await a.stream(), sb = await b.stream();
    const ta = (await a.me()).tag, tb = (await b.me()).tag;
    const st = await sa.next("state", (d) => d.here.some((w: any) => w.tag === ta) && d.here.some((w: any) => w.tag === tb), 2000);
    expect(st).not.toBeNull();
    expect(Date.parse(st!.data.serverTime)).toBeGreaterThan(0);
    expect(st!.data.you.tag).toBe(ta);
    expect(JSON.stringify(st!.data)).not.toMatch(/pid|[0-9a-f]{8}-[0-9a-f]{4}-/);
    sb.close();
    expect(await sa.next("state", (d) => !d.here.some((w: any) => w.tag === tb), 2000)).not.toBeNull();
    sa.close();
  });
  test("a bad gesture is a 400 and changes nothing", async () => {
    const a = visitor();
    for (const gesture of [{ kind: "flick", ball: "teal", v: [99, 0, 0], at: 1 }, { kind: "ring", at: 20 }, null]) {
      expect((await a.post("/stage/gesture", { gesture })).status).toBe(400);
    }
  });
  test("undo removes only your own newest gesture", async () => {
    const a = visitor(), b = visitor();
    const at = 3.123;
    expect((await a.post("/stage/gesture", { gesture: { kind: "ring", at } })).status).toBe(200);
    expect((await b.post("/stage/undo")).status).toBe(409);
    const s = await a.stream();
    const before = await s.next("state", () => true);
    expect(before!.data.stage.gestures.some((g: any) => g.at === at)).toBe(true);
    expect((await a.post("/stage/undo")).status).toBe(200);
    expect(await s.next("state", (d) => !d.stage.gestures.some((g: any) => g.at === at && g.by === before!.data.you.tag))).not.toBeNull();
    s.close();
  });
  test("pointers reach other visitors and are never in the state", async () => {
    const a = visitor(), b = visitor();
    const ta = (await a.me()).tag;
    const s = await b.stream();
    await a.stream();
    expect((await a.post("/pointer", { p: [0.5, 1, 0.25] })).status).toBe(200);
    const got = await s.next("pointers", (d) => d.some((p: any) => p.tag === ta && p.p[0] === 0.5), 1000);
    expect(got).not.toBeNull();
    const st = await s.next("state", () => true);
    expect(JSON.stringify(st!.data)).not.toContain('"p":[0.5');
    expect((await a.post("/pointer", { p: [1, 2] })).status).toBe(400);
    expect((await a.post("/pointer", { p: [99, 0, 0] })).status).toBe(400);
    s.close();
  });
  test("an aim rides on the pointer to other visitors, checked like a flick (ADR 23)", async () => {
    const a = visitor(), b = visitor();
    const ta = (await a.me()).tag;
    const s = await b.stream();
    await a.stream();
    const aim = { ball: "gold", v: [1.5, -2, 0.25] };
    expect((await a.post("/pointer", { p: [0.75, 1, 0], aim })).status).toBe(200);
    const got = await s.next("pointers", (d) => d.some((p: any) => p.tag === ta && p.aim?.ball === "gold"), 1000);
    expect(got!.data.find((p: any) => p.tag === ta).aim).toEqual(aim);
    // letting go drops it
    expect((await a.post("/pointer", { p: [0.75, 1, 0] })).status).toBe(200);
    expect(await s.next("pointers", (d) => d.some((p: any) => p.tag === ta && !p.aim), 1000)).not.toBeNull();
    for (const bad of [{ ball: "nope", v: [0, 0, 0] }, { ball: "gold", v: [99, 0, 0] }, { ball: "gold", v: [1, 2] }, { ball: "gold", v: [0, 0, 0], at: 1 }, "gold"]) {
      expect((await a.post("/pointer", { p: [0, 1, 0], aim: bad })).status).toBe(400);
    }
    expect((await a.post("/pointer", { p: null, aim })).status).toBe(400);
    s.close();
  });
});

describe("exhibits", { concurrent: false }, () => {
  test("leave it, then history, restore and join in, over HTTP", async () => {
    const a = visitor();
    await a.post("/stage/clear");
    expect((await a.post("/stage/gesture", { gesture: { kind: "ring", at: 2 } })).status).toBe(200);
    // somewhere to put it: an empty plinth, or replace plinth 6 (its exhibit goes to the storeroom)
    const st = await (await a.stream()).next("state", () => true);
    const empty = st!.data.slots.find((s: any) => !s.exhibit)?.slot;
    const r = await a.post("/publish", empty ? { title: "Check", slot: empty } : { title: "Check", slot: 6, replace: true });
    expect(r.status).toBe(200);
    const id = r.json.exhibitId;
    const h = await (await a.req(`/exhibits/${id}`)).json();
    expect(h.versions[0]).toMatchObject({ n: 1, title: "Check" });
    expect((await a.post(`/exhibits/${id}/restore`, { versionId: h.versions[0].id })).status).toBe(200);
    expect((await (await a.req(`/exhibits/${id}`)).json()).versions.length).toBe(2);
    expect((await a.post("/stage/join", { versionId: h.versions[0].id })).status).toBe(409);
    expect((await a.post("/stage/join", { versionId: h.versions[0].id, replace: true })).status).toBe(200);
    expect((await a.req("/exhibits/99999")).status).toBe(404);
    expect((await a.req("/exhibits/abc")).status).toBe(404);
  });
  test("a taken plinth is a 409 without replace", async () => {
    const a = visitor();
    await a.post("/stage/gesture", { gesture: { kind: "ring", at: 4 } });
    // fill plinth 1 if it's empty, then try again without replace
    await a.post("/publish", { title: "Fill", slot: 1 });
    expect(await a.post("/publish", { title: "Again", slot: 1 })).toMatchObject({ status: 409, json: { error: "slot-taken" } });
  });
  test("cleared loops are listed and can be brought back", async () => {
    const a = visitor();
    await a.post("/stage/gesture", { gesture: { kind: "ring", at: 5.5 } });
    expect((await a.post("/stage/clear")).status).toBe(200);
    const list = await (await a.req("/archive?before=999999999")).json();
    expect(list.loops[0].gestures.some((g: any) => g.at === 5.5)).toBe(true);
    expect((await a.post("/stage/bring-back", { archivedId: list.loops[0].id })).status).toBe(200);
    expect((await a.req("/archive?before=x")).status).toBe(400);
  });
});

// ADR 24: the server says where every robot is; a page sends only launches
describe("the hall", { concurrent: false }, () => {
  const robotOf = (d: any, tag: string) => d.robots.find((r: any) => r.tag === tag);
  const speed = (r: any) => Math.sqrt(r.vel[0] * r.vel[0] + r.vel[1] * r.vel[1]);
  test("/hall/ is the hall page", async () => {
    const r = await fetch(BASE + "/hall/");
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/<canvas[^>]*data-hall/);
  });
  test("a visitor has a robot while their hall is open, at rest, the server's clock on every snapshot", async () => {
    const a = visitor();
    const ta = (await a.me()).tag;
    const s = await a.stream("/hall/events");
    const got = await s.next("hall", (d) => !!robotOf(d, ta));
    expect(got).not.toBeNull();
    expect(got!.data.you.tag).toBe(ta);
    expect(Number.isInteger(got!.data.serverTime)).toBe(true);
    const r = robotOf(got!.data, ta);
    expect(r).toMatchObject({ vel: [0, 0], name: expect.any(String), colour: expect.any(Number) });
    expect(Number.isInteger(r.t)).toBe(true);
    expect(JSON.stringify(got!.data)).not.toMatch(/pid/);
    s.close();
  });
  test("a launch moves your robot, capped, and reaches another visitor within a second", async () => {
    const a = visitor(), b = visitor();
    const ta = (await a.me()).tag;
    const sb = await b.stream("/hall/events");
    const sa = await a.stream("/hall/events");
    await sa.next("hall", (d) => !!robotOf(d, ta));
    const sent = Date.now();
    const r = await a.post("/hall/launch", { dir: [3, 4], power: 1, seq: 5 });
    expect(r.status).toBe(200);
    expect(r.json.robot.seq).toBe(5);
    expect(speed(r.json.robot)).toBeCloseTo(8, 6);
    const seen = await sb.next("hall", (d) => robotOf(d, ta)?.seq === 5);
    expect(seen).not.toBeNull();
    expect(seen!.at - sent).toBeLessThan(1000);
    // ten more launches: never faster than one
    for (let i = 6; i < 16; i++) await a.post("/hall/launch", { dir: [1, 0], power: 1, seq: i });
    const last = await sb.next("hall", (d) => robotOf(d, ta)?.seq === 15);
    expect(speed(robotOf(last!.data, ta))).toBeLessThanOrEqual(8 + 1e-9);
    sa.close();
    sb.close();
  });
  test("a page can't say where its robot is, or launch it too hard", async () => {
    const a = visitor();
    const s = await a.stream("/hall/events");
    await s.next("hall", () => true);
    for (const bad of [{ dir: [1, 0], power: 0.5, seq: 1, pos: [1, 1] }, { dir: [1, 0], power: 2, seq: 1 }, { pos: [3, 3] }, { dir: [0, 0], power: 1, seq: 1 }]) {
      const r = await a.post("/hall/launch", bad);
      expect(r.status).toBe(400);
      expect(r.json.error).toBeTruthy();
    }
    expect((await a.post("/hall/launch", { dir: [1, 0], power: 0.5, seq: 1 }, "https://evil.example")).status).toBe(403);
    s.close();
  });
  test("no hall open, no robot to launch; leaving takes your robot away", async () => {
    const a = visitor(), b = visitor();
    const ta = (await a.me()).tag;
    expect((await a.post("/hall/launch", { dir: [1, 0], power: 0.5, seq: 1 })).status).toBe(409);
    const sb = await b.stream("/hall/events");
    const sa = await a.stream("/hall/events");
    expect(await sb.next("hall", (d) => !!robotOf(d, ta))).not.toBeNull();
    sa.close();
    expect(await sb.next("hall", (d) => !robotOf(d, ta), 2000)).not.toBeNull();
    sb.close();
  });
});
