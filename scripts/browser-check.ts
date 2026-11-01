#!/usr/bin/env node
// The checks only a real browser can make, run by hand before committing a
// change to the page. It drives the installed Chrome against the running app
// at APP_URL, as several visitors, using real drags and keys.
//
//   node scripts/browser-check.ts            # everything
//   node scripts/browser-check.ts brawl      # one section
//
// Screenshots go to .shots/ (gitignored): read them. It plays in the arena
// and banks artifacts, so point it at a throwaway database.
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { refuseProduction } from "../spec/not-production.ts";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

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

async function visitor(browser: Browser, opts: Opts = DESKTOP): Promise<Page> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  await page.goto(APP);
  await page.waitForFunction(() => document.body.dataset.conn === "live", null, { timeout: 10_000 });
  await page.waitForTimeout(150);
  return page;
}
const probe = (p: Page) => p.evaluate(() => (document.querySelector("[data-arena]") as any).probe());
const me = (s: any) => s.robots.find((r: any) => r.tag === s.you);
/** A real drag: press somewhere fixed, pull opposite `dir`, let go. */
async function launch(p: Page, dir: number[], power = 1) {
  const s = await probe(p);
  const box = (await p.locator("[data-arena]").boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const pull = power * A.PULL_MAX * s.metre;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx - (dir[0] / len) * pull, cy - (dir[1] / len) * pull);
  await p.mouse.up();
}
const toward = (s: any, to: number[]) => [to[0] - me(s).pos[0], to[1] - me(s).pos[1]];

async function launching(browser: Browser) {
  const a = await visitor(browser), b = await visitor(browser);
  const tag = (await probe(a)).you;
  const start = me(await probe(a)).pos;
  await launch(a, [1, 0.2]);
  const shown = await probe(a);
  check(me(shown).speed > 5, "a drag launches at once", `${me(shown).speed.toFixed(1)} m/s`);
  await b.waitForFunction((t) => (document.querySelector("[data-arena]") as any).probe().robots.find((r: any) => r.tag === t)?.speed > 1, tag, { timeout: 1000 });
  check(true, "the other visitor sees it move within a second");
  await a.waitForTimeout(200);
  const before = me(await probe(a));
  await launch(a, [-1, 0.2]); // back the other way, in flight
  await a.waitForTimeout(60);
  const after = me(await probe(a));
  check(before.speed > 1 && after.pos[0] < before.pos[0], "a launch takes hold in mid-flight, the robot turning back", `was ${before.speed.toFixed(1)} m/s`);
  check(Math.hypot(after.pos[0] - start[0], after.pos[1] - start[1]) > 0.2, "it has really moved");
  await a.keyboard.press("Escape");
  await a.locator("[data-arena]").focus();
  await a.keyboard.press("ArrowDown");
  await a.keyboard.press("Enter");
  await a.waitForTimeout(50);
  check(me(await probe(a)).speed > 1, "keys launch too");
  // a tiny pull cancels
  await a.waitForTimeout(3500);
  const box = (await a.locator("[data-arena]").boundingBox())!;
  await a.mouse.move(box.x + 50, box.y + 50);
  await a.mouse.down();
  await a.mouse.move(box.x + 52, box.y + 50);
  await a.mouse.up();
  await a.waitForTimeout(60);
  check(me(await probe(a)).speed < 1, "a tiny pull cancels");
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 40);
  await a.screenshot({ path: ".shots/aim-1440.png" });
  await a.mouse.up();
  await a.context().close();
  await b.context().close();
}

/** A real brawl: one robot grabs, the other hunts it. */
async function brawl(browser: Browser) {
  const a = await visitor(browser), b = await visitor(browser);
  let top = 0, grabbed = 0, knocked = 0, banked = 0, prev = 0;
  const end = Date.now() + 40_000;
  while (Date.now() < end && !(knocked && banked)) {
    const [sa, sb] = [await probe(a), await probe(b)];
    top = Math.max(top, ...sa.robots.map((r: any) => r.speed));
    const n = sa.carrying.length;
    if (n > prev) grabbed = Math.max(grabbed, n);
    if (n < prev) knocked += (await a.locator("[data-banked]").textContent()) === `Banked ${banked}` ? 1 : 0;
    const bank = Number((await a.locator("[data-banked]").textContent())!.split(" ")[1]);
    banked = Math.max(banked, bank);
    prev = n;
    const goal = n >= 2 && knocked ? A.VAULT : [...sa.artifacts].filter((x: any) => x.readyAt <= Date.now()).sort((x: any, y: any) => Math.hypot(x.pos[0] - me(sa).pos[0], x.pos[1] - me(sa).pos[1]) - Math.hypot(y.pos[0] - me(sa).pos[0], y.pos[1] - me(sa).pos[1]))[0]?.pos ?? A.VAULT;
    await launch(a, toward(sa, goal), 0.8);
    if (n > 0) await launch(b, toward(sb, me(sa).pos)); // hunting
    await a.waitForTimeout(120);
  }
  check(grabbed >= 1, "a robot grabs artifacts", `up to ${grabbed}`);
  check(knocked >= 1, "another robot knocks one loose by hitting it", `${knocked} time(s)`);
  check(banked >= 1, "banking by flying through the vault", `${banked}`);
  check(top <= A.SPEED_MAX + 1e-6, "speed stays bounded through a real brawl", `top ${top.toFixed(1)} m/s`);
  await a.screenshot({ path: ".shots/brawl-1440.png" });
  await a.context().close();
  await b.context().close();
}

async function line(browser: Browser) {
  const four = [];
  for (let i = 0; i < 4; i++) four.push(await visitor(browser));
  const fifth = await visitor(browser);
  const s = await probe(fifth);
  check(s.robots.length === 4 && s.place === 1, "a fifth visitor watches, first in line", `${s.robots.length} robots`);
  check((await fifth.locator("[data-status]").textContent())!.includes("number 1"), "and is told so");
  await fifth.screenshot({ path: ".shots/line-1440.png" });
  await four[0].context().close();
  await fifth.waitForFunction(() => (document.querySelector("[data-arena]") as any).probe().place === 0, null, { timeout: A.GRACE_MS + 3000 });
  check(true, "and gets the next free robot after the grace");
  check(await fifth.locator("[data-status]").isHidden(), "the line message goes");
  for (const p of [...four.slice(1), fifth]) await p.context().close();
}

async function reconnect(browser: Browser) {
  const ctx = await browser.newContext(DESKTOP);
  const p = await ctx.newPage();
  await p.route("**/events", (r) => r.fulfill({ status: 502, body: "no" }), { times: 2 });
  await p.goto(APP);
  await p.waitForFunction(() => document.body.dataset.conn === "live", null, { timeout: 8000 });
  check(true, "a refused stream is opened again");
  await ctx.close();
}

async function phone(browser: Browser) {
  const p = await visitor(browser, PHONE);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(wide <= 0, "nothing scrolls sideways at 390x844", `${wide}px`);
  const box = (await p.locator("[data-arena]").boundingBox())!;
  const cdp = await p.context().newCDPSession(p);
  const touch = (type: string, x: number, y: number) => cdp.send("Input.dispatchTouchEvent", { type: type as any, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", box.x + box.width / 2, box.y + box.height / 2);
  await touch("touchMove", box.x + box.width / 2 - 80, box.y + box.height / 2 - 30);
  await p.screenshot({ path: ".shots/aim-390.png" });
  await touch("touchEnd", 0, 0);
  await p.waitForTimeout(60);
  check(me(await probe(p)).speed > 1, "a touch drag launches");
  await p.context().close();
  const ctx = await browser.newContext({ ...DESKTOP, javaScriptEnabled: false });
  const q = await ctx.newPage();
  await q.goto(APP);
  check((await q.locator("noscript").count()) > 0, "without script the page says so");
  await ctx.close();
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = { launching, brawl, line, reconnect, phone };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const [name, run] of Object.entries(SECTIONS)) {
    if (only && only !== name) continue;
    console.log(`\n# ${name}`);
    await run(browser);
    // the visitors just closed are ghosts holding their slots for the grace
    await new Promise((r) => setTimeout(r, A.GRACE_MS + 500));
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
