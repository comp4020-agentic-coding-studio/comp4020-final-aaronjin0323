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
import { randomUUID } from "node:crypto";
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
async function tapTile(page: Page, cell: string | number): Promise<void> {
  for (let turns = 0; !(await reachable(page, cell)); turns++) {
    if (turns === 8) throw new Error(`tile ${cell} can't be reached from any camera angle`);
    await page.locator("text=Turn left").tap();
    await page.waitForTimeout(350);
  }
  await page.locator(`button.tile[value="${cell}"]`).tap();
}

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
  await a.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await a.getAttribute(`button.tile[value="${cell}"]`, "data-state")) === "mine", "A sees it as theirs");
  check((await b.getAttribute(`button.tile[value="${cell}"]`, "title")) === "Ana", "B sees A's name on it");

  // B already sees the tile as Ana's, so clicking it names her, not a race.
  await b.fill("#label", "Ben");
  await clickTile(b, cell);
  const notice = await b.waitForSelector('[data-notice="held"]', { timeout: 3000 }).catch(() => null);
  const said = (await notice?.textContent()) ?? "";
  check(said.startsWith("Ana's Small House"), "B clicking A's plot is told it's Ana's", said);

  // The claimed count follows along.
  const countA = await a.textContent("[data-claimed]");
  const countB = await b.textContent("[data-claimed]");
  check(countA === countB, "both pages show the same claimed count", `${countA} / ${countB}`);

  await a.screenshot({ path: ".shots/realtime-a.png" });
  await b.screenshot({ path: ".shots/realtime-b.png" });
  await a.context().close();
  await b.context().close();
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
    ["phone-360", 360, 780, true],
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
    // The goal line is one line, at every size, even with the longest name a
    // label allows in it (wide glyphs) and a two-digit count.
    const real = await page.$eval("[data-goal]", (el) => el.innerHTML);
    await page.$eval("[data-goal]", (el) => {
      el.querySelector("[data-landmarks]")!.textContent = "90";
      el.querySelector("[data-goal-lead]")!.textContent = "Closest: ";
      el.querySelector("[data-goal-who]")!.textContent = "WWWWWWWWWWWWWWWWWWWWWWWW";
      el.querySelector("[data-goal-tail]")!.textContent = "'s building, 6 of 8";
      el.querySelector("[data-goal-unit]")!.textContent = " neighbours";
    });
    const worst = await page.$eval("[data-goal]", (el) => {
      const r = el.getBoundingClientRect();
      const tail = el.querySelector("[data-goal-tail]")!.getBoundingClientRect();
      return { h: Math.round(r.height), tailRight: Math.round(tail.right) };
    });
    await page.locator(".hud").screenshot({ path: `.shots/goal-worst-${name}.png` });
    check(worst.tailRight <= width, `${name}: "6 of 8" stays on screen with a 24-character name`, `${worst.h}px tall, ends at ${worst.tailRight}px`);
    // ...and with no neighbours anywhere yet, the hint in its place.
    await page.$eval("[data-goal]", (el) => {
      el.querySelector("[data-goal-lead]")!.textContent = "Start one: build beside someone";
      el.querySelector("[data-goal-who]")!.textContent = "";
      el.querySelector("[data-goal-tail]")!.textContent = "";
      el.querySelector("[data-goal-unit]")!.textContent = "";
    });
    const hint = await page.$eval("[data-goal-lead]", (el) => ({ right: Math.round(el.getBoundingClientRect().right), cut: el.scrollWidth > el.clientWidth }));
    check(hint.right <= width, `${name}: the start-one hint stays on screen`, `ends at ${hint.right}px${hint.cut ? ", cut short with 90 raised" : ""}`);
    await page.$eval("[data-landmarks]", (el) => (el.textContent = "0"));
    check(!(await page.$eval("[data-goal-lead]", (el) => el.scrollWidth > el.clientWidth)), `${name}: and isn't cut short with none raised`);
    await page.$eval("[data-goal]", (el, html) => (el.innerHTML = html), real);
    const goal = await page.$eval("[data-goal]", (el) => {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el.querySelector("[data-landmarks]")!).fontSize);
      return { h: Math.round(r.height), lh: Math.round(lh), right: Math.round(r.right), text: el.textContent ?? "" };
    });
    check(goal.h <= goal.lh * 1.5 && goal.right <= width, `${name}: the goal line fits on one line`, `${goal.h}px tall, "${goal.text}"`);
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
  check(
    /^Earns \d+(\.\d)? coins\/min here, with \d neighbours?\.( Raises .+'s income\.)?( Building here (brings .+'s building to \d of 8 neighbours\.|completes a landmark!))?$/.test(title),
    "and says what it would earn and whose income it raises",
    title,
  );
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
    check(text.startsWith(`${name}'s `), "tapping a building names its owner", text);
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
  check(/^Land claimed! Your building is now generating income\. (Mia and Kai|Kai and Mia) now earn more\.$/.test(myNotice), "my claim says it's claimed and whose income it raised", myNotice);
  check((await miaFloat) !== null, "Mia sees +1 float off her tile");
  await mia.waitForSelector('[data-notice="arrived"]', { timeout: 3000 }).catch(() => null);
  const miaNotice = (await mia.textContent('[data-notice="arrived"]').catch(() => null)) ?? "";
  check(/^Me built next to you\. Your income increased! Your building now has \d neighbours?\.$/.test(miaNotice), "Mia is told who built next to her", miaNotice);
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
  await me.click(".confirm-claim");
  await me.waitForSelector(`button.tile[value="${far}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  const moved = (await me.textContent('[data-notice="moved"]').catch(() => null)) ?? "";
  check(/^Moved to row \d+, column \d+\. Your income is now 10 coins\/min\.$/.test(moved), "my move says where, and my income", moved);
  check((await miaDrop) !== null, "Mia sees −1 float off her tile");
  await mia.waitForSelector('[data-notice="left"]', { timeout: 3000 }).catch(() => null);
  const left2 = (await mia.textContent('[data-notice="left"]').catch(() => null)) ?? "";
  check(/^Your neighbour relocated\. Your income has changed\. Your building now has \d neighbours?\.$/.test(left2), "Mia is told her neighbour relocated", left2);

  for (const p of [mia, kai, me]) await p.context().close();
}

// The tile's data-* hooks, as a short string for a check's detail.
const hooks = (page: Page, cell: number): Promise<Record<string, string | undefined>> =>
  page.$eval(`button.tile[value="${cell}"]`, (el) => ({ ...(el as HTMLElement).dataset }));
// Whether an element is really on screen: [hidden] can lose to a display rule.
const shown = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (el) => getComputedStyle(el).display !== "none").catch(() => false);
// Whether it's rendered at all, an ancestor's [hidden] included.
const rendered = (page: Page, sel: string): Promise<boolean> =>
  page.$eval(sel, (el) => el.checkVisibility()).catch(() => false);

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
  check(target.preview === "target" && target.previewHeight === "2", "hovering a free plot previews its height (level 1 + 1 neighbour)", JSON.stringify(target));
  check((await hooks(me, left)).preview === "lift", "and marks the neighbour it would lift");
  check(
    (await me.$$eval("[data-preview]", (els) => els.length)) === 2,
    "and nothing else",
    `${await me.$$eval("[data-preview]", (els) => els.map((e) => (e as HTMLButtonElement).value).join())}`,
  );
  const facts = (await me.textContent("[data-inspect]").catch(() => "")) ?? "";
  check((await shown(me, "[data-inspect]")) && /If you build here\s*Earns 12 coins\/min here, with 1 neighbour\. Raises Mia's income\./.test(facts), "the inspector says the income there and whose it raises", facts.replace(/\s+/g, " ").trim());
  await me.locator("[data-stage]").screenshot({ path: ".shots/preview-hover.png" });
  const after = await me.$$eval("button.tile", (els) => els.map((e) => `${(e as HTMLElement).dataset.state}:${(e as HTMLElement).dataset.height}`).join());
  check(after === before, "previewing changes no real state");

  // Hover Mia's tile: who holds it and how long it's safe.
  if (await reachable(me, left)) {
    await me.hover(`button.tile[value="${left}"]`);
    const info = ((await me.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
    check(/Mia/.test(info) && /Small House, level 1/.test(info) && /\d+ h \d+ m left/.test(info), "hovering a building shows its owner, type and lease left", info.trim());
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
    (await page.locator('[data-notice="claimed"]').count()) === 0 && !/claimed/i.test((await page.textContent("[data-announce]")) ?? ""),
    "the stream showing it first doesn't announce success before the reply",
  );
  check((await hooks(page, cell)).pending === "", "and it stays pending until the reply");
  release();
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  await page.waitForFunction(() => !document.querySelector("[data-pending]"), null, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, cell)).pending === undefined, "and pending clears when it answers");
  const said = (await page.textContent('[data-notice="claimed"]').catch(() => "")) ?? "";
  check(/^Land claimed! Your building is now generating income\./.test(said), "success says the land is claimed", said);
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
  await page.context().close();

  // Failures say why, and never show a claim as made: on a page with no
  // land yet, so each click is a claim, not a move.
  const empty = await fresh(browser);
  await empty.fill("#label", "Fails");
  const other = Number(await freeTile(empty));
  for (const [what, handler, pattern] of [
    ["the network failing", (r: import("playwright-core").Route) => r.abort("internetdisconnected"), /Couldn't reach the server/],
    ["a 403", (r: import("playwright-core").Route) => r.fulfill({ status: 403, body: "Cross-site request refused" }), /refused that/],
    ["a 402", (r: import("playwright-core").Route) => r.fulfill({ status: 402, contentType: "application/json", body: '{"error":"coins"}' }), /enough coins/],
    ["a 429", (r: import("playwright-core").Route) => r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"cooldown"}' }), /cooling down/],
    ["a 409", (r: import("playwright-core").Route) => r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"taken"}' }), /got there first/],
    ["a 400", (r: import("playwright-core").Route) => r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"label"}' }), /1 to 24 characters/],
  ] as const) {
    await empty.route("**/claim", handler);
    await clickTile(empty, other);
    await empty.waitForFunction(() => !document.querySelector("[data-pending]"), null, { timeout: 3000 }).catch(() => null);
    const text = (await empty.textContent("[data-notices]")) ?? "";
    check(pattern.test(text), `${what} is explained`, text);
    check((await hooks(empty, other)).state === "free", `and after ${what} the tile isn't shown as mine`);
    await empty.unroute("**/claim");
  }

  // Space claims a focused tile too.
  const spaced = Number(await freeTile(empty));
  await empty.press("#label", "Enter");
  await empty.evaluate((c) => (document.querySelector(`button.tile[value="${c}"]`) as HTMLElement).focus(), String(spaced));
  await empty.keyboard.press("Space");
  await empty.waitForSelector(`button.tile[value="${spaced}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(empty, spaced)).state === "mine", "Space claims the focused tile");

  await empty.context().close();
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
  check((await shown(page, "[data-inspect]")) && /Ana/.test(info) && / left/.test(info), "tapping a building inspects it", info.trim());
  check((await page.$$eval("[data-preview]", (els) => els.length)) === 0, "and a held tile previews nothing");
  await page.locator(".confirm-cancel").tap();
  check((await page.$$eval("[data-selected], [data-preview]", (els) => els.length)) === 0, "Cancel clears the selection and preview");
  check(!(await shown(page, "[data-inspect]")), "and the inspector");
  await ana.context().close();
  await page.context().close();
}

// --- the room's goal, waves and landmarks (docs/adr/0004) ---

// A player who exists only as a cookie: seeded through the HTTP API, never
// the database, like any script client would.
type Player = { pid: string; label: string };
const player = (label: string): Player => ({ pid: randomUUID(), label });
async function seed(p: Player, cellId: number): Promise<void> {
  const res = await fetch(`${APP}/claim`, {
    method: "POST",
    headers: { cookie: `pid=${p.pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ cellId, label: p.label }),
  });
  if (res.status !== 200) throw new Error(`seeding ${p.label} on ${cellId}: ${res.status}`);
}
const around = (id: number): number[] =>
  [-13, -12, -11, -1, 1, 11, 12, 13].map((d) => id + d);
const goalText = (page: Page): Promise<string> => page.$eval("[data-goal]", (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());

async function goalLine(browser: Browser): Promise<void> {
  console.log("\n— the goal: the building closest to 8 neighbours, and plots that help —");
  const me = await fresh(browser);
  await me.waitForTimeout(400);
  const before = await goalText(me);
  check(/^\d+ landmarks? raised · (Closest: .+, \d of 8 neighbours|Start one: build beside someone)$/.test(before), "the goal line shows", before);

  if (!/Closest:/.test(before)) {
    const patch = await openPatch(me);
    await seed(player("Seed"), patch);
    await seed(player("Seed2"), patch + 1);
    await me.waitForFunction(() => /Closest:/.test(document.querySelector("[data-goal]")?.textContent ?? ""), null, { timeout: 3000 });
  }
  // The closest building, worked out here from the board's own hooks:
  // most occupied neighbours, interior, not a landmark yet.
  const read = async () => {
    const tiles = await me.$$eval("button.tile", (els) =>
      els.map((e) => ({ state: (e as HTMLElement).dataset.state, n: Number((e as HTMLElement).dataset.neighbours ?? 0), mark: (e as HTMLElement).dataset.landmark !== undefined, label: e.getAttribute("title") })),
    );
    const interior = (id: number) => id > 11 && id < 132 && id % 12 > 0 && id % 12 < 11;
    let top = -1;
    tiles.forEach((t, id) => {
      if (t.state !== "free" && interior(id) && !t.mark && (top < 0 || t.n > tiles[top].n)) top = id;
    });
    return { tiles, top };
  };
  let { tiles, top } = await read();
  const n = tiles[top].n;
  const named = tiles[top].state === "mine" ? "your building" : `${tiles[top].label}'s building`;
  check((await goalText(me)).endsWith(`Closest: ${named}, ${n} of 8 neighbours`), "the goal line names the closest building on the board", await goalText(me));
  const gaps = around(top).filter((id) => tiles[id].state === "free");
  const count = Number(await me.textContent("[data-landmarks]"));
  const watch = me
    .waitForFunction(
      ([t, c]) =>
        (document.querySelector("[data-goal]")?.textContent ?? "").replace(/\s+/g, " ").endsWith(t as string) ||
        Number(document.querySelector("[data-landmarks]")?.textContent) >= (c as number),
      [n + 1 < 8 ? `, ${n + 1} of 8 neighbours` : "\u0000", count + 1] as const,
      { timeout: 3000 },
    )
    .catch(() => null);
  await seed(player("Helper"), gaps[0]);
  check((await watch) !== null, "and counts up when that building gains a neighbour", await goalText(me));
  ({ tiles, top } = await read());
  const name = tiles[top].state === "mine" ? "your building" : `${tiles[top].label}'s building`;
  const open = around(top).filter((id) => tiles[id].state === "free");
  const k = tiles[top].n;

  const gap = open[0];
  const glowing = await me.$$eval("button.tile[data-helps]", (els) => els.map((e) => Number((e as HTMLButtonElement).value)));
  check(open.length > 0 && open.every((id) => glowing.includes(id)), "every gap round the closest building glows", `gaps ${open.join(",")}; glowing ${glowing.join(",")}`);
  const glow = await me.$eval(`button.tile[value="${gap}"]`, (el) => getComputedStyle(el).boxShadow);
  check(/255, 176, 0/.test(glow), "the glow is drawn", glow.slice(0, 60));
  while (!(await reachable(me, gap))) {
    await me.click("text=Turn left");
    await me.waitForTimeout(350);
  }
  await me.hover(`button.tile[value="${gap}"]`);
  const facts = ((await me.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
  check(facts.includes(`Building here brings ${name} to ${k + 1} of 8 neighbours`) || facts.includes("Building here completes a landmark!"), "the inspector says what a glowing plot would do", facts.trim());
  await me.locator("[data-stage]").screenshot({ path: ".shots/goal-helps.png" });
  await me.mouse.move(2, 2);
  await me.locator(".hud").screenshot({ path: ".shots/goal-line.png" });
  await me.context().close();
}

async function landmarks(browser: Browser): Promise<void> {
  console.log("\n— a landmark raised by nine people —");
  const watcher = await fresh(browser);
  const calm = await fresh(browser, { reducedMotion: "reduce" });
  await watcher.waitForTimeout(400);
  const centre = await openPatch(watcher);
  const countBefore = Number(await watcher.textContent("[data-landmarks]"));
  // Watcher's focus sits in the name field; a celebration mustn't move it.
  await watcher.focus("#label");

  // Nine people, the holder first, then the ring. Names at their worst: one
  // as long as a label can be.
  const nine = ["Holder Hana", "Kai", "Zoe", "Ari", "Bartholomew Fitzgerald-X", "Cy", "Di", "Ed", "Flo"].map(player);
  await seed(nine[0], centre);
  const ring = around(centre);
  for (let i = 0; i < 7; i++) await seed(nine[i + 1], ring[i]);
  const burst = watcher.waitForSelector(`button.tile[value="${centre}"] .burst`, { timeout: 3000 }).catch(() => null);
  const calmBurst = calm.waitForSelector(`button.tile[value="${centre}"] .burst`, { timeout: 3000 }).catch(() => null);
  await seed(nine[8], ring[7]);

  check((await burst) !== null, "the watching page bursts over the new landmark");
  // Up by one on an empty patch; by more if the block also finished a tower
  // beside an earlier run's.
  check(Number(await watcher.textContent("[data-landmarks]")) > countBefore, "and the count goes up", `${countBefore} → ${await watcher.textContent("[data-landmarks]")}`);
  check((await watcher.$("[data-landmarks][data-bump]")) !== null, "with a bump");
  const cheer = ((await watcher.textContent(".cheer")) ?? "").trim();
  check((await shown(watcher, ".cheer")) && nine.every((p) => cheer.includes(p.label)), "one line names all nine", cheer);
  await watcher.waitForTimeout(150);
  check(((await watcher.textContent("[data-announce]")) ?? "") === cheer, "and it's announced", (await watcher.textContent("[data-announce]")) ?? "");
  check(await watcher.evaluate(() => document.activeElement?.id === "label"), "focus stays where it was");
  check((await watcher.$(`button.tile[value="${centre}"] .crown`)) !== null, "the tower wears a crown");
  const aria = (await watcher.getAttribute(`button.tile[value="${centre}"]`, "aria-label")) ?? "";
  check(aria.endsWith(`Landmark raised by ${nine.slice(0, 8).map((p) => p.label).join(", ")} and Flo`), "and its label names who raised it", aria);
  // Frozen mid-burst for the screenshot.
  await watcher.addStyleTag({ content: ".burst { animation-play-state: paused !important; animation-delay: -0.5s !important; }" });
  await watcher.screenshot({ path: ".shots/landmark.png" });
  await watcher.locator("[data-stage]").screenshot({ path: ".shots/landmark-stage.png" });

  check((await calmBurst) !== null, "under reduced motion it's marked too");
  const still = await calm.$eval(`button.tile[value="${centre}"] .burst`, (el) => getComputedStyle(el).animationName).catch(() => "gone");
  check(still === "none", "standing still", still);

  // The crown, up close, in greyscale, after the moment has passed.
  await watcher.waitForTimeout(3200);
  check((await watcher.$$(".burst")).length === 0, "the burst goes by itself");
  const late = await fresh(browser, { deviceScaleFactor: 4, reducedMotion: "reduce" });
  await late.waitForTimeout(500);
  check((await late.$(`button.tile[value="${centre}"] .crown`)) !== null, "a page opened later shows the crown");
  check((await late.$$(".burst")).length === 0 && !(await shown(late, ".cheer")), "but doesn't replay the celebration");
  const box = await late.locator(`button.tile[value="${centre}"]`).boundingBox();
  if (box) {
    const clip = { x: box.x - box.width * 1.2, y: box.y - box.height * 2.4, width: box.width * 3.4, height: box.height * 4 };
    await late.screenshot({ path: ".shots/landmark-crown.png", clip });
    await late.addStyleTag({ content: "html { filter: grayscale(1); }" });
    await late.screenshot({ path: ".shots/landmark-crown-grey.png", clip });
  }
  await late.locator(`button.tile[value="${centre}"]`).hover();
  const facts = ((await late.textContent("[data-inspect]")) ?? "").replace(/\s+/g, " ");
  check(/Landmark\s*raised by Holder Hana, Kai/.test(facts), "the inspector names the landmark's raisers", facts.trim());
  for (const p of [watcher, calm, late]) await p.context().close();
}

// --- the city economy (docs/adr/0005) ---

// A POST as a seeded player, through HTTP like any script client.
async function postAs(p: Player, route: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${APP}${route}`, {
    method: "POST",
    headers: { cookie: `pid=${p.pid}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
// A page whose cookie is a known pid, so seeded players can act on it.
async function freshAs(browser: Browser, p: Player, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addCookies([{ name: "pid", value: p.pid, url: APP }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no script errors", e.message));
  await page.goto(`${APP}/?v=${Date.now()}`);
  await page.waitForTimeout(400);
  return page;
}
const dashText = (page: Page, key: string): Promise<string> => page.$eval(`[data-dash-${key}]`, (el) => el.textContent ?? "");
const coinsOf = async (page: Page): Promise<number> => Number(await dashText(page, "coins"));
const disabled = (page: Page, act: string): Promise<boolean> => page.$eval(`[data-act="${act}"]`, (el) => (el as HTMLButtonElement).disabled);
const whyOf = (page: Page, act: string): Promise<string> => page.$eval(`[data-why="${act}"]`, (el) => el.textContent ?? "");

// A free plot whose 8 neighbours are free too, for a fresh block.
async function claimOwn(browser: Browser, name: string): Promise<{ me: Player; page: Page; cell: number }> {
  const me = player(name);
  const page = await freshAs(browser, me);
  const cell = await openPatch(page);
  await claimAs(page, name, cell);
  return { me, page, cell };
}

async function economy(browser: Browser): Promise<void> {
  console.log("\n— the economy: claim, collect, upgrade —");
  const me = player("Wally");
  const page = await freshAs(browser, me);
  const watcher = await fresh(browser);
  check((await dashText(page, "building")) === "No building yet" && (await disabled(page, "upgrade")), "before a claim the dashboard says there's no building, and Upgrade is off");
  const cell = await openPatch(page);
  await claimAs(page, "Wally", cell);
  const said = (await page.textContent("[data-notices]")) ?? "";
  check(said.trim() === "Land claimed! Your building is now generating income.", "a claim says the land is claimed", said);
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-level")) === "1", "and a Small House stands on it");
  check((await dashText(page, "building")) === "Small House · Lv 1" && (await dashText(page, "rate")) === "10 coins/min", "the dashboard shows the building and income", `${await dashText(page, "building")}, ${await dashText(page, "rate")}`);
  check(/^\d+ h \d+ m$/.test(await dashText(page, "lease")), "and the lease left", await dashText(page, "lease"));

  // Not enough coins: Upgrade is off and says why, in words.
  check(await disabled(page, "upgrade"), "with 100 coins, Upgrade is disabled");
  const why = await whyOf(page, "upgrade");
  check(why.includes("You need 50 more coins.") && why.includes("Income 10 → 20 coins/min"), "and explains why, with both incomes", why);
  check((await page.textContent('[data-act-sub="upgrade"]')) === "need 50", "the button itself says it", (await page.textContent('[data-act-sub="upgrade"]')) ?? "");
  await page.locator("[data-dash]").screenshot({ path: ".shots/dash-poor.png" });

  // The uncollected count ticks up between boards.
  const p0 = Number(await dashText(page, "pending"));
  await page.waitForTimeout(6500); // 10 coins/min: one coin every 6 s
  const p1 = Number(await dashText(page, "pending"));
  check(p1 > p0, "uncollected income counts up live", `${p0} → ${p1}`);

  // Collect pays it into the wallet, here and as the server holds it.
  const before = await coinsOf(page);
  await page.click('[data-act="collect"]');
  await page.waitForFunction((b) => Number(document.querySelector("[data-dash-coins]")?.textContent) > b, before, { timeout: 3000 }).catch(() => null);
  const after = await coinsOf(page);
  check(after > before, "Collect increases coins", `${before} → ${after}`);
  check(/^Collected \d+ coins\.$/.test(((await page.textContent("[data-notices]")) ?? "").trim()), "and says how many", (await page.textContent("[data-notices]")) ?? "");
  check(Number(await dashText(page, "pending")) === 0, "and the uncollected count resets");

  // Four neighbours each help once: 200 coins, so the upgrade is affordable.
  const helpers = ["Hal", "Hope", "Hugh", "Hana"].map(player);
  const ring = around(cell);
  for (let i = 0; i < helpers.length; i++) {
    await seed(helpers[i], ring[i]);
    const r = await postAs(helpers[i], "/help", { cellId: cell });
    if (r.status !== 200) throw new Error(`helper ${i}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  await page.waitForFunction(() => !(document.querySelector('[data-act="upgrade"]') as HTMLButtonElement).disabled, null, { timeout: 3000 }).catch(() => null);
  check(!(await disabled(page, "upgrade")), "with enough coins, Upgrade is enabled", await whyOf(page, "upgrade"));
  check((await dashText(page, "neighbours")) === "4 of 8" && (await dashText(page, "rate")) === "18 coins/min", "four neighbours: 18 coins a minute", `${await dashText(page, "neighbours")}, ${await dashText(page, "rate")}`);

  // Upgrade: the building's type changes, here and for everyone else.
  const seen = watcher.waitForSelector(`button.tile[value="${cell}"][data-level="2"]`, { timeout: 3000 }).catch(() => null);
  const started = Date.now();
  await page.click('[data-act="upgrade"]');
  await page.waitForSelector(`button.tile[value="${cell}"][data-level="2"]`, { timeout: 3000 }).catch(() => null);
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-level")) === "2", "Upgrade turns the Small House into a Townhouse");
  check((await dashText(page, "building")) === "Townhouse · Lv 2" && (await dashText(page, "rate")) === "36 coins/min", "the dashboard follows", `${await dashText(page, "building")}, ${await dashText(page, "rate")}`);
  check(/^Upgraded to a Townhouse! Your income is now 36 coins\/min\.$/.test(((await page.textContent("[data-notices]")) ?? "").trim()), "and says so", (await page.textContent("[data-notices]")) ?? "");
  check((await seen) !== null && Date.now() - started < 1000, "another browser sees the upgrade within a second", `${Date.now() - started} ms`);
  const roof = await page.$eval(`button.tile[value="${cell}"] .roof`, (el) => getComputedStyle(el, "::before").content);
  check(roof !== "none", "and a Townhouse draws a different roofline", roof);
  await page.locator("[data-dash]").screenshot({ path: ".shots/dash.png" });

  // Without JavaScript the same four actions are plain forms.
  const nojs = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    await ctx.addCookies([{ name: "pid", value: me.pid, url: APP }]);
    const p = await ctx.newPage();
    await p.goto(`${APP}/?v=${Date.now()}`);
    return p;
  })();
  const forms = await nojs.$$eval("button[formaction]", (els) => els.map((e) => e.getAttribute("formaction")));
  check(["/collect", "/upgrade", "/renew"].every((a) => forms.includes(a)), "without JavaScript, collect, upgrade and renew are form buttons", forms.join(" "));
  // income since the Collect above: a coin every few seconds at 36/min
  await nojs.waitForTimeout(2500);
  await nojs.reload();
  const c0 = Number(await nojs.textContent("[data-dash-coins]"));
  if (!(await nojs.$eval('[data-act="collect"]', (el) => (el as HTMLButtonElement).disabled))) {
    await nojs.click('[data-act="collect"]');
    await nojs.waitForURL(/notice=(collected|nothing-to-collect)/, { timeout: 3000 }).catch(() => null);
    check(/notice=collected/.test(nojs.url()) && Number(await nojs.textContent("[data-dash-coins]")) > c0, "and Collect posts and reloads with more coins", nojs.url());
  } else check(false, "the no-JS page has income to collect");
  await nojs.context().close();

  // Every building level, up close, in colour and greyscale.
  await buildingLevels(browser);
  for (const p of [page, watcher]) await p.context().close();
}

// The five building types side by side, drawn by the real stylesheet on
// real plots: a page with its tiles' levels set by hand, for the camera
// only (nothing is posted).
async function buildingLevels(browser: Browser): Promise<void> {
  const page = await fresh(browser, { deviceScaleFactor: 3, reducedMotion: "reduce" });
  await page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLButtonElement>("button.tile")];
    tiles.forEach((t) => {
      t.dataset.state = "free";
      delete t.dataset.level;
      t.style.setProperty("--h", "0");
      delete t.dataset.helps;
      delete t.dataset.lease;
      delete t.dataset.landmark;
      t.querySelector(".crown")?.remove();
      t.querySelector(".initials")!.textContent = "";
    });
    [1, 2, 3, 4, 5].forEach((level, i) => {
      const t = tiles[5 * 12 + 2 + i * 2];
      t.dataset.state = i === 2 ? "mine" : "held";
      t.dataset.level = String(level);
      t.style.setProperty("--h", String(level));
      t.style.setProperty("--hue", String([200, 20, 320, 140, 260][i]));
    });
    const soon = tiles[8 * 12 + 4];
    soon.dataset.state = "held";
    soon.dataset.level = "2";
    soon.dataset.lease = "soon";
    soon.style.setProperty("--h", "2");
    soon.style.setProperty("--hue", "40");
  });
  const box = await page.locator(".board").boundingBox();
  if (box) {
    const clip = { x: box.x + box.width * 0.1, y: box.y + box.height * 0.2, width: box.width * 0.8, height: box.height * 0.6 };
    await page.screenshot({ path: ".shots/buildings.png", clip });
    await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
    await page.screenshot({ path: ".shots/buildings-grey.png", clip });
  }
  await page.context().close();
  const one = await fresh(browser, { deviceScaleFactor: 1, reducedMotion: "reduce" });
  await one.locator("[data-stage]").screenshot({ path: ".shots/buildings-1x.png" });
  await one.context().close();
}

async function relocation(browser: Browser): Promise<void> {
  console.log("\n— relocating: preview, confirm, cooldown —");
  const { page, cell } = await claimOwn(browser, "Remy");
  const watcher = await fresh(browser);
  const states = await page.$$eval("button.tile", (els) => els.map((e) => (e as HTMLElement).dataset.state));
  const dest = [...Array(144).keys()].find(
    (id) => states[id] === "free" && Math.abs((id % 12) - (cell % 12)) > 3 && around(id).every((n) => n < 0 || n > 143 || Math.abs((n % 12) - (id % 12)) > 1 || states[n] === "free"),
  );
  if (dest === undefined) throw new Error("no lonely free plot left; reseed the board");
  await page.click('[data-act="relocate"]');
  check((await page.getAttribute(".board", "data-relocating")) === "", "Relocate marks the free plots as destinations");
  await clickTile(page, dest);
  const text = ((await page.textContent(".confirm-text")) ?? "").trim();
  check(
    /^Move from row \d+, column \d+ to row \d+, column \d+ for 50 coins\. Income 10 → 10 coins\/min\. Lease left: \d+ h \d+ m\./.test(text),
    "the preview names both plots, the cost, both incomes and the lease left",
    text,
  );
  check((await hooks(page, dest)).preview === "target" && (await page.getAttribute(`button.tile[value="${dest}"]`, "data-selected")) === "", "and highlights the destination");
  check((await hooks(page, dest)).state === "free", "nothing moves before the confirm");
  await page.screenshot({ path: ".shots/relocate-preview.png" });
  const seen = watcher.waitForSelector(`button.tile[value="${dest}"][data-state="held"]`, { timeout: 3000 }).catch(() => null);
  const started = Date.now();
  await page.click(".confirm-claim");
  await page.waitForSelector(`button.tile[value="${dest}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, dest)).state === "mine" && (await hooks(page, cell)).state === "free", "confirming moves the building");
  check((await coinsOf(page)) === 50, "for 50 coins", String(await coinsOf(page)));
  check((await seen) !== null && Date.now() - started < 1000, "another browser sees the move within a second", `${Date.now() - started} ms`);
  check(await disabled(page, "relocate"), "and Relocate is then cooling down");
  const why = await whyOf(page, "relocate");
  check(/^You can move again in (29|30) m\.$/.test(why), "saying how long", why);
  // Clicking a free plot while cooling down previews but can't confirm.
  const another = (await openPatch(page)) + 1;
  await clickTile(page, another);
  const blocked = ((await page.textContent(".confirm-text")) ?? "").trim();
  check(blocked.includes("You can move again in") && (await page.$eval(".confirm-claim", (b) => (b as HTMLButtonElement).disabled)), "a move during the cooldown is shown, and blocked", blocked);
  await page.click(".confirm-cancel");
  for (const p of [page, watcher]) await p.context().close();

  // On a phone the preview is the confirm bar, under the thumb.
  const ph = player("Phoebe");
  const phone = await freshAs(browser, ph, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const home = await openPatch(phone);
  await seed(ph, home);
  await phone.reload();
  await phone.waitForTimeout(400);
  const far = (await openPatch(phone)) + 13;
  await tapTile(phone, far);
  const bar = await phone.locator(".confirm-claim").boundingBox();
  check(/^Move here · 50 coins$/.test((await phone.textContent(".confirm-claim")) ?? "") && (bar?.y ?? 0) > 700, "on a phone the move is confirmed from a bar at the bottom", `${await phone.textContent(".confirm-claim")} at y=${Math.round(bar?.y ?? 0)}`);
  await phone.screenshot({ path: ".shots/relocate-phone.png" });
  await phone.context().close();
}

async function renewal(browser: Browser): Promise<void> {
  console.log("\n— renewing a lease, up to 48 hours —");
  const { me, page, cell } = await claimOwn(browser, "Rena");
  // Three neighbours help: 100 + 150 = 250 coins.
  const ring = around(cell);
  for (const [i, h] of ["Ned", "Nia", "Noor"].map(player).entries()) {
    await seed(h, ring[i]);
    await postAs(h, "/help", { cellId: cell });
  }
  await page.waitForFunction(() => Number(document.querySelector("[data-dash-coins]")?.textContent) >= 250, null, { timeout: 3000 }).catch(() => null);
  await page.click('[data-act="renew"]');
  const opts = await page.$$eval("[data-renew-hours]", (els) => els.map((e) => ({ h: (e as HTMLElement).dataset.renewHours, t: e.textContent, off: (e as HTMLButtonElement).disabled })));
  check(opts.map((o) => o.t).join(" | ") === "+6 h · 100 coins | +12 h · 180 coins | +24 h · 300 coins", "Renew offers three options with their costs", opts.map((o) => o.t).join(" | "));
  check(opts[2].off && (await page.textContent('[data-renew-why="24"]')) === "Need 50 more", "one you can't afford is disabled and says why", (await page.textContent('[data-renew-why="24"]')) ?? "");
  await page.locator("[data-dash]").screenshot({ path: ".shots/renew-open.png" });
  const lease0 = await dashText(page, "lease");
  await page.click('[data-renew-hours="12"]');
  await page.waitForFunction((l) => document.querySelector("[data-dash-lease]")?.textContent !== l, lease0, { timeout: 3000 }).catch(() => null);
  check(/^3[56] h \d+ m$/.test(await dashText(page, "lease")), "renewing 12 h extends the lease", `${lease0} → ${await dashText(page, "lease")}`);
  // Now at 36 h of a 48 h cap: 24 h is past it, whatever the coins.
  // Two more neighbours help, so coins aren't what refuses it.
  for (const [i, h] of ["Oz", "Ola"].map(player).entries()) {
    await seed(h, ring[3 + i]);
    await postAs(h, "/help", { cellId: cell });
  }
  await page.waitForFunction(() => Number(document.querySelector("[data-dash-coins]")?.textContent) >= 170, null, { timeout: 3000 }).catch(() => null);
  if ((await page.getAttribute('[data-act="renew"]', "aria-expanded")) !== "true") await page.click('[data-act="renew"]');
  const why24 = (await page.textContent('[data-renew-why="24"]')) ?? "";
  check((await page.$eval('[data-renew-hours="24"]', (b) => (b as HTMLButtonElement).disabled)) && why24 === "Past the 48 h limit", "an option past the 48 h cap is disabled with the reason", why24);
  const r = await postAs(me, "/renew", { hours: 24 });
  check(r.status === 400 && r.json.error === "max-lease", "and the server refuses it too", `${r.status} ${JSON.stringify(r.json)}`);
  await page.locator("[data-dash]").screenshot({ path: ".shots/renew-cap.png" });
  await page.context().close();
}

async function helping(browser: Browser): Promise<void> {
  console.log("\n— helping a neighbour —");
  const ana = player("Anya");
  const ben = player("Bram");
  const a = await freshAs(browser, ana);
  const b = await freshAs(browser, ben);
  const centre = await openPatch(a);
  await claimAs(a, "Anya", centre);
  await claimAs(b, "Bram", centre + 1);
  await a.waitForSelector(`button.tile[value="${centre + 1}"][data-state="held"]`, { timeout: 3000 });
  check(!(await rendered(a, ".help-button")), "no Help button until a neighbour's building is looked at");
  await clickTile(a, centre + 1);
  const label = (await a.textContent(".help-button")) ?? "";
  check(label === "Help Bram (+50 to them, +20 to you)" && (await rendered(a, ".help-button")), "a neighbour's inspector offers Help", label);
  const bCoins = await coinsOf(b);
  const started = Date.now();
  const seen = b.waitForFunction((c) => Number(document.querySelector("[data-dash-coins]")?.textContent) === c + 50, bCoins, { timeout: 3000 }).catch(() => null);
  await a.click(".help-button");
  await a.waitForFunction(() => (document.querySelector(".help-said")?.textContent ?? "") !== "", null, { timeout: 3000 }).catch(() => null);
  check(((await a.textContent(".help-said")) ?? "").startsWith("You helped your neighbour"), "Anya is told", (await a.textContent(".help-said")) ?? "");
  check((await coinsOf(a)) === 120, "and gets 20 coins", String(await coinsOf(a)));
  check((await seen) !== null && Date.now() - started < 1000, "Bram's page shows his 50 coins within a second", `${Date.now() - started} ms`);
  check(await a.$eval(".help-button", (el) => (el as HTMLButtonElement).disabled && /^Help again in (59|60) m$/.test(el.textContent ?? "")), "then Help cools down for an hour, and says so", (await a.textContent(".help-button")) ?? "");
  await a.screenshot({ path: ".shots/help.png" });
  // A building that isn't beside mine offers no Help.
  const states = await a.$$eval("button.tile", (els) => els.map((e) => (e as HTMLElement).dataset.state));
  const farHeld = states.findIndex((s, id) => s === "held" && !around(centre).includes(id));
  if (farHeld >= 0 && (await reachable(a, farHeld))) {
    await a.hover(`button.tile[value="${farHeld}"]`);
    check(!(await rendered(a, ".help-button")), "a building not beside mine offers no Help");
  }
  for (const p of [a, b]) await p.context().close();
  const nojs = await fresh(browser, { javaScriptEnabled: false });
  check((await nojs.$$(".help-button, .wave-button, .waved")).length === 0, "without JavaScript there's no Help button, and no wave anywhere");
  await nojs.context().close();
}

const SECTIONS = {
  realtime,
  keyboard,
  noScript,
  effects,
  phone,
  preview,
  claiming,
  touchInspect,
  hitTesting,
  goalLine,
  landmarks,
  economy,
  relocation,
  renewal,
  helping,
  viewports,
};

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
