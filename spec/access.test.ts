import { describe, expect, it } from "vitest";
import { baseUrl, get, post, stateOf, visitor } from "./helpers.ts";

// Who is who, and what any POST refuses before it touches the museum. None
// of these touch the workbench, so this file runs alongside the others
// (the workbench tests are all in spec/workbench.test.ts, in sequence).

const TAG = /^[0-9a-f]{6}$/;

describe("visitors", () => {
  it("gives a new browser a pid cookie: HttpOnly, SameSite=Lax, a year", async () => {
    const res = await fetch(new URL("/", baseUrl()));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^pid=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12};/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(cookie).toMatch(/; Max-Age=31536000(;|$)/);
  });

  it("keeps a well-formed cookie, and sets none", async () => {
    const a = visitor();
    const res = await get(a, "/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("treats two cookies as two visitors, each with a generated name and a tag", async () => {
    const a = visitor();
    const b = visitor();
    const [sa, sb] = await Promise.all([stateOf(a), stateOf(b)]);
    expect(sa.you.tag).toMatch(TAG);
    expect(sb.you.tag).toMatch(TAG);
    expect(sa.you.tag).not.toBe(sb.you.tag);
    expect(sa.you.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(sa.you.colour).toBeGreaterThanOrEqual(0);
    expect(sa.you.colour).toBeLessThan(8);
    // and the same cookie is the same visitor next time
    expect((await stateOf(a)).you).toEqual(sa.you);
  });

  it("never sends the pid in a state event", async () => {
    const a = visitor();
    const s = await stateOf(a);
    expect(JSON.stringify(s)).not.toContain(a.pid);
  });

  it("renames with POST /me, trimmed, and refuses an empty, overlong or control-character name", async () => {
    const a = visitor();
    const ok = await post(a, "/me", { name: "  Mia <b>  " });
    expect(ok.status).toBe(200);
    expect(ok.body.state.you.name).toBe("Mia <b>");
    expect((await stateOf(a)).you.name).toBe("Mia <b>");

    for (const name of ["", "   ", "x".repeat(25), "a\nb", "a\u0000b", "a\u2028b", 42, null]) {
      const r = await post(a, "/me", { name });
      expect(r.status, JSON.stringify(name)).toBe(400);
      expect(r.body).toMatchObject({ error: "bad-request", message: expect.any(String) });
    }
    // 24 characters counted as characters, not UTF-16 units
    expect((await post(a, "/me", { name: "🦩".repeat(24) })).status).toBe(200);
    expect((await stateOf(a)).you.name).toBe("🦩".repeat(24));
  });
});

describe("every POST", () => {
  it("refuses a cross-site Origin with 403 cross-origin, and changes nothing", async () => {
    const a = visitor();
    const before = (await stateOf(a)).you.name;
    const r = await post(a, "/me", { name: "Hijacked" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "cross-origin", message: expect.any(String) });
    expect((await stateOf(a)).you.name).toBe(before);
    for (const path of ["/stage/gesture", "/stage/grab", "/stage/clear", "/publish", "/exhibits/1/store", "/exhibits/1/restore"]) {
      const res = await post(a, path, {}, { origin: "https://evil.example" });
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toBe("cross-origin");
    }
  });

  it("refuses a body that isn't a JSON object, or is over 4096 bytes", async () => {
    const a = visitor();
    for (const body of ["{nope", "[1,2]", '"name"', "null"]) {
      const r = await post(a, "/me", body);
      expect(r.status, body).toBe(400);
      expect(r.body.error).toBe("bad-request");
    }
    const big = await post(a, "/me", { name: "x", pad: "y".repeat(5000) });
    expect(big.status).toBe(400);
    expect(big.body.error).toBe("bad-request");
  });

  it("refuses keys a route doesn't take", async () => {
    const r = await post(visitor(), "/me", { name: "Ok", pid: "someone-else" });
    expect(r.status).toBe(400);
  });

  it("answers an unknown action with 404 not-found as JSON", async () => {
    const r = await post(visitor(), "/stage/explode", {});
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not-found", message: expect.any(String) });
  });
});

describe("exhibits", () => {
  it("GET /exhibits/:id answers the history, newest first, or 404", async () => {
    const r = await get(null, "/exhibits/1");
    expect(r.status).toBe(200);
    expect(r.body.exhibit.id).toBe(1);
    const ns = r.body.versions.map((v: { n: number }) => v.n);
    expect(ns.length).toBeGreaterThan(0);
    expect(ns).toEqual([...ns].sort((x: number, y: number) => y - x));
    expect(ns.at(-1)).toBe(1);
    expect(r.body.versions.at(-1)).toMatchObject({ title: "Loop & Lantern", recipe: "loop", publishedBy: null });

    const missing = await get(null, "/exhibits/999999");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("not-found");
  });

  it("refuses restore, display and store of an exhibit that doesn't exist with 404", async () => {
    const a = visitor();
    expect((await post(a, "/exhibits/999999/restore", { versionId: 1 })).status).toBe(404);
    expect((await post(a, "/exhibits/999999/display", { slot: 6 })).status).toBe(404);
    expect((await post(a, "/exhibits/999999/store")).status).toBe(404);
  });

  it("refuses restore of a version from another exhibit with 404, and bad ids with 400", async () => {
    const a = visitor();
    expect((await post(a, "/exhibits/2/restore", { versionId: 1 })).status).toBe(404);
    for (const versionId of [0, -1, 1.5, "1", null]) {
      expect((await post(a, "/exhibits/1/restore", { versionId })).status, String(versionId)).toBe(400);
    }
    expect((await post(a, "/exhibits/1/display", { slot: 7 })).status).toBe(400);
    expect((await post(a, "/exhibits/1/display", { slot: "1" })).status).toBe(400);
  });
});

describe("the state event", () => {
  it("always lists six slots, in order", async () => {
    const s = await stateOf(visitor());
    expect(s.slots.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(typeof s.seq).toBe("number");
    expect(Date.parse(s.serverTime)).not.toBeNaN();
  });
});

describe("the archive", () => {
  it("pages back through archived loops, the state's newest few first", async () => {
    const a = visitor();
    const s = await stateOf(a);
    expect(typeof s.archivedTotal).toBe("number");
    const first = await get(a, "/archive");
    expect(first.status).toBe(200);
    // Other spec files archive drafts in parallel, so newer drafts may land
    // between the two reads. Nothing is ever removed, so the page is newest
    // first, and once past the newcomers it is the state's list in order.
    type D = { id: number; archivedAt: string };
    const page: D[] = first.body.drafts;
    const newestFirst = (x: D, y: D) => y.archivedAt.localeCompare(x.archivedAt) || y.id - x.id;
    expect(page).toEqual([...page].sort(newestFirst));
    const named = new Set(s.archivedDrafts.map((d) => d.id));
    const start = page.findIndex((d) => named.has(d.id));
    const after = start < 0 ? [] : page.slice(start).map((d) => d.id);
    expect(after).toEqual(s.archivedDrafts.map((d) => d.id).slice(0, after.length));
    expect(start >= 0 || s.archivedDrafts.length === 0 || page.length === 12).toBe(true);
    if (s.archivedTotal > s.archivedDrafts.length) expect(first.body.more).toBe(true);
    if (first.body.drafts.length > 0) {
      const last = first.body.drafts.at(-1).id;
      const next = await get(a, `/archive?before=${last}`);
      expect(next.status).toBe(200);
      expect(next.body.drafts.every((d: { id: number }) => d.id !== last)).toBe(true);
    }
  });

  it("refuses a before that isn't an id", async () => {
    for (const bad of ["x", "-1", "1.5", "", "constructor"]) {
      expect((await get(visitor(), `/archive?before=${bad}`)).status, bad).toBe(400);
    }
  });
});
