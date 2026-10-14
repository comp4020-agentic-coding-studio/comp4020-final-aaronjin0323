import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStore } from "../src/db.ts";
import { claimEffects, expiryDrops, line, people, quote, tag } from "../src/log.ts";

// Crit 10: the server logs who did what, and at the crit someone narrates two
// strangers' play from `flyctl logs` alone. The app under APP_URL is a
// separate process (a container in CI) whose stdout the spec can't read, so
// this file starts its own copy of src/server.ts, on a free port with a
// throwaway database, and reads what it prints.

const MIA = "00000000-0000-4000-8000-00000000017a";
const KAI = "00000000-0000-4000-8000-0000000004a1";
const ZED = "00000000-0000-4000-8000-000000000ced";
const TAG = /^[0-9a-f]{6}$/;

let app: ChildProcess;
let dir: string;
let base: string;
let out = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "skyline-log-"));
  app = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DB_PATH: join(dir, "app.db"), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout!.setEncoding("utf8").on("data", (s: string) => (out += s));
  app.stderr!.setEncoding("utf8").on("data", (s: string) => (out += s));
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start line:\n${out}`)), 10_000);
    app.stdout!.on("data", () => {
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
  app?.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
});

const claim = (pid: string, cellId: number, label: string): Promise<Response> =>
  fetch(new URL("/claim", base), {
    method: "POST",
    headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ cellId, label }),
  });

// The log lines that start with `event`, once the server has had a moment to
// write them.
async function lines(event: string): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 50));
  return out.split("\n").filter((l) => l.startsWith(event + " "));
}

describe("the server log", () => {
  it("says who claimed which tile, and tells two visitors apart", async () => {
    expect((await claim(MIA, 5 * 12 + 5, "Mia")).status).toBe(200); // r6c6
    expect((await claim(KAI, 5 * 12 + 6, "Kai")).status).toBe(200); // r6c7, beside her

    const claims = await lines("claim");
    expect(claims).toHaveLength(2);
    const [mia, kai] = claims;
    expect(mia).toMatch(new RegExp(`^claim who=${tag(MIA)} label="Mia" at=r6c6$`));
    expect(kai).toMatch(new RegExp(`^claim who=${tag(KAI)} label="Kai" at=r6c7 lifted=${tag(MIA)}:"Mia"$`));
    expect(tag(MIA)).toMatch(TAG);
    expect(tag(MIA)).not.toBe(tag(KAI));
  });

  it("names a move's old tile, and who a refused claim lost to", async () => {
    expect((await claim(MIA, 0, "Mia")).status).toBe(200); // moves to r1c1, dropping Kai
    expect((await claim(KAI, 0, "Kai")).status).toBe(409);

    const moved = (await lines("relocate")).at(-1)!;
    expect(moved).toMatch(new RegExp(`^relocate who=${tag(MIA)} label="Mia" at=r1c1 from=r6c6 dropped=${tag(KAI)}:"Kai"$`));
    const refused = (await lines("claim.refused")).at(-1)!;
    expect(refused).toMatch(
      new RegExp(`^claim.refused who=${tag(KAI)} status=409 reason=taken at=r1c1 label="Kai" held=${tag(MIA)}:"Mia"$`),
    );
  });

  it("logs each economy action by tag: collect, upgrade, renew, help, and each refusal with its status", async () => {
    const post = (pid: string, path: string, body: object = {}): Promise<Response> =>
      fetch(new URL(path, base), {
        method: "POST",
        headers: { cookie: `pid=${pid}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
    expect((await claim(ZED, 1, "Zed")).status).toBe(200); // r1c2, beside Mia at r1c1
    expect((await post(KAI, "/collect")).status).toBe(200);
    expect((await post(KAI, "/upgrade")).status).toBe(402);
    expect((await post(ZED, "/renew", { hours: 6 })).status).toBe(200);
    expect((await post(ZED, "/help", { cellId: 0 })).status).toBe(200);
    expect((await post(ZED, "/help", { cellId: 0 })).status).toBe(429);
    expect((await post(KAI, "/help", { cellId: 0 })).status).toBe(400);

    expect((await lines("collect")).at(-1)).toMatch(new RegExp(`^collect who=${tag(KAI)} paid=\\d+ coins=\\d+$`));
    expect((await lines("upgrade.refused")).at(-1)).toBe(`upgrade.refused who=${tag(KAI)} status=402 reason=coins`);
    expect((await lines("renew")).at(-1)).toMatch(new RegExp(`^renew who=${tag(ZED)} at=r1c2 hours=6 until="[^"]+" coins=0$`));
    expect((await lines("help")).at(-1)).toBe(`help who=${tag(ZED)} at=r1c2 to=r1c1 helped=${tag(MIA)}:"Mia"`);
    expect((await lines("help.refused")).slice(-2)).toEqual([
      `help.refused who=${tag(ZED)} status=429 reason=cooldown to=r1c1`,
      `help.refused who=${tag(KAI)} status=400 reason=not-neighbour to=r1c1`,
    ]);
  });

  it("logs a stream opening and closing, with the open count", async () => {
    const controller = new AbortController();
    const res = await fetch(new URL("/events", base), { headers: { cookie: `pid=${KAI}` }, signal: controller.signal });
    expect(res.status).toBe(200);
    expect((await lines("stream.open")).at(-1)).toMatch(new RegExp(`^stream.open who=${tag(KAI)} open=1$`));
    controller.abort();
    await new Promise((r) => setTimeout(r, 200));
    expect((await lines("stream.close")).at(-1)).toMatch(new RegExp(`^stream.close who=${tag(KAI)} open=0 secs=\\d+$`));
  });

  it("can't be made to forge a line with a typed label", async () => {
    const before = out.split("\n").length;
    const forged = "x\nclaim who=000000 at=r1c1";
    expect((await claim(KAI, 100, forged)).status).toBe(400); // a control character, so refused
    await new Promise((r) => setTimeout(r, 50));
    const added = out.split("\n").slice(before - 1, -1);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^claim\.refused who=[0-9a-f]{6} status=400 reason=label at=r9c5 label="x\\nclaim who=000000 at=r1c1"$/);
    expect(out.split("\n").filter((l) => l.startsWith("claim who=000000"))).toHaveLength(0);
  });

  it("never prints a pid, on any path a visitor can take", async () => {
    // A pid check only covers lines that were printed, so walk every logged
    // path first: a page load, a stream, a claim, a refusal.
    for (const pid of [MIA, KAI]) {
      expect((await fetch(new URL("/", base), { headers: { cookie: `pid=${pid}` } })).status).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 50));
    for (const event of ["page", "stream.open", "stream.close", "claim", "claim.refused", "relocate", "collect", "upgrade.refused", "renew", "help", "help.refused"]) {
      expect((await lines(event)).length, `no ${event} line was printed`).toBeGreaterThan(0);
    }
    for (const pid of [MIA, KAI, ZED]) {
      expect(out).not.toContain(pid);
      // nor a long run of it, in case something prints part of the cookie
      expect(out).not.toContain(pid.replaceAll("-", "").slice(-12));
    }
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("quoting", () => {
  it("keeps every string on one line, whatever it holds", () => {
    for (const s of ["a\nb", "a\rb", "a\u2028b", "a\u2029b", 'say "hi"', "back\\slash"]) {
      const l = line("claim", { label: s });
      expect(l).not.toMatch(/[\n\r\u2028\u2029]/);
      expect(JSON.parse(l.slice('claim label='.length))).toBe(s);
    }
  });

  it("escapes bidi overrides, so a label can't reorder the line it's on", () => {
    expect(quote("a\u202eb")).toBe('"a\\u202eb"');
    // an astral format character (a tag) is escaped as its surrogate pair, so the value still parses
    expect(quote("a\u{e0041}b")).toBe('"a\\udb40\\udc41b"');
    expect(JSON.parse(quote("a\u{e0041}b"))).toBe("a\u{e0041}b");
  });
});

// Replaced by ADR 5: "names whose dormant tile was taken over" went with
// dormant tiles. What a claim and an expiry did, by the same height rule:
describe("what a claim or an expiry did", () => {
  it("names who a claim lifted, and who a lease ending dropped", () => {
    const store = openStore(":memory:");
    try {
      const t0 = new Date("2026-10-01T10:00:00.000Z");
      store.claim(0, MIA, "Mia", t0);
      store.claim(2, KAI, "Kai", t0);
      const t1 = new Date(t0.getTime() + 60 * 60 * 1000);
      const before = store.tiles();
      expect(store.claim(1, "ivy-pid", "Ivy", t1)).toBe("claimed");
      const did = claimEffects(before, store.tiles(), "ivy-pid", 1, t1);
      expect(people(did.lifted)).toEqual({ raw: `${tag(MIA)}:"Mia",${tag(KAI)}:"Kai"` });
      expect(did.from).toBeNull();
      // Mia's lease ends a day on (Kai's too); Ivy, an hour younger, is who it drops
      const end = new Date(t0.getTime() + 24 * 60 * 60 * 1000);
      expect(people(expiryDrops(store.tiles(), 0, end))).toEqual({ raw: `${tag("ivy-pid")}:"Ivy"` });
    } finally {
      store.close();
    }
  });
});
