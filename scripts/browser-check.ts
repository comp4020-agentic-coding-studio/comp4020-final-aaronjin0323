#!/usr/bin/env node
// The checks only a real browser can make, run by hand before committing a
// change to the page. It drives the installed Chrome against the running
// app at APP_URL, as two visitors where it matters.
//
//   node scripts/browser-check.ts            # everything
//   node scripts/browser-check.ts flick      # one section
//
// Screenshots go to .shots/ (gitignored): read them, since a green run says
// the behaviour works, not that the page looks right. It plays on the
// shared stage and leaves exhibits, so point it at a throwaway database.
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
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

/** A new visitor (its own cookie jar), with the page live and the room drawn. */
async function visitor(browser: Browser, opts: Opts = DESKTOP, init?: () => void): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: "reduce", ...opts });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  await page.goto(`${APP}/?v=${Date.now()}`);
  await page.waitForFunction(() => document.body.dataset.conn === "live", null, { timeout: 10_000 });
  await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any).probe === "function" || document.body.classList.contains("no-gl"), null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  return page;
}
const post = (page: Page, path: string, body: unknown = {}) =>
  page.evaluate(async ([p, b]) => (await fetch(p as string, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, [path, body] as const);
const probe = (page: Page) => page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
const gestureCount = (page: Page) => page.evaluate(() => document.querySelectorAll("[data-ticks] .tick").length);
/** Waits until this page's loop strip shows `n` gestures; ms taken, or -1. */
const ticks = (page: Page, n: number, ms = 1500, since = Date.now()) =>
  page.waitForFunction((n) => document.querySelectorAll("[data-ticks] .tick").length === n, n, { timeout: ms }).then(() => Date.now() - since, () => -1);
async function quietStage(page: Page) {
  await post(page, "/stage/clear");
  await ticks(page, 0);
}

async function viewports(browser: Browser) {
  console.log("\n— both viewports —");
  for (const [name, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw === opts!.viewport!.width, `${name}: no sideways scroll`, `${sw}px`);
    const p = await probe(page);
    const vw = opts!.viewport!.width, vh = opts!.viewport!.height;
    const panel = (await page.locator("#panel").boundingBox())!;
    const inView = (q: { x: number; y: number }) => q.x > 0 && q.x < vw && q.y > 0 && q.y < vh && !(q.x > panel.x && q.y > panel.y && q.y < panel.y + panel.height);
    check(Object.values(p.balls).every((b: any) => inView(b)) && inView(p.bell), `${name}: the fountain is in view, not under the panel`);
    check(p.plinths.filter((q: any) => inView(q)).length >= 3, `${name}: at least three plinths in the opening view`, String(p.plinths.filter((q: any) => inView(q)).length));
    const small = await page.$$eval("button:not([hidden])", (els) => els.filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().height < 32).map((e) => e.textContent?.trim()));
    check(small.length === 0, `${name}: every button is at least 32px tall`, small.join(", "));
    const iconOnly = await page.$$eval("button", (els) => els.filter((e) => (e as HTMLElement).offsetParent && !(e.textContent ?? "").trim()).length);
    check(iconOnly === 0, `${name}: no button without words`, String(iconOnly));
    await page.screenshot({ path: `.shots/${name}.png` });
    await page.context().close();
  }
}

async function flick(browser: Browser) {
  console.log("\n— flick a ball by dragging it, seen by a second visitor —");
  const a = await visitor(browser);
  const b = await visitor(browser, PHONE);
  await quietStage(a);
  await ticks(b, 0);
  const p = await probe(a);
  const teal = p.balls.teal;
  const restB = (await probe(b)).balls.teal.pos;
  await a.mouse.move(teal.x, teal.y);
  await a.mouse.down();
  await a.mouse.move(teal.x - 60, teal.y + 90, { steps: 6 });
  const sent = Date.now();
  await a.mouse.up();
  check((await ticks(a, 1, 1500)) >= 0, "dragging a ball and letting go adds a flick to the loop");
  const seen = await ticks(b, 1, 1500, sent);
  check(seen >= 0 && seen < 1000, "the other visitor's loop shows it within a second", `${seen} ms`);
  const moved = await b.waitForFunction((r) => { const q = (document.querySelector("[data-scene]") as any).probe().balls.teal.pos; return Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) > 0.1; }, restB, { timeout: 21_000 }).then(() => true, () => false);
  check(moved, "and the teal ball flies on their screen too");
  // the bell: a click rings it
  const bell = (await probe(a)).bell;
  await a.mouse.click(bell.x, bell.y);
  check((await ticks(a, 2, 1500)) >= 0, "clicking the bell rings it");
  await a.screenshot({ path: ".shots/flick-desktop.png" });
  await b.screenshot({ path: ".shots/flick-phone.png" });
  await a.context().close();
  await b.context().close();
}

async function pointers(browser: Browser) {
  console.log("\n— you see where the others are reaching —");
  const a = await visitor(browser);
  const b = await visitor(browser);
  const ta = await a.evaluate(async () => (await (await fetch("/me")).json()).tag);
  const p = await probe(a);
  await a.mouse.move(p.bell.x + 40, p.bell.y + 30);
  await a.mouse.move(p.bell.x + 50, p.bell.y + 40);
  const got = await b.waitForFunction((t) => (document.querySelector("[data-scene]") as any).probe().others.includes(t), ta, { timeout: 1500 }).then(() => true, () => false);
  check(got, "a visitor's pointer shows on another visitor's screen");
  await a.context().close();
  const gone = await b.waitForFunction((t) => !(document.querySelector("[data-scene]") as any).probe().others.includes(t), ta, { timeout: 6000 }).then(() => true, () => false);
  check(gone, "and goes when they leave");
  await b.context().close();
}

async function aim(browser: Browser) {
  console.log("\n— you see someone aim before they flick, and whose ball it is after (ADR 23) —");
  const a = await visitor(browser);
  const b = await visitor(browser);
  await quietStage(a);
  await ticks(b, 0);
  const ta = await a.evaluate(async () => (await (await fetch("/me")).json()).tag);
  const nameA = await a.evaluate(() => document.querySelector("[data-you-name]")!.textContent);
  const gold = (await probe(a)).balls.gold;
  await a.mouse.move(gold.x, gold.y);
  await a.mouse.down();
  await a.mouse.move(gold.x + 50, gold.y + 80, { steps: 6 });
  const seen = await b.waitForFunction((t) => (document.querySelector("[data-scene]") as any).probe().aims.some((x: any) => x.tag === t && x.ball === "gold"), ta, { timeout: 1500 }).then(() => true, () => false);
  check(seen, "while one visitor drags gold, the other sees their aim on gold");
  await b.screenshot({ path: ".shots/aim-seen.png" });
  await a.mouse.up();
  const dropped = await b.waitForFunction((t) => !(document.querySelector("[data-scene]") as any).probe().aims.some((x: any) => x.tag === t), ta, { timeout: 1500 }).then(() => true, () => false);
  check(dropped, "and the aim goes when they let go");
  const carried = await b.waitForFunction((t) => (document.querySelector("[data-scene]") as any).probe().movers.gold === t, ta, { timeout: 21_000 }).then(() => true, () => false);
  check(carried, "the flicked ball shows who moved it on the other screen");
  await b.screenshot({ path: ".shots/whose-ball.png" });
  const told = await b.waitForFunction((n) => (document.querySelector("[data-story]")?.textContent ?? "").startsWith(`${n} flicked gold`), nameA, { timeout: 21_000 }).then(() => true, () => false);
  check(told, "and the stage card says who flicked it", await b.evaluate(() => document.querySelector("[data-story]")?.textContent ?? ""));
  await a.context().close();
  await b.context().close();
}

async function keyboard(browser: Browser) {
  console.log("\n— keyboard only —");
  const page = await visitor(browser);
  await quietStage(page);
  const reached = new Set<string>();
  await page.focus("body");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    reached.add(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.gesture ?? (document.activeElement as HTMLElement)?.dataset.go ?? ""));
  }
  check(["flick:teal", "flick:coral", "flick:gold", "flick:plum", "ring"].every((g) => reached.has(g)), "every gesture is a button in tab order");
  check(reached.has("stage") && reached.has("slot:1"), "the stage and the plinths are in tab order");
  await page.focus('[data-gesture="ring"]');
  await page.keyboard.press("Enter");
  check((await ticks(page, 1)) >= 0, "Enter on Ring the bell plays it");
  await page.focus('[data-gesture="flick:gold"]');
  await page.keyboard.press("Enter");
  check((await ticks(page, 2)) >= 0, "Enter on Flick gold plays it");
  await page.focus("[data-scene]");
  const before = (await probe(page)).bell;
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  const after = (await probe(page)).bell;
  check(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 2, "arrow keys turn the room");
  await page.context().close();
}

async function leaveIt(browser: Browser) {
  console.log("\n— leave it on a plinth, then join in —");
  const page = await visitor(browser);
  await quietStage(page);
  await page.click('[data-gesture="ring"]');
  await ticks(page, 1);
  await page.click("[data-publish-open]");
  const title = await page.inputValue("#publish-title");
  check(title.length > 0 && title.length <= 40, "Leave it suggests a title", title);
  const mine = `Check ${Date.now() % 100000}`;
  await page.fill("#publish-title", mine);
  // an empty plinth if there is one, else a new version of plinth 1's
  const pick = page.locator('[data-targets] input[value^="empty"], [data-targets] input[value^="version"]').first();
  await pick.check();
  await page.click('[data-publish] button[type="submit"]');
  const shown = await page.waitForFunction((t) => document.querySelector("[data-plinth-title]")?.textContent === t && !document.querySelector('[data-card="plinth"]')!.hasAttribute("hidden"), mine, { timeout: 3000 }).then(() => true, () => false);
  check(shown, "it lands on the plinth, and the plinth's card shows it");
  const versions = await page.locator("[data-versions] li").count();
  check(versions >= 1, "with its versions listed", String(versions));
  await page.click("[data-join]");
  if (await page.locator("[data-ask]").evaluate((d) => (d as HTMLDialogElement).open)) await page.click("[data-ask-yes]");
  const back = await page.waitForFunction(() => !document.querySelector('[data-card="stage"]')!.hasAttribute("hidden") && /Joined in from/.test(document.querySelector("[data-based]")?.textContent ?? ""), null, { timeout: 3000 }).then(() => true, () => false);
  check(back, "Join in brings it to the stage, saying where it came from");
  await page.click('[data-go="slot:2"]');
  await page.keyboard.press("Escape");
  check(await page.locator('[data-card="stage"]').isVisible(), "Escape goes back to the stage");
  await page.screenshot({ path: ".shots/leave-it.png" });
  await page.context().close();
}

async function noWebGL(browser: Browser) {
  console.log("\n— without WebGL —");
  const page = await visitor(browser, DESKTOP, () => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return /webgl/.test(kind) ? null : (real as any).call(this, kind, ...rest);
    } as any;
  });
  check(await page.evaluate(() => document.body.classList.contains("no-gl")), "the page says it has no room");
  await quietStage(page);
  await page.click('[data-gesture="ring"]');
  check((await ticks(page, 1)) >= 0, "and the gesture buttons still play");
  await page.screenshot({ path: ".shots/no-webgl.png" });
  await page.context().close();
}

async function noScript(browser: Browser) {
  console.log("\n— without JavaScript —");
  const ctx = await browser.newContext({ javaScriptEnabled: false, ...DESKTOP });
  const page = await ctx.newPage();
  await page.goto(`${APP}/?v=${Date.now()}`);
  check(await page.locator("[data-listing] li").count() === 6, "the six plinths are listed in the HTML");
  await ctx.close();
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = { viewports, flick, pointers, aim, keyboard, "leave-it": leaveIt, "no-webgl": noWebGL, "no-script": noScript };
const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED });
try {
  for (const [name, run] of Object.entries(SECTIONS)) if (!only || only === name) await run(browser);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed; now read the screenshots in .shots/");
process.exit(failures ? 1 : 0);
