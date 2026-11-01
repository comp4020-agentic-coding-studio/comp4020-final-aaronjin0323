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
  let top = 0, grabbed = 0, knocked = 0, banked = 0, prev = 0, same = true;
  const end = Date.now() + 40_000;
  while (Date.now() < end && !(knocked && banked)) {
    const [sa, sb] = [await probe(a), await probe(b)];
    top = Math.max(top, ...sa.robots.map((r: any) => r.speed));
    const n = sa.carrying.length;
    if (n > prev) grabbed = Math.max(grabbed, n);
    const bank = Number((await a.locator("[data-banked]").textContent())!.match(/\d+/)![0]);
    if (n < prev && bank === banked) {
      knocked++;
      // the same scatter on both screens, artifact for artifact
      await a.waitForTimeout(150);
      const spots = (x: any) => x.artifacts.map((f: any) => `${f.id}:${f.pos}`).sort().join();
      const [fa, fb] = [await probe(a), await probe(b)];
      same = same && spots(fa) === spots(fb);
      if (knocked === 1) {
        check(/You dropped/.test((await a.locator("[data-toast]").textContent()) ?? ""), "the loser is told what they dropped");
        await a.screenshot({ path: ".shots/scatter-1440.png" });
      }
    }
    banked = Math.max(banked, bank);
    prev = n;
    const goal = n >= 1 && knocked ? A.VAULT : [...sa.artifacts].filter((x: any) => x.readyAt <= Date.now()).sort((x: any, y: any) => Math.hypot(x.pos[0] - me(sa).pos[0], x.pos[1] - me(sa).pos[1]) - Math.hypot(y.pos[0] - me(sa).pos[0], y.pos[1] - me(sa).pos[1]))[0]?.pos ?? A.VAULT;
    await launch(a, toward(sa, goal), 0.8);
    if (n > 0 && !knocked) await launch(b, toward(sb, me(sa).pos)); // hunting
    await a.waitForTimeout(120);
  }
  check(grabbed >= 1, "a robot grabs artifacts", `up to ${grabbed}`);
  check(knocked >= 1, "touching another robot scatters the cargo", `${knocked} time(s)`);
  check(same, "both screens show the same artifacts in the same places");
  check(banked >= 1, "delivering by flying through the vault", `${banked}`);
  check(top <= A.SPEED_MAX + 1e-6, "speed stays bounded through a real brawl", `top ${top.toFixed(1)} m/s`);
  await a.waitForFunction((n) => document.querySelectorAll("[data-shelf] .card").length >= n, banked, { timeout: 2000 }).then(() => check(true, "what's delivered appears on your shelf"), () => check(false, "what's delivered appears on your shelf"));
  check(await a.locator("[data-shelf] canvas").first().isVisible(), "each card shows the artifact");
  await a.locator(".catalog summary").click();
  check((await a.locator("[data-catalog] li").count()) === A.CATALOG.length, "the catalog lists every entry, under the shelf");
  await a.screenshot({ path: ".shots/brawl-1440.png", fullPage: true });
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

/** Collects and delivers one artifact, alone, by real drags. */
async function earn(p: Page) {
  const total = () => p.locator("[data-banked]").textContent().then((t) => Number(t!.match(/\d+/)![0]));
  for (const end = Date.now() + 45_000; Date.now() < end && (await total()) < 1; await p.waitForTimeout(220)) {
    const s = await probe(p);
    const near = [...s.artifacts].sort((x: any, y: any) => Math.hypot(x.pos[0] - me(s).pos[0], x.pos[1] - me(s).pos[1]) - Math.hypot(y.pos[0] - me(s).pos[0], y.pos[1] - me(s).pos[1]))[0];
    await launch(p, toward(s, s.carrying.length ? A.VAULT : near.pos), 0.8);
  }
  return (await total()) >= 1;
}
const roomProbe = (p: Page) => p.evaluate(() => (document.querySelector("[data-room]") as any).probe());

async function room(browser: Browser) {
  const a = await visitor(browser);
  check(await earn(a), "a visitor earns an artifact to show");
  await a.goto(`${APP}/room/`);
  await a.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev !== null);
  check((await roomProbe(a)).mine, "/room/ is your own room");
  await a.screenshot({ path: ".shots/room-default-1440.png" });
  await a.click("[data-edit]");
  let s = await roomProbe(a);
  const stand = s.items.find((i: any) => i.type === "plinth");
  await a.mouse.click(stand.cx, stand.cy);
  await a.selectOption("[data-artifact]", { index: 1 });
  await a.mouse.move(stand.cx, stand.cy);
  await a.mouse.down();
  await a.mouse.move(stand.cx + 90, stand.cy + 10, { steps: 4 });
  await a.mouse.up();
  await a.click('[data-walls] button:has-text("Walnut")');
  await a.click('[data-floors] button:has-text("Terrazzo")');
  await a.click('[data-lights] button:has-text("After hours")');
  await a.click('[data-add-stand] button:has-text("Glass case")');
  await a.click('[data-add-decor] button:has-text("Potted olive")');
  await a.click('[data-add-decor] button:has-text("Framed study")');
  await a.click("[data-save]");
  await a.waitForFunction(() => document.querySelector("[data-status]")?.textContent === "Saved.");
  s = await roomProbe(a);
  await a.click("[data-done]");
  await a.reload();
  await a.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev > 0);
  const back = await roomProbe(a);
  check(back.wall === "walnut" && back.shown === 1 && back.items.length === s.items.length, "the arrangement survives a reload", `${back.items.length} items`);
  check(back.items.find((i: any) => i.uid === stand.uid).x > stand.x, "the drag moved the stand, and it stayed");
  await a.waitForTimeout(300);
  await a.screenshot({ path: ".shots/room-1440.png" });

  const b = await visitor(browser);
  await b.goto(`${APP}/room/`);
  await b.waitForFunction(() => (document.querySelector("[data-rooms] a") ?? null) !== null);
  await b.click(`[data-rooms] a[href="/room/${back.tag}"]`);
  await b.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().shown > 0);
  const seen = await roomProbe(b);
  check(!seen.mine && seen.wall === "walnut", "another visitor finds the room in the directory");
  check(await b.locator("[data-edit]").isHidden(), "and gets no way to edit it");
  check(await b.locator("[data-panel]").isHidden(), "and no panel");
  const refused = await b.evaluate(async (layout) => {
    const r = await fetch("/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout, was: 1 }) });
    return r.status;
  }, { wall: "plaster", floor: "oak", light: "warm", items: [{ uid: 1, type: "plinth", x: 0.5, y: 0.5, artifact: back.items.find((i: any) => i.artifact).artifact }] });
  check(refused === 409, "and can't show the owner's artifact in their own room", `${refused}`);
  const held = back.items.find((i: any) => i.artifact);
  await b.mouse.click(held.cx, held.cy - 40);
  await b.waitForFunction(() => document.querySelector("dialog")?.open, null, { timeout: 2000 });
  check(true, "pressing an artifact opens it large");
  await b.click("[data-nearer]");
  await b.click("[data-wake]");
  await b.waitForTimeout(400);
  const look = (await roomProbe(b)).looking;
  check(look.zoom > 1 && look.t > 0, "closer and wake both answer", `zoom ${look.zoom.toFixed(2)}`);
  await b.mouse.move(600, 300);
  await b.screenshot({ path: ".shots/closer-1440.png" });
  await b.click("[data-close]");
  await b.context().close();

  const c = await visitor(browser, PHONE);
  await c.goto(`${APP}/room/${back.tag}`);
  await c.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().shown > 0);
  check((await c.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "the room doesn't scroll sideways at 390x844");
  await c.waitForTimeout(200);
  await c.screenshot({ path: ".shots/room-390.png" });
  await c.context().close();
  await a.context().close();
}

/** The whole journey, photographed at one size, as a newcomer. */
async function trip(browser: Browser, opts: Opts, name: string, touch: boolean) {
  const a = await visitor(browser, opts);
  const shot = (s: string) => a.screenshot({ path: `.shots/j-${name}-${s}.png` });
  const box = async (sel: string) => (await a.locator(sel).boundingBox())!;
  const cdp = touch ? await a.context().newCDPSession(a) : null;
  /** A pull: on the phone's pad if it's showing, by touch; else the mouse. */
  const pull = async (dir: number[], power: number, hold?: () => Promise<unknown>) => {
    const padShows = touch && (await a.locator("[data-pad]").isVisible());
    const area = await box(padShows ? "[data-pad]" : "[data-arena]");
    const s = await probe(a);
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const [cx, cy] = [area.x + area.width / 2, area.y + area.height / 2];
    const reach = Math.min(power * A.PULL_MAX * s.metre, 44 / 1);
    const to = [cx - (dir[0] / len) * reach, cy - (dir[1] / len) * reach];
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to[0], y: to[1] }] });
      await hold?.();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await a.mouse.move(cx, cy);
      await a.mouse.down();
      await a.mouse.move(to[0], to[1]);
      await hold?.();
      await a.mouse.up();
    }
  };
  const inView = () => a.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check((await inView()) <= 0, `${name}: nothing scrolls sideways`);
  const arena = await box("[data-arena]");
  const vh = opts!.viewport!.height;
  check(arena.y >= 0 && arena.y + arena.height <= vh + 1, `${name}: the whole arena fits on screen`, `${Math.round(arena.width)}x${Math.round(arena.height)}`);
  check((await probe(a)).coach.length > 0, `${name}: a newcomer gets one line`, (await probe(a)).coach);
  const lineSeen = (await a.locator("[data-coach]").isVisible()) || (await a.locator("[data-pad-words]").isVisible());
  check(lineSeen, `${name}: and the line is really on screen`);
  const covers = await a.evaluate(() => {
    const f = document.querySelector("[data-arena]")!.getBoundingClientRect(), c = document.querySelector("[data-coach]")!.getBoundingClientRect();
    return c.width > 0 && c.left < f.right && c.right > f.left && c.top < f.bottom && c.bottom > f.top;
  });
  check(!covers, `${name}: the line doesn't cover the arena`);
  await shot("1-first");
  const s0 = await probe(a);
  await pull(toward(s0, [8, 5]), 0.7, async () => {
    await a.waitForTimeout(120);
    await shot("2-aim");
  });
  await a.waitForTimeout(80);
  check(me(await probe(a)).speed > 0.5, `${name}: a pull launches`);
  check(/touch an artifact/i.test((await probe(a)).coach), `${name}: the line moves on after a launch`);
  const total = async () => (await probe(a)).held.total as number;
  let saw = false;
  for (const end = Date.now() + 45_000; Date.now() < end && (await total()) < 1; await a.waitForTimeout(240)) {
    const s = await probe(a);
    if (s.carrying.length && !saw) {
      saw = true;
      check(/vault/i.test(s.coach), `${name}: carrying, the line points to the vault`);
      check((await a.locator("[data-tray] [data-full]").count()) >= 1, `${name}: cargo shows in the at-risk tray`);
      const sp = (await a.locator("[data-speed]").textContent())!;
      check(sp !== "Top speed 100%", `${name}: weight shows as top speed`, sp);
      await shot("3-cargo");
    }
    const near = [...s.artifacts].filter((x: any) => x.readyAt <= Date.now()).sort((x: any, y: any) => Math.hypot(x.pos[0] - me(s).pos[0], x.pos[1] - me(s).pos[1]) - Math.hypot(y.pos[0] - me(s).pos[0], y.pos[1] - me(s).pos[1]))[0];
    await pull(toward(s, s.carrying.length ? A.VAULT : near?.pos ?? A.VAULT), 0.8);
  }
  check((await total()) >= 1, `${name}: delivered`);
  await a.waitForFunction(() => /kept for good/.test(document.querySelector("[data-toast]")?.textContent ?? ""), null, { timeout: 2000 }).then(() => check(true, `${name}: the delivery is announced, and offers the room`), () => check(false, `${name}: the delivery is announced`));
  await shot("4-delivered");
  check((await probe(a)).coach === "", `${name}: guidance stops once delivered`);
  check((await a.locator(".journey li[data-now]").textContent().catch(() => "")) === "Exhibit" || name === "land", `${name}: the journey points on to Exhibit`);
  await a.locator("[data-toast] a").click();
  await a.waitForURL("**/room/");
  await a.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev !== null);
  await a.waitForFunction(() => /on show/.test(document.querySelector("[data-waiting]")?.textContent ?? ""));
  check(true, `${name}: the room says what's waiting`);
  await a.waitForTimeout(150);
  check((await a.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: the room doesn't scroll sideways`);
  const seen = await a.locator("[data-room]").boundingBox();
  check(seen!.y >= 0 && seen!.y + seen!.height <= vh + 1, `${name}: the whole room fits on screen`, `${Math.round(seen!.width)}x${Math.round(seen!.height)}`);
  await a.screenshot({ path: `.shots/j-${name}-5-room.png` });
  await a.context().close();
}
async function journey(browser: Browser) {
  await trip(browser, DESKTOP, "desk", false);
  await new Promise((r) => setTimeout(r, A.GRACE_MS + 500));
  await trip(browser, PHONE, "phone", true);
  await new Promise((r) => setTimeout(r, A.GRACE_MS + 500));
  await trip(browser, { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "land", true);
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = { launching, brawl, line, reconnect, phone, room, journey };
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
