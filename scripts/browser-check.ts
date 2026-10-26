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
// @ts-ignore -- plain JS module shared with the page
import * as H from "../public/hall.js";

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
/** Two drawn frames: what's on screen has caught up with the last state. */
const drawn = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
async function quietStage(page: Page) {
  await post(page, "/stage/clear");
  await ticks(page, 0);
  await drawn(page);
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

async function reconnect(browser: Browser) {
  console.log("\n— a refused stream comes back on its own —");
  // A proxy answers 502 while a machine starts or a deploy swaps; a browser's
  // EventSource gives up for good on any answer that isn't a stream.
  const ctx = await browser.newContext({ reducedMotion: "reduce", ...DESKTOP });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  let refused = 0;
  await page.route("**/events", (route) => (refused++ < 2 ? route.fulfill({ status: 502, body: "Bad gateway" }) : route.continue()));
  await page.goto(`${APP}/?v=${Date.now()}`);
  const t0 = Date.now();
  const live = await page.waitForFunction(() => document.body.dataset.conn === "live", null, { timeout: 15_000 }).then(() => true, () => false);
  check(live && refused >= 2, "after the stream is refused twice, the page connects by itself", `${refused} refused, ${Date.now() - t0} ms`);
  check(live && !(await page.locator('[data-gesture="ring"]').isDisabled()), "and play comes back");
  await ctx.close();
}

/** A hall page, live, with its robot on screen. */
async function hallVisitor(browser: Browser, opts: Opts = DESKTOP): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: "reduce", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors in the hall", e.message));
  await page.goto(`${APP}/hall/?v=${Date.now()}`);
  await page.waitForFunction(() => { const p = (document.querySelector("[data-hall]") as any).probe?.(); return document.body.dataset.conn === "live" && p?.robots.some((r: any) => r.tag === p.you); }, null, { timeout: 10_000 });
  return page;
}
const hallProbe = (page: Page) => page.evaluate(() => (document.querySelector("[data-hall]") as any).probe());
const meIn = (p: any, tag = p.you) => p.robots.find((r: any) => r.tag === tag);
/** Waits until a robot (yours unless told) is still, on this page. */
const settled = (page: Page, tag?: string) =>
  page.waitForFunction((t) => { const p = (document.querySelector("[data-hall]") as any).probe(); const r = p.robots.find((x: any) => x.tag === (t ?? p.you)); return r && r.speed === 0; }, tag, { timeout: 15_000 });

async function hall(browser: Browser) {
  console.log("\n— the hall: drag back to aim, let go to launch; the server says where (ADR 24) —");
  const a = await hallVisitor(browser);
  const b = await hallVisitor(browser, PHONE);
  const ta = (await hallProbe(a)).you;
  await b.waitForFunction((t) => (document.querySelector("[data-hall]") as any).probe().robots.some((r: any) => r.tag === t), ta);
  await settled(a);
  const me = meIn(await hallProbe(a));
  // mouse: press on the robot, pull back to the left
  await a.mouse.move(me.x, me.y);
  await a.mouse.down();
  await a.mouse.move(me.x - 1.2 * (await hallProbe(a)).metre, me.y + 4, { steps: 5 });
  const aiming = await hallProbe(a);
  check(!!aiming.aim && aiming.aim.dir[0] > 0.9 && aiming.aim.power > 0.3 && aiming.aim.power < 0.7, "pulling back aims the other way, with power by the pull", JSON.stringify(aiming.aim));
  check(/Aiming right, power \d+%/.test(await a.textContent("[data-aim]") ?? ""), "and says the aim in words", await a.textContent("[data-aim]") ?? "");
  await a.screenshot({ path: ".shots/hall-aim.png" });
  const sent = Date.now();
  await a.mouse.up();
  const ownMoved = await a.waitForFunction(() => { const p = (document.querySelector("[data-hall]") as any).probe(); return p.robots.find((r: any) => r.tag === p.you).speed > 0; }, null, { timeout: 300 }).then(() => Date.now() - sent, () => -1);
  check(ownMoved >= 0 && ownMoved < 300, "letting go moves your robot at once", `${ownMoved} ms`);
  const seen = await b.waitForFunction(([t, x]) => { const r = (document.querySelector("[data-hall]") as any).probe().robots.find((q: any) => q.tag === t); return r && r.pos[0] > x + 0.3; }, [ta, me.pos[0]] as const, { timeout: 1500 }).then(() => Date.now() - sent, () => -1);
  check(seen >= 0 && seen < 1000, "the other visitor sees it go within a second", `${seen} ms`);
  await settled(a);
  await settled(b, ta);
  const pa = meIn(await hallProbe(a)).pos, pb = meIn(await hallProbe(b), ta).pos;
  check(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.01, "and both screens agree where it stopped", `${pa.map((x: number) => x.toFixed(3))} / ${pb.map((x: number) => x.toFixed(3))}`);
  // a pull shorter than MIN_PULL cancels
  const still = meIn(await hallProbe(a));
  await a.mouse.move(still.x, still.y);
  await a.mouse.down();
  await a.mouse.move(still.x + 2, still.y, { steps: 2 });
  await a.mouse.up();
  await a.waitForTimeout(300);
  check(meIn(await hallProbe(a)).speed === 0, "a tiny pull launches nothing");
  // keys: aim, change power, launch; ten launches in a row are no faster than one
  await a.focus("[data-hall]");
  await a.keyboard.press("ArrowLeft");
  await a.keyboard.press("ArrowUp");
  check(/Aiming up-right|Aiming right/.test(await a.textContent("[data-aim]") ?? ""), "arrow keys aim", await a.textContent("[data-aim]") ?? "");
  await a.keyboard.press("Escape");
  check((await hallProbe(a)).aim === null, "Escape cancels the aim");
  for (let i = 0; i < 6; i++) await a.keyboard.press("ArrowUp"); // full power
  let fastest = 0;
  for (let i = 0; i < 10; i++) {
    await a.keyboard.press("Enter"); // the same shot again
    fastest = Math.max(fastest, meIn(await hallProbe(a)).speed);
  }
  await a.waitForTimeout(400);
  fastest = Math.max(fastest, meIn(await hallProbe(a)).speed, meIn(await hallProbe(b), ta).speed);
  check(fastest > 7.9 && fastest <= 8 + 1e-9, "Enter launches at full power, and ten in a row are no faster than one", fastest.toFixed(3));
  // touch, on the phone: real touch events, pulled down to launch up
  await settled(b);
  const mb = meIn(await hallProbe(b));
  const cdp = await b.context().newCDPSession(b);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", mb.x, mb.y);
  for (let i = 1; i <= 5; i++) await touch("touchMove", mb.x, mb.y + i * 14);
  const tAim = (await hallProbe(b)).aim;
  check(!!tAim && tAim.dir[1] < -0.9, "on a phone, a touch pulled down aims up", JSON.stringify(tAim));
  await b.screenshot({ path: ".shots/hall-phone.png" });
  await touch("touchEnd", 0, 0);
  const tMoved = await b.waitForFunction(() => { const p = (document.querySelector("[data-hall]") as any).probe(); return p.robots.find((r: any) => r.tag === p.you).speed > 0; }, null, { timeout: 500 }).then(() => true, () => false);
  check(tMoved, "and letting go launches it");
  const sw = await b.evaluate(() => document.documentElement.scrollWidth);
  check(sw === 390, "phone: no sideways scroll", `${sw}px`);
  // leaving takes your robot away
  const tb = (await hallProbe(b)).you;
  await b.context().close();
  const gone = await a.waitForFunction((t) => !(document.querySelector("[data-hall]") as any).probe().robots.some((r: any) => r.tag === t), tb, { timeout: 3000 }).then(() => true, () => false);
  check(gone, "a visitor's robot leaves with them");
  await a.context().close();
}

/** Drags your robot to launch so its path passes `ok`: the pull worked
 * out by the same rule the server runs. False if no launch from here does. */
async function dragToward(page: Page, target: number[], ok: (p: number[]) => boolean): Promise<boolean> {
  await page.evaluate(() => scrollTo(0, 0)); // the hall in view, whatever was opened below it
  await settled(page);
  const pr = await hallProbe(page);
  const me = meIn(pr);
  const from = { pos: me.pos, vel: [0, 0], t: 0, seq: 0 };
  const dx = target[0] - me.pos[0], dy = target[1] - me.pos[1];
  const len = Math.hypot(dx, dy);
  for (let power = 0.25; power <= 1.0001; power += 0.05) {
    const p = Math.min(1, power);
    if (!(H.path(from, { dir: [dx / len, dy / len], power: p, seq: 0 }) as number[][]).some(ok)) continue;
    // the pull: back from the robot, PULL_MAX * power metres
    const pull = p * H.PULL_MAX;
    await page.mouse.move(me.x, me.y);
    await page.mouse.down();
    await page.mouse.move(me.x - (dx / len) * pull * pr.metre, me.y - (dy / len) * pull * pr.metre, { steps: 6 });
    await page.mouse.up();
    return true;
  }
  return false;
}
/** As a player would: launches straight there if one launch can, else hops
 * towards it at full power and tries again, up to six launches. */
async function reach(page: Page, target: number[], ok: (p: number[]) => boolean): Promise<boolean> {
  for (let hop = 0; hop < 6; hop++) {
    if (await dragToward(page, target, ok)) return true;
    await dragToward(page, target, () => true);
  }
  return false;
}

async function collect(browser: Browser) {
  console.log("\n— collecting: touch to carry, your zone to keep, a display that stays (ADR 25) —");
  const a = await hallVisitor(browser);
  let pr = await hallProbe(a);
  check(pr.artifacts.length === H.MAX_AVAILABLE, "six artifacts on the floor", String(pr.artifacts.length));
  check(new Set(pr.artifacts.map((x: any) => x.kind)).size >= 1 && pr.artifacts.every((x: any) => H.KINDS.includes(x.kind)), "each one of the three kinds");
  check(/Carrying nothing\. Room for 3\./.test((await a.textContent("[data-cargo]")) ?? ""), "the panel says the cargo is empty, with room for three");
  const before = { ...pr.kept.collection };
  // launch over the nearest artifact, in hops if it's far
  const me0 = meIn(pr).pos;
  const target = [...pr.artifacts].sort((p: any, q: any) => Math.hypot(p.pos[0] - me0[0], p.pos[1] - me0[1]) - Math.hypot(q.pos[0] - me0[0], q.pos[1] - me0[1]))[0];
  check(await reach(a, target.pos, (p) => H.touches(p, target.pos)), "launches can reach an artifact");
  const carried = await a.waitForFunction((id) => (document.querySelector("[data-hall]") as any).probe().carrying.some((c: any) => c.id === id), target.id, { timeout: 5000 }).then(() => true, () => false);
  check(carried, "touching it carries it, as the server says");
  pr = await hallProbe(a);
  check(pr.kept.collection[target.kind] === before[target.kind], "and it isn't kept yet: the collection hasn't changed");
  check(/Carrying [123] of 3/.test((await a.textContent("[data-cargo]")) ?? ""), "the panel says what's carried and the room left", (await a.textContent("[data-cargo]")) ?? "");
  check(pr.artifacts.length === H.MAX_AVAILABLE && !pr.artifacts.some((x: any) => x.id === target.id), "the floor is topped up to six, without it");
  await settled(a);
  await a.screenshot({ path: ".shots/hall-carrying.png" });
  // home
  const home = pr.home.pos;
  check(await reach(a, home, (p) => H.atHome(p, home)), "launches can reach your zone");
  const keptIt = await a.waitForFunction(([k, n]) => (document.querySelector("[data-hall]") as any).probe().kept.collection[k as string] > (n as number), [target.kind, before[target.kind]] as const, { timeout: 6000 }).then(() => true, () => false);
  check(keptIt, "entering your zone keeps it, once the server says");
  check(/Kept: /.test((await a.textContent("[data-kept]")) ?? ""), "and the panel says so", (await a.textContent("[data-kept]")) ?? "");
  check(/Carrying nothing/.test((await a.textContent("[data-cargo]")) ?? ""), "with the cargo empty again");
  // the display: put it in place 2
  await a.selectOption("#slot-2", target.kind);
  const shown = await a.waitForFunction((k) => /×\d/.test(document.querySelectorAll("[data-display] li")[1]?.textContent ?? "") && (document.querySelector("[data-hall]") as any).probe().kept.display[1] === k, target.kind, { timeout: 3000 }).then(() => true, () => false);
  check(shown, "a kind you own goes on the display, with its count");
  await a.screenshot({ path: ".shots/hall-kept.png", fullPage: true });
  // the same visitor, later: all still there, from the server
  await a.reload();
  await a.waitForFunction(() => (document.querySelector("[data-hall]") as any).probe?.()?.kept, null, { timeout: 10_000 });
  pr = await hallProbe(a);
  check(pr.kept.display[1] === target.kind && pr.kept.collection[target.kind] > before[target.kind], "after a reload, the collection and display are still there");
  await a.context().close();
  // the panels on a phone
  const b = await hallVisitor(browser, PHONE);
  const sw = await b.evaluate(() => document.documentElement.scrollWidth);
  check(sw === 390, "phone: no sideways scroll with the panels", `${sw}px`);
  await b.screenshot({ path: ".shots/hall-phone-panels.png", fullPage: true });
  await b.context().close();
}

/** Drags your robot straight at `target` at `power`. */
async function fling(page: Page, target: number[], power: number) {
  await page.evaluate(() => scrollTo(0, 0));
  await settled(page);
  const pr = await hallProbe(page);
  const me = meIn(pr);
  const dx = target[0] - me.pos[0], dy = target[1] - me.pos[1];
  const len = Math.hypot(dx, dy);
  const pull = power * H.PULL_MAX;
  await page.mouse.move(me.x, me.y);
  await page.mouse.down();
  await page.mouse.move(me.x - (dx / len) * pull * pr.metre, me.y - (dy / len) * pull * pr.metre, { steps: 6 });
  await page.mouse.up();
}

async function together(browser: Browser) {
  console.log("\n— together: real displays to look at, and a fast hit knocks one loose (ADR 26) —");
  const a = await hallVisitor(browser);
  const b = await hallVisitor(browser);
  const ta = (await hallProbe(a)).you, tb = (await hallProbe(b)).you;
  // a collects one and shows it
  const pa = await hallProbe(a);
  const mineA = meIn(pa).pos;
  const near = (pr: any, from: number[]) => [...pr.artifacts].filter((x: any) => x.readyAt <= Date.now() + 5e9).sort((p: any, q: any) => Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1]) - Math.hypot(q.pos[0] - from[0], q.pos[1] - from[1]))[0];
  const ta1 = near(pa, mineA);
  await reach(a, ta1.pos, (p) => H.touches(p, ta1.pos));
  await a.waitForFunction(() => (document.querySelector("[data-hall]") as any).probe().carrying.length > 0, null, { timeout: 5000 });
  const homeA = (await hallProbe(a)).home.pos;
  await reach(a, homeA, (p) => H.atHome(p, homeA));
  await a.waitForFunction(() => Object.values((document.querySelector("[data-hall]") as any).probe().kept.collection).some((n: any) => n > 0), null, { timeout: 6000 });
  const kind = Object.entries((await hallProbe(a)).kept.collection).find(([, n]) => (n as number) > 0)![0];
  await a.selectOption("#slot-1", kind);
  await a.waitForFunction((k) => (document.querySelector("[data-hall]") as any).probe().kept.display[0] === k, kind, { timeout: 3000 });
  // b looks at it, by the button and by clicking a's robot
  await b.click(`[data-look="${ta}"]`);
  const shown = await b.waitForFunction((k) => !document.querySelector("[data-their]")!.hasAttribute("hidden") && /×\d/.test(document.querySelector("[data-their-places] li")?.textContent ?? "") && (document.querySelector("[data-their-places] li")?.textContent ?? "").toLowerCase().includes(k === "fish" ? "fish" : k === "cloud" ? "cloud" : "door"), kind, { timeout: 3000 }).then(() => true, () => false);
  check(shown, "another player sees your real display, with its count");
  check((await b.locator("[data-their] select").count()) === 0, "and can only look, not change it");
  await b.click("[data-their-close]");
  await b.evaluate(() => scrollTo(0, 0)); // opening the card scrolled down to it; click where the robot is now
  await settled(b, ta);
  const ra = meIn(await hallProbe(b), ta);
  await b.mouse.click(ra.x, ra.y);
  check(await b.locator("[data-their]").isVisible(), "clicking their robot opens it too");
  await b.screenshot({ path: ".shots/hall-their-display.png", fullPage: true });
  await b.click("[data-their-close]");

  // b picks one up and stands in the open
  const pb = await hallProbe(b);
  const tb1 = near(pb, meIn(pb).pos);
  await reach(b, tb1.pos, (p) => H.touches(p, tb1.pos));
  await b.waitForFunction(() => (document.querySelector("[data-hall]") as any).probe().carrying.length > 0, null, { timeout: 5000 });
  await settled(b);
  const homeB = (await hallProbe(b)).home.pos;
  if (H.inSafe(meIn(await hallProbe(b)).pos, homeB)) await dragToward(b, [H.HALL.w / 2, H.HALL.h / 2], (p) => !H.inSafe(p, homeB) && Math.hypot(p[0] - homeB[0], p[1] - homeB[1]) > H.SAFE_R + 0.6);
  await settled(b);
  // a closes in, stops short, then hits b hard
  let knocked = false;
  for (let tries = 0; tries < 4 && !knocked; tries++) {
    await settled(a);
    await settled(a, tb);
    const target = meIn(await hallProbe(a), tb).pos;
    if (Math.hypot(meIn(await hallProbe(a)).pos[0] - target[0], meIn(await hallProbe(a)).pos[1] - target[1]) > 2.6)
      await dragToward(a, target, (p) => Math.hypot(p[0] - target[0], p[1] - target[1]) < 2.4);
    await settled(a);
    await fling(a, meIn(await hallProbe(a), tb).pos, 1);
    knocked = await b.waitForFunction(() => /knocked .* loose from you/.test(document.querySelector("[data-news]")?.textContent ?? ""), null, { timeout: 2500 }).then(() => true, () => false);
  }
  check(knocked, "a fast hit knocks one loose, and the struck player is told", (await b.textContent("[data-news]")) ?? "");
  check(/^You knocked/.test((await a.textContent("[data-news]")) ?? ""), "the one who hit is told too", (await a.textContent("[data-news]")) ?? "");
  const pr = await hallProbe(b);
  check(pr.shields[tb] > 0, "the struck robot shows a shield");
  check(pr.artifacts.some((x: any) => x.readyAt > Date.now() - 2000), "and the dropped artifact waits before anyone can take it");
  await b.screenshot({ path: ".shots/hall-knock.png" });
  check(Object.values(pr.kept.collection).every((n: any) => n >= 0) && (await hallProbe(a)).kept.collection[kind] >= 1, "nobody's kept collection changed");
  await a.context().close();
  await b.context().close();
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

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = { viewports, flick, pointers, aim, keyboard, "leave-it": leaveIt, reconnect, hall, collect, together, "no-webgl": noWebGL, "no-script": noScript };
const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED });
try {
  for (const [name, run] of Object.entries(SECTIONS)) if (!only || only === name) await run(browser);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed; now read the screenshots in .shots/");
process.exit(failures ? 1 : 0);
