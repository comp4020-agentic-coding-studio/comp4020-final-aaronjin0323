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
import net from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { refuseProduction } from "../spec/not-production.ts";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";
// @ts-ignore -- plain JS module shared with the page
import { SLOT_COLOURS } from "../public/arena-ui.js";

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
  // two samples after the launch: comparing with one taken before the drag
  // races the robot, which is still flying forward while the mouse moves
  await a.waitForTimeout(40);
  const turned = me(await probe(a));
  await a.waitForTimeout(120);
  const after = me(await probe(a));
  check(before.speed > 1 && after.pos[0] < turned.pos[0], "a launch takes hold in mid-flight, the robot turning back", `was ${before.speed.toFixed(1)} m/s, ${(turned.pos[0] - after.pos[0]).toFixed(2)} m back`);
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
        check(/Dropped/.test((await a.locator("[data-toast]").textContent()) ?? ""), "the loser is told what they dropped");
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
  await a.goto(`${APP}/room/`);
  await a.waitForFunction((n) => document.querySelectorAll("[data-onshow] canvas").length >= n, banked, { timeout: 2000 }).then(() => check(true, "what's delivered appears in your room's collection"), () => check(false, "what's delivered appears in your room's collection"));
  await a.locator(".catalog summary").click();
  check((await a.locator("[data-catalog] li").count()) === A.CATALOG.length, "the catalog lists every entry, under the collection");
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
  const cards = await a.locator("[data-onshow] button").evaluateAll((bs) => bs.map((b) => ({ rarity: (b as HTMLElement).dataset.rarity, text: (b.textContent ?? "").toLowerCase(), border: getComputedStyle(b).borderColor })));
  check(cards.length > 0 && cards.every((c) => c.rarity && c.border), "each collection card is drawn in its material", cards.map((c) => `${c.rarity} ${c.border}`).join(", "));
  check(cards.every((c) => !/mythic|rare|common/.test(c.text)), "and no word on a card names its tier", cards.map((c) => c.text).join(" | "));
  await a.screenshot({ path: ".shots/room-default-1440.png" });
  await a.click("[data-edit]");
  let s = await roomProbe(a);
  const stand = s.items.find((i: any) => i.type === "plinth");
  await a.mouse.click(stand.cx, stand.cy);
  await a.click('[data-tab="shown"]');
  await a.click("[data-tiles] .tile");
  await a.mouse.move(stand.cx, stand.cy);
  await a.mouse.down();
  await a.mouse.move(stand.cx + 90, stand.cy + 10, { steps: 4 });
  await a.mouse.up();
  // the editor works like a decorating game, one thing at a time
  const room_ = (await a.locator("[data-room]").boundingBox())!;
  const letGo = () => a.mouse.click(room_.x + 6, room_.y + 6);
  await a.click('[data-tab="room"]');
  await a.click('[data-tiles] button:has-text("Sage")');
  check((await a.locator("[data-tabs] button").count()) === 3, "three tabs over the tiles");
  check((await a.locator("[data-tiles] canvas").count()) >= 6, "tiles are pictures of the thing");
  await a.click('.tiles [data-colour="ink"]');
  check((await roomProbe(a)).wallTint === "ink", "the palette opens under the walls, and tints them");
  await a.click('.tiles [data-colour="ink"]');
  check((await roomProbe(a)).wallTint === undefined, "and tapping it again clears it");
  await letGo();
  check((await roomProbe(a)).selected === null, "a tap on nothing lets go");
  check(await a.locator("[data-tools]").isHidden(), "and the tools go with it");
  await a.click('[data-tab="things"]');
  await a.click('[data-tiles] button:has-text("Round table")');
  await a.click("[data-colour-tool]");
  await a.click('[data-colours] [data-colour="terracotta"]');
  const table = (await roomProbe(a)).items.at(-1);
  check(table.type === "table" && table.colour === "terracotta" && (await roomProbe(a)).selected === table.uid, "a tile places its thing, selected, and Colour tints it");
  await letGo();
  await a.click('[data-tiles] button:has-text("Tall vase")');
  const vase = (await roomProbe(a)).items.at(-1);
  await a.mouse.move(vase.cx, vase.cy);
  await a.mouse.down();
  await a.mouse.move(table.cx, table.cy + 6, { steps: 8 });
  await a.mouse.up();
  const stacked = (await roomProbe(a)).items.at(-1);
  check(stacked.up > 0, "a vase dragged onto a table sits on it", `${stacked.x}, ${stacked.y}`);
  check(Number.isInteger(stacked.x * 16), "and it snapped to the grid");
  await a.click('[data-tiles] button:has-text("Oak bench")');
  await a.click("[data-rotate]");
  check((await roomProbe(a)).items.at(-1).rot === 1, "Turn turns the selected thing");
  await a.screenshot({ path: ".shots/editor-1440.png" });
  const benchNow = (await roomProbe(a)).items.at(-1);
  await a.locator("[data-room]").focus();
  await a.keyboard.press("ArrowRight");
  const keyed = (await roomProbe(a)).items.at(-1);
  check(keyed.x !== benchNow.x || keyed.y !== benchNow.y, "arrow keys move the selected thing");
  await a.keyboard.press("Delete");
  check((await roomProbe(a)).items.every((i: any) => i.uid !== benchNow.uid), "Delete takes it away");
  await a.click('[data-tiles] button:has-text("Oak bench")');
  await a.click("[data-remove]");
  check((await roomProbe(a)).items.every((i: any) => i.uid !== benchNow.uid), "and so does Remove");
  const shot = a.waitForEvent("download", { timeout: 4000 }).then((d) => d.suggestedFilename(), () => "");
  await a.click("[data-photo]");
  check(/\.png$/.test(await shot), "the picture button saves a PNG");
  const styleOf = (sel: string) => a.locator(sel).first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, border: `${c.borderTopStyle} ${c.borderTopWidth}`, weight: c.fontWeight };
  });
  const done = await styleOf("[data-done]"), cancel = await styleOf("[data-cancel]");
  const clear = (c: string) => c === "rgba(0, 0, 0, 0)";
  check(!clear(done.bg) && clear(cancel.bg), "Done is the one filled action", `${done.bg}`);
  check(cancel.border.startsWith("none"), "Cancel is quiet");
  await a.click("[data-cancel]");
  check((await a.locator("[data-cancel]").textContent()) === "Lose changes?" && (await a.locator("[data-panel]").isVisible()), "with changes, Cancel asks once before losing them");
  await a.click('[data-tab="room"]');
  await a.click('[data-tiles] button:has-text("Walnut")');
  check((await a.locator("[data-cancel]").textContent()) === "Cancel", "and carrying on stands it down");
  await a.click('[data-tiles] button:has-text("Terrazzo")');
  await a.click('[data-tiles] button:has-text("After hours")');
  await a.click('[data-tab="things"]');
  await a.click('[data-tiles] button:has-text("Glass case")');
  await a.click('[data-tiles] button:has-text("Potted olive")');
  await a.click('[data-tiles] button:has-text("Framed study")');
  s = await roomProbe(a);
  await a.click("[data-done]");
  await a.waitForFunction(() => document.querySelector("[data-status]")?.textContent === "Saved.");
  check(await a.locator("[data-panel]").isHidden(), "Done saves and leaves");
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
  // walking: a visitor goes round the room
  await b.waitForTimeout(250);
  await b.screenshot({ path: ".shots/iso-1440.png" });
  const w0 = (await roomProbe(b)).walker;
  await b.locator("[data-room]").focus();
  await b.keyboard.down("ArrowUp");
  await b.waitForTimeout(500);
  await b.keyboard.up("ArrowUp");
  const w1 = (await roomProbe(b)).walker;
  check(w1.x < w0.x && w1.y < w0.y, "the keys walk a visitor's robot", `${w0.x.toFixed(2)} to ${w1.x.toFixed(2)}`);
  await b.keyboard.down("ArrowUp");
  await b.waitForTimeout(3500);
  await b.keyboard.up("ArrowUp");
  const w2 = (await roomProbe(b)).walker;
  check(w2.x >= 0.03 && w2.y >= 0.03, "and the walls hold it in", `${w2.x.toFixed(2)}, ${w2.y.toFixed(2)}`);
  await b.mouse.click(held.ax, held.ay);
  await b.waitForFunction(() => document.querySelector("dialog")?.open, null, { timeout: 8000 });
  check(true, "pressing an artifact walks over to it, and opens it large");
  await b.click("[data-wake]");
  await b.waitForTimeout(400);
  const look = (await roomProbe(b)).looking;
  check(look.t > 0, "Wake it answers");
  await b.mouse.move(600, 300);
  await b.screenshot({ path: ".shots/closer-1440.png" });
  await b.click("[data-close]");
  await b.waitForFunction(() => (document.querySelector("[data-room]") as any).probe().near !== null);
  check(/Look closely/.test((await roomProbe(b)).prompt), "beside an artifact, a prompt offers a look", (await roomProbe(b)).prompt);
  await b.screenshot({ path: ".shots/iso-near-1440.png" });
  const bench = back.items.find((i: any) => i.type === "bench");
  await b.mouse.click(bench.cx, bench.cy);
  await b.waitForFunction(() => (document.querySelector("[data-room]") as any).probe().walker.sitting, null, { timeout: 9000 }).then(() => check(true, "pressing a bench walks over and sits"), () => check(false, "pressing a bench walks over and sits"));
  await b.click("[data-prompt]");
  check(!(await roomProbe(b)).walker.sitting, "and the prompt stands up again");
  await b.context().close();

  const c = await visitor(browser, PHONE);
  await c.goto(`${APP}/room/${back.tag}`);
  await c.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().shown > 0);
  check((await c.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "the room doesn't scroll sideways at 390x844");
  await c.waitForTimeout(200);
  const before = (await roomProbe(c)).walker;
  const pic = (await c.locator("[data-room]").boundingBox())!;
  await c.touchscreen.tap(pic.x + pic.width * 0.5, pic.y + pic.height * 0.62);
  await c.waitForTimeout(1200);
  const after = (await roomProbe(c)).walker;
  check(Math.hypot(after.x - before.x, after.y - before.y) > 0.1, "a tap walks the robot on a phone", `${before.x.toFixed(2)} to ${after.x.toFixed(2)}`);
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
  check((await probe(a)).mark === "pull", `${name}: a newcomer is shown the pull`, (await probe(a)).coach);
  await shot("1-first");
  const s0 = await probe(a);
  await pull(toward(s0, [8, 5]), 0.7, async () => {
    await a.waitForTimeout(120);
    await shot("2-aim");
  });
  await a.waitForTimeout(80);
  check(me(await probe(a)).speed > 0.5, `${name}: a pull launches`);
  check((await probe(a)).mark === "artifact", `${name}: the mark moves to an artifact after a launch`);
  const total = async () => (await probe(a)).held.total as number;
  let saw = false;
  for (const end = Date.now() + 45_000; Date.now() < end && (await total()) < 1; await a.waitForTimeout(240)) {
    const s = await probe(a);
    if (s.carrying.length && !saw) {
      saw = true;
      check(s.mark === "vault", `${name}: carrying, the mark points to the vault`);
      await shot("3-cargo");
    }
    const near = [...s.artifacts].filter((x: any) => x.readyAt <= Date.now()).sort((x: any, y: any) => Math.hypot(x.pos[0] - me(s).pos[0], x.pos[1] - me(s).pos[1]) - Math.hypot(y.pos[0] - me(s).pos[0], y.pos[1] - me(s).pos[1]))[0];
    await pull(toward(s, s.carrying.length ? A.VAULT : near?.pos ?? A.VAULT), 0.8);
  }
  check((await total()) >= 1, `${name}: delivered`);
  await a.waitForFunction(() => /kept!/.test(document.querySelector("[data-toast]")?.textContent ?? ""), null, { timeout: 2000 }).then(() => check(true, `${name}: the delivery is announced`), () => check(false, `${name}: the delivery is announced`));
  await shot("4-delivered");
  check((await probe(a)).mark === null, `${name}: guidance stops once delivered`);
  check((await a.locator("[data-room-link][data-calling]").count()) === 1, `${name}: the Room button calls`);
  await a.locator("[data-room-link]").click();
  await a.waitForURL("**/room/");
  await a.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev !== null);
  await a.waitForFunction(() => /new/.test(document.querySelector("[data-waiting]")?.textContent ?? ""));
  check(await a.locator("[data-edit]").isVisible(), `${name}: Decorate says something new is waiting`);
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

/** Four real pages at once, two desktop and two phones, playing and dropping out. */
async function together(browser: Browser) {
  const pages = [await visitor(browser), await visitor(browser), await visitor(browser, PHONE), await visitor(browser, PHONE)];
  const [a, b, c, d] = pages;
  await a.waitForTimeout(300);
  const all = await Promise.all(pages.map(probe));
  check(all.every((s) => s.robots.length === 4), "four pages, four robots on every screen");
  check(new Set(all.map((s) => s.you)).size === 4, "each its own player");
  check(new Set(all.map((s) => s.robots.map((r: any) => r.slot).sort().join())).size === 1, "each in its own slot");
  // each page is washed in its own robot's colour, so a player back from their room knows which is theirs
  const tints = await Promise.all(pages.map((p) => p.evaluate(() => ({ slot: document.documentElement.dataset.slot, you: getComputedStyle(document.documentElement).getPropertyValue("--you").trim(), bg: getComputedStyle(document.body).backgroundImage }))));
  const slots = all.map((s) => String(me(s).slot));
  check(tints.every((t, i) => t.slot === slots[i] && t.you.toLowerCase() === SLOT_COLOURS[Number(slots[i])]), "each page is tinted with its own robot's colour", tints.map((t) => t.you).join(" "));
  check(new Set(tints.map((t) => t.you)).size === 4 && tints.every((t) => t.bg.includes("gradient")), "four players, four different tints");
  const floor = (s: any) => s.artifacts.map((f: any) => `${f.id}:${f.pos}`).sort().join();
  check(new Set(all.map(floor)).size === 1, "and every screen shows the same floor");
  // the same robot, in motion, on four screens at one moment
  await launch(a, [1, 0.5]);
  await a.waitForTimeout(250);
  const tag = all[0].you;
  const seen = await Promise.all(pages.map((p) => p.evaluate((t) => {
    const x = (document.querySelector("[data-arena]") as any).probe().robots.find((r: any) => r.tag === t);
    return { pos: x.pos, at: Date.now() };
  }, tag)));
  const spread = Math.max(...seen.flatMap((u) => seen.map((v) => Math.hypot(u.pos[0] - v.pos[0], u.pos[1] - v.pos[1]) - 10 * Math.abs(u.at - v.at) / 1000)));
  check(spread < 0.5, "a moving robot is in the same place on every screen", `within ${Math.max(0, spread).toFixed(2)} m`);
  await Promise.all(pages.map((p, i) => p.screenshot({ path: `.shots/together-${i < 2 ? "1440" : "390"}-${i}.png` })));

  // a refresh mid-carry
  // only once it's at rest with cargo aboard: a moving robot can legally
  // bank in the vault or lose its cargo to a contact on the way
  let ready = false;
  for (const end = Date.now() + 30_000; Date.now() < end && !ready; await b.waitForTimeout(220)) {
    const s = await probe(b);
    ready = s.carrying.length > 0 && me(s).speed < 0.05;
    if (s.carrying.length) continue;
    const near = [...s.artifacts].filter((x: any) => x.readyAt <= Date.now()).sort((x: any, y: any) => Math.hypot(x.pos[0] - me(s).pos[0], x.pos[1] - me(s).pos[1]) - Math.hypot(y.pos[0] - me(s).pos[0], y.pos[1] - me(s).pos[1]))[0];
    if (near) await launch(b, toward(s, near.pos), 0.8);
  }
  check(ready, "one page picks something up and comes to rest");
  const before = await probe(b);
  await b.reload();
  await b.waitForFunction(() => document.body.dataset.conn === "live");
  await b.waitForTimeout(300);
  const after = await probe(b);
  const ids = (s: any) => s.carrying.map((i: any) => i.id).join();
  check(after.you === before.you && me(after).slot === me(before).slot, "a refresh keeps the same robot");
  check(ids(after) === ids(before), "and exactly what it carried", after.carrying.length);

  void c;
  void d;
  for (const p of pages) await p.context().close();
}

/** A network that vanishes without closing anything, through a proxy we can
 * freeze: bytes just stop, which no browser "offline" switch reproduces. */
async function stall(browser: Browser) {
  const target = new URL(APP);
  let frozen = false;
  const open = new Set<net.Socket>();
  const proxy = net.createServer((client) => {
    if (frozen) return client.destroy();
    const up = net.connect(Number(target.port), target.hostname);
    open.add(client);
    open.add(up);
    client.on("data", (d) => { if (!frozen) up.write(d); });
    up.on("data", (d) => { if (!frozen) client.write(d); });
    const end = () => { client.destroy(); up.destroy(); open.delete(client); open.delete(up); };
    client.on("close", end).on("error", end);
    up.on("close", end).on("error", end);
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const port = (proxy.address() as net.AddressInfo).port;
  const ctx = await browser.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => document.body.dataset.conn === "live");
  await p.waitForTimeout(A.BEAT_MS + 1500);
  check((await p.evaluate(() => document.body.dataset.conn)) === "live", "a quiet arena stays live on the heartbeat alone");
  frozen = true;
  const t0 = Date.now();
  await p.waitForFunction(() => document.body.dataset.conn !== "live", null, { timeout: A.BEAT_MISS_MS + 5000 }).then(() => check(true, "a stalled phone notices", `${((Date.now() - t0) / 1000).toFixed(1)} s`), () => check(false, "a stalled phone notices"));
  check(/reconnecting/i.test((await p.locator("[data-status]").textContent()) ?? ""), "and says so");
  await p.screenshot({ path: ".shots/stalled-390.png" });
  frozen = false;
  for (const s of open) s.destroy();
  await p.waitForFunction(() => document.body.dataset.conn === "live", null, { timeout: 25_000 }).then(() => check(true, "and comes back on its own"), () => check(false, "and comes back on its own"));
  check(await p.locator("[data-status]").isHidden(), "the message goes");
  await ctx.close();
  proxy.close();
}

/** Arranging on a phone: tap, choose, the arrow buttons, save. */
// a room is shared (ADR 36): two people in one room see each other walk
async function visitors(browser: Browser) {
  const a = await visitor(browser);
  await a.goto(`${APP}/room/`);
  await a.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().tag);
  const tag = (await roomProbe(a)).tag;
  const b = await visitor(browser, PHONE);
  await b.goto(`${APP}/room/${tag}`);
  const sees = (p: Page, n: number) => p.waitForFunction((n) => (document.querySelector("[data-room]") as any).probe().others.length === n, n, { timeout: 3000 }).then(() => true, () => false);
  check(await sees(a, 1), "the owner sees a visitor arrive in their room");
  check(await sees(b, 1), "and the visitor sees the owner there");
  const pa = await roomProbe(a), pb = await roomProbe(b);
  check(pa.others[0].tag === pb.me && pb.others[0].tag === pa.me, "each sees the other, not themselves");
  // two people who come in together don't stand on one spot
  const apart = Math.hypot(pa.walker.x - pb.walker.x, pa.walker.y - pb.walker.y);
  check(apart > 0.03 || pa.walker.moving || pb.walker.moving, "two arrivals don't stand on one spot", apart.toFixed(3));
  check(/^#[0-9a-f]{6}$/.test(pa.others[0].colour) && pa.others[0].colour === pb.myColour && pb.others[0].colour === pa.myColour, "each drawn in the same colour on both screens", `${pa.myColour} and ${pb.myColour}`);
  // the visitor walks; the owner's screen follows within a second
  await b.locator("[data-room]").focus();
  await b.keyboard.down("ArrowUp");
  await b.waitForTimeout(700);
  await b.keyboard.up("ArrowUp");
  const there = (await roomProbe(b)).walker;
  const at = Date.now();
  const followed = await a.waitForFunction(([x, y]) => {
    const o = (document.querySelector("[data-room]") as any).probe().others[0];
    return o && Math.abs(o.x - x) < 0.02 && Math.abs(o.y - y) < 0.02 && !o.moving;
  }, [there.x, there.y], { timeout: 1500 }).then(() => true, () => false);
  check(followed, "the owner sees the visitor walk there, within a second", `${Date.now() - at} ms`);
  await a.waitForTimeout(400);
  await a.screenshot({ path: ".shots/visitors-1440.png" });
  await b.screenshot({ path: ".shots/visitors-390.png" });
  // the ways out say why, and your own room is one tap away (ADR 37)
  check(await a.locator("[data-way-rooms]").isVisible() && await a.locator("[data-way-home]").isHidden(), "in your own room: ← Arena and Visit rooms");
  check(await b.locator("[data-way-home]").isVisible() && await b.locator("[data-way-rooms]").isHidden(), "in someone else's: Your room and ← Arena");
  for (const p of [a, b]) check((await p.locator("[data-way-play] .label").textContent())?.trim() === "← Arena", "the way to the arena reads ← Arena");
  const why = (await a.locator("[data-playing]").textContent())?.trim();
  check(!!why, "← Arena says why", why);
  await b.click("[data-way-home]");
  await b.waitForURL(/\/room\/$/);
  await b.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().mine === true, null, { timeout: 5000 }).then(() => check(true, "one tap on Your room takes the visitor home"), () => check(false, "one tap on Your room takes the visitor home"));
  check(await sees(a, 0), "and the owner sees them leave");
  await b.close();
  await a.close();
}

async function phoneroom(browser: Browser) {
  const p = await visitor(browser, PHONE);
  check(await earn(p), "a phone earns an artifact");
  await p.goto(`${APP}/room/`);
  await p.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev !== null);
  await p.tap("[data-edit]");
  const s = await roomProbe(p);
  const stand = s.items.find((i: any) => i.type === "plinth");
  await p.tap("[data-tiles] .tile");
  const placed = await roomProbe(p);
  check(placed.shown === 1 && placed.items.length === s.items.length, "an artifact goes on the first empty stand");
  check(await p.locator("[data-tools]").isHidden(), "no tools until something is selected");
  await p.locator("[data-room]").scrollIntoViewIfNeeded();
  const now = (await roomProbe(p)).items.find((i: any) => i.uid === stand.uid);
  await p.touchscreen.tap(now.cx, now.cy);
  await p.waitForSelector("[data-tools]:not([hidden])");
  check(true, "a tap selects a stand");
  await p.tap("[data-colour-tool]");
  await p.screenshot({ path: ".shots/edit-390-colour.png" });
  await p.tap("[data-colour-tool]");
  const cdp = await p.context().newCDPSession(p);
  const touch = (type: string, x = 0, y = 0) => cdp.send("Input.dispatchTouchEvent", { type: type as any, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", now.cx, now.cy);
  for (let d = 10; d <= 50; d += 10) await touch("touchMove", now.cx + d, now.cy + d / 3);
  await touch("touchEnd");
  await p.tap('[data-tab="things"]');
  await p.screenshot({ path: ".shots/edit-390.png" });
  await p.locator("[data-tiles] .tile").last().scrollIntoViewIfNeeded();
  const bar = await p.locator("[data-done]").boundingBox();
  check(!!bar && bar.y >= 0 && bar.y + bar.height <= 844, "Done stays in reach deep in the panel");
  const pic = await p.locator("[data-room]").boundingBox();
  check(!!pic && pic.y >= 0 && pic.y < 200, "and the room stays in view above the tiles", `y ${Math.round(pic?.y ?? -1)}`);
  await p.screenshot({ path: ".shots/edit-390-deep.png" });
  await p.tap("[data-done]");
  await p.waitForFunction(() => document.querySelector("[data-status]")?.textContent === "Saved.");
  await p.reload();
  await p.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev > 0);
  const moved = (await roomProbe(p)).items.find((i: any) => i.uid === stand.uid);
  check((moved.x !== stand.x || moved.y !== stand.y) && !!moved.artifact, "a drag by touch moved it, and it saved", `${stand.x} to ${moved.x}`);
  check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "the panel doesn't scroll sideways");
  await p.context().close();
}

/** What a person can actually see in the window: words and controls, not what's scrolled away. */
const inWindow = (p: Page) => p.evaluate(() => {
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect(), c = getComputedStyle(el);
    return el.checkVisibility({ contentVisibilityAuto: true } as any) && r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && c.visibility !== "hidden" && Number(c.opacity) > 0;
  };
  const controls = [...document.querySelectorAll("a, button, summary, select, input")].filter((e) => seen(e) && !e.closest(".tiles, .colours"));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let words = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!;
    if (el.closest(".sr, script, style, noscript, .tiles") || !seen(el)) continue;
    words += (n.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
  }
  return { words, controls: controls.length };
});
function within(n: { words: number; controls: number }, words: number, controls: number, what: string) {
  check(n.words <= words, `${what}: at most ${words} words in view`, `${n.words}`);
  check(n.controls <= controls, `${what}: at most ${controls} controls in view`, `${n.controls}`);
}
/** ADR 35: each screen's budget, read from the screen itself, at both sizes. */
async function budget(browser: Browser) {
  for (const [opts, name] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as [Opts, string][]) {
    const p = await visitor(browser, opts);
    within(await inWindow(p), 12, 2, `${name}, a newcomer's arena`);
    check(await earn(p), `${name}: earned something`);
    await p.waitForTimeout(5300); // the delivery's message has gone
    within(await inWindow(p), 12, 2, `${name}, the arena in play`);
    await p.goto(`${APP}/room/`);
    await p.waitForFunction(() => (document.querySelector("[data-room]") as any).probe?.().rev !== null);
    await p.waitForTimeout(150);
    within(await inWindow(p), 16, 4, `${name}, your room`);
    await p.click("[data-edit]");
    await p.waitForTimeout(100);
    within(await inWindow(p), 12, 6, `${name}, decorating with nothing selected`);
    await p.click('[data-tab="things"]');
    check((await p.locator(".colours button:visible").count()) === 0, `${name}: no palette until it applies`);
    await p.context().close();
    await new Promise((r) => setTimeout(r, A.GRACE_MS + 500));
  }
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = { launching, brawl, line, reconnect, phone, room, journey, together, stall, phoneroom, visitors, budget };
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
