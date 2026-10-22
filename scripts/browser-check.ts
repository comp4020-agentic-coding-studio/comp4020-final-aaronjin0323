#!/usr/bin/env node
// The checks only a real browser can make, run by hand before committing a
// change to the page. It drives the Chrome you have installed (CI has none,
// so this isn't in `pnpm check`), against the running app at APP_URL.
//
//   node scripts/browser-check.ts            # everything
//   node scripts/browser-check.ts realtime   # one section
//   HEADED=1 node scripts/browser-check.ts   # a real GPU-backed window
//
// It writes screenshots to .shots/ (gitignored). Read them: a green run says
// the behaviour works, not that the page looks right.
//
// It plays on the shared stage and leaves exhibits as fixture visitors, so
// point it at a throwaway database, never production.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { refuseProduction } from "../spec/not-production.ts";

const APP = process.env.APP_URL ?? "http://localhost:8080";
refuseProduction(APP);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const only = process.argv[2];
mkdirSync(".shots", { recursive: true });

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

type Opts = Parameters<Browser["newContext"]>[0];
const DESKTOP: Opts = { viewport: { width: 1440, height: 900 } };
const PHONE: Opts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// Each context is its own cookie jar, so its own visitor.
async function visitor(browser: Browser, opts: Opts = DESKTOP): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: "reduce", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  await page.goto(`${APP}/?v=${Date.now()}`);
  await live(page);
  // and the 3D room, which loads after the stream: a probe before it exists
  // throws, and a gesture before it is drawn isn't seen
  await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function" || document.body.classList.contains("no-gl"), null, { timeout: 10_000 });
  return page;
}

/** Waits until the page has had a state event and enabled its controls. */
const live = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => document.body.dataset.conn === "live" && !document.querySelector("[data-people]")?.hasAttribute("hidden"), null, { timeout: 10_000 });

const post = (page: Page, path: string, body: unknown = {}): Promise<{ status: number; json: { error?: string } }> =>
  page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    },
    [path, body] as const,
  );

/** A quiet stage, whatever was playing (starting over archives, so
 * nothing is lost), with the stage card selected. */
async function freshStage(page: Page): Promise<void> {
  await post(page, "/stage/clear");
  await page.click('[data-go="bench"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-loop-ticks] .tick").length === 0, null, { timeout: 3000 }).catch(() => null);
}

/** The stage as the scene shows it: each object on the canvas. */
const stageOf = (page: Page) => page.evaluate(() => (document.querySelector("[data-scene]") as any).probe().stage);

/** A sphere's place on the stage now, in the stage's frame. */
const sphereAt = async (page: Page, id: string): Promise<number[]> => (await stageOf(page))?.spheres?.[id]?.pos ?? [0, 0, 0];

/** Waits until a sphere has moved on this page's screen; ms taken, or -1. */
const movedFrom = (page: Page, id: string, from: number[], ms: number, since = Date.now()): Promise<number> =>
  page
    .waitForFunction(
      ([id, p0]) => {
        const q = (document.querySelector("[data-scene]") as any).probe().stage.spheres[id as string].pos;
        const p = p0 as number[];
        return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0.1;
      },
      [id, from] as const,
      { timeout: ms },
    )
    .then(
      () => Date.now() - since,
      () => -1,
    );

/** The first-person view: where you stand, look, aim and what you hold. */
const fpOf = (page: Page) => page.evaluate(() => (document.querySelector("[data-scene]") as any).probe().fp);

/** Walks forward with the keyboard for `ms`, from wherever you are. */
async function walk(page: Page, ms: number, key = "KeyW"): Promise<void> {
  await page.focus("[data-scene]");
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

/** Aims the eyes at a sphere (as a mouse would turn them), then holds the
 * hand at the reticle for `holdMs` and lets go: a first-person throw. */
async function aimAndThrow(page: Page, id: string, holdMs = 500): Promise<void> {
  await page.evaluate((id) => {
    const c = document.querySelector("[data-scene]") as any;
    const s = c.probe().stage.spheres[id].pos;
    c.lookAtPoint(s[0], s[1] + 0.66, s[2]);
  }, id);
  await page.waitForTimeout(150);
  const box = (await page.locator("[data-scene]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Waits until this page's stage has shown an event of this kind. */
const heard = (page: Page, kind: string, ms: number): Promise<boolean> =>
  page.waitForFunction((k) => new RegExp(`\\b${k}\\b`).test(document.querySelector("[data-scene]")!.getAttribute("data-heard") ?? ""), kind, { timeout: ms }).then(
    () => true,
    () => false,
  );

const twoFrames = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Playwright's fullPage capture turns an emulated phone into a mouse
// device while it captures; growing the viewport to the page keeps it a
// phone. Two frames after the resize, or the shot can be half drawn.
async function wholePage(page: Page, path: string): Promise<void> {
  const screen = page.viewportSize();
  if (!screen) throw new Error("wholePage needs a fixed viewport");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: screen.width, height });
  await twoFrames(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path });
  await page.setViewportSize(screen);
}

// ------------------------------------------------------------------ sections

async function firstVisit(browser: Browser): Promise<void> {
  console.log("\n— first visit: what can I do? —");
  const page = await visitor(browser);
  const lede = (await page.textContent("[data-lede]")) ?? "";
  check(lede.trim().split(/\s+/).length <= 6 && lede.trim().length > 0, "the first line invites, in a few words", lede);
  const box = await page.locator("[data-lede]").boundingBox();
  check(!!box && box.y + box.height < 200, "and sits at the top of the first screen", `${Math.round(box?.y ?? -1)}px`);
  const plinths = await page.locator("[data-go]").count();
  check(plinths === 7, "the stage and six plinths are buttons", String(plinths));
  const listingHidden = await page.$eval("[data-static]", (el) => getComputedStyle(el).display === "none");
  check(listingHidden, "the no-JS listing steps aside once the page is live");
  const you = (await page.textContent("[data-you]")) ?? "";
  const here = await page.locator("[data-here] li").count();
  check(you.trim().length > 0 && here >= 1, "it says who you are and who's here", `${you.trim()}, ${here} here`);
  await page.context().close();
}

async function noScript(browser: Browser): Promise<void> {
  console.log("\n— without JavaScript —");
  const ctx = await browser.newContext({ ...DESKTOP, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${APP}/?v=${Date.now()}`);
  const items = await page.locator("[data-static] li").allTextContents();
  check(items.length === 6, "the server's listing names all six slots", items.join(" | "));
  await page.screenshot({ path: ".shots/no-js.png" });
  await ctx.close();
}

async function noWebGL(browser: Browser): Promise<void> {
  console.log("\n— without WebGL —");
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/.test(kind)) return null;
      return (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof real;
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors without WebGL", e.message));
  await page.goto(`${APP}/?v=${Date.now()}`);
  await live(page);
  check(await page.$eval("[data-scene]", (el) => getComputedStyle(el).display === "none"), "the canvas is hidden");
  await freshStage(page);
  const bell = page.locator('[data-gesture="tap:bell"]');
  check(await bell.isEnabled(), "the gesture buttons still work");
  await bell.click();
  await page.waitForFunction(() => document.querySelectorAll("[data-loop-ticks] .tick").length === 1, null, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-loop-ticks] .tick").count()) === 1, "and the loop shows the gesture");
  await page.click('[data-go="slot:1"]');
  await page.waitForSelector("[data-history] .version", { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-history] .version").count()) > 0, "history still lists versions");
  await page.screenshot({ path: ".shots/no-webgl.png" });
  await ctx.close();
}

// Real-time play in first person (ADR 16, 17): A walks up to the stage,
// aims at a sphere and throws it by holding and letting go; it plays on A's
// screen at once and on B's within a second. A holds gold; B takes it with
// its button, and A's throw is refused. B rings the bell from the
// keyboard and A sees it; the loop credits both.
async function realtime(browser: Browser): Promise<void> {
  console.log("\n— real-time: two people play the stage together —");
  const motion: Opts = { ...DESKTOP, reducedMotion: "no-preference" };
  const a = await visitor(browser, motion);
  const b = await visitor(browser, motion);
  await freshStage(a);
  await b.click('[data-go="bench"]');
  await walk(a, 900);
  const at = (await fpOf(a)).at as number[];
  check(Math.hypot(at[0], at[1]) >= 2.59 && Math.hypot(at[0], at[1]) < 4, "A walks up to the stage's edge, and not into it", `r ${Math.hypot(at[0], at[1]).toFixed(2)}`);
  const tealA = await sphereAt(a, "teal");
  const tealB = await sphereAt(b, "teal");
  await aimAndThrow(a, "teal");
  const sent = Date.now();
  const mine = await movedFrom(a, "teal", tealA, 600, sent);
  check(mine >= 0 && mine < 250, "A's throw plays on A's screen at once", `${mine} ms after letting go`);
  const seen = await movedFrom(b, "teal", tealB, 3000, sent);
  check(seen >= 0 && seen < 1000, "B sees A's throw within about a second, without reloading", `${seen} ms`);
  // grabbing takes it: A holds gold, B takes it, A's throw is refused
  await a.evaluate(() => {
    const c = document.querySelector("[data-scene]") as any;
    const s = c.probe().stage.spheres.gold.pos;
    c.lookAtPoint(s[0], s[1] + 0.66, s[2]);
  });
  await a.waitForTimeout(150);
  const box = (await a.locator("[data-scene]").boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await b.waitForFunction(() => document.querySelector('[data-gesture="throw:gold"]')?.getAttribute("aria-label")?.startsWith("Take"), null, { timeout: 3000 }).catch(() => null);
  const aName = ((await a.textContent("[data-you]")) ?? "").trim();
  const offer = (await b.getAttribute('[data-gesture="throw:gold"]', "aria-label")) ?? "";
  check(offer.includes(aName), "B sees that A holds the gold sphere, and can take it", offer);
  await b.click('[data-gesture="throw:gold"]');
  await b.waitForTimeout(300);
  await a.mouse.up();
  await a.waitForFunction(() => !(document.querySelector("[data-toast]") as HTMLElement).hidden, null, { timeout: 3000 }).catch(() => null);
  const toast = (await a.textContent("[data-toast]")) ?? "";
  check(/has it|Pick it up/.test(toast), "A's throw after B took it is refused, saying who has it", toast);
  await b.focus('[data-gesture="tap:bell"]');
  await b.keyboard.press("Enter");
  check(await heard(a, "ring", 3000), "A sees the bell B rang, on A's screen");
  await a.waitForFunction(() => document.querySelectorAll("[data-bench-credits] li").length >= 2, null, { timeout: 3000 }).catch(() => null);
  const credits = await a.$$eval("[data-bench-credits] [aria-label]", (els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  check(credits.length >= 2, "the loop credits both players", credits.join(" | "));
  await a.screenshot({ path: ".shots/play-a.png" });
  await b.screenshot({ path: ".shots/play-b.png" });
  await a.context().close();
  await b.context().close();
}

// Presence (ADR 17): each visitor sees the other standing in the room, a
// head in their colour that moves when they walk, and the sphere they hold
// floating in front of them.
async function presence(browser: Browser): Promise<void> {
  console.log("\n— presence: you see the others in the room —");
  const motion: Opts = { ...DESKTOP, reducedMotion: "no-preference" };
  const a = await visitor(browser, motion);
  const b = await visitor(browser, motion);
  await freshStage(a);
  // B turns a little and steps aside, so A (facing the stage) sees B
  await walk(b, 500, "KeyD");
  const others = async (p: Page) => ((await fpOf(p)).others as { tag: string; head: { x: number; y: number }; visible: boolean; holding: string | null }[]);
  await a.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().fp.others.length >= 1, null, { timeout: 3000 }).catch(() => null);
  const first = await others(a);
  check(first.length >= 1, "A sees B in the room", JSON.stringify(first.map((o) => o.tag)));
  // A walks round to the far side of the stage and looks back at B, then B
  // takes a step: A sees B's head move, still in view
  await a.evaluate(() => (document.querySelector("[data-scene]") as any).lookAtPoint(-3, 1.62, 0));
  await walk(a, 1200);
  const bAt = (await fpOf(b)).at as number[];
  await a.evaluate(([x, z]) => (document.querySelector("[data-scene]") as any).lookAtPoint(x, 1.62, z), bAt);
  await a.waitForTimeout(500);
  const before = (await others(a))[0];
  await walk(b, 250, "KeyA");
  await a.waitForTimeout(700);
  const after = (await others(a))[0];
  const moved = before && after ? Math.hypot(after.head.x - before.head.x, after.head.y - before.head.y) : 0;
  check(!!before?.visible && moved > 8, "and sees B's head move when B walks", `${Math.round(moved)}px`);
  // B walks up to the stage and picks up chrome: A sees it in B's hands
  await b.evaluate(() => (document.querySelector("[data-scene]") as any).lookAtPoint(0, 1.62, 0));
  await walk(b, 900);
  await b.evaluate(() => {
    const c = document.querySelector("[data-scene]") as any;
    const s = c.probe().stage.spheres.chrome.pos;
    c.lookAtPoint(s[0], s[1] + 0.66, s[2]);
  });
  await b.waitForTimeout(150);
  const box = (await b.locator("[data-scene]").boundingBox())!;
  await b.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await b.mouse.down();
  const holding = await a.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().fp.others.some((o: any) => o.holding === "chrome"), null, { timeout: 3000 }).then(() => true, () => false);
  check(holding, "A sees the sphere B picked up, in B's hands");
  await a.screenshot({ path: ".shots/presence-a.png" });
  await b.mouse.up();
  // B leaves: A's view no longer has B
  await b.context().close();
  const gone = await a.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().fp.others.length === 0, null, { timeout: 8000 }).then(() => true, () => false);
  check(gone, "when B leaves, B is gone from A's room");
  await a.context().close();
}

// The objects set each other off, on screen: a sphere thrown through the
// ribbon is caught, another visitor's pluck flings it off, and Undo takes
// back only your own gesture.
async function chain(browser: Browser): Promise<void> {
  console.log("\n— cause and effect: the ribbon catches, a pluck throws off —");
  const motion: Opts = { ...DESKTOP, reducedMotion: "no-preference" };
  const a = await visitor(browser, motion);
  const b = await visitor(browser, motion);
  await freshStage(a);
  await b.click('[data-go="bench"]');
  await a.waitForTimeout(600);
  // thrown straight through the ribbon, a moment from now in the loop
  const now = (await stageOf(a)).moment as number;
  await post(a, "/stage/grab", { object: "chrome" });
  const at = Number(((now + 0.4) % 12).toFixed(3));
  await post(a, "/stage/gesture", { gesture: { kind: "throw", object: "chrome", at, from: [0.62, 0.95, 0], v: [0.9, 0, 0] } });
  check(await heard(a, "catch", 3000), "a sphere thrown through the ribbon is caught, with a flash and a sound");
  // B plucks the ribbon once chrome rides it: it's flung off on A's screen
  await b.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().stage && /catch/.test(document.querySelector("[data-scene]")!.getAttribute("data-heard") ?? "x") , null, { timeout: 3000 }).catch(() => null);
  await a.waitForTimeout(200);
  await b.click('[data-gesture="pluck:ribbon"]');
  check(await heard(a, "fling", 4000), "another visitor's pluck flings it off, on the first visitor's screen");
  // Undo on A takes back A's throw, never B's pluck
  await a.click("[data-undo]");
  await a.waitForFunction(() => document.querySelectorAll("[data-loop-ticks] .tick").length === 1, null, { timeout: 3000 }).catch(() => null);
  const left = await a.locator("[data-loop-ticks] .tick").count();
  check(left === 1, "Undo takes back your own gesture and leaves the other visitor's", `${left} left`);
  await a.screenshot({ path: ".shots/chain.png" });
  await a.context().close();
  await b.context().close();
}

async function publishing(browser: Browser): Promise<void> {
  console.log("\n— leaving it, history, restore, joining in —");
  const page = await visitor(browser);
  await freshStage(page);
  check(await page.locator("[data-publish-open]").isDisabled(), "a quiet stage has nothing to leave");
  await page.click('[data-gesture="tap:bell"]');
  await page.click('[data-gesture="pluck:ribbon"]');
  await page.waitForFunction(() => !(document.querySelector("[data-publish-open]") as HTMLButtonElement).disabled, null, { timeout: 3000 }).catch(() => null);
  await page.click("[data-publish-open]");
  const suggested = await page.inputValue("#publish-title");
  check(suggested.length > 0 && suggested.length <= 40, "Leave it suggests a playful title", suggested);
  const title = `Check ${Date.now() % 100000}`;
  await page.fill("#publish-title", title);
  // a full slot asks first, naming what moves to the storeroom
  const replace = page.locator('input[name="target"][data-group="replace"]').first();
  if ((await replace.count()) > 0) {
    await replace.check();
    const plan = (await page.textContent("[data-plan]")) ?? "";
    check(/Replaces ".+" on plinth \d/.test(plan), "a taken slot says what it replaces", plan);
    await page.click('[data-publish] button[type="submit"]');
    const asked = (await page.textContent("[data-ask-text]")) ?? "";
    check(/moves to the storeroom/.test(asked) && (await page.locator("[data-ask]").isVisible()), "and asks before moving it", asked);
    await page.click('[data-ask] button[value="no"]');
  }
  await page.locator('input[name="target"][data-group="version"]').first().check();
  await page.screenshot({ path: ".shots/publish-form.png" });
  await page.click('[data-publish] button[type="submit"]');
  await page.waitForSelector('[data-view="exhibit"]:not([hidden]) [data-history] .version', { timeout: 3000 }).catch(() => null);
  const heading = (await page.textContent("[data-ex-title]")) ?? "";
  check(heading === title, "leaving it shows the exhibit with its new title", heading);
  const versions = await page.locator("[data-history] .version").count();
  check(versions >= 2, "its history lists every version", String(versions));
  await page.locator("[data-history] .version-chip").last().click();
  await page.locator('[data-history] button[aria-label^="Restore as version"]').click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-history] .version").length === n + 1, versions, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-history] .version").count()) === versions + 1, "restore adds a version rather than changing one");
  await page.screenshot({ path: ".shots/history.png" });
  // Join in, over a loop someone's playing, asks and archives it
  const newest = async () => (await page.locator("[data-archive] .shelf-item").first().textContent().catch(() => "")) ?? "";
  const archivedBefore = await newest();
  await page.click("[data-ex-join]");
  const asked = (await page.textContent("[data-ask-text]")) ?? "";
  check(/Archived loops/.test(asked), "Join in over someone's playing asks first, saying it's archived", asked);
  await page.click("[data-ask-yes]");
  await page.waitForFunction((t) => (document.querySelector("[data-archive] .shelf-item")?.textContent ?? "") !== t, archivedBefore, { timeout: 3000 }).catch(() => null);
  check((await newest()) !== archivedBefore, "the loop that was playing is in Archived loops");
  check((await page.getAttribute('[data-go="bench"]', "aria-pressed")) === "true", "and the performance is on the stage to play along with");
  await page.context().close();
}

async function archive(browser: Browser): Promise<void> {
  console.log("\n— every archived loop stays reachable —");
  const page = await visitor(browser);
  // archive enough loops that the state's newest 12 can't hold them all
  for (let i = 0; i < 15; i++) {
    await post(page, "/stage/gesture", { gesture: { kind: "tap", object: "bell", at: i * 0.5 } });
    await post(page, "/stage/clear");
  }
  await page.waitForFunction(() => Number(document.querySelector("[data-archive-count]")?.textContent) >= 15, null, { timeout: 5000 });
  const total = Number(await page.textContent("[data-archive-count]"));
  await page.click("[data-archive-box] > summary");
  const shown = () => page.locator("[data-archive] .shelf-item").count();
  const before = await shown();
  check(before > 0 && before < total, "the drawer starts with the newest few", `${before} of ${total}`);
  let clicks = 0;
  while ((await page.locator("[data-archive-older]").count()) > 0 && clicks < 50) {
    const n = await shown();
    await page.click("[data-archive-older]");
    await page.waitForFunction((m) => document.querySelectorAll("[data-archive] .shelf-item").length > m, n, { timeout: 3000 });
    clicks++;
  }
  check((await shown()) === total, "Show older reaches every one", `${await shown()} of ${total} after ${clicks} click(s)`);
  await page.context().close();
}

async function disconnect(browser: Browser): Promise<void> {
  console.log("\n— disconnected: look, don't edit —");
  const page = await visitor(browser);
  await freshStage(page);
  await page.context().setOffline(true);
  // EventSource notices a dead network on its own; kick it by closing the stream
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForFunction(() => document.body.dataset.conn !== "live", null, { timeout: 15_000 }).catch(() => null);
  const status = (await page.textContent("[data-status]")) ?? "";
  check(/Reconnecting/.test(status) && (await page.locator("[data-status]").isVisible()), "it says it's reconnecting", status);
  const enabled = await page.$$eval("[data-edit]", (els) => els.filter((e) => !(e as HTMLButtonElement).disabled && (e as HTMLElement).offsetParent !== null).length);
  check(enabled === 0, "every control is disabled", `${enabled} still enabled`);
  check(await page.locator('[data-view="bench"]').isVisible(), "and the view stays");
  await page.screenshot({ path: ".shots/disconnected.png" });
  await page.context().setOffline(false);
  await live(page).catch(() => null);
  check(await page.locator('[data-gesture="tap:bell"]').isEnabled(), "play comes back after the first state of the new connection");
  await page.context().close();
}

async function keyboard(browser: Browser): Promise<void> {
  console.log("\n— keyboard only —");
  const page = await visitor(browser);
  await freshStage(page);
  await page.focus("body");
  const reached = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const what = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      return el.dataset.go ? `go:${el.dataset.go}` : el.dataset.gesture ? `gesture:${el.dataset.gesture}` : el.id || el.dataset.scene !== undefined ? el.id || "scene" : el.tagName;
    });
    reached.add(what);
  }
  check(reached.has("go:slot:1") && reached.has("go:bench"), "plinth buttons are in tab order");
  const gestures = [...reached].filter((r) => r.startsWith("gesture:"));
  check(gestures.length === 6, "every gesture is a button in tab order", gestures.join(", "));
  check(reached.has("scene"), "the canvas takes focus");
  // arrow keys on the canvas orbit the camera, and don't scroll the page
  await page.focus("[data-scene]");
  const y0 = await page.evaluate(() => scrollY);
  const before = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 600 } });
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  const after = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 600 } });
  const gl = !(await page.evaluate(() => document.body.classList.contains("no-gl")));
  if (gl) check(!before.equals(after), "arrow keys on the canvas turn and walk you");
  check((await page.evaluate(() => scrollY)) === y0, "without scrolling the page");
  // Enter on a plinth selects it and its history
  await page.focus('[data-go="slot:2"]');
  await page.keyboard.press("Enter");
  check((await page.getAttribute('[data-go="slot:2"]', "aria-pressed")) === "true", "Enter on a plinth selects it");
  // a gesture by keyboard: Enter on the bell adds it to the loop
  await page.focus('[data-go="bench"]');
  await page.keyboard.press("Enter");
  await page.focus('[data-gesture="tap:bell"]');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("[data-loop-ticks] .tick").length >= 1, null, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-loop-ticks] .tick").count()) >= 1, "Enter on a gesture button plays it");
  // and a throw from the keyboard: grabbed and thrown in one press
  await page.focus('[data-gesture="throw:teal"]');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("[data-loop-ticks] .tick").length >= 2, null, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-loop-ticks] .tick").count()) >= 2, "a sphere can be thrown from the keyboard");
  await page.context().close();
}

async function viewports(browser: Browser): Promise<void> {
  console.log("\n— both viewports —");
  for (const [name, opts, mobile] of [
    ["desktop", DESKTOP, false],
    ["phone", PHONE, true],
  ] as const) {
    const ctx: BrowserContext = await browser.newContext({ ...opts });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => check(false, "no script errors", e.message));
    await page.goto(`${APP}/?v=${Date.now()}`);
    await live(page);
    const width = opts!.viewport!.width;
    if (mobile) {
      // headless --window-size has a minimum width; pin the phone through CDP
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true });
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `.shots/${name}.png` });
    await page.evaluate(() => {
      const q = matchMedia("(hover: none) and (pointer: coarse)");
      const seen = [q.matches];
      q.addEventListener("change", (e) => seen.push(e.matches));
      Object.assign(window, { touchSeen: seen });
    });
    // with something playing on the stage
    await freshStage(page);
    await page.click('[data-gesture="tap:bell"]');
    await page.waitForTimeout(800);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw === width, `${name}: no sideways scroll`, `${sw}px`);
    await page.screenshot({ path: `.shots/${name}-bench.png` });
    if (mobile) {
      await wholePage(page, `.shots/${name}-whole.png`);
      const seen = await page.evaluate(() => (window as unknown as { touchSeen: boolean[] }).touchSeen);
      check(seen.length > 0 && seen.every(Boolean), "phone: styled as a touch screen all through its screenshot", seen.join(" → "));
      // every gesture button is a comfortable thumb's width
      const narrow = await page.$$eval("[data-gesture]", (els) => els.filter((e) => e.getBoundingClientRect().width < 44).length);
      check(narrow === 0, "phone: every gesture button is at least 44px wide", `${narrow} narrower`);
      // the row shows colours and numbers; each button names its exhibit
      // in full for screen readers and on hover (ADR 13)
      const named = await page.$$eval("[data-go]", (els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      check(named.length === 7 && named.every((n) => /^(The stage|Plinth \d): .+/.test(n)), "phone: every plinth button names its exhibit", named.join(" | "));
      const small = await page.$$eval("button:not([hidden])", (els) => els.filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().height < 32).map((e) => e.textContent?.trim()));
      check(small.length === 0, "phone: every visible button is a comfortable tap", small.join(", "));
    } else {
      await page.click('[data-go="slot:1"]');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `.shots/${name}-plinth.png` });
    }
    await ctx.close();
  }
}

// AA contrast measured on the rendered pixels behind each piece of visible
// text (the sky and the 3D room are never flat): hide the text, capture,
// and compare against the 5th-percentile pixel inside the element's border.
async function contrast(browser: Browser): Promise<void> {
  console.log("\n— contrast over the sky, on the pixels —");
  for (const [name, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    for (const sel of ["bench", "slot:2"]) {
      await page.click(`[data-go="${sel}"]`);
      await page.waitForTimeout(1800);
      const items = await page.evaluate(() => {
        const out: { text: string; color: string; size: string; weight: string; box: { x: number; y: number; width: number; height: number } }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set<Element>();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const e = n.parentElement!;
          if (!n.textContent!.trim() || seen.has(e) || !e.offsetParent || getComputedStyle(e).visibility === "hidden") continue;
          // clip to every scrolling ancestor: text scrolled out of view isn't read
          const r0 = e.getBoundingClientRect();
          let l = r0.left, t = Math.max(0, r0.top), rr = Math.min(innerWidth, r0.right), bb = Math.min(innerHeight, r0.bottom);
          for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
            const o = getComputedStyle(a);
            if (/(auto|scroll|hidden)/.test(o.overflowX + o.overflowY)) {
              const ar = a.getBoundingClientRect();
              l = Math.max(l, ar.left); t = Math.max(t, ar.top); rr = Math.min(rr, ar.right); bb = Math.min(bb, ar.bottom);
            }
          }
          if (rr - l < 12 || bb - t < 8) continue;
          seen.add(e);
          e.setAttribute("data-cx", "");
          const cs = getComputedStyle(e);
          out.push({ text: n.textContent!.trim().slice(0, 30), color: cs.color, size: cs.fontSize, weight: cs.fontWeight, box: { x: l, y: t, width: rr - l, height: bb - t } });
        }
        return out;
      });
      const style = await page.addStyleTag({ content: "[data-cx], [data-cx] * { color: transparent !important; text-shadow: none !important; }" });
      await twoFrames(page);
      const shot = (await page.screenshot()).toString("base64");
      await style.evaluate((s) => (s as Element).remove());
      await page.evaluate(() => document.querySelectorAll("[data-cx]").forEach((e) => e.removeAttribute("data-cx")));
      const bad = await page.evaluate(
        async ([b64, items, vw]) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0);
          const px = g.getImageData(0, 0, img.width, img.height).data;
          const dpr = img.width / (vw as number);
          const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          const lum = (r: number, gg: number, b: number) => 0.2126 * ch(r) + 0.7152 * ch(gg) + 0.0722 * ch(b);
          const out: string[] = [];
          for (const it of items as typeof items extends (infer T)[] ? T[] : never) {
            const m = it.color.match(/[\d.]+/g)!.map(Number);
            if (m[3] !== undefined && m[3] < 0.1) continue;
            const L = lum(m[0], m[1], m[2]);
            const inset = 5;
            const crs: number[] = [];
            for (let y = Math.floor((it.box.y + inset) * dpr); y < (it.box.y + it.box.height - inset) * dpr; y += 2)
              for (let x = Math.floor((it.box.x + inset) * dpr); x < (it.box.x + it.box.width - inset) * dpr; x += 2) {
                const k = (y * img.width + x) * 4;
                const Lb = lum(px[k], px[k + 1], px[k + 2]);
                crs.push((Math.max(L, Lb) + 0.05) / (Math.min(L, Lb) + 0.05));
              }
            if (!crs.length) continue;
            crs.sort((a, b) => a - b);
            const worst = crs[Math.floor(crs.length * 0.05)];
            const large = parseFloat(it.size) >= 24 || (parseFloat(it.size) >= 18.66 && Number(it.weight) >= 700);
            if (worst < (large ? 3 : 4.5)) out.push(`"${it.text}" ${worst.toFixed(2)}`);
          }
          return out;
        },
        [shot, items, page.viewportSize()!.width] as const,
      );
      check(items.length > 0 && bad.length === 0, `${name}, ${sel}: every visible text is AA on what's behind it`, bad.length ? bad.join("; ") : `${items.length} measured`);
    }
    await page.context().close();
  }
}

// The word budget (ADR 13): visible words on the first screen, counting
// names, titles and numbers, on the bench view and on a plinth.
async function words(browser: Browser): Promise<void> {
  console.log("\n— words on the first screen (ADR 13) —");
  for (const [name, opts, budget] of [["desktop", DESKTOP, 40], ["phone", PHONE, 30]] as const) {
    const page = await visitor(browser, opts);
    // the stage card and a plinth
    for (const sel of ["bench", "slot:1"]) {
      await page.click(`[data-go="${sel}"]`);
      await page.waitForTimeout(800);
      const seen = await page.evaluate(() => {
        const out: string[] = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const e = n.parentElement!;
          const t = n.textContent!.trim();
          // checkVisibility also sees a closed <details>, whose content keeps
          // an offsetParent while it isn't rendered
          if (!t || !e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) || e.closest(".sr-only")) continue;
          const r = e.getBoundingClientRect();
          if (r.width < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          out.push(t);
        }
        return out;
      });
      const count = seen.join(" ").split(/\s+/).filter(Boolean).length;
      check(count > 0 && count <= budget, `${name}, ${sel}: at most ${budget} words`, `${count}: ${seen.join(" | ")}`);
    }
    await page.context().close();
  }
}

// On the phone the sculpture stays in sight while every control on the bench
// is worked (CLAUDE.md, "Phone and keyboard"): the scene is pinned above a
// panel that scrolls on its own, and the page never scrolls.
async function phoneEdit(browser: Browser): Promise<void> {
  console.log("\n— phone: the stage stays in sight while you play —");
  const page = await visitor(browser, PHONE);
  await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
  await freshStage(page);
  await page.click('[data-gesture="tap:bell"]');
  const controls = await page.locator('[data-view="bench"] button').filter({ visible: true }).all();
  const misses: string[] = [];
  for (const c of controls) {
    await c.scrollIntoViewIfNeeded();
    await c.focus();
    await twoFrames(page);
    const r = await page.evaluate((el) => {
      const vh = innerHeight;
      const vw = innerWidth;
      const scene = document.querySelector("[data-scene]")!.getBoundingClientRect();
      const box = (el as Element).getBoundingClientRect();
      const shown = box;
      // the sculpture itself, not just its canvas: inside the uncovered
      // scene, unblocked, and big enough to see a change
      const canvas = document.querySelector("[data-scene]") as any;
      const p = canvas.probe();
      const v = p.view, b = p.box;
      const sculptureIn = b.x >= v.x - 1 && b.y >= v.y - 1 && b.x + b.w <= v.x + v.w + 1 && b.y + b.h <= v.y + v.h + 1 && p.occluded < 0.03 && b.w * b.h >= 0.2 * v.w * v.h;
      return {
        sculptureIn,
        id: (el as Element).id || (el as HTMLInputElement).name + ":" + (el as HTMLInputElement).value || (el as Element).textContent?.trim(),
        sceneIn: scene.top >= -1 && scene.bottom <= vh + 1 && scene.height >= vh * 0.3 && scene.left >= -1 && scene.right <= vw + 1,
        controlIn: shown.top >= scene.bottom - 1 && shown.bottom <= vh + 1,
        pageScroll: scrollY,
      };
    }, await c.elementHandle());
    if (!r.sceneIn || !r.controlIn || !r.sculptureIn || r.pageScroll !== 0) misses.push(`${r.id}${r.sceneIn ? "" : " scene-off"}${r.sculptureIn ? "" : " sculpture-off"}${r.controlIn ? "" : " control-off"}${r.pageScroll ? ` page-scrolled ${r.pageScroll}` : ""}`);
  }
  check(controls.length >= 9 && misses.length === 0, "every stage control is worked with the stage on screen", misses.length ? misses.slice(0, 6).join("; ") : `${controls.length} controls`);
  // scrolling the panel, for longer than the idle drift waits, leaves the
  // camera where it was (with motion on: reduced motion stops the drift anyway)
  const yaw = async () => Number(await page.locator("[data-scene]").getAttribute("data-yaw"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#panel").evaluate((p) => p.scrollTo({ top: 0 }));
  await page.waitForTimeout(2500);
  const yawBefore = await yaw();
  const panelBox = (await page.locator("#panel").boundingBox())!;
  await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
  const end = Date.now() + 8000;
  for (let dir = 1; Date.now() < end; dir = -dir) {
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, dir * 120);
      await page.waitForTimeout(40);
    }
  }
  const scrolled = await page.locator("#panel").evaluate((p) => p.scrollHeight > p.clientHeight);
  const yawAfter = await yaw();
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(Number.isFinite(yawBefore) && scrolled && Math.abs(yawAfter - yawBefore) < 0.005, "scrolling the controls never turns the scene", `yaw ${yawBefore} → ${yawAfter}`);
  // and a gesture's effect shows in the scene while its button is on screen
  const ring = page.locator('[data-gesture="throw:gold"]');
  await ring.scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const before = await sphereAt(page, "gold");
  await ring.click();
  const moved = await page.waitForFunction((p0) => { const q = (document.querySelector("[data-scene]") as any).probe().stage.spheres.gold.pos; return Math.hypot(q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]) > 0.1; }, before, { timeout: 3000 }).then(() => true, () => false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(moved, "and a thrown sphere flies in view as its button is pressed");
  await page.screenshot({ path: ".shots/phone-edit.png" });
  await page.context().close();
}

async function names(browser: Browser): Promise<void> {
  console.log("\n— a name is text, never markup —");
  const page = await visitor(browser);
  await page.click("[data-rename-open]");
  await page.fill("#rename-input", "<b>x</b><img src=x>");
  await page.click('[data-rename] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("[data-you]")?.textContent?.includes("<b>x</b>"), null, { timeout: 3000 }).catch(() => null);
  const shown = (await page.textContent("[data-you]")) ?? "";
  check(shown.includes("<b>x</b><img src=x>"), "the name shows as typed", shown);
  check((await page.locator("[data-people] b, [data-people] img").count()) === 0, "and no element came from it");
  await page.context().close();
}

// The camera's first settled pose, at both sizes: inside the ring of
// arches, with the bench sculpture big and central in the part of the
// scene the panel doesn't cover (CLAUDE.md, "The opening view").
async function opening(browser: Browser): Promise<void> {
  console.log("\n— the opening view: standing in the room —");
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
    check(p.camR < p.archR && p.camY < p.archTop, `${label}: you stand inside the pavilion`, `r ${p.camR.toFixed(1)} of ${p.archR.toFixed(1)}`);
    check(Math.abs(p.camY - 1.62) < 0.01, `${label}: at a visitor's eye height`, `y ${p.camY.toFixed(2)}`);
    // the stage is ahead of you: its box straddles the reticle (the canvas centre)
    const c = await page.locator("[data-scene]").boundingBox();
    const cx = c!.width / 2, cy = c!.height / 2;
    const b = p.box;
    check(b.x < cx && b.x + b.w > cx && b.y < cy + c!.height * 0.25 && b.w * b.h > 0.12 * c!.width * c!.height, `${label}: facing the stage, big in front of you`, `box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`);
    check(await page.locator(".reticle, [data-reticle]").first().isVisible(), `${label}: a reticle marks where your hand goes`);
    await page.screenshot({ path: `.shots/opening-${label}.png` });
    await page.context().close();
  }
}

// The look of the opening view, at both sizes: a soft sunset sky, stone
// arches standing on their pillars, depth behind the room, and light that
// tells the materials apart (CLAUDE.md, "A warm, immersive gallery").
async function look(browser: Browser): Promise<void> {
  console.log("\n— the look —");
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const p = await page.evaluate(() => {
      const c = document.querySelector("[data-scene]")!;
      const r = c.getBoundingClientRect();
      return { ...(c as any).probe(), top: r.top, left: r.left };
    });
    const L = p.look ?? {};
    // the sky's pixels: the uncovered scene above the horizon, by the probe
    const shot = (await page.screenshot()).toString("base64");
    const sky = await page.evaluate(
      async ([b64, p]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const cv = new OffscreenCanvas(img.width, img.height);
        const g = cv.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const k = img.width / innerWidth;
        const chroma: number[] = [], light: number[] = [];
        for (const [x, y] of p.look?.skyPx ?? []) {
          const d = g.getImageData(Math.round((p.left + x) * k), Math.round((p.top + y) * k), 1, 1).data;
          const mx = Math.max(d[0], d[1], d[2]), mn = Math.min(d[0], d[1], d[2]);
          chroma.push(mx - mn);
          light.push((mx + mn) / 510);
        }
        chroma.sort((a, b) => a - b);
        light.sort((a, b) => a - b);
        return { n: chroma.length, p90: chroma[Math.floor(chroma.length * 0.9)] ?? 999, median: light[Math.floor(light.length / 2)] ?? 0 };
      },
      [shot, p] as const,
    );
    check(sky.n > 20 && sky.p90 < 100 && sky.median > 0.6, `${label}: a soft peach-to-lavender sky`, `${sky.n} px, chroma p90 ${sky.p90}, median lightness ${sky.median.toFixed(2)}`);
    check(L.archThick >= 0.3 && L.archGap < 0.1 && L.archAlong < 0.05, `${label}: stone arches standing on their pillars`, `thick ${L.archThick?.toFixed(2)}, foot gap ${L.archGap?.toFixed(2)}, off the ring ${L.archAlong?.toFixed(2)}`);
    check(L.cloudLayers >= 3 && L.horizon && L.islands >= 3 && L.islandsInView >= 1, `${label}: layered clouds, a horizon and floating islands`, `${L.cloudLayers} layers, horizon ${L.horizon}, ${L.islands} islands, ${L.islandsInView} in view`);
    check(L.warmSide && L.coolFill && L.contactShadows >= 19, `${label}: warm side light, cool fill and contact shadows`, `warm side ${L.warmSide}, cool fill ${L.coolFill}, ${L.contactShadows} contact shadows`);
    await page.screenshot({ path: `.shots/look-${label}.png` });
    await page.context().close();
  }
}

// Plinths in first person (ADR 17), at both sizes: choosing one from the
// row walks you in front of it, facing it, with its card; walking up to one
// with the keys shows its card too; "Back to the stage" and Escape walk you
// back to where you started.
async function focus(browser: Browser): Promise<void> {
  console.log("\n— plinths: walk up to one, and back to the stage —");
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
    const start = await fpOf(page);
    check(await page.locator("[data-home]").isHidden(), `${label}: no Back button where you start`);
    const bad: string[] = [];
    for (let slot = 1; slot <= 6; slot++) {
      await page.click(`[data-go="slot:${slot}"]`);
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const canvas = document.querySelector("[data-scene]") as any;
        return { fp: canvas.probe().fp, title: document.querySelector("[data-ex-title]")?.textContent ?? "", home: !(document.querySelector("[data-home]") as HTMLElement).hidden };
      });
      // standing 2.3 m before the plinth at radius 5.4: about 3.1 from the centre
      const rr = Math.hypot(r.fp.at[0], r.fp.at[1]);
      const why = [Math.abs(rr - 3.1) > 0.3 ? `stood at r ${rr.toFixed(2)}` : "", r.home ? "" : "no Back button", (await page.locator('[data-view="exhibit"]').isVisible()) ? "" : "no card"].filter(Boolean);
      if (why.length) bad.push(`${slot}: ${why.join(", ")}`);
      if (slot === 2) await page.screenshot({ path: `.shots/focus-${label}-2.png` });
    }
    check(bad.length === 0, `${label}: choosing each plinth walks you before it, with its card`, bad.join("; ") || "6 plinths");
    await page.click("[data-home]");
    await page.waitForTimeout(900);
    const back = await fpOf(page);
    check(Math.hypot(back.at[0] - start.at[0], back.at[1] - start.at[1]) < 0.05 && (await page.locator('[data-view="bench"]').isVisible()), `${label}: Back to the stage walks you back to where you started`, JSON.stringify(back.at));
    if (label === "desktop") {
      // walking up to plinth 1 with the keys shows its card
      await page.evaluate(() => {
        const a = ((0 / 6) * 2 + 1 / 6) * Math.PI;
        (document.querySelector("[data-scene]") as any).lookAtPoint(Math.sin(a) * 5.4, 1.62, Math.cos(a) * 5.4);
      });
      await walk(page, 900);
      const shown = await page.locator('[data-view="exhibit"]').isVisible();
      check(shown && (await page.getAttribute('[data-go="slot:1"]', "aria-pressed")) === "true", `${label}: walking up to a plinth shows its card`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      check(await page.locator('[data-view="bench"]').isVisible(), `${label}: Escape goes back to the stage`);
    }
    await page.context().close();
  }
}

// The first screen (ADR 14, 16), at both sizes: a compact stage card whose
// gestures are right there, no editor to open and nothing to read first;
// a plinth shows its card with Join in; Escape comes back.
async function explore(browser: Browser): Promise<void> {
  console.log("\n— the first screen: play is right there —");
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    const card = page.locator('[data-view="bench"]');
    const cardH = (await card.boundingBox())?.height ?? 999;
    check(await card.isVisible(), `${label}: it opens on the stage card`);
    check(cardH <= (label === "phone" ? 330 : 360), `${label}: and the card is compact`, `${Math.round(cardH)}px`);
    const gestures = await page.locator("[data-gesture]").evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility()).length);
    check(gestures === 6, `${label}: every gesture is on the first screen, no editor to open`, `${gestures} gestures`);
    const panels = await page.locator('input[type="range"], details.fine-tune, [data-parts]').count();
    check(panels === 0, `${label}: no sliders or parameter panels anywhere`, String(panels));
    const title = await page.locator("#bench-h").evaluate((h) => ({ text: h.textContent ?? "", cut: h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1 }));
    check(!title.cut, `${label}: the stage's title shows in full`, title.text);
    await page.click('[data-go="slot:1"]');
    await page.waitForTimeout(200);
    check((await page.locator("[data-ex-join]").isVisible()) && (await card.isHidden()), `${label}: a plinth shows its card, with Join in`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check((await card.isVisible()) && (await page.evaluate(() => document.activeElement?.id === "bench-h")), `${label}: Escape comes back to the stage, focus on its heading`);
    await page.screenshot({ path: `.shots/explore-${label}.png` });
    await page.context().close();
  }
}

// Safari's engine plays the same performance as Chrome's, bit for bit
// (CLAUDE.md, "The rules use only arithmetic every engine rounds the same").
// macOS ships JavaScriptCore, the engine inside Safari, as `jsc`: run
// stage.js in it and in Node (V8, Chrome's engine) and compare a busy
// performance's exact positions. Seen red against the Math.sin rules.
const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc";
async function engines(): Promise<void> {
  console.log("\n— Safari's engine and Chrome's play the same performance —");
  if (!existsSync(JSC)) return check(true, "no JavaScriptCore here (not macOS): skipped");
  const body = `
var G=[["throw","teal",0.5,[-0.62,0.95,0],[-0.9,0,0]],["throw","gold",1,[-0.6,0.3,-0.2],[2.2,0.2,0.1]],["tap","bell",2],["throw","dusk",3,[0,0.15,0],[0,1.8,0]],["pluck","ribbon",5,null,null,0.5],["throw","chrome",6.5,[1.2,0.3,0.6],[-2,0.3,-0.6]],["tap","bell",9]].map(function(a){var o={kind:a[0],object:a[1],at:a[2],by:"aaaaaa"};if(a[3]){o.from=a[3];o.v=a[4]}if(a[5]!=null)o.u=a[5];return o});
var out=[];for(var t=0;t<12;t+=0.25){var s=simulate({set:"orbit",gestures:G},t);for(var i=0;i<SPHERES.length;i++)out.push(s.spheres[SPHERES[i]].pos.join(","))}
for(var i=0;i<480;i++)out.push(ribbonPoint(i/480).join(","));
(typeof print==="function"?print:console.log)(out.join(";"));`;
  const file = join(tmpdir(), `stage-engines-${process.pid}.js`);
  writeFileSync(file, readFileSync("public/stage.js", "utf8").replace(/^export /gm, "") + body);
  const safari = execFileSync(JSC, [file], { encoding: "utf8" }).trim().split(";");
  const chrome = execFileSync(process.execPath, [file], { encoding: "utf8" }).trim().split(";");
  const at = chrome.findIndex((x, i) => x !== safari[i]);
  check(chrome.length > 400 && at < 0, "every sphere position and the ribbon's path are identical, bit for bit", at < 0 ? `${chrome.length} values` : `first differs at value ${at}: ${chrome[at]} vs ${safari[at]}`);
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = {
  firstVisit,
  explore,
  opening,
  look,
  focus,
  noScript,
  noWebGL,
  realtime,
  presence,
  chain,
  publishing,
  archive,
  disconnect,
  keyboard,
  viewports,
  contrast,
  words,
  "phone-edit": phoneEdit,
  names,
  engines,
};

// HEADED=1 runs a real, GPU-backed window parked off-screen: headless can
// hide GPU failures (CLAUDE.md, "Things this stack keeps getting wrong").
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.env.HEADED,
  args: process.env.HEADED ? ["--window-position=-3000,0"] : [],
});
try {
  for (const [name, run] of Object.entries(SECTIONS)) {
    if (!only || only === name) await run(browser);
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed; now read the screenshots in .shots/");
process.exit(failures ? 1 : 0);
