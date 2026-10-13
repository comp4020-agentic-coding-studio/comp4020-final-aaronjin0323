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
      // Off screen, elementFromPoint finds nothing: scroll to it, as a player would.
      el.scrollIntoView({ block: "center", behavior: "instant" });
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

// The whole page as the emulated device sees it. Playwright's fullPage
// renders as a mouse device while it captures: on a phone, (hover: none) and
// (pointer: coarse) stop matching and the shot shows the desktop styles.
// Making the viewport as tall as the page keeps the device intact. The two
// frames matter: a capture straight after the resize can catch it half
// drawn, with the top of the page tiled down the shot.
async function wholePage(page: Page, path: string): Promise<void> {
  const screen = page.viewportSize();
  if (!screen) throw new Error("wholePage needs a fixed viewport");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: screen.width, height });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path });
  await page.setViewportSize(screen);
}

async function viewports(browser: Browser): Promise<void> {
  console.log("\n— both viewports —");
  for (const [name, width, height, mobile] of [
    ["desktop", 1440, 900, false],
    ["phone", 390, 844, true],
  ] as const) {
    const page = await fresh(browser, { viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await page.evaluate(() => document.fonts.ready);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(scrollWidth === width, `${name}: no sideways scroll`, `${scrollWidth}px`);
    // The page notes every flip of the touch query while the shot is taken:
    // a flip means the phone shot shows the styles for a mouse.
    await page.evaluate(() => {
      const query = matchMedia("(hover: none) and (pointer: coarse)");
      const seen = [query.matches];
      query.addEventListener("change", (e) => seen.push(e.matches));
      Object.assign(window, { touchSeen: seen });
    });
    await wholePage(page, `.shots/${name}.png`);
    if (mobile) {
      const seen = await page.evaluate(() => (window as unknown as { touchSeen: boolean[] }).touchSeen);
      check(seen.every(Boolean), "phone: styled as a touch screen all through its screenshot", seen.join(" → "));
    }
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

// The tile's data-* hooks, as a short string for a check's detail.
const hooks = (page: Page, cell: number): Promise<Record<string, string | undefined>> =>
  page.$eval(`button.tile[value="${cell}"]`, (el) => ({ ...(el as HTMLElement).dataset }));
// Whether an element is really on screen: [hidden] can lose to a display rule.
const shown = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (el) => getComputedStyle(el).display !== "none").catch(() => false);

async function preview(browser: Browser): Promise<void> {
  console.log("\n— preview and inspector, by mouse and keyboard —");
  const mia = await fresh(browser);
  const me = await fresh(browser);
  await me.waitForTimeout(400);
  const centre = await openPatch(me);
  const left = centre - 1;
  await claimAs(mia, "Mia", left);
  await me.waitForSelector(`button.tile[value="${left}"][data-state="held"]`, { timeout: 3000 });
  check((await me.getAttribute("[data-conn]", "data-conn")) === "live", "the connection line says live");

  // Hover a free tile beside Mia: it previews its height and Mia's rise.
  const before = await me.$$eval("button.tile", (els) => els.map((e) => `${(e as HTMLElement).dataset.state}:${(e as HTMLElement).dataset.height}`).join());
  while (!(await reachable(me, centre))) {
    await me.click("text=Turn left");
    await me.waitForTimeout(350);
  }
  await me.hover(`button.tile[value="${centre}"]`);
  const target = await hooks(me, centre);
  check(target.preview === "target" && target.previewHeight === "1", "hovering a free tile previews its height", JSON.stringify(target));
  check((await hooks(me, left)).preview === "lift", "and marks the neighbour it would lift");
  check(
    (await me.$$eval("[data-preview]", (els) => els.length)) === 2,
    "and nothing else",
    `${await me.$$eval("[data-preview]", (els) => els.map((e) => (e as HTMLButtonElement).value).join())}`,
  );
  const facts = (await me.textContent("[data-inspect]").catch(() => "")) ?? "";
  check((await shown(me, "[data-inspect]")) && /If you settle here/.test(facts), "the inspector says what settling would do", facts.replace(/\s+/g, " ").trim());
  await me.locator("[data-stage]").screenshot({ path: ".shots/preview-hover.png" });
  const after = await me.$$eval("button.tile", (els) => els.map((e) => `${(e as HTMLElement).dataset.state}:${(e as HTMLElement).dataset.height}`).join());
  check(after === before, "previewing changes no real state");

  // Hover Mia's tile: who holds it and how long it's safe.
  if (await reachable(me, left)) {
    await me.hover(`button.tile[value="${left}"]`);
    const info = ((await me.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
    check(/Mia/.test(info) && /safe for \d+ h \d+ m/.test(info), "hovering a held tile shows its holder and protection left", info.trim());
  }

  // Moving the mouse off the board clears it all.
  await me.mouse.move(2, 2);
  check((await me.$$eval("[data-preview]", (els) => els.length)) === 0, "leaving the board clears the preview");
  check(!(await shown(me, "[data-inspect]")), "and hides the inspector");

  // Keyboard alone reaches the same information.
  await me.press("#label", "Enter"); // lands on the board
  // A key press makes the focus keyboard-visible. Step away and back; at a
  // board edge one order can't move, so try the other.
  for (const [away, back] of [["ArrowLeft", "ArrowRight"], ["ArrowRight", "ArrowLeft"]]) {
    await me.evaluate((c) => (document.querySelector(`button.tile[value="${c}"]`) as HTMLElement).focus(), String(left));
    await me.keyboard.press(away);
    await me.keyboard.press(back);
    if ((await me.evaluate(() => (document.activeElement as HTMLButtonElement).value)) === String(left)) break;
  }
  const keyed = await me.evaluate(() => (document.activeElement as HTMLButtonElement).value);
  const keyInfo = ((await me.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
  check(keyed === String(left) && /Mia/.test(keyInfo), "the keyboard reaches the inspector", `focused ${keyed}: ${keyInfo.trim()}`);
  const describedBy = await me.evaluate(() => document.activeElement?.getAttribute("aria-describedby") ?? "");
  check(describedBy !== "" && (await me.$(`#${describedBy}[data-inspect]`)) !== null, "and the focused tile is described by it", describedBy);
  await me.keyboard.press("Tab"); // off the board
  await me.waitForTimeout(50);
  check(!(await shown(me, "[data-inspect]")), "leaving the board by keyboard hides it");

  await mia.context().close();
  await me.context().close();
}

async function claiming(browser: Browser): Promise<void> {
  console.log("\n— a claim in flight —");
  const page = await fresh(browser);
  const watcher = await fresh(browser);
  await page.waitForTimeout(400);
  const cell = Number(await freeTile(page));
  await page.fill("#label", "Slow");

  // The claim reaches the server, but its reply is held back: the stream
  // shows the new board first, and the page must still not say "claimed"
  // until the reply confirms it. Every post is counted.
  let posts = 0;
  let release = (): void => {};
  await page.route("**/claim", async (route) => {
    posts++;
    const reply = await route.fetch();
    await new Promise<void>((done) => (release = done));
    await route.fulfill({ response: reply });
  });
  const fresh1 = watcher.waitForSelector(`button.tile[value="${cell}"][data-fresh]`, { timeout: 4000 }).catch(() => null);
  while (!(await reachable(page, cell))) {
    await page.click("text=Turn left");
    await page.waitForTimeout(350);
  }
  await page.click(`button.tile[value="${cell}"]`);
  await page.waitForTimeout(100);
  check((await hooks(page, cell)).pending === "", "the tile shows pending while the claim runs");
  await page.click(`button.tile[value="${cell}"]`);
  await page.focus(`button.tile[value="${cell}"]`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  check(posts === 1, "a second click or Enter while pending posts nothing", `${posts} post(s)`);
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check(
    (await page.locator('[data-notice="claimed"]').count()) === 0 && !/Claimed/.test((await page.textContent("[data-announce]")) ?? ""),
    "the stream showing it first doesn't announce success before the reply",
  );
  check((await hooks(page, cell)).pending === "", "and it stays pending until the reply");
  release();
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  await page.waitForFunction(() => !document.querySelector("[data-pending]"), null, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, cell)).pending === undefined, "and pending clears when it answers");
  const said = (await page.textContent('[data-notice="claimed"]').catch(() => "")) ?? "";
  check(/^Claimed row \d+, column \d+\./.test(said), "success says what was claimed", said);
  await page.waitForTimeout(100);
  const spoken = (await page.textContent("[data-announce]")) ?? "";
  check(spoken === said, "and it's announced to screen readers", spoken);

  // Someone else's claim is marked on the watcher's board, briefly.
  check((await fresh1) !== null, "another page marks the fresh claim");
  await watcher.waitForTimeout(2300);
  check((await hooks(watcher, cell)).fresh === undefined, "and the mark goes after about two seconds");
  check(
    await watcher.evaluate(() => !document.activeElement || !document.activeElement.classList.contains("tile")),
    "without taking the watcher's focus",
  );
  await page.unroute("**/claim");

  // Failures say why, and never show a claim as made.
  const other = Number(await freeTile(page));
  for (const [what, handler, pattern] of [
    ["the network failing", (r: import("playwright-core").Route) => r.abort("internetdisconnected"), /Couldn't reach the server/],
    ["a 403", (r: import("playwright-core").Route) => r.fulfill({ status: 403, body: "Cross-site claim refused" }), /refused a claim/],
    ["a 409", (r: import("playwright-core").Route) => r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"taken"}' }), /got there first/],
    ["a 400", (r: import("playwright-core").Route) => r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"label"}' }), /1 to 24 characters/],
  ] as const) {
    await page.route("**/claim", handler);
    await clickTile(page, other);
    await page.waitForFunction(() => !document.querySelector("[data-pending]"), null, { timeout: 3000 }).catch(() => null);
    const text = (await page.textContent("[data-notices]")) ?? "";
    check(pattern.test(text), `${what} is explained`, text);
    check((await hooks(page, other)).state === "free", `and after ${what} the tile isn't shown as mine`);
    await page.unroute("**/claim");
  }

  // Space claims a focused tile too.
  const spaced = Number(await freeTile(page));
  await page.press("#label", "Enter");
  await page.evaluate((c) => (document.querySelector(`button.tile[value="${c}"]`) as HTMLElement).focus(), String(spaced));
  await page.keyboard.press("Space");
  await page.waitForSelector(`button.tile[value="${spaced}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, spaced)).state === "mine", "Space claims the focused tile");

  await page.context().close();
  await watcher.context().close();
}

async function touchInspect(browser: Browser): Promise<void> {
  console.log("\n— phone: tap to inspect and preview —");
  const ana = await fresh(browser);
  const page = await fresh(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.waitForTimeout(400);
  const centre = await openPatch(page);
  await claimAs(ana, "Ana", centre - 1);
  await page.waitForSelector(`button.tile[value="${centre - 1}"][data-state="held"]`, { timeout: 3000 });

  await page.locator(`button.tile[value="${centre}"]`).tap();
  const t = await hooks(page, centre);
  check(t.selected === "" && t.preview === "target", "tapping a free tile selects and previews it", JSON.stringify(t));
  check((await hooks(page, centre - 1)).preview === "lift", "and marks whom it would lift");
  await page.screenshot({ path: ".shots/phone-preview.png" });

  await page.locator(`button.tile[value="${centre - 1}"]`).tap();
  const info = ((await page.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
  check((await shown(page, "[data-inspect]")) && /Ana/.test(info) && /safe for/.test(info), "tapping a held tile inspects it", info.trim());
  check((await page.$$eval("[data-preview]", (els) => els.length)) === 0, "and a held tile previews nothing");
  await page.locator(".confirm-cancel").tap();
  check((await page.$$eval("[data-selected], [data-preview]", (els) => els.length)) === 0, "Cancel clears the selection and preview");
  check(!(await shown(page, "[data-inspect]")), "and the inspector");
  await ana.context().close();
  await page.context().close();
}

const SECTIONS = { realtime, dormant, keyboard, noScript, effects, phone, preview, claiming, touchInspect, hitTesting, viewports };

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
