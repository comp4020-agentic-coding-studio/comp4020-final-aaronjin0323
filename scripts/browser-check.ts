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
  await openEditor(page);
}

/** Into create mode the way a visitor goes: "Shape it" (ADR 14). */
async function openEditor(page: Page): Promise<void> {
  if (await page.locator("[data-shape]").isVisible()) await page.click("[data-shape]");
  await page.waitForSelector('[data-parts] .part[data-part="ribbon"]', { state: "visible" });
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
  check(lede.trim().split(/\s+/).length <= 6 && lede.trim().length > 0, "the first line invites, in a few words", lede);
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
  await openEditor(b);
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
  const here = await b.$$eval("[data-here] [aria-label]", (els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
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
  await page.locator("[data-history] .version-chip").last().click();
  const restore = page.locator('[data-history] button[aria-label^="Restore as version"]');
  await restore.click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-history] .version").length === n + 1, n0, { timeout: 3000 }).catch(() => null);
  check((await page.locator("[data-history] .version").count()) === n0 + 1, "restore adds a version rather than changing one");
  const top = (await page.locator("[data-history] .version-chip").first().getAttribute("aria-label")) ?? "";
  check(/restored from version 1/.test(top), "and says where it came from", top.slice(0, 90));
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
  await page.focus("[data-shape]");
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
      // the row shows colours and numbers; each button names its exhibit
      // in full for screen readers and on hover (ADR 13)
      const named = await page.$$eval("[data-go]", (els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      check(named.length === 7 && named.every((n) => /^(Workbench|Plinth \d): .+/.test(n)), "phone: every plinth button names its exhibit", named.join(" | "));
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
    // the bench card, a plinth, and the bench editor once it's opened
    for (const sel of ["bench", "slot:1", "create"]) {
      if (sel === "create") {
        await page.click('[data-go="bench"]');
        await page.click("[data-shape]");
      } else await page.click(`[data-go="${sel}"]`);
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
  console.log("\n— phone: the sculpture stays in sight while you edit —");
  const page = await visitor(browser, PHONE);
  await freshBench(page);
  // open every part, so every control is reachable
  for (const t of await page.locator("[data-toggle]").all()) if ((await t.getAttribute("aria-expanded")) === "false") await t.click();
  const controls = await page.locator('[data-view="bench"] input[data-part], [data-publish-open], [data-clear]').all();
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
      // a radio swatch is visually its label
      const shown = (el as HTMLInputElement).type === "radio" ? (el as Element).closest("label")!.getBoundingClientRect() : box;
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
  check(controls.length >= 30 && misses.length === 0, "every bench control is worked with the sculpture on screen", misses.length ? misses.slice(0, 6).join("; ") : `${controls.length} controls`);
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
  // and a slider's change shows in the scene while it's on screen: the
  // canvas pixels differ before and after moving the last part's Scale
  const scale = page.locator('[data-view="bench"] input[data-key="scale"]').last();
  await scale.scrollIntoViewIfNeeded();
  const sceneBox = (await page.locator("[data-scene]").boundingBox())!;
  const before = await page.screenshot({ clip: sceneBox });
  await scale.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const after = await page.screenshot({ clip: sceneBox });
  check(!before.equals(after), "and the sculpture changes in view as a slider moves");
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
  console.log("\n— the opening view —");
  const setup = await visitor(browser);
  await freshBench(setup);
  await setup.context().close();
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
    const inside = p.camR < p.archR && p.camY < p.archTop;
    check(inside, `${label}: the camera stands inside the pavilion`, `r ${p.camR.toFixed(1)} of ${p.archR.toFixed(1)}, y ${p.camY.toFixed(1)}`);
    check(p.camY >= 1.3 && p.camY <= 2.0, `${label}: at a visitor's eye height`, `y ${p.camY.toFixed(2)}`);
    const area = (p.box.w * p.box.h) / (p.view.w * p.view.h);
    const cx = (p.box.x + p.box.w / 2 - p.view.x) / p.view.w;
    const cy = (p.box.y + p.box.h / 2 - p.view.y) / p.view.h;
    check(area >= 0.25 && Math.abs(cx - 0.5) < 0.12 && Math.abs(cy - 0.5) < 0.15, `${label}: the bench sculpture is big and central`, `${Math.round(area * 100)}% of the scene, centre ${cx.toFixed(2)}, ${cy.toFixed(2)}`);
    await page.screenshot({ path: `.shots/opening-${label}.png` });
    await page.context().close();
  }
}

// Orbit (CLAUDE.md, "Orbit"; ADR 15): Play starts one; dragging a sphere
// from the shelf onto the ribbon places it and the ribbon catches it; a
// second visitor reshaping the ribbon moves that sphere on the first
// visitor's screen; Undo puts the last edit back; the keyboard does what a
// drag does; sliders, history and drawers are out of sight.
async function orbit(browser: Browser): Promise<void> {
  console.log("\n— Orbit: pieces that affect each other —");
  const a = await visitor(browser);
  const b = await visitor(browser);
  const probe = (p: Page) => p.evaluate(() => (document.querySelector("[data-scene]") as any).probe().orbit);
  // from something else on the bench, so Play is offered and asks first
  await post(a, "/draft/clear");
  await post(a, "/draft/start", { recipe: "loop" });
  await a.waitForSelector("[data-play]:not([hidden])", { timeout: 3000 }).catch(() => null);
  // A starts it, by Play
  await a.click("[data-play]", { timeout: 1500 }).catch(() => null);
  await a.click("[data-ask-yes]", { timeout: 2000 }).catch(() => null);
  const started = await a.waitForFunction(() => document.body.dataset.recipe === "orbit" && document.body.dataset.mode === "create" && !document.querySelector("[data-pieces]")!.hasAttribute("hidden"), null, { timeout: 4000 }).then(() => true, () => false);
  check(started, "Play starts an Orbit, in the editor, with its pieces");
  if (!started) {
    await a.context().close();
    await b.context().close();
    return;
  }
  // the main experience: no slider, no history, no drawer in sight
  const sliders = await a.locator('[data-view="bench"] input[type=range]').filter({ visible: true }).count();
  const drawers = await a.locator("[data-drawers]").isVisible();
  const history = await a.locator("[data-history], .history").filter({ visible: true }).count();
  check(sliders === 0 && !drawers && history === 0, "sliders, history and drawers are out of sight", `${sliders} sliders, drawers ${drawers}, history ${history}`);
  check(await a.locator("[data-undo]").isVisible() && await a.locator("[data-publish-open]").isVisible(), "Undo and Exhibit are there");
  await a.waitForTimeout(1200);
  // drag the chrome sphere from the shelf onto the ribbon
  const o0 = await probe(a);
  const box = (await a.locator("[data-scene]").boundingBox())!;
  const from = o0?.shelf?.chrome;
  const to = o0?.ribbon;
  if (from && to) {
    await a.mouse.move(box.x + from.x, box.y + from.y);
    await a.mouse.down();
    for (let i = 1; i <= 12; i++) await a.mouse.move(box.x + from.x + ((to.x - from.x) * i) / 12, box.y + from.y + ((to.y - from.y) * i) / 12);
    const glowing = await a.locator("[data-scene]").getAttribute("data-catches");
    await a.mouse.up();
    check(glowing === "true", "a sphere dragged over the ribbon glows before it's dropped", `catches ${glowing}`);
  } else check(false, "the shelf and ribbon are on screen to drag between", JSON.stringify(o0));
  const placed = await a.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().orbit?.spheres?.chrome?.caught === true, null, { timeout: 3000 }).then(() => true, () => false);
  const row = await a.locator('[data-piece-row="chrome"]').getAttribute("data-caught").catch(() => null);
  check(placed, "dropped on the ribbon, the sphere is placed and caught", `row says caught ${row}`);
  // B, a different visitor, reshapes the ribbon; A's sphere moves on A's screen
  await b.click("[data-shape]").catch(() => null);
  await b.waitForSelector("[data-pieces]:not([hidden])", { timeout: 3000 }).catch(() => null);
  const posBefore = await a.evaluate(() => (document.querySelector("[data-scene]") as any).probe().orbit.spheres.chrome.world);
  const t0 = Date.now();
  await b.click('[data-ribbon="turns:1"]');
  const moved = await a
    .waitForFunction(
      (before) => {
        const w = (document.querySelector("[data-scene]") as any).probe().orbit?.spheres?.chrome?.world;
        return w && Math.hypot(w[0] - before[0], w[1] - before[1], w[2] - before[2]) > 0.05;
      },
      posBefore,
      { timeout: 2000 },
    )
    .then(() => true, () => false);
  const turnsA = await a.evaluate(() => (document.querySelector('[data-view="bench"] input[data-part="ribbon"][data-key="turns"]') as HTMLInputElement)?.value);
  check(moved, "another visitor reshaping the ribbon moves your sphere on your screen", `${Date.now() - t0} ms, A sees loops ${turnsA}`);
  // Undo, on A: A's last edit was the drop, so the sphere goes back to the shelf
  await a.click("[data-undo]");
  const undone = await a.waitForFunction(() => !(document.querySelector("[data-scene]") as any).probe().orbit?.spheres?.chrome, null, { timeout: 3000 }).then(() => true, () => false);
  const turnsAfter = await a.evaluate(() => (document.querySelector('[data-view="bench"] input[data-part="ribbon"][data-key="turns"]') as HTMLInputElement)?.value);
  check(undone && turnsAfter === turnsA, "Undo takes back your own last change, and leaves the other visitor's", `sphere back ${undone}, loops ${turnsA} → ${turnsAfter}`);
  // the keyboard does what a drag does
  await a.locator('[data-piece="teal:place"]').focus();
  await a.keyboard.press("Enter");
  const keyed = await a.waitForFunction(() => (document.querySelector("[data-scene]") as any).probe().orbit?.spheres?.teal?.caught === true, null, { timeout: 3000 }).then(() => true, () => false);
  check(keyed, "the keyboard places a sphere on the ribbon too");
  await a.screenshot({ path: ".shots/orbit-desktop.png" });
  // and it keeps: Exhibit is the ordinary publish, with both visitors credited
  const credits = await a.locator("[data-bench-credits] li").count();
  check(credits >= 2, "both visitors are credited on the draft", `${credits} contributors`);
  await a.context().close();
  await b.context().close();
  // the phone, in the editor: pieces and the sculpture both in view
  const ph = await visitor(browser, PHONE);
  await ph.click("[data-shape]").catch(() => null);
  await ph.waitForSelector("[data-pieces]:not([hidden])", { timeout: 3000 }).catch(() => null);
  await ph.waitForTimeout(1200);
  const pr = await ph.evaluate(() => {
    const c = document.querySelector("[data-scene]") as any;
    const p = c.probe();
    const pieces = document.querySelector("[data-pieces]")!.getBoundingClientRect();
    return { box: p.box, view: p.view, piecesIn: pieces.top < innerHeight && pieces.bottom > 0 && pieces.height > 40 };
  });
  check(pr.piecesIn && pr.box.w * pr.box.h > 0.15 * pr.view.w * pr.view.h, "phone: the pieces and the sculpture are both in view", JSON.stringify(pr.box));
  await ph.screenshot({ path: ".shots/orbit-phone.png" });
  await ph.context().close();
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

// Every plinth close-up, at both sizes: the exhibit is clear of every
// panel (as the DOM measures them), nothing stands in front of it, nothing
// big crowds the lens, no arch is cut through its curve. Then the Gallery
// button: there on a plinth and after a drag, and it brings the opening
// view back (CLAUDE.md, "A plinth close-up is composed").
async function focus(browser: Browser): Promise<void> {
  console.log("\n— plinth close-ups, and back to the gallery —");
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForFunction(() => typeof (document.querySelector("[data-scene]") as any)?.probe === "function", null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const opening = await page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
    check(await page.locator("[data-home]").isHidden(), `${label}: no Gallery button on the opening view`);
    const bad: string[] = [];
    for (let slot = 1; slot <= 6; slot++) {
      await page.click(`[data-go="slot:${slot}"]`);
      await page.waitForTimeout(150);
      await twoFrames(page);
      const r = await page.evaluate((slot) => {
        const canvas = document.querySelector("[data-scene]")!;
        const c = canvas.getBoundingClientRect();
        const p = (canvas as any).probe(slot);
        const box = { l: c.left + p.box.x, t: c.top + p.box.y, r: c.left + p.box.x + p.box.w, b: c.top + p.box.y + p.box.h };
        const panels = [".panel", ".brand", "[data-people]", "[data-nav]", "[data-home]", ".top"]
          .map((q) => [q, document.querySelector(q)] as const)
          .filter(([, n]) => n && (n as Element).checkVisibility())
          .map(([q, n]) => [q, (n as Element).getBoundingClientRect()] as const);
        // a little slack for the exhibit's own shadow and the pulse ring
        const hit = panels.filter(([, b]) => b.width && b.left < box.r - 4 && b.right > box.l + 4 && b.top < box.b - 4 && b.bottom > box.t + 4).map(([q]) => q);
        const offCanvas = box.l < c.left - 2 || box.r > c.right + 2 || box.t < c.top - 2 || box.b > c.bottom + 2;
        return { ...p, hit, offCanvas, home: !(document.querySelector("[data-home]") as HTMLElement).hidden };
      }, slot);
      const why = [
        r.hit.length ? `under ${r.hit.join(",")}` : "",
        r.offCanvas ? "off the canvas" : "",
        r.occluded >= 0.03 ? `${Math.round(r.occluded * 100)}% hidden` : "",
        r.near >= 0.03 ? `${Math.round(r.near * 100)}% near foreground` : "",
        r.cuts ? `${r.cuts} arch cut` : "",
        r.camR >= r.archR ? "camera outside" : "",
        r.box.w * r.box.h < 0.08 * r.view.w * r.view.h ? "too small" : "",
        r.home ? "" : "no Gallery button",
      ].filter(Boolean);
      if (why.length) bad.push(`${slot}: ${why.join(", ")}`);
      if (slot === 2 || slot === 5) await page.screenshot({ path: `.shots/focus-${label}-${slot}.png` });
    }
    check(bad.length === 0, `${label}: every plinth close-up is clear, unblocked, uncut and uncrowded`, bad.join("; ") || "6 plinths");
    // back to the gallery
    await page.click("[data-home]");
    await page.waitForTimeout(1600);
    const back = await page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
    const pressed = await page.getAttribute('[data-go="bench"]', "aria-pressed");
    check(pressed === "true" && Math.abs(back.camR - opening.camR) < 0.3 && Math.abs(back.camY - opening.camY) < 0.3 && (await page.locator("[data-home]").isHidden()), `${label}: Gallery brings back the opening view`, `r ${back.camR.toFixed(2)}/${opening.camR.toFixed(2)}, y ${back.camY.toFixed(2)}/${opening.camY.toFixed(2)}`);
    // a drag away from the opening view offers it too, and Escape takes it
    const sc = (await page.locator("[data-scene]").boundingBox())!;
    const y0 = sc.y + sc.height * 0.4;
    await page.mouse.move(sc.x + sc.width * 0.3, y0);
    await page.mouse.down();
    await page.mouse.move(sc.x + sc.width * 0.45, y0 + 20, { steps: 6 });
    await page.mouse.up();
    const shown = await page.locator("[data-home]").isVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1600);
    const esc = await page.evaluate(() => (document.querySelector("[data-scene]") as any).probe());
    const turned = Math.abs(((((esc.yaw - opening.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI);
    check(shown && turned < 0.05 && (await page.locator("[data-home]").isHidden()), `${label}: a drag offers Gallery, and Escape goes back`, `shown ${shown}, yaw ${esc.yaw.toFixed(2)}/${opening.yaw.toFixed(2)}`);
    await page.context().close();
  }
}

// Explore first, then create (ADR 14), at both sizes: the first screen is a
// compact card with no editing control showing; "Shape it", by keyboard,
// opens the editor with focus on its heading; Done, Gallery and Escape each
// come back to the card with focus on "Shape it"; a plinth never opens it.
async function explore(browser: Browser): Promise<void> {
  console.log("\n— explore first, then create —");
  const setup = await visitor(browser);
  await post(setup, "/draft/clear");
  await post(setup, "/draft/start", { recipe: "loop" });
  await setup.context().close();
  const EDIT = '[data-view="bench"] input[data-part], [data-publish-open], [data-clear]';
  const visibleEditing = (page: Page) => page.locator(EDIT).evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility()).length);
  const focusedIs = (page: Page, sel: string) => page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, sel);
  for (const [label, opts] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    const page = await visitor(browser, opts);
    await page.waitForSelector("[data-shape]", { state: "attached", timeout: 3000 }).catch(() => null);
    const card = page.locator("[data-card]").filter({ visible: true }).first();
    const cardShown = (await card.count()) > 0 && (await card.isVisible());
    const cardH = cardShown ? ((await card.boundingBox())?.height ?? 999) : 999;
    const editingAtStart = await visibleEditing(page);
    check(cardShown && editingAtStart === 0, `${label}: it opens on a selection card, no editing controls`, `card ${cardShown}, ${editingAtStart} controls showing`);
    check(cardH <= (label === "phone" ? 240 : 280), `${label}: and the card is compact`, `${Math.round(cardH)}px`);
    // the tab order has no hidden editor in it
    const tabbable = await page.locator(EDIT).evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility() && (e as HTMLElement).tabIndex >= 0).length);
    check(tabbable === 0, `${label}: nothing from the editor is in the tab order`, String(tabbable));
    // into create, by keyboard
    await page.focus("[data-shape]", { timeout: 1500 }).catch(() => null);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const editing = await visibleEditing(page);
    check(editing >= 10 && (await focusedIs(page, "#bench-h")), `${label}: "Shape it" opens the editor, focus on its heading`, `${editing} controls`);
    // every way out comes back to the card, focus on what opened it
    const ways: Array<[string, () => Promise<void>]> = [
      ["Done", () => page.click("[data-done]", { timeout: 1500 })],
      ["Gallery", () => page.click("[data-home]", { timeout: 1500 })],
      ["Escape", async () => {
        await page.focus('[data-view="bench"] input[type="range"]', { timeout: 1500 });
        await page.keyboard.press("Escape");
      }],
    ];
    for (const [name, leave] of ways) {
      await page.click("[data-shape]", { timeout: 1500 }).catch(() => null);
      await page.waitForTimeout(150);
      await leave().catch(() => null);
      await page.waitForTimeout(250);
      const back = (await visibleEditing(page)) === 0 && (await card.isVisible().catch(() => false)) && (await focusedIs(page, "[data-shape]"));
      check(back, `${label}: ${name} goes back to the card, focus on "Shape it"`);
    }
    // a plinth is looked at, never edited
    await page.click("[data-shape]", { timeout: 1500 }).catch(() => null);
    await page.click('[data-go="slot:1"]');
    await page.waitForTimeout(200);
    check((await visibleEditing(page)) === 0 && (await card.isVisible().catch(() => false)), `${label}: choosing a plinth shows its card, not the editor`);
    await page.click('[data-go="bench"]');
    await page.waitForTimeout(200);
    check((await visibleEditing(page)) === 0, `${label}: and coming back to the bench is explore too`);
    await page.screenshot({ path: `.shots/explore-${label}.png` });
    await page.context().close();
  }
}

const SECTIONS: Record<string, (b: Browser) => Promise<void>> = {
  firstVisit,
  explore,
  opening,
  look,
  orbit,
  focus,
  noScript,
  noWebGL,
  realtime,
  dragging,
  publishing,
  archive,
  disconnect,
  keyboard,
  viewports,
  contrast,
  words,
  "phone-edit": phoneEdit,
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
