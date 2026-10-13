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

// Whether a click at the tile's centre lands on the tile. In 3D a taller
// block in front can cover a shorter one behind it.
const reachable = (page: Page, cell: string | number): Promise<boolean> =>
  page.evaluate((c) => {
    const el = document.querySelector(`button.tile[value="${c}"]`)!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  }, String(cell));

// Turn the camera until the tile is uncovered, the way a player would, then
// click it. Fails the check rather than clicking through with force.
async function clickTile(page: Page, cell: string | number): Promise<void> {
  for (let turns = 0; !(await reachable(page, cell)); turns++) {
    if (turns === 8) throw new Error(`tile ${cell} can't be reached from any camera angle`);
    await page.click("text=Turn left");
    await page.waitForTimeout(350);
  }
  await page.click(`button.tile[value="${cell}"]`);
}

async function realtime(browser: Browser): Promise<void> {
  console.log("\n— real-time: two people, two browsers —");
  const a = await fresh(browser);
  const b = await fresh(browser);
  await a.waitForTimeout(500); // both streams connected
  const cell = await freeTile(a);
  const url = a.url();

  await a.fill("#label", "Ana");
  while (!(await reachable(a, cell))) {
    await a.click("text=Turn left");
    await a.waitForTimeout(350);
  }
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

  // B already sees the tile as Ana's, so clicking it names her, not a race.
  await b.fill("#label", "Ben");
  await clickTile(b, cell);
  const notice = await b.waitForSelector('[data-notice="held"]', { timeout: 3000 }).catch(() => null);
  const said = (await notice?.textContent()) ?? "";
  check(said.startsWith("Ana holds"), "B clicking A's tile is told it's Ana's", said);

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

  let turns = 0;
  while (!(await reachable(page, cell)) && turns < 8) {
    await page.click("text=Turn left");
    await page.waitForTimeout(350);
    turns++;
  }
  check(await reachable(page, cell), "turning the camera brings a hidden tile into reach", `${turns} turn(s)`);

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
  await clickTile(page, cell);
  await page.waitForURL(/notice=claimed/, { timeout: 3000 }).catch(() => null);
  check(/notice=claimed/.test(page.url()), "a plain form post claims and reloads");
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "the reloaded board shows it");
  await page.context().close();
}

async function hitTesting(browser: Browser): Promise<void> {
  console.log("\n— every free tile takes its own click —");
  const page = await fresh(browser);
  const lost = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLButtonElement>("button.tile")) {
      if (el.dataset.state !== "free") continue;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const tile = hit?.closest("button.tile");
      // Covered by a taller block is a 3D fact a player turns the camera for;
      // lost to anything else is a bug.
      if (tile !== el && !(tile && tile.getAttribute("data-state") !== "free")) out.push(el.value);
    }
    return out;
  });
  check(lost.length === 0, "no free tile loses its click to the board", lost.length ? `lost: ${lost.join(", ")}` : "");
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
  const title = (await page.textContent(".confirm-text")) ?? "";
  check(/^(No neighbours yet|Would lift \d+ neighbours?)\.$/.test(title), "and says whom it would lift", title);
  const box = await page.locator(".confirm-claim").boundingBox();
  check((box?.height ?? 0) >= 44, "its button is a comfortable tap", `${Math.round(box?.height ?? 0)}px tall`);
  await page.screenshot({ path: ".shots/phone-confirm.png" });
  await page.locator(".confirm-claim").tap();
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await tile.getAttribute("data-state")) === "mine", "confirming claims it");
  check(!(await page.locator(".confirm").isVisible()), "and the bar goes away");

  // Tapping someone else's tile says whose it is: on a phone there's no hover.
  const held = page.locator('button.tile[data-state="held"]').first();
  if ((await held.count()) > 0) {
    const name = (await held.getAttribute("title")) ?? "";
    await held.tap();
    const text = (await page.textContent(".confirm-text")) ?? "";
    check(text.startsWith(`${name} holds row`), "tapping a held tile names its holder", text);
    check(!(await page.locator(".confirm-claim").isVisible()), "and offers no claim button");
    await page.locator(".confirm-cancel").tap();
  }

  // Cancel leaves everything as it was.
  const other = await freeTile(page);
  await page.locator(`button.tile[value="${other}"]`).tap();
  await page.locator(".confirm-cancel").tap();
  check(!(await page.locator(".confirm").isVisible()), "Cancel closes the bar");
  check((await page.getAttribute(`button.tile[value="${other}"]`, "data-state")) === "free", "and claims nothing");
  await page.context().close();
}

// Finds a free tile with free neighbours all round, so a scene can be built
// on any board without bumping into what earlier runs left behind.
async function openPatch(page: Page): Promise<number> {
  const states = await page.$$eval("button.tile", (els) => els.map((e) => (e as HTMLElement).dataset.state));
  for (let r = 1; r < 11; r++) {
    for (let c = 1; c < 10; c++) {
      const ids = [-1, 0, 1].flatMap((dr) => [-1, 0, 1, 2].map((dc) => (r + dr) * 12 + c + dc));
      if (ids.every((id) => states[id] === "free")) return r * 12 + c;
    }
  }
  throw new Error("no open 3x4 patch on the board; reseed it");
}

async function claimAs(page: Page, name: string, cell: number): Promise<void> {
  await page.fill("#label", name);
  await clickTile(page, cell);
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 });
}

async function effects(browser: Browser): Promise<void> {
  console.log("\n— your choice, shown —");
  const mia = await fresh(browser);
  const kai = await fresh(browser);
  const me = await fresh(browser);
  await me.waitForTimeout(400);
  const centre = await openPatch(me);
  const [left, right] = [centre - 1, centre + 1];

  await claimAs(mia, "Mia", left);
  await claimAs(kai, "Kai", right);
  await me.waitForTimeout(300);

  // Watch Mia's page for a +1 appearing on Mia's own tile.
  const miaFloat = mia.waitForSelector(`button.tile[value="${left}"] .rise[data-delta="up"]`, { timeout: 3000 }).catch(() => null);
  await claimAs(me, "Me", centre);

  const myNotice = (await me.textContent('[data-notice="claimed"]')) ?? "";
  check(/You lifted (Mia and Kai|Kai and Mia)\./.test(myNotice), "my claim says who I lifted", myNotice);
  check((await miaFloat) !== null, "Mia sees +1 float off her tile");
  await mia.waitForSelector('[data-notice="arrived"]', { timeout: 3000 }).catch(() => null);
  const miaNotice = (await mia.textContent('[data-notice="arrived"]').catch(() => null)) ?? "";
  check(/^Me settled beside you\. You're up to height \d\.$/.test(miaNotice), "Mia is told who settled beside her", miaNotice);
  check((await me.locator('[data-notice]').count()) === 1, "I get one message, not one per channel");
  // Freeze the badge mid-flight so the screenshot shows what a player sees.
  await mia.addStyleTag({ content: ".rise { animation-play-state: paused !important; animation-delay: -0.25s !important; }" });
  const badge = mia.locator(`button.tile[value="${left}"]`);
  await badge.evaluate((el) => {
    const r = document.createElement("span");
    r.className = "rise";
    r.dataset.delta = "up";
    r.textContent = "+1";
    el.append(r);
  });
  await mia.locator("[data-stage]").screenshot({ path: ".shots/effects-mia.png" });

  // I move far away: Mia and Kai drop, and both are told.
  const miaDrop = mia.waitForSelector(`button.tile[value="${left}"] .rise[data-delta="down"]`, { timeout: 3000 }).catch(() => null);
  // Far away and with no claimed neighbours, so the move lifts nobody.
  const states = await me.$$eval("button.tile", (els) => els.map((e) => (e as HTMLElement).dataset.state));
  const lonely = (id: number): boolean =>
    states[id] === "free" &&
    [-13, -12, -11, -1, 1, 11, 12, 13].every((d) => id + d < 0 || id + d > 143 || states[id + d] === "free");
  const far = [...Array(144).keys()].filter((id) => Math.abs((id % 12) - (centre % 12)) > 2 || Math.abs(Math.floor(id / 12) - Math.floor(centre / 12)) > 2).find(lonely);
  if (far === undefined) throw new Error("no lonely free tile left; reseed the board");
  await clickTile(me, far);
  await me.waitForSelector(`button.tile[value="${far}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  const moved = (await me.textContent('[data-notice="claimed"]')) ?? "";
  check(/dropped a floor when you left\./.test(moved), "my move names who dropped", moved);
  check((await miaDrop) !== null, "Mia sees −1 float off her tile");
  await mia.waitForSelector('[data-notice="left"]', { timeout: 3000 }).catch(() => null);
  const left2 = (await mia.textContent('[data-notice="left"]').catch(() => null)) ?? "";
  check(/^Me moved away from beside you\./.test(left2), "Mia is told I moved away", left2);

  for (const p of [mia, kai, me]) await p.context().close();
}

const SECTIONS = { realtime, dormant, keyboard, noScript, effects, phone, hitTesting, viewports };

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
