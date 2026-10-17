// Fills a throwaway database with a demo board through the app's own store.
// Refuses to touch an existing file.
//
//   DB_PATH=/tmp/skyline-demo/app.db node scripts/seed-demo.ts
//   DB_PATH=/tmp/skyline-demo/app.db node scripts/seed-demo.ts districts
//
// The default is a cluster of live tiles and a few claimed two days ago
// (their leases have ended). `districts` (docs/adr/0010) seeds what a mayor
// needs, levels that take hours of income, five hours in the past: Kai a
// crowned factory, Lv3 and mayor of district 5 over Mia and Zoe; a tie at
// Lv3 in district 3 (no mayor); and in district 8 Ivy at Lv3 alone over Rex,
// a Small House with coins to upgrade. Their pids are fixed (DISTRICT_PIDS),
// so scripts/browser-check.ts's `districts` section can play Ivy and Rex.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { openStore } from "../src/db.ts";

export const DISTRICT_PIDS = {
  Kai: "00000000-0000-4000-8000-00000000d501",
  Mia: "00000000-0000-4000-8000-00000000d502",
  Zoe: "00000000-0000-4000-8000-00000000d503",
  Ari: "00000000-0000-4000-8000-00000000d504",
  Bo: "00000000-0000-4000-8000-00000000d505",
  Cy: "00000000-0000-4000-8000-00000000d506",
  Ivy: "00000000-0000-4000-8000-00000000d507",
  Rex: "00000000-0000-4000-8000-00000000d508",
} as const;
const cell = (r: number, c: number): number => r * 12 + c;
// [name, plot, level, zone]
export const DISTRICT_SCENE: [keyof typeof DISTRICT_PIDS, number, number, string][] = [
  ["Kai", cell(5, 5), 3, "factory"],
  ["Mia", cell(6, 6), 2, "market"],
  ["Zoe", cell(4, 4), 2, "civic"],
  ["Ari", cell(5, 6), 1, "civic"],
  ["Bo", cell(0, 9), 3, "civic"],
  ["Cy", cell(2, 11), 3, "civic"],
  ["Ivy", cell(9, 5), 3, "civic"],
  ["Rex", cell(10, 7), 1, "civic"],
];

const path = process.env.DB_PATH;
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!path || path.startsWith("/data")) throw new Error("set DB_PATH to a throwaway file, never the volume");
  if (existsSync(path)) throw new Error(`${path} already exists; seed only a fresh file`);
  const store = openStore(path);
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  if (process.argv[2] === "districts") {
    const then = new Date(now - 5 * HOUR);
    const later = new Date(now - HOUR);
    for (const [name, id] of DISTRICT_SCENE) store.claim(id, DISTRICT_PIDS[name], name, then);
    for (const [name, , level, zone] of DISTRICT_SCENE) {
      const pid = DISTRICT_PIDS[name];
      store.collect(pid, later);
      for (let l = 1; l < level; l++) if (store.upgrade(pid, later) !== "upgraded") throw new Error(`${name} couldn't reach Lv${l + 1}`);
      if (zone !== "civic" && !store.rezone(pid, zone, later).ok) throw new Error(`${name} couldn't zone ${zone}`);
    }
    store.raise(new Date(now));
    store.close();
    console.log(`seeded ${path}: districts scene, ${DISTRICT_SCENE.length} buildings`);
  } else {
    const DAY = 24 * HOUR;
    const live: [number, string][] = [[40, "Mia"], [41, "Kai"], [52, "Zoe"], [53, "Ari"], [54, "Noa"], [65, "Liv"], [66, "Ren"]];
    const away: [number, string][] = [[42, "Ivy"], [64, "Sol"], [90, "Tai"]];
    for (const [id, name] of away) store.claim(id, randomUUID(), name, new Date(now - 2 * DAY));
    for (const [id, name] of live) store.claim(id, randomUUID(), name, new Date(now - 60_000));
    store.close();
    console.log(`seeded ${path}: ${live.length} live, ${away.length} with ended leases`);
  }
}
