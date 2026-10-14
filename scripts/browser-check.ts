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

// The camera buttons sit behind the camera icon: open it the way a player
// would, then turn. A page without script has no camera panel at all.
async function turnLeft(page: Page, touch = false): Promise<void> {
  const open = await page.$eval('details[data-tool="camera"]', (d) => (d as HTMLDetailsElement).open).catch(() => null);
  if (open === null) throw new Error("no camera panel to turn the board with");
  if (!open) await (touch ? page.locator('details[data-tool="camera"] > summary').tap() : page.click('details[data-tool="camera"] > summary'));
  await (touch ? page.locator("text=Turn left").tap() : page.click("text=Turn left"));
  await page.waitForTimeout(450); // the turn's 300 ms transition, settled
}

// Hover a plot the way a player would: turning the camera until it's
// uncovered first.
// Other players' claims can raise a neighbour between the reach check and
// the hover, so a covered hover turns the camera and tries again rather than
// waiting out Playwright's default timeout on an angle that's now blocked.
async function hoverTile(page: Page, cell: string | number): Promise<void> {
  for (let turns = 0; ; turns++) {
    if (turns === 8) throw new Error(`tile ${cell} can't be reached from any camera angle`);
    if (await reachable(page, cell)) {
      try {
        await page.hover(`button.tile[value="${cell}"]`, { timeout: 1500 });
        return;
      } catch {
        // covered after all; fall through and turn
      }
    }
    await turnLeft(page);
  }
}

// Turn the camera until the tile is uncovered, the way a player would, then
// click it. Fails the check rather than clicking through with force.
async function tapTile(page: Page, cell: string | number): Promise<void> {
  for (let turns = 0; !(await reachable(page, cell)); turns++) {
    if (turns === 8) throw new Error(`tile ${cell} can't be reached from any camera angle`);
    await turnLeft(page, true);
  }
  await page.locator(`button.tile[value="${cell}"]`).tap();
}

async function clickTile(page: Page, cell: string | number): Promise<void> {
  for (let turns = 0; !(await reachable(page, cell)); turns++) {
    if (turns === 8) throw new Error(`tile ${cell} can't be reached from any camera angle`);
    await turnLeft(page);
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
  while (!(await reachable(a, cell))) await turnLeft(a);
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
  check(said === "Ana's Small House", "B clicking A's plot is told it's Ana's", said);

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
    // The goal line is hidden until a building has 5 neighbours; shown here
    // to measure its worst case, then put back as it was.
    const wasHidden = await page.$eval("[data-goal]", (el) => (el as HTMLElement).hidden);
    const real = await page.$eval("[data-goal]", (el) => el.innerHTML);
    await page.$eval("[data-goal]", (el) => {
      (el as HTMLElement).hidden = false;
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
    await page.$eval("[data-goal]", (el, h) => ((el as HTMLElement).hidden = h), wasHidden);
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
  check(label === "Build here", "the bar offers one button", label);
  const title = (await page.textContent(".confirm-text")) ?? "";
  check(/^\+\d+(\.\d)?\/min( · .+ \+20%)?$/.test(title), "and says what it would earn and whose income it raises, in numbers", title);
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
  check(/^Your building is up! \+14\/min · (Mia and Kai|Kai and Mia) \+20%$/.test(myNotice), "my claim says it's up, its income, and whose it raised", myNotice);
  check((await miaFloat) !== null, "Mia sees +1 float off her tile");
  await mia.waitForSelector('[data-notice="arrived"]', { timeout: 3000 }).catch(() => null);
  const miaNotice = (await mia.textContent('[data-notice="arrived"]').catch(() => null)) ?? "";
  check(miaNotice === "Me built beside you · +20%", "Mia is told who built beside her", miaNotice);
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
  await me.click(".move-button");
  await me.waitForSelector(`button.tile[value="${far}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  const moved = (await me.textContent('[data-notice="moved"]').catch(() => null)) ?? "";
  check(moved === "Moved! +10/min", "my move says so, and my income", moved);
  check((await miaDrop) !== null, "Mia sees −1 float off her tile");
  await mia.waitForSelector('[data-notice="left"]', { timeout: 3000 }).catch(() => null);
  const left2 = (await mia.textContent('[data-notice="left"]').catch(() => null)) ?? "";
  check(left2 === "Me moved away · \u221220%", "Mia is told her neighbour moved away", left2);

  for (const p of [mia, kai, me]) await p.context().close();
}

// The tile's data-* hooks, as a short string for a check's detail.
const hooks = (page: Page, cell: number): Promise<Record<string, string | undefined>> =>
  page.$eval(`button.tile[value="${cell}"]`, (el) => ({ ...(el as HTMLElement).dataset }));
// The inspector's heading and facts, as one line with a space between each.
const inspectText = (page: Page): Promise<string> =>
  page.$eval("[data-inspect]", (el) => [...el.querySelectorAll("h2, dt, dd")].map((e) => (e.textContent ?? "").trim()).join(" ")).catch(() => "");
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
  await hoverTile(me, centre);
  const target = await hooks(me, centre);
  check(target.preview === "target" && target.previewHeight === "2", "hovering a free plot previews its height (level 1 + 1 neighbour)", JSON.stringify(target));
  const gain = await me.$eval(`button.tile[value="${centre}"] .beacon`, (el) => ({ data: (el as HTMLElement).dataset.gain, drawn: getComputedStyle(el, "::after").content }));
  check(gain.data === "+12/min" && gain.drawn === '"+12/min"', "and floats +12/min over the ghost building", JSON.stringify(gain));
  const lift = await me.$eval(`button.tile[value="${left}"] .beacon`, (el) => getComputedStyle(el, "::after").content);
  check(lift === '"+20%"', "and +20% over the neighbour it would lift", lift);
  check((await hooks(me, left)).preview === "lift", "and marks the neighbour it would lift");
  check(
    (await me.$$eval("[data-preview]", (els) => els.length)) === 2,
    "and nothing else",
    `${await me.$$eval("[data-preview]", (els) => els.map((e) => (e as HTMLButtonElement).value).join())}`,
  );
  const facts = await inspectText(me);
  check((await shown(me, "[data-inspect]")) && facts === "Free plot Earns +12/min Lifts Mia +20%", "the inspector says the income there and whose it raises", facts);
  await me.locator("[data-stage]").screenshot({ path: ".shots/preview-hover.png" });
  const after = await me.$$eval("button.tile", (els) => els.map((e) => `${(e as HTMLElement).dataset.state}:${(e as HTMLElement).dataset.height}`).join());
  check(after === before, "previewing changes no real state");

  // Hover Mia's tile: who holds it and how long it's safe.
  if (await reachable(me, left)) {
    await me.hover(`button.tile[value="${left}"]`);
    const info = await inspectText(me);
    check(/^Mia's Small House Earns \+\d+\/min Neighbours \d of \d Lease \d+ h \d+ m left$/.test(info), "hovering a building shows its owner, type, income and lease left", info);
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
  while (!(await reachable(page, cell))) await turnLeft(page);
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
  check(/^Your building is up! \+\d+\/min/.test(said), "success says the building is up", said);
  await page.waitForTimeout(100);
  const spoken = (await page.textContent("[data-announce]")) ?? "";
  check(/^Your building is up, earning \d+ coins a minute\./.test(spoken), "and a full sentence is announced to screen readers", spoken);

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
    ["the network failing", (r: import("playwright-core").Route) => r.abort("internetdisconnected"), /^Can't reach the server: nothing claimed$/],
    ["a 403", (r: import("playwright-core").Route) => r.fulfill({ status: 403, body: "Cross-site request refused" }), /^Refused: reload and try again$/],
    ["a 402", (r: import("playwright-core").Route) => r.fulfill({ status: 402, contentType: "application/json", body: '{"error":"coins"}' }), /^Not enough coins$/],
    ["a 429", (r: import("playwright-core").Route) => r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"cooldown"}' }), /^Not yet: cooling down$/],
    ["a 409", (r: import("playwright-core").Route) => r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"taken"}' }), /^Someone got there first$/],
    ["a 400", (r: import("playwright-core").Route) => r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"label"}' }), /^Name: 1 to 24 characters$/],
  ] as const) {
    await empty.route("**/claim", handler);
    await clickTile(empty, other);
    await empty.waitForFunction(() => !document.querySelector("[data-pending]"), null, { timeout: 3000 }).catch(() => null);
    const text = ((await empty.textContent("[data-notices]")) ?? "").trim();
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
  check((await shown(page, "[data-inspect]")) && /^Ana's Small House/.test(info.trim()) && / left$/.test(info.trim()), "tapping a building inspects it", info.trim());
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
  // Hidden until some building has 5 neighbours: then it appears, live.
  const maxN = Math.max(...(await me.$$eval("button.tile", (els) => els.map((e) => Number((e as HTMLElement).dataset.neighbours ?? 0)))));
  if (maxN < 5 && Number(await me.textContent("[data-landmarks]")) === 0) {
    check(!(await rendered(me, "[data-goal]")), "the goal line is hidden while no building has 5 neighbours", `most is ${maxN}`);
    const patch = await openPatch(me);
    await seed(player("Seed"), patch);
    for (const [i, id] of [patch - 13, patch - 12, patch - 11, patch - 1].entries()) await seed(player(`Ring${i}`), id);
    await me.waitForSelector(`button.tile[value="${patch - 1}"][data-state="held"]`, { timeout: 3000 });
    const most = Math.max(...(await me.$$eval("button.tile", (els) => els.map((e) => Number((e as HTMLElement).dataset.neighbours ?? 0)))));
    check((await rendered(me, "[data-goal]")) === most >= 5, "and shown exactly when a building reaches 5", `most is now ${most}`);
    await seed(player("Ring4"), patch + 1);
    await me.waitForFunction(() => document.querySelector("[data-goal]")?.checkVisibility() ?? false, null, { timeout: 3000 }).catch(() => null);
  }
  const before = await goalText(me);
  check((await rendered(me, "[data-goal]")) && /^\d+ landmarks? raised · Closest: .+, \d of 8 neighbours$/.test(before), "the goal line appears once one has 5", before);
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
  await hoverTile(me, gap);
  const facts = await inspectText(me);
  check(facts.includes(`Landmark ${name} → ${k + 1} of 8`) || facts.includes("Landmark completes one!"), "the inspector says what a glowing plot would do", facts);
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
  await hoverTile(late, centre);
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
const hudText = (page: Page, key: string): Promise<string> => page.$eval(`[data-hud-${key}]`, (el) => el.textContent ?? "");
const coinsOf = async (page: Page): Promise<number> => Number(await hudText(page, "coins"));
const noticeOf = async (page: Page): Promise<string> => ((await page.textContent("[data-notices]")) ?? "").trim();

// A free plot whose 8 neighbours are free too, for a fresh block.
async function claimOwn(browser: Browser, name: string): Promise<{ me: Player; page: Page; cell: number }> {
  const me = player(name);
  const page = await freshAs(browser, me);
  const cell = await openPatch(page);
  await claimAs(page, name, cell);
  return { me, page, cell };
}

async function economy(browser: Browser): Promise<void> {
  console.log("\n— the economy: claim, collect, upgrade, and controls that appear only when usable —");
  const me = player("Wally");
  const page = await freshAs(browser, me);
  const watcher = await fresh(browser);
  check(!(await rendered(page, "[data-wallet]")) && !(await rendered(page, '[data-act="upgrade"]')), "before a claim there's no wallet and no Upgrade");
  const cell = await openPatch(page);
  await claimAs(page, "Wally", cell);
  check((await noticeOf(page)) === "Your building is up! +10/min", "a claim says the building is up", await noticeOf(page));
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-level")) === "1", "and a Small House stands on it");
  check((await rendered(page, "[data-wallet]")) && (await hudText(page, "coins")) === "100" && (await hudText(page, "rate")) === "+10/min", "the wallet shows coins and +10/min", `${await hudText(page, "coins")}, ${await hudText(page, "rate")}`);
  const ring = await page.$eval("[data-hud-lease]", (el) => ({ label: el.getAttribute("aria-label"), title: el.getAttribute("title"), shown: el.checkVisibility() }));
  check(ring.shown && /^Lease: 2[34] h \d+ m left$/.test(ring.label ?? "") && ring.label === ring.title, "the lease is a ring, named and titled with the time left", JSON.stringify(ring));
  const plotRing = await page.$eval(`button.tile[value="${cell}"] .ring`, (el) => getComputedStyle(el).display);
  check(plotRing === "block", "and a ring round the building's foot", plotRing);

  // Absent, not disabled: no Upgrade at 100 coins, no Renew at 24 h, and no
  // Collect until a coin waits.
  check(!(await rendered(page, '[data-act="upgrade"]')), "with 100 coins there's no Upgrade button at all");
  check((await page.$$eval("[data-renew-hours]", (els) => els.filter((e) => e.checkVisibility()).length)) === 0, "with 24 h left there's no Renew");
  check((await page.$$("[data-why], .act-why")).length === 0 && (await page.$$eval("button:disabled", (els) => els.filter((e) => e.checkVisibility()).length)) === 0, "and no disabled button explaining itself anywhere");
  await page.locator("[data-wallet]").screenshot({ path: ".shots/wallet-new.png" });

  // Income waits: Collect appears, and a +N ticks up over the building.
  await page.waitForSelector('[data-act="collect"]:not([hidden])', { timeout: 9000 }).catch(() => null);
  check(await rendered(page, '[data-act="collect"]'), "once a coin waits, Collect appears");
  const o0 = Number((await page.textContent(`button.tile[value="${cell}"] .owed`))?.replace("+", "") ?? NaN);
  await page.waitForTimeout(6500); // 10 coins/min: one coin every 6 s
  const o1 = Number((await page.textContent(`button.tile[value="${cell}"] .owed`))?.replace("+", "") ?? NaN);
  check(o1 > o0, "and a +N over the building ticks up", `${o0} → ${o1}`);
  await page.locator("[data-stage]").screenshot({ path: ".shots/income-waiting.png" });

  // Collect: coins fly to the wallet, which counts up; Collect goes away.
  const before = await coinsOf(page);
  await page.click('[data-act="collect"]');
  await page.waitForSelector(".flying-coin", { timeout: 2000 }).catch(() => null);
  const flying = await page.$$eval(".flying-coin", (els) => els.length);
  await page.screenshot({ path: ".shots/collect.png" });
  check(flying > 0, "Collect sends coins flying to the wallet", `${flying} coins`);
  await page.waitForFunction((b) => Number(document.querySelector("[data-hud-coins]")?.textContent) > b, before, { timeout: 3000 }).catch(() => null);
  const after = await coinsOf(page);
  check(after > before, "and the wallet counts up", `${before} → ${after}`);
  check((await noticeOf(page)) === `+${after - before} collected`, "saying how many, in a word", await noticeOf(page));
  check(!(await rendered(page, '[data-act="collect"]')), "and Collect goes away with nothing waiting");

  // Four neighbours each help once: 200 coins, so Upgrade appears.
  const helpers = ["Hal", "Hope", "Hugh", "Hana"].map(player);
  const ringIds = around(cell);
  for (let i = 0; i < helpers.length; i++) {
    await seed(helpers[i], ringIds[i]);
    const r = await postAs(helpers[i], "/help", { cellId: cell });
    if (r.status !== 200) throw new Error(`helper ${i}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  await page.waitForSelector('[data-act="upgrade"]:not([hidden])', { timeout: 3000 }).catch(() => null);
  const upLabel = await page.getAttribute('[data-act="upgrade"]', "aria-label");
  check((await rendered(page, '[data-act="upgrade"]')) && (await hudText(page, "next")) === "Townhouse" && (await hudText(page, "cost")) === "150", "with enough coins, Upgrade appears, naming the Townhouse and its cost", `${await hudText(page, "next")} ${await hudText(page, "cost")}`);
  check(upLabel === "Upgrade to Townhouse for 150 coins", "and says so to a screen reader", upLabel ?? "");
  check((await hudText(page, "rate")) === "+18/min", "four neighbours: +18/min", await hudText(page, "rate"));
  await page.locator("[data-wallet]").screenshot({ path: ".shots/wallet-upgrade.png" });

  const seen = watcher.waitForSelector(`button.tile[value="${cell}"][data-level="2"]`, { timeout: 3000 }).catch(() => null);
  const started = Date.now();
  await page.click('[data-act="upgrade"]');
  await page.waitForSelector(`button.tile[value="${cell}"][data-level="2"]`, { timeout: 3000 }).catch(() => null);
  check((await page.getAttribute(`button.tile[value="${cell}"]`, "data-level")) === "2", "Upgrade turns the Small House into a Townhouse");
  check((await hudText(page, "rate")) === "+36/min", "the wallet follows", await hudText(page, "rate"));
  check((await noticeOf(page)) === "Townhouse! +36/min", "and says so in a line", await noticeOf(page));
  check((await seen) !== null && Date.now() - started < 1000, "another browser sees the upgrade within a second", `${Date.now() - started} ms`);
  check(!(await rendered(page, '[data-act="upgrade"]')), "and Upgrade goes, now out of reach");
  const roof = await page.$eval(`button.tile[value="${cell}"] .roof`, (el) => getComputedStyle(el, "::before").content);
  check(roof !== "none", "and a Townhouse draws a different roofline", roof);

  // Without JavaScript the same actions are plain forms.
  const nojs = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    await ctx.addCookies([{ name: "pid", value: me.pid, url: APP }]);
    const p = await ctx.newPage();
    await p.goto(`${APP}/?v=${Date.now()}`);
    return p;
  })();
  await nojs.waitForTimeout(2500);
  await nojs.reload();
  const forms = await nojs.$$eval("button[formaction]", (els) => els.map((e) => e.getAttribute("formaction")));
  check(["/collect", "/upgrade", "/renew"].every((a) => forms.includes(a)), "without JavaScript, collect, upgrade and renew are form buttons", forms.join(" "));
  const c0 = Number(await nojs.textContent("[data-hud-coins]"));
  if (await rendered(nojs, '[data-act="collect"]')) {
    await nojs.click('[data-act="collect"]');
    await nojs.waitForURL(/notice=(collected|nothing-to-collect)/, { timeout: 3000 }).catch(() => null);
    check(/notice=collected/.test(nojs.url()) && Number(await nojs.textContent("[data-hud-coins]")) > c0, "and Collect posts and reloads with more coins", nojs.url());
    check(((await nojs.textContent("[data-notices]")) ?? "").trim() === "Collected!", "saying so in a word");
  } else check(false, "the no-JS page shows Collect when income waits");
  await nojs.context().close();

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
  check(!(await rendered(page, ".move-button")), "no Move button until a free plot is picked");
  await clickTile(page, dest);
  const facts = await inspectText(page);
  const label = ((await page.textContent(".move-button")) ?? "").trim();
  check(facts === "Free plot Earns +10/min" && label === "Move here · 50" && (await rendered(page, ".move-button")), "picking a free plot shows what it earns, and Move here with its cost", `${facts} | ${label}`);
  check((await hooks(page, dest)).preview === "target", "and previews the building there");
  check((await hooks(page, dest)).state === "free", "nothing moves before the confirm");
  await page.screenshot({ path: ".shots/relocate-preview.png" });
  const seen = watcher.waitForSelector(`button.tile[value="${dest}"][data-state="held"]`, { timeout: 3000 }).catch(() => null);
  const started = Date.now();
  await page.click(".move-button");
  await page.waitForSelector(`button.tile[value="${dest}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, dest)).state === "mine" && (await hooks(page, cell)).state === "free", "confirming moves the building");
  check((await coinsOf(page)) === 50, "for 50 coins", String(await coinsOf(page)));
  check((await seen) !== null && Date.now() - started < 1000, "another browser sees the move within a second", `${Date.now() - started} ms`);
  // Cooling down: a free plot offers no Move at all.
  const another = (await openPatch(page)) + 1;
  await clickTile(page, another);
  await page.waitForTimeout(100);
  check((await rendered(page, "[data-inspect]")) && !(await rendered(page, ".move-button")), "during the cooldown a free plot is inspected, with no Move button");
  for (const p of [page, watcher]) await p.context().close();

  // On a phone the move is the confirm bar, under the thumb.
  const ph = player("Phoebe");
  const phone = await freshAs(browser, ph, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const home = await openPatch(phone);
  await seed(ph, home);
  await phone.reload();
  await phone.waitForTimeout(400);
  const far = (await openPatch(phone)) + 13;
  await tapTile(phone, far);
  const bar = await phone.locator(".confirm-claim").boundingBox();
  check((await phone.textContent(".confirm-claim")) === "Move here · 50" && (bar?.y ?? 0) > 700, "on a phone the move is confirmed from a bar at the bottom", `${await phone.textContent(".confirm-claim")} at y=${Math.round(bar?.y ?? 0)}`);
  await phone.screenshot({ path: ".shots/relocate-phone.png" });
  await phone.locator(".confirm-claim").tap();
  await phone.waitForSelector(`button.tile[value="${far}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(phone, far)).state === "mine", "and confirming moves it");
  await phone.context().close();
}

async function renewal(browser: Browser): Promise<void> {
  console.log("\n— renewing a lease: offered only under 6 hours, up to 48 —");
  const { me, page, cell } = await claimOwn(browser, "Rena");
  // Three neighbours help: 100 + 150 = 250 coins.
  const ring = around(cell);
  for (const [i, h] of ["Ned", "Nia", "Noor"].map(player).entries()) {
    await seed(h, ring[i]);
    await postAs(h, "/help", { cellId: cell });
  }
  await page.waitForFunction(() => Number(document.querySelector("[data-hud-coins]")?.textContent) >= 250, null, { timeout: 3000 }).catch(() => null);
  check((await page.$$eval("[data-renew-hours]", (els) => els.filter((e) => e.checkVisibility()).length)) === 0, "with 24 h left there's no Renew, however many coins");
  // A lease only gets under 6 h by waiting 18 h, so the page's clock is
  // moved on instead (nothing is posted until the renewal itself).
  const lease0 = await page.getAttribute(`button.tile[value="${cell}"]`, "data-lease-ends-at");
  await page.clock.install({ time: new Date(new Date(lease0!).getTime() - 5 * 3_600_000) });
  await page.clock.runFor(1100);
  await page.waitForSelector("[data-renew-hours]:not([hidden])", { timeout: 3000 }).catch(() => null);
  const opts = await page.$$eval("[data-renew-hours]", (els) => els.filter((e) => e.checkVisibility()).map((e) => e.getAttribute("aria-label")));
  check(opts.join(" | ") === "Renew lease 6 hours for 100 coins | Renew lease 12 hours for 180 coins", "under 6 h, Renew appears with only the options you can afford", opts.join(" | "));
  const ringLabel = (await page.getAttribute("[data-hud-lease]", "aria-label")) ?? "";
  check(/^Lease: [45] h \d+ m left$/.test(ringLabel), "and the ring has drained, its name the time left", ringLabel);
  await page.locator("[data-wallet]").screenshot({ path: ".shots/renew-open.png" });
  await page.clock.resume();
  await page.click('[data-renew-hours="12"]');
  await page.waitForFunction((l) => document.querySelector(`button.tile[data-state="mine"]`)?.getAttribute("data-lease-ends-at") !== l, lease0, { timeout: 3000 }).catch(() => null);
  const lease1 = await page.getAttribute(`button.tile[value="${cell}"]`, "data-lease-ends-at");
  const added = (new Date(lease1!).getTime() - new Date(lease0!).getTime()) / 3_600_000;
  check(Math.round(added) === 12, "renewing 12 h extends the lease by 12 h", `${added.toFixed(2)} h`);
  check(/^Lease renewed · \d+ h left$/.test(await noticeOf(page)), "and says so in a line", await noticeOf(page));
  // Now at 36 h of a 48 h cap: 24 h is past it, whatever the coins.
  for (const [i, h] of ["Oz", "Ola"].map(player).entries()) {
    await seed(h, ring[3 + i]);
    await postAs(h, "/help", { cellId: cell });
  }
  const r = await postAs(me, "/renew", { hours: 24 });
  check(r.status === 400 && r.json.error === "max-lease", "the server refuses a renewal past 48 h", `${r.status} ${JSON.stringify(r.json)}`);
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
  check(!(await rendered(a, ".help-button")), "no Help button until a neighbour's building is picked");
  await clickTile(a, centre + 1);
  const label = (await a.textContent(".help-button")) ?? "";
  const name = (await a.getAttribute(".help-button", "aria-label")) ?? "";
  check(label === "Help Bram · +50" && (await rendered(a, ".help-button")), "a neighbour's inspector offers Help", label);
  check(name === "Help Bram: 50 coins to them, 20 to you", "with a full accessible name", name);
  const bCoins = await coinsOf(b);
  const started = Date.now();
  const seen = b.waitForFunction((c) => Number(document.querySelector("[data-hud-coins]")?.textContent) === c + 50, bCoins, { timeout: 3000 }).catch(() => null);
  await a.click(".help-button");
  await a.waitForSelector('[data-notice="helped"]', { timeout: 3000 }).catch(() => null);
  check((await noticeOf(a)) === "Helped! +50 to them, +20 to you", "Anya is told, in a line", await noticeOf(a));
  check((await coinsOf(a)) === 120, "and gets 20 coins", String(await coinsOf(a)));
  check((await seen) !== null && Date.now() - started < 1000, "Bram's page shows his 50 coins within a second", `${Date.now() - started} ms`);
  check(!(await rendered(a, ".help-button")), "then Help goes away while it cools down");
  await a.screenshot({ path: ".shots/help.png" });
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


// --- a stranger, cold: what's on the first screen, and the first minute ---

// The words a person can actually see: text in rendered elements on the
// screen, plus input placeholders and the logo's alt (its heading text).
async function visibleWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = (el: Element) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const onScreen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const words: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      // roof initials are map labels on other people's buildings, not words to read
      if (el.closest(".sr-only, script, style, h1, .initials") || !seen(el) || !onScreen(el)) continue;
      words.push(...(n.textContent ?? "").split(/\s+/).filter(Boolean));
    }
    for (const i of document.querySelectorAll("input")) if (seen(i) && onScreen(i) && !i.value) words.push(...i.placeholder.split(/\s+/).filter(Boolean));
    const logo = document.querySelector("h1");
    if (logo && seen(logo)) words.push(...(logo.textContent ?? "").split(/\s+/).filter(Boolean));
    return words;
  });
}

async function stranger(browser: Browser): Promise<void> {
  console.log("\n— a stranger, cold: the first screen and the first minute —");
  for (const [name, width, height, mobile] of [
    ["phone", 390, 844, true],
    ["desktop", 1440, 900, false],
  ] as const) {
    const page = await fresh(browser, { viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.fonts.ready);
    const words = await visibleWords(page);
    check(words.length > 0 && words.length < 25, `${name}: the first screen shows under 25 words`, `${words.length}: ${words.join(" ")}`);
    for (const [what, sel] of [
      ["the wallet", "[data-wallet]"],
      ["Collect", '[data-act="collect"]'],
      ["Upgrade", '[data-act="upgrade"]'],
      ["a renewal", "[data-renew-hours]"],
      ["the city activity", "[data-events]"],
      ["the map key", ".legend"],
      ["the camera buttons", "[data-camera] button"],
      ["the keyboard hint", ".keys-hint"],
      ["the goal line", "[data-goal]"],
    ] as const) {
      const visible = await page.$$eval(sel, (els) => els.some((e) => e.checkVisibility()));
      check(!visible, `${name}: no ${what} on the first screen`);
    }
    const disabled = await page.$$eval("button:disabled", (els) => els.filter((e) => e.checkVisibility()).length);
    check(disabled === 0, `${name}: no disabled button on the first screen`, `${disabled}`);
    const tucked = await page.$$eval("details[data-tool] > summary", (els) => els.filter((e) => e.checkVisibility()).map((e) => e.textContent?.trim()));
    check(tucked.length >= 3 && tucked.every((t) => t && t.length > 0), `${name}: the key, activity and camera sit behind named icons`, tucked.join(", "));
    const glow = await page.$$eval('button.tile[data-state="free"]', (els) => els.map((el) => getComputedStyle(el).animationName));
    check(glow.length > 0 && glow.every((a) => a === "invite" || a === "helps"), `${name}: every free plot glows`, [...new Set(glow)].join(", "));
    await page.screenshot({ path: `.shots/stranger-${name}-1-first.png` });

    // The journey, using only what's on the screen: tap a glowing plot.
    const cell = await openPatch(page);
    if (mobile) await tapTile(page, cell);
    else await clickTile(page, cell);
    await page.waitForTimeout(200);
    const focus = await page.evaluate(() => document.activeElement?.id ?? "");
    const pulse = await page.$eval("#label", (el) => ({ want: (el as HTMLElement).dataset.want !== undefined, anim: getComputedStyle(el).animationName }));
    check(focus === "label" && pulse.want && pulse.anim === "want", `${name}: tapping a plot with no name pulses the name field and focuses it`, `${focus}, ${JSON.stringify(pulse)}`);
    check((await hooks(page, cell)).state === "free" && (await hooks(page, cell)).wanted === "", `${name}: and remembers the plot, unclaimed`);
    check((await page.textContent("[data-announce]")) === "Type your name to build here.", `${name}: saying so to a screen reader`);
    const ghost = await page.$eval(`button.tile[value="${cell}"] .beacon`, (el) => getComputedStyle(el, "::after").content);
    check(ghost === '"+10/min"', `${name}: the plot shows what it would earn`, ghost);
    await page.screenshot({ path: `.shots/stranger-${name}-2-name.png` });

    // Type a name: Enter builds on the remembered plot.
    await page.keyboard.type(`Cold${name}`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
    check((await hooks(page, cell)).state === "mine", `${name}: typing a name and pressing Enter builds there`);
    check((await page.$$(`button.tile[value="${cell}"] .coin-burst`)).length > 0, `${name}: with a burst of coins`);
    check((await noticeOf(page)) === "Your building is up! +10/min", `${name}: and one short line`, await noticeOf(page));
    check(await rendered(page, "[data-wallet]"), `${name}: the wallet appears after the first claim`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `.shots/stranger-${name}-3-built.png` });

    // Income ticks over the building; Collect appears; collect.
    await page.waitForSelector(`button.tile[value="${cell}"] .owed`, { timeout: 9000 }).catch(() => null);
    check((await page.textContent(`button.tile[value="${cell}"] .owed`)) === "+1", `${name}: income ticks up over the building`, (await page.textContent(`button.tile[value="${cell}"] .owed`)) ?? "none");
    check(await rendered(page, '[data-act="collect"]'), `${name}: and Collect appears`);
    await page.screenshot({ path: `.shots/stranger-${name}-4-waiting.png` });
    const before = await coinsOf(page);
    await (mobile ? page.locator('[data-act="collect"]').tap() : page.click('[data-act="collect"]'));
    await page.waitForFunction((b) => Number(document.querySelector("[data-hud-coins]")?.textContent) > b, before, { timeout: 3000 }).catch(() => null);
    check((await coinsOf(page)) > before, `${name}: Collect fills the wallet`, `${before} → ${await coinsOf(page)}`);
    await page.screenshot({ path: `.shots/stranger-${name}-5-collected.png` });
    await page.context().close();
  }

  // Tapping the remembered plot again, once a name is typed, also builds;
  // and Enter in the field with nothing picked never claims.
  const page = await fresh(browser);
  await page.waitForTimeout(300);
  await page.fill("#label", "Nobody");
  await page.press("#label", "Enter");
  await page.waitForTimeout(300);
  check((await page.$$('button.tile[data-state="mine"]')).length === 0, "Enter in the name field with no plot picked claims nothing (not tile 0)");
  await page.fill("#label", "");
  const cell = await openPatch(page);
  await clickTile(page, cell);
  await page.fill("#label", "Again");
  await clickTile(page, cell);
  await page.waitForSelector(`button.tile[value="${cell}"][data-state="mine"]`, { timeout: 3000 }).catch(() => null);
  check((await hooks(page, cell)).state === "mine", "picking the plot again once a name is there builds on it");
  await page.context().close();

  // Reduced motion: the cues stand still as highlights.
  const calm = await fresh(browser, { reducedMotion: "reduce" });
  await calm.waitForTimeout(300);
  const still = await calm.$eval('button.tile[data-state="free"]:not([data-helps])', (el) => ({ anim: getComputedStyle(el).animationName, ring: getComputedStyle(el).boxShadow }));
  check(still.anim === "none" && /255, 176, 0/.test(still.ring), "under reduced motion the free plots hold a steady gold edge", JSON.stringify(still));
  await clickTile(calm, await openPatch(calm));
  const field = await calm.$eval("#label", (el) => ({ anim: getComputedStyle(el).animationName, ring: getComputedStyle(el).boxShadow }));
  check(field.anim === "none" && /255, 176, 0/.test(field.ring), "and the name field a steady gold ring", JSON.stringify(field));
  await calm.context().close();

  // The panels remember being opened, and survive storage being blocked.
  const keep = await fresh(browser);
  await keep.click('details[data-tool="key"] > summary');
  check(await rendered(keep, ".legend"), "the map key opens from its icon");
  // the toggle event is async: wait until it's been saved, then come back
  await keep.waitForFunction(() => JSON.parse(localStorage.getItem("skyline-tools") ?? "{}").key === true, null, { timeout: 2000 }).catch(() => null);
  await keep.reload();
  await keep.waitForTimeout(300);
  check(await rendered(keep, ".legend"), "and stays open on the next visit");
  await keep.context().close();
  const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new Error("blocked"); } });
  });
  const bp = await blocked.newPage();
  const errors: string[] = [];
  bp.on("pageerror", (e) => errors.push(e.message));
  await bp.goto(`${APP}/?v=${Date.now()}`);
  await bp.waitForTimeout(300);
  await bp.click('details[data-tool="key"] > summary');
  check(errors.length === 0 && (await rendered(bp, ".legend")), "with storage blocked the page still works", errors.join("; "));
  await blocked.close();
}

// A board with a lot going on, for the eye: seeded through HTTP.
async function richBoard(browser: Browser): Promise<void> {
  console.log("\n— a busy board, for the screenshot —");
  const page = await fresh(browser);
  await page.waitForTimeout(300);
  const centre = await openPatch(page);
  const names = ["Mia", "Kai", "Zoe", "Ari", "Bo", "Cy"];
  for (const [i, id] of [centre - 12, centre - 1, centre + 1, centre + 12, centre + 2, centre - 11].entries()) await seed(player(names[i]), id);
  const me = player("Rich");
  await seed(me, centre);
  await postAs(player("x"), "/help", {}); // a refused post changes nothing
  const mine = await freshAs(browser, me);
  await mine.waitForTimeout(1500);
  await mine.evaluate(() => scrollTo(0, 0));
  await mine.waitForTimeout(300);
  await mine.screenshot({ path: ".shots/rich-desktop.png" });
  const phone = await freshAs(browser, me, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: ".shots/rich-phone.png" });
  check(true, "busy board captured");
  for (const p of [page, mine, phone]) await p.context().close();
}

// A full board must still draw. A roof triangle cut with clip-path on a
// rotated piece costs Chrome a mask layer padded 1000px each side; with 70
// houses that passed a gigabyte, and the GPU dropped layers: walls, roofs,
// the floor and half the wallet went missing on screen while every DOM box
// still measured fine. So this measures the compositor too, not only layout.
async function busyBoard(browser: Browser): Promise<void> {
  console.log("\n— a full board still draws: faces, 3D, the wallet, the layer budget —");
  const probe = await fresh(browser);
  await probe.waitForTimeout(300);
  const free = await probe.$$eval('button.tile[data-state="free"]', (els) => els.map((e) => Number((e as HTMLButtonElement).value)));
  const held = 144 - free.length;
  const want = Math.max(0, 100 - held);
  const fill = free.slice(-want);
  const people: Player[] = [];
  for (const [i, id] of fill.entries()) {
    const p = player(`B${i}`);
    await seed(p, id);
    people.push(p);
  }
  await probe.context().close();
  const me = people[0] ?? player("Busy");
  if (!people.length) await seed(me, free[0]);
  const page = await freshAs(browser, me);
  await page.waitForTimeout(1500);
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const taken = await page.$$eval('button.tile:not([data-state="free"])', (els) => els.length);
  check(taken >= 100, "at least 100 plots held", `${taken}`);

  // Side faces: a sample of 20 held tiles, each face with a real size.
  const faces = await page.$$eval('button.tile:not([data-state="free"])', (els) => {
    const pick = els.filter((_, i) => i % Math.max(1, Math.floor(els.length / 20)) === 0).slice(0, 20);
    return pick.map((t) => {
      const sides = t.querySelector(".sides")!.getBoundingClientRect();
      const roof = t.querySelector(".roof")!.getBoundingClientRect();
      const pseudo = ["::before", "::after"].map((p) => getComputedStyle(t, p).content !== "none");
      return { id: (t as HTMLButtonElement).value, w: sides.width, h: sides.height, roof: roof.width * roof.height, pseudo: pseudo.every(Boolean) };
    });
  });
  check(faces.length === 20, "20 held tiles sampled", `${faces.length}`);
  check(faces.length > 0 && faces.every((f) => f.w > 0 && f.h > 0 && f.roof > 0 && f.pseudo), "every sampled tile draws its side faces and roof", JSON.stringify(faces.filter((f) => !(f.w > 0 && f.h > 0 && f.roof > 0 && f.pseudo)).slice(0, 3)));

  // Nothing between the board and a face may flatten preserve-3d.
  const flatteners = await page.$$eval('button.tile:not([data-state="free"]) .sides', (els) => {
    const bad: string[] = [];
    for (const face of els) {
      for (let el: Element | null = face; el && !el.classList.contains("stage"); el = el.parentElement) {
        const s = getComputedStyle(el);
        const why = [
          s.filter !== "none" && `filter ${s.filter}`,
          s.overflow !== "visible" && `overflow ${s.overflow}`,
          Number(s.opacity) < 1 && `opacity ${s.opacity}`,
          s.isolation === "isolate" && "isolation",
          s.willChange !== "auto" && `will-change ${s.willChange}`,
          s.clipPath !== "none" && `clip-path ${s.clipPath}`,
          s.mixBlendMode !== "normal" && `blend ${s.mixBlendMode}`,
        ].filter(Boolean);
        if (why.length) bad.push(`${el.className || el.tagName}: ${why.join(", ")}`);
      }
    }
    return [...new Set(bad)];
  });
  check(flatteners.length === 0, "nothing between the board and a face flattens 3D", flatteners.slice(0, 3).join(" | "));

  // The rotated roof pieces must not be clipped: that's what cost the layers.
  const clippedRoofs = await page.$$eval(".tile[data-level] .roof, .tile[data-level] .gable", (els) => {
    let n = 0;
    for (const el of els) for (const p of ["::before", "::after"]) if (getComputedStyle(el, p).clipPath !== "none") n++;
    return n;
  });
  check(clippedRoofs === 0, "no roof piece is cut with clip-path", `${clippedRoofs} clipped`);

  // The compositor's own bill: every layer's size, from Chrome.
  const cdp = await page.context().newCDPSession(page);
  const layers: { width: number; height: number }[] = await new Promise((resolve) => {
    cdp.on("LayerTree.layerTreeDidChange", (e: { layers?: { width: number; height: number }[] }) => e.layers && resolve(e.layers));
    void cdp.send("LayerTree.enable");
  });
  const mb = Math.round(layers.reduce((s, l) => s + l.width * l.height * 4, 0) / 1e6);
  const huge = layers.filter((l) => l.width * l.height > 1440 * 900 * 1.5).length;
  check(layers.length > 100 && mb < 400, "the board's layers fit a GPU budget (< 400 MB)", `${layers.length} layers, ${mb} MB`);
  check(huge <= 4, "no pile of viewport-sized layers", `${huge} huge`);
  await cdp.detach();

  // The wallet: its box holds its content, and it's painted on screen.
  const wallet = await page.$eval("[data-wallet]", (el) => {
    const r = el.getBoundingClientRect();
    const kids = [...el.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.getBoundingClientRect());
    const bottom = Math.max(...kids.map((k) => k.bottom));
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, contentBottom: bottom, kids: kids.length };
  });
  check(wallet.kids > 0 && wallet.contentBottom <= wallet.bottom + 1 && wallet.bottom - wallet.top >= wallet.contentBottom - wallet.top, "the wallet's box holds its content", JSON.stringify(wallet));
  const shot = await page.screenshot();
  const painted = await page.evaluate(
    async ({ b64, box }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      // the bottom row of the wallet, where a cut-off panel shows page background
      const y = Math.round((box.bottom - 10) * k);
      let differ = 0;
      const bg = g.getImageData(2, 2, 1, 1).data;
      for (let x = Math.round((box.left + 12) * k); x < (box.right - 12) * k; x += 4) {
        const d = g.getImageData(x, y, 1, 1).data;
        if (Math.abs(d[0] - bg[0]) + Math.abs(d[1] - bg[1]) + Math.abs(d[2] - bg[2]) > 24) differ++;
      }
      return differ;
    },
    { b64: shot.toString("base64"), box: wallet },
  );
  check(painted > 5, "the wallet's lower edge is painted, not cut off", `${painted} painted samples`);
  await page.screenshot({ path: ".shots/busy-board.png" });
  await page.context().close();
}

const SECTIONS = {
  stranger,
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
  richBoard,
  busyBoard,
};

// HEADED=1 runs a real, GPU-backed window parked off-screen: the busy board's
// layer drop showed there and only partly in headless.
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
