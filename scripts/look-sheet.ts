#!/usr/bin/env node
// Every piece of the arena's look on one sheet, for judging the art: the
// floor, the vault (calm, lit, with a burst), all four robots (still, moving,
// yours), every artifact kind in every material (on the floor, as cargo, in
// a room icon, as a dark catalog shape), a contact and a settling ring.
// It starts its own server on a throwaway database and screenshots
// .shots/look-sheet-1440.png and .shots/look-sheet-390.png. Read them.
//
//   node scripts/look-sheet.ts            # LOOK_PORT=8301 by default
//   LOOK_T=1.3 node scripts/look-sheet.ts # a different moment, in seconds
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.LOOK_PORT ?? 8301);
const T = Number(process.env.LOOK_T ?? 0.8);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const db = join(mkdtempSync(join(tmpdir(), "look-")), "x.db");
const server = spawn(process.execPath, ["src/server.ts"], { env: { ...process.env, PORT: String(PORT), DB_PATH: db, NODE_ENV: "" }, stdio: "ignore" });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 100; i++) {
  try { await fetch(`${base}/readme/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
mkdirSync(".shots", { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors: string[] = [];
try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
    page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(`${base}/readme/`);
    await page.evaluate(async ({ T, w }) => {
      const load = (path: string): Promise<any> => import(path);
      const A = await load("/arena.js");
      const { SLOT_COLOURS } = await load("/arena-ui.js");
      const { drawItem, drawAura, itemIcon } = await load("/arena-draw.js");
      const { drawFloor } = await load("/look-floor.js");
      const { drawVault, drawBurst } = await load("/look-vault.js");
      const { drawRobot, drawTrail } = await load("/look-robot.js");
      const { drawFlash, drawSettling, drawTether, drawCargoSlot } = await load("/look-effects.js");
      document.body.innerHTML = "";
      document.body.style.cssText = "margin:0;background:#16130f;color:#ccc;font:12px system-ui";
      const cw = Math.min(w - 16, 1200), m = cw / A.ARENA.w, ch = A.ARENA.h * m;
      const c = document.createElement("canvas");
      c.width = cw * 2; c.height = ch * 2; c.style.cssText = `width:${cw}px;height:${ch}px;display:block;margin:8px`;
      document.body.append(c);
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.scale(2, 2);
      const now = T * 1000, px = (v: number) => v * m;
      drawFloor(g, { w: cw, h: ch, m, now, reduced: false });
      drawVault(g, { x: px(A.VAULT[0]), y: px(A.VAULT[1]), r: px(A.VAULT_R), lit: true, now, reduced: false });
      drawBurst(g, { x: px(A.VAULT[0]), y: px(A.VAULT[1]), r: px(A.VAULT_R), k: 0.35, reduced: false });
      // every artifact on the floor, three rows of four materials
      const mats = Object.keys(A.MATERIALS);
      ["fish", "cloud", "door"].forEach((kind, row) => mats.forEach((material, col) => {
        const x = px(1.2 + col * 1.25), y = px(1.4 + row * 1.6), r = Math.max(15, px(A.ARTIFACT_R) * 1.15);
        drawAura(g, material, x, y, r, T);
        drawItem(g, { kind, material, seed: 11 + row * 7 + col }, x, y, r, T);
      }));
      // four robots: still, moving with a trail and cargo, yours
      [0, 1, 2, 3].forEach((slot) => {
        const x = px(10.4 + slot * 1.3), y = px(2), vel = slot === 1 ? [6, 2] : [0, 0];
        if (slot === 1) drawTrail(g, { x, y, back: [x - px(vel[0] * 0.09), y - px(vel[1] * 0.09)], r: px(A.ROBOT_R), colour: SLOT_COLOURS[slot] });
        drawRobot(g, { x, y, r: px(A.ROBOT_R), slot, colour: SLOT_COLOURS[slot], isMe: slot === 0, vel, now, reduced: false });
      });
      // a robot towing two pieces of cargo
      { const x = px(11), y = px(4.6), r = px(A.ROBOT_R), step = px(A.ROBOT_R * 1.25);
        drawTether(g, { x1: x, y1: y, x2: x - (r + step * 1.8), y2: y });
        [{ kind: "fish", material: "gold", seed: 3 }, { kind: "door", material: "glass", seed: 4 }].forEach((item, i) => {
          const cx = x - (r + step * (i + 0.8));
          drawCargoSlot(g, { x: cx, y, r: px(A.ARTIFACT_R) * 1.05 });
          drawItem(g, item, cx, y, px(A.ARTIFACT_R) * 0.8, T);
        });
        drawRobot(g, { x, y, r, slot: 2, colour: SLOT_COLOURS[2], isMe: false, vel: [3, 0], now, reduced: false }); }
      // a contact scattering two things, and an artifact settling
      drawFlash(g, { x: px(12.5), y: px(7.4), r: px(A.ARTIFACT_R), k: 0.3, lines: [[px(12.5), px(7.4), px(14), px(8.6)], [px(12.5), px(7.4), px(11.2), px(8.8)]], reduced: false });
      { const x = px(14.4), y = px(6.2); drawItem(g, { kind: "cloud", material: "tin", seed: 9 }, x, y, Math.max(15, px(A.ARTIFACT_R) * 1.15), T); drawSettling(g, { x, y, r: px(A.ARTIFACT_R), ready: 0.6 }); }
      // the same artifacts as room icons and dark catalog shapes
      const strip = document.createElement("div");
      strip.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:8px;background:#f3eee6;padding:8px;border-radius:8px";
      for (const kind of ["fish", "cloud", "door"]) for (const material of mats) strip.append(itemIcon({ kind, material, seed: 5 }, 72));
      for (const kind of ["fish", "cloud", "door"]) strip.append(itemIcon({ kind, material: "tin", seed: 5 }, 72, { dark: true }));
      document.body.append(strip);
    }, { T, w });
    await page.screenshot({ path: `.shots/look-sheet-${w}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill("SIGKILL");
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "look sheet: .shots/look-sheet-1440.png, .shots/look-sheet-390.png");
process.exit(errors.length ? 1 : 0);
