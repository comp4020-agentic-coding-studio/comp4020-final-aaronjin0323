#!/usr/bin/env node
// The checks only a real browser can make, run by hand before committing a
// change to the page. It drives the Chrome you have installed (CI has none,
// so this isn't in `pnpm check`), against the running app at APP_URL.
//
//   node scripts/browser-check.ts            # everything
//   node scripts/browser-check.ts realtime   # one section
//
// It writes screenshots to .shots/ (gitignored). Read them: a green run says
// the behaviour works, not that the page looks right.
//
// It claims tiles, so point it at a throwaway database, never production.
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";

const APP = process.env.APP_URL ?? "http://localhost:8080";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const only = process.argv[2];
mkdirSync(".shots", { recursive: true });

if (/fly\.dev/.test(APP)) throw new Error("browser-check claims tiles; don't point it at production");

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const fresh = async (browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  await page.goto(`${APP}/?v=${Date.now()}`);
  return page;
};

const freeTile = (page: Page): Promise<string> =>
  page.locator('button.tile[data-state="free"]').nth(5).getAttribute("value").then((v) => v ?? "");

async function realtime(browser: Browser): Promise<void> {
  console.log("\n— real-time: two people, two browsers —");
  const a = await fresh(browser);
  const b = await fresh(browser);
  await a.waitForTimeout(500); // both streams connected
  const cell = await freeTile(a);
  const url = a.url();

  await a.fill("#label", "Ana");
  const started = Date.now();
  await a.click(`button.tile[value="${cell}"]`);
  await b.waitForSelector(`button.tile[value="${cell}"][data-state="held"]`, { timeout: 3000 }).catch(() => null);
  const elapsed = Date.now() - started;
  const seen = await b.getAttribute(`button.tile[value="${cell}"]`, "data-state");

  check(seen === "held", "B sees A's claim without reloading", `${elapsed} ms`);
  check(elapsed < 1000, "within about a second", `${elapsed} ms`);
  check(a.url() === url, "A's claim didn't reload A's page");
  check((await a.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "A sees it as theirs");
  check((await b.getAttribute(`button.tile[value="${cell}"]`, "title")) === "Ana", "B sees A's name on it");

  // A refused claim says so in place.
  await b.fill("#label", "Ben");
  await b.click(`button.tile[value="${cell}"]`);
  const notice = await b.waitForSelector('[data-notice="taken"]', { timeout: 3000 }).catch(() => null);
  check(notice !== null, "B's claim on A's tile is refused with a notice");

  // The claimed count follows along.
  const countA = await a.textContent("[data-claimed]");
  const countB = await b.textContent("[data-claimed]");
  check(countA === countB, "both pages show the same claimed count", `${countA} / ${countB}`);

  await a.screenshot({ path: ".shots/realtime-a.png" });
  await b.screenshot({ path: ".shots/realtime-b.png" });
  await a.context().close();
  await b.context().close();
}

async function dormant(browser: Browser): Promise<void> {
  console.log("\n— dormant tiles —");
  const page = await fresh(browser);
  const dormantTile = page.locator('button.tile[data-state="dormant"]').first();
  if ((await dormantTile.count()) === 0) {
    console.log("  (no dormant tile on this board; seed one with scripts/seed-demo.ts)");
    await page.context().close();
    return;
  }
  const cell = (await dormantTile.getAttribute("value")) ?? "";
  const aria = (await dormantTile.getAttribute("aria-label")) ?? "";
  check(/away over a day, open to settle/.test(aria), "a dormant tile says it's open to settle", aria);
  const height = Number(await dormantTile.getAttribute("data-height"));
  await page.locator('[data-stage]').screenshot({ path: ".shots/dormant.png" });

  // In 3D a taller tile in front can hide a shorter one behind it; turning
  // the camera is how a player reaches it. Turn until this tile is the
  // topmost thing under its own centre, then click it like a player would.
  const reachable = (): Promise<boolean> =>
    page.evaluate((c) => {
      const el = document.querySelector(`button.tile[value="${c}"]`)!;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit);
    }, cell);
  let turns = 0;
  while (!(await reachable()) && turns < 8) {
    await page.click("text=Turn left");
    await page.waitForTimeout(350);
    turns++;
  }
  check(await reachable(), "turning the camera brings a hidden tile into reach", `${turns} turn(s)`);

  const watcher = await fresh(browser);
  await page.fill("#label", "Settler");
  await page.click(`button.tile[value="${cell}"]`);
  await watcher.waitForSelector(`button.tile[value="${cell}"][data-state="held"]`, { timeout: 3000 }).catch(() => null);
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "settling on a dormant tile works");
  check(
    (await watcher.getAttribute(`button.tile[value="${cell}"]`, "title")) === "Settler",
    "everyone else sees the new holder live",
  );
  check(Number(await page.getAttribute(`button.tile[value="${cell}"]`, "data-height")) === height, "the tile keeps its height");
  await page.context().close();
  await watcher.context().close();
}

async function keyboard(browser: Browser): Promise<void> {
  console.log("\n— keyboard —");
  const page = await fresh(browser);
  await page.fill("#label", "Keys");
  await page.press("#label", "Enter");
  check(await page.evaluate(() => document.activeElement?.classList.contains("tile") ?? false), "Enter in the name field goes to the board");
  // walk to a free tile
  for (let i = 0; i < 24; i++) {
    if ((await page.evaluate(() => (document.activeElement as HTMLElement).dataset.state)) === "free") break;
    await page.keyboard.press(i < 12 ? "d" : "s");
  }
  const cell = await page.evaluate(() => (document.activeElement as HTMLButtonElement).value);
  const url = page.url();
  await page.keyboard.press("Enter");
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "Enter claims the focused tile", `tile ${cell}`);
  check(page.url() === url, "and the page didn't reload");
  check(
    await page.evaluate((c) => (document.activeElement as HTMLButtonElement).value === c, cell),
    "focus stays on the claimed tile",
  );
  await page.click("#label");
  await page.keyboard.type("wasd");
  check((await page.inputValue("#label")).endsWith("wasd"), "WASD still types in the name field");
  await page.context().close();
}

async function noScript(browser: Browser): Promise<void> {
  console.log("\n— without JavaScript —");
  const page = await fresh(browser, { javaScriptEnabled: false });
  const cell = await freeTile(page);
  await page.fill("#label", "NoJS");
  await page.click(`button.tile[value="${cell}"]`);
  await page.waitForURL(/notice=claimed/, { timeout: 3000 }).catch(() => null);
  check(/notice=claimed/.test(page.url()), "a plain form post claims and reloads");
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "the reloaded board shows it");
  await page.context().close();
}

async function viewports(browser: Browser): Promise<void> {
  console.log("\n— both viewports —");
  for (const [name, width, height, mobile] of [
    ["desktop", 1440, 900, false],
    ["phone", 390, 844, true],
  ] as const) {
    const page = await fresh(browser, { viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(scrollWidth === width, `${name}: no sideways scroll`, `${scrollWidth}px`);
    await page.screenshot({ path: `.shots/${name}.png`, fullPage: true });
    await page.context().close();
  }
}

async function phone(browser: Browser): Promise<void> {
  console.log("\n— phone: tap to select, then confirm —");
  const page = await fresh(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cell = await freeTile(page);
  await page.fill("#label", "Thumb");
  const tile = page.locator(`button.tile[value="${cell}"]`);
  await tile.tap();
  check((await tile.getAttribute("data-state")) === "free", "the first tap doesn't claim");
  check(await page.locator(".confirm").isVisible(), "it shows the confirm bar");
  const label = (await page.textContent(".confirm-claim")) ?? "";
  check(/^Claim row \d+, column \d+$/.test(label), "the bar names the tile", label);
  const box = await page.locator(".confirm-claim").boundingBox();
  check((box?.height ?? 0) >= 44, "its button is a comfortable tap", `${Math.round(box?.height ?? 0)}px tall`);
  await page.screenshot({ path: ".shots/phone-confirm.png" });
  await page.locator(".confirm-claim").tap();
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await tile.getAttribute("data-state")) === "mine", "confirming claims it");
  check(!(await page.locator(".confirm").isVisible()), "and the bar goes away");

  // Cancel leaves everything as it was.
  const other = await freeTile(page);
  await page.locator(`button.tile[value="${other}"]`).tap();
  await page.locator(".confirm-cancel").tap();
  check(!(await page.locator(".confirm").isVisible()), "Cancel closes the bar");
  check((await page.getAttribute(`button.tile[value="${other}"]`, "data-state")) === "free", "and claims nothing");
  await page.context().close();
}

const SECTIONS = { realtime, dormant, keyboard, noScript, phone, viewports };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const [name, run] of Object.entries(SECTIONS)) {
    if (!only || only === name) await run(browser);
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed; now read the screenshots in .shots/");
process.exit(failures ? 1 : 0);
