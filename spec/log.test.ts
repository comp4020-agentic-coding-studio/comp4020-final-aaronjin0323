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
// workbench is its own too.

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
    env: { ...process.env, PORT: "0", DB_PATH: join(dir, "museum.db"), NODE_ENV: "test", LEASE_MS: "300", SWEEP_MS: "100" },
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
    expect(quote("a b‮b")).toBe('"a\\u2028b\\u202eb"');
    expect(JSON.parse(quote("a b‮b"))).toBe("a b‮b");
  });

  it("logs a new visitor, a rename and a page load by tag", async () => {
    expect((await act(MIA, "/me", { name: "Mia" })).status).toBe(200);
    const [fresh] = await lines("visitor.new");
    expect(fresh).toMatch(new RegExp(`^visitor\\.new who=${tag(MIA.pid)} name="[A-Z][a-z]+ [A-Z][a-z]+" colour=\\d$`));
    expect((await lines("rename"))[0]).toMatch(new RegExp(`^rename who=${tag(MIA.pid)} from="[A-Z][a-z]+ [A-Z][a-z]+" to="Mia"$`));
  });

  it("logs a start, an edit and a refused edit naming the holder", async () => {
    await act(KAI, "/me", { name: "Kai" });
    expect((await act(MIA, "/draft/start", { recipe: "loop" })).status).toBe(200);
    expect((await act(MIA, "/draft/edit", { part: "ribbon", values: { turns: 3 } })).status).toBe(200);
    expect((await act(KAI, "/draft/edit", { part: "ribbon", values: { turns: 4 } })).status).toBe(409);
    expect((await lines("draft.start"))[0]).toBe(`draft.start who=${tag(MIA.pid)} recipe=loop draft=1`);
    expect((await lines("edit"))[0]).toBe(`edit who=${tag(MIA.pid)} part=ribbon values={"turns":3} rev=2`);
    expect((await lines("edit.refused"))[0]).toMatch(
      new RegExp(`^edit\\.refused who=${tag(KAI.pid)} status=409 error=lease-held holder=${tag(MIA.pid)}:"Mia" message=".+"$`),
    );
  });

  it("logs a lease running out on the sweep", async () => {
    await sleep(600);
    expect((await lines("lease.expire"))[0]).toMatch(new RegExp(`^lease\\.expire who=${tag(MIA.pid)} part=ribbon at="[^"]+"$`));
  });

  it("logs a publish and a refused one, with the title quoted", async () => {
    const title = 'Moon "1"\nfake=line';
    const bad = await act(MIA, "/publish", { title, slot: 4 });
    expect(bad.status).toBe(400); // a newline isn't allowed in a title
    const ok = await act(MIA, "/publish", { title: 'Moon "1" ‮', slot: 4 });
    expect(ok.status).toBe(200);
    const taken = await act(KAI, "/publish", { title: "Mine", slot: 1 });
    expect(taken.status).toBe(409);
    const [pub] = await lines("publish");
    expect(pub).toBe(`publish who=${tag(MIA.pid)} title="Moon \\"1\\" \\u202e" exhibit=4 n=1 slot=4`);
    expect(out).not.toContain("\nfake=line");
    expect((await lines("publish.refused")).map((l) => l.split(" message=")[0])).toEqual([
      `publish.refused who=${tag(MIA.pid)} status=400 error=bad-request`,
      `publish.refused who=${tag(KAI.pid)} status=409 error=slot-taken`,
    ]);
  });

  it("logs restore, store and display", async () => {
    expect((await act(KAI, "/exhibits/2/restore", { versionId: 2 })).status).toBe(200);
    expect((await act(KAI, "/exhibits/4/store")).status).toBe(200);
    expect((await act(KAI, "/exhibits/4/display", { slot: 5 })).status).toBe(200);
    expect((await lines("restore"))[0]).toBe(`restore who=${tag(KAI.pid)} exhibit=2 from=1 n=2`);
    expect((await lines("store"))[0]).toBe(`store who=${tag(KAI.pid)} exhibit=4 slot=4`);
    expect((await lines("display"))[0]).toBe(`display who=${tag(KAI.pid)} exhibit=4 slot=5`);
  });

  it("logs a remix that archived the draft, and a clear", async () => {
    expect((await act(KAI, "/draft/remix", { versionId: 3, replace: true })).status).toBe(200);
    expect((await act(KAI, "/draft/clear")).status).toBe(200);
    expect((await lines("draft.remix"))[0]).toBe(`draft.remix who=${tag(KAI.pid)} version=3 draft=2 archived=1`);
    expect((await lines("draft.clear"))[0]).toBe(`draft.clear who=${tag(KAI.pid)} archived=2`);
  });

  it("logs a cross-site POST, and a stream opening and closing with the leases it released", async () => {
    expect((await act(ZED, "/me", { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await lines("rename.refused")).at(-1)).toBe(`rename.refused who=${tag(ZED.pid)} status=403 error=cross-origin`);

    await act(ZED, "/draft/start", { recipe: "bloom" });
    const s = await open(ZED, base);
    await s.first();
    await act(ZED, "/draft/lease", { part: "stem" });
    s.close();
    await sleep(200);
    expect((await lines("stream.open")).at(-1)).toMatch(new RegExp(`^stream\\.open who=${tag(ZED.pid)} open=1$`));
    expect((await lines("stream.close")).at(-1)).toMatch(new RegExp(`^stream\\.close who=${tag(ZED.pid)} open=0 secs=\\d+ released=stem$`));
  });

  it("never prints a pid, only tags, once every path above has logged", async () => {
    for (const event of ["start", "visitor.new", "rename", "page", "draft.start", "edit", "edit.refused", "lease", "lease.expire", "publish", "restore", "draft.clear", "stream.open", "stream.close"]) {
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
