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
// It edits the shared workbench and publishes exhibits as fixture visitors,
// so point it at a throwaway database, never production.
import { mkdirSync } from "node:fs";
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

/** Puts a Loop & Lantern on the bench, whatever was there. Clearing archives,
 * so nothing is lost; it may be refused while someone else holds a lease. */
async function freshBench(page: Page): Promise<void> {
  await post(page, "/draft/clear");
  const r = await post(page, "/draft/start", { recipe: "loop" });
  if (r.status !== 200) throw new Error(`couldn't start a draft: ${r.status} ${JSON.stringify(r.json)}`);
  await page.click('[data-go="bench"]');
  await page.waitForSelector('[data-parts] .part[data-part="ribbon"]');
}

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
  check(/Pick a sculpture to remix/.test(lede), "the first line says what to do", lede);
  const box = await page.locator("[data-lede]").boundingBox();
  check(!!box && box.y + box.height < 200, "and sits at the top of the first screen", `${Math.round(box?.y ?? -1)}px`);
  const plinths = await page.locator("[data-go]").count();
  check(plinths === 7, "the workbench and six plinths are buttons", String(plinths));
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
  await freshBench(page);
  const slider = page.locator("#ribbon-turns");
  check(await slider.isEnabled(), "the sliders still work");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector("#ribbon-turns + output")?.textContent === "3", null, { timeout: 3000 }).catch(() => null);
  check((await page.textContent("#ribbon-turns + output")) === "3", "and the draft's numbers show");
  await page.click('[data-go="slot:1"]');
  await page.waitForSelector("[data-history] .version", { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-history] .version").count()) > 0, "history still lists versions");
  await page.screenshot({ path: ".shots/no-webgl.png" });
  await ctx.close();
}

async function realtime(browser: Browser): Promise<void> {
  console.log("\n— real-time: two people, two browsers —");
  const a = await visitor(browser);
  const b = await visitor(browser);
  await freshBench(a);
  await b.click('[data-go="bench"]');
  await b.waitForSelector('[data-parts] .part[data-part="spheres"]');
  const before = (await b.textContent("#spheres-count + output")) ?? "";
  // open the part, then move its slider by keyboard: a real input event
  await a.click('[data-toggle="spheres"]');
  await a.focus("#spheres-count");
  const started = Date.now();
  await a.keyboard.press("ArrowRight");
  const want = String(Number(before) + 1);
  await b.waitForFunction((w) => document.querySelector("#spheres-count + output")?.textContent === w, want, { timeout: 3000 }).catch(() => null);
  const elapsed = Date.now() - started;
  const seen = (await b.textContent("#spheres-count + output")) ?? "";
  check(seen === want, "B sees A's edit without reloading", `${before} → ${seen}`);
  check(elapsed < 1000, "within about a second", `${elapsed} ms`);

  // B sees the part as A's, with A's name, and can't move it
  await b.click('[data-toggle="spheres"]');
  await b.waitForFunction(() => document.querySelector('.part[data-part="spheres"]')?.getAttribute("data-lease") === "held", null, { timeout: 3000 }).catch(() => null);
  const lease = await b.$eval('.part[data-part="spheres"]', (el) => ({ state: el.getAttribute("data-lease"), text: el.querySelector("[data-lease-text]")?.textContent ?? "" }));
  const aName = ((await a.textContent("[data-you]")) ?? "").trim();
  check(lease.state === "held" && lease.text.includes(aName), "B sees who holds the part", lease.text);
  check(await b.locator("#spheres-count").isDisabled(), "and its controls are disabled for B");
  check(await b.locator("#ribbon-turns").isEnabled(), "while the other parts stay free");
  check((await a.getAttribute('.part[data-part="spheres"]', "data-lease")) === "mine", "A sees it as theirs");
  await b.screenshot({ path: ".shots/lease-held.png" });
  await a.screenshot({ path: ".shots/lease-mine.png" });

  // A's presence is in B's here-now strip
  const here = await b.locator("[data-here] li").allTextContents();
  check(here.some((t) => t.includes(aName)), "B's here-now strip lists A", here.join(" | "));

  // A leaves: B sees the part free again at once
  await a.context().close();
  await b.waitForFunction(() => document.querySelector('.part[data-part="spheres"]')?.getAttribute("data-lease") === "free", null, { timeout: 3000 }).catch(() => null);
  check((await b.getAttribute('.part[data-part="spheres"]', "data-lease")) === "free", "when A leaves, the part is free for B");
  await b.context().close();
}

async function dragging(browser: Browser): Promise<void> {
  console.log("\n— dragging a slider: draw every frame, send at most every 100 ms —");
  const page = await visitor(browser);
  await freshBench(page);
  const sent: number[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/draft/edit")) sent.push(Date.now());
  });
  const box = (await page.locator("#ribbon-radius").boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  const startedAt = Date.now();
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(box.x + 4 + (i / 40) * (box.width - 8), box.y + box.height / 2);
    await page.waitForTimeout(15);
  }
  const dragMs = Date.now() - startedAt;
  await page.mouse.up();
  await page.waitForTimeout(400);
  const gaps = sent.slice(1).map((t, i) => t - sent[i]);
  // the release send may follow a throttled one closely; every other gap is ≥ ~100 ms
  const tooClose = gaps.slice(0, -1).filter((g) => g < 90);
  check(sent.length >= 2 && sent.length <= Math.ceil(dragMs / 100) + 2, "a drag sends a handful of edits, not one per frame", `${sent.length} sends over ${dragMs} ms`);
  check(tooClose.length === 0, "none closer than 100 ms apart while dragging", gaps.join(","));
  const final = (await page.textContent("#ribbon-radius + output")) ?? "";
  check(final === "1.6", "the final value is the one on release", final);
  await page.context().close();
}

async function publishing(browser: Browser): Promise<void> {
  console.log("\n— publishing, history, restore, storeroom —");
  const page = await visitor(browser);
  await freshBench(page);
  await page.click("[data-publish-open]");
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
    await page.screenshot({ path: ".shots/publish-confirm.png" });
    await page.click('[data-ask] button[value="no"]');
  }
  // publish as a new version of slot 1's exhibit: no confirm needed
  const version = page.locator('input[name="target"][data-group="version"]').first();
  await version.check();
  await page.screenshot({ path: ".shots/publish-form.png" });
  const plan = (await page.textContent("[data-plan]")) ?? "";
  check(/^Adds version \d+ to ".+"/.test(plan), "adding a version says which", plan);
  await page.click('[data-publish] button[type="submit"]');
  await page.waitForSelector('[data-view="exhibit"]:not([hidden]) [data-history] .version', { timeout: 3000 }).catch(() => null);
  const heading = (await page.textContent("[data-ex-title]")) ?? "";
  check(heading === title, "publishing shows the exhibit with its new title", heading);
  const versions = await page.locator("[data-history] .version").count();
  check(versions >= 2, "its history lists every version", String(versions));
  // restore the oldest as a new version
  const n0 = versions;
  const restore = page.locator('[data-history] button:has-text("Restore as version")').last();
  await restore.click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-history] .version").length === n + 1, n0, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-history] .version").count()) === n0 + 1, "restore adds a version rather than changing one");
  const top = (await page.locator("[data-history] .version").first().textContent()) ?? "";
  check(/restored from version 1/.test(top), "and says where it came from", top.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: ".shots/history.png" });

  // remix onto a full bench is only "Replace the workbench", confirmed
  check(await page.locator("[data-ex-remix]").isHidden(), "with a full bench, plain Remix isn't offered");
  check(await page.locator("[data-ex-replace]").isVisible(), "Replace the workbench is, separately labelled");
  // The state carries only the latest archived drafts, so after many runs
  // the count stays at its cap; look for the newest entry changing instead.
  const newest = async () => (await page.locator("[data-archive] .shelf-item").first().textContent().catch(() => "")) ?? "";
  const archivedBefore = await newest();
  await page.click("[data-ex-replace]");
  const asked = (await page.textContent("[data-ask-text]")) ?? "";
  check(/Archived drafts/.test(asked), "and asks first, saying the bench is archived", asked);
  await page.click("[data-ask-yes]");
  await page.waitForFunction((t) => (document.querySelector("[data-archive] .shelf-item")?.textContent ?? "") !== t, archivedBefore, { timeout: 3000 }).catch(() => null);
  const archivedTop = await newest();
  check(archivedTop !== archivedBefore && /replaced/.test(archivedTop), "the old bench is in Archived drafts", archivedTop.replace(/\s+/g, " ").slice(0, 60));
  await page.context().close();
}

async function archive(browser: Browser): Promise<void> {
  console.log("\n— every archived draft stays reachable —");
  const page = await visitor(browser);
  // archive enough drafts that the state's newest 12 can't hold them all
  for (let i = 0; i < 14; i++) {
    await post(page, "/draft/clear");
    await post(page, "/draft/start", { recipe: "bloom" });
  }
  await post(page, "/draft/clear");
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
  await freshBench(page);
  await page.context().setOffline(true);
  // EventSource notices a dead network on its own; kick it by closing the stream
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.waitForFunction(() => document.body.dataset.conn !== "live", null, { timeout: 15_000 }).catch(() => null);
  const status = (await page.textContent("[data-status]")) ?? "";
  check(/Reconnecting/.test(status) && (await page.locator("[data-status]").isVisible()), "it says it's reconnecting", status);
  const enabled = await page.$$eval("[data-edit]", (els) => els.filter((e) => !(e as HTMLButtonElement).disabled && (e as HTMLElement).offsetParent !== null).length);
  check(enabled === 0, "every control is disabled", `${enabled} still enabled`);
  check((await page.locator('[data-parts] .part').count()) > 0, "and the view stays");
  await page.screenshot({ path: ".shots/disconnected.png" });
  await page.context().setOffline(false);
  await live(page).catch(() => null);
  check(await page.locator("#ribbon-turns").isEnabled(), "editing comes back after the first state of the new connection");
  await page.context().close();
}

async function keyboard(browser: Browser): Promise<void> {
  console.log("\n— keyboard only —");
  const page = await visitor(browser);
  await freshBench(page);
  await page.focus("body");
  const reached = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const what = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      return el.dataset.go ? `go:${el.dataset.go}` : el.id || el.dataset.scene !== undefined ? el.id || "scene" : el.tagName;
    });
    reached.add(what);
  }
  check(reached.has("go:slot:1") && reached.has("go:bench"), "plinth buttons are in tab order");
  check(reached.has("ribbon-turns") || [...reached].some((r) => r.startsWith("ribbon-")), "the sliders are in tab order");
  check(reached.has("scene"), "the canvas takes focus");
  // arrow keys on the canvas orbit the camera, and don't scroll the page
  await page.focus("[data-scene]");
  const y0 = await page.evaluate(() => scrollY);
  const before = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 600 } });
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  const after = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 600 } });
  const gl = !(await page.evaluate(() => document.body.classList.contains("no-gl")));
  if (gl) check(!before.equals(after), "arrow keys on the canvas turn the camera");
  check((await page.evaluate(() => scrollY)) === y0, "without scrolling the page");
  // Enter on a plinth selects it and its history
  await page.focus('[data-go="slot:2"]');
  await page.keyboard.press("Enter");
  check((await page.getAttribute('[data-go="slot:2"]', "aria-pressed")) === "true", "Enter on a plinth selects it");
  // a swatch by keyboard
  await page.focus('[data-go="bench"]');
  await page.keyboard.press("Enter");
  const swatch = page.locator('input[type="radio"][data-part="ribbon"][data-key="colour"]').first();
  await swatch.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const checked = await page.$eval('input[type="radio"][data-part="ribbon"][data-key="colour"]:checked', (e) => (e as HTMLInputElement).value).catch(() => "");
  check(checked === "1", "arrow keys pick a colour", checked);
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
    // with a sculpture on the bench and a part open
    await freshBench(page);
    await page.waitForTimeout(800);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw === width, `${name}: no sideways scroll`, `${sw}px`);
    await page.screenshot({ path: `.shots/${name}-bench.png` });
    if (mobile) {
      await wholePage(page, `.shots/${name}-whole.png`);
      const seen = await page.evaluate(() => (window as unknown as { touchSeen: boolean[] }).touchSeen);
      check(seen.length > 0 && seen.every(Boolean), "phone: styled as a touch screen all through its screenshot", seen.join(" → "));
      // the slider and the sculpture it changes: where they land
      const slider = await page.locator("#ribbon-turns").boundingBox();
      check(!!slider && slider.width >= 150, "phone: sliders are wide enough to drag", `${Math.round(slider?.width ?? 0)}px`);
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

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = {
  firstVisit,
  noScript,
  noWebGL,
  realtime,
  dragging,
  publishing,
  archive,
  disconnect,
  keyboard,
  viewports,
  names,
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
