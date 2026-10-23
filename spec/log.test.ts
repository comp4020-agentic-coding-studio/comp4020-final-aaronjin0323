import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { line, quote, tag } from "../src/log.ts";
import { open, post, sleep, type Visitor } from "./helpers.ts";

// The server logs who did what, one `event key=value` line each, a person as
// a tag and every typed string JSON-quoted. The app under APP_URL is a
// separate process (a container in CI) whose stdout the spec can't read, so
// this file starts its own copy of src/server.ts on a free port with a
// throwaway database, and reads what it prints. Its own server, so its
// stage is its own too.

const MIA: Visitor = { pid: "00000000-0000-4000-8000-00000000017a", cookie: "pid=00000000-0000-4000-8000-00000000017a" };
const KAI: Visitor = { pid: "00000000-0000-4000-8000-0000000004a1", cookie: "pid=00000000-0000-4000-8000-0000000004a1" };
const ZED: Visitor = { pid: "00000000-0000-4000-8000-000000000ced", cookie: "pid=00000000-0000-4000-8000-000000000ced" };

let app: ChildProcess;
let dir: string;
let base: string;
let out = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "museum-log-"));
  app = spawn(process.execPath, ["src/server.ts"], {
    env: { ...process.env, PORT: "0", DB_PATH: join(dir, "museum.db"), NODE_ENV: "test", CLAIM_MS: "300", SWEEP_MS: "100" },
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

const act = (who: Visitor, path: string, body?: unknown, extra?: Record<string, string>) => post(who, path, body, extra, base);

// The log lines that start with `event`, once the server has had a moment.
async function lines(event: string): Promise<string[]> {
  await sleep(50);
  return out.split("\n").filter((l) => l.startsWith(event + " "));
}

describe("the server log", { concurrent: false }, () => {
  it("formats key=value, quoting strings and escaping what could fake a line", () => {
    expect(line("x", { who: { raw: "abc123" }, n: 3, ok: true, name: 'Mia "M"', gone: undefined })).toBe('x who=abc123 n=3 ok=true name="Mia \\"M\\""');
    expect(quote("a\nb")).toBe('"a\\nb"');
    expect(quote("a\u2028b\u202eb")).toBe('"a\\u2028b\\u202eb"');
    expect(JSON.parse(quote("a\u2028b\u202eb"))).toBe("a\u2028b\u202eb");
  });

  it("logs a new visitor, a rename and a page load by tag", async () => {
    expect((await act(MIA, "/me", { name: "Mia" })).status).toBe(200);
    const [fresh] = await lines("visitor.new");
    expect(fresh).toMatch(new RegExp(`^visitor\\.new who=${tag(MIA.pid)} name="[A-Z][a-z]+ [A-Z][a-z]+" colour=\\d$`));
    expect((await lines("rename"))[0]).toMatch(new RegExp(`^rename who=${tag(MIA.pid)} from="[A-Z][a-z]+ [A-Z][a-z]+" to="Mia"$`));
  });

  it("logs a grab that took a sphere, a gesture, and a refused throw naming the holder", async () => {
    await act(KAI, "/me", { name: "Kai" });
    expect((await act(MIA, "/stage/grab", { object: "teal" })).status).toBe(200);
    expect((await act(KAI, "/stage/grab", { object: "teal" })).status).toBe(200);
    expect((await act(MIA, "/stage/gesture", { gesture: { kind: "throw", object: "teal", at: 1, from: [0, 0.4, 0], v: [0, 1, 0] } })).status).toBe(409);
    expect((await act(MIA, "/stage/gesture", { gesture: { kind: "tap", object: "bell", at: 2.5 } })).status).toBe(200);
    expect((await lines("grab"))[0]).toBe(`grab who=${tag(MIA.pid)} object=teal`);
    expect((await lines("grab"))[1]).toBe(`grab who=${tag(KAI.pid)} object=teal from=${tag(MIA.pid)}:"Mia"`);
    expect((await lines("gesture"))[0]).toBe(`gesture who=${tag(MIA.pid)} kind=tap object=bell at=2.5 rev=2`);
    expect((await lines("gesture.refused"))[0]).toMatch(
      new RegExp(`^gesture\\.refused who=${tag(MIA.pid)} status=409 error=taken holder=${tag(KAI.pid)}:"Kai" message=".+"$`),
    );
  });

  it("logs a claim running out on the sweep", async () => {
    await sleep(600);
    expect((await lines("claim.expire"))[0]).toMatch(new RegExp(`^claim\\.expire who=${tag(KAI.pid)} part=teal at="[^"]+"$`));
  });

  it("logs a publish and a refused one, with the title quoted", async () => {
    const title = 'Moon "1"\nfake=line';
    const bad = await act(MIA, "/publish", { title, slot: 4 });
    expect(bad.status).toBe(400); // a newline isn't allowed in a title
    // plinth 4 holds the Chime Tree starter (exhibit 7, migration 4): replace it
    const ok = await act(MIA, "/publish", { title: 'Moon "1" \u202e', slot: 4, replace: true });
    expect(ok.status).toBe(200);
    const taken = await act(KAI, "/publish", { title: "Mine", slot: 1 });
    expect(taken.status).toBe(409);
    const [pub] = await lines("publish");
    expect(pub).toBe(`publish who=${tag(MIA.pid)} title="Moon \\"1\\" \\u202e" exhibit=10 n=1 slot=4 stored=7`);
    expect(out).not.toContain("\nfake=line");
    expect((await lines("publish.refused")).map((l) => l.split(" message=")[0])).toEqual([
      `publish.refused who=${tag(MIA.pid)} status=400 error=bad-request`,
      `publish.refused who=${tag(KAI.pid)} status=409 error=slot-taken`,
    ]);
  });

  it("logs restore, store and display", async () => {
    expect((await act(KAI, "/exhibits/5/restore", { versionId: 5 })).status).toBe(200);
    expect((await act(KAI, "/exhibits/10/store")).status).toBe(200);
    expect((await act(KAI, "/exhibits/10/display", { slot: 4 })).status).toBe(200);
    expect((await lines("restore"))[0]).toBe(`restore who=${tag(KAI.pid)} exhibit=5 from=1 n=2`);
    expect((await lines("store"))[0]).toBe(`store who=${tag(KAI.pid)} exhibit=10 slot=4`);
    expect((await lines("display"))[0]).toBe(`display who=${tag(KAI.pid)} exhibit=10 slot=4`);
  });

  it("logs a join that archived the loop, an undo, and a start-over", async () => {
    expect((await act(KAI, "/stage/join", { versionId: 6, replace: true })).status).toBe(200);
    expect((await act(KAI, "/stage/gesture", { gesture: { kind: "pluck", object: "ribbon", at: 3, u: 0.5 } })).status).toBe(200);
    expect((await act(KAI, "/stage/undo")).status).toBe(200);
    expect((await act(KAI, "/stage/clear")).status).toBe(200);
    expect((await lines("stage.join"))[0]).toBe(`stage.join who=${tag(KAI.pid)} version=6 draft=2 archived=1`);
    expect((await lines("undo"))[0]).toBe(`undo who=${tag(KAI.pid)} kind=pluck object=ribbon at=3`);
    expect((await lines("stage.clear"))[0]).toBe(`stage.clear who=${tag(KAI.pid)} archived=2`);
  });

  it("logs a cross-site POST, and a stream opening and closing with the spheres it dropped", async () => {
    expect((await act(ZED, "/me", { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await lines("rename.refused")).at(-1)).toBe(`rename.refused who=${tag(ZED.pid)} status=403 error=cross-origin`);

    const s = await open(ZED, base);
    await s.first();
    await act(ZED, "/stage/grab", { object: "gold" });
    s.close();
    await sleep(200);
    expect((await lines("stream.open")).at(-1)).toMatch(new RegExp(`^stream\\.open who=${tag(ZED.pid)} open=1$`));
    expect((await lines("stream.close")).at(-1)).toMatch(new RegExp(`^stream\\.close who=${tag(ZED.pid)} open=0 secs=\\d+ released=gold$`));
  });

  it("never prints a pid, only tags, once every path above has logged", async () => {
    for (const event of ["start", "visitor.new", "rename", "page", "grab", "gesture", "gesture.refused", "claim.expire", "undo", "publish", "restore", "stage.join", "stage.clear", "stream.open", "stream.close"]) {
      if (event === "page") {
        await fetch(base, { headers: { cookie: MIA.cookie } });
      }
      expect(await lines(event), `no ${event} line`).not.toEqual([]);
    }
    for (const v of [MIA, KAI, ZED]) {
      expect(out).not.toContain(v.pid);
      expect(out).toContain(tag(v.pid));
    }
    // every line is an event name, then key=value fields
    for (const l of out.trim().split("\n")) expect(l).toMatch(/^[a-z][a-z.-]*( [a-zA-Z]+=\S.*)*$/);
  });
});
