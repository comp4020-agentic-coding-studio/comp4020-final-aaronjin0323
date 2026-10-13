// Fills a throwaway database with a demo board through the app's own store:
// a cluster of live tiles and a few claimed two days ago, so dormant tiles
// can be seen and tested locally. Refuses to touch an existing file.
//
//   DB_PATH=/tmp/skyline-demo/app.db node scripts/seed-demo.ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { openStore } from "../src/db.ts";

const path = process.env.DB_PATH;
if (!path || path.startsWith("/data")) throw new Error("set DB_PATH to a throwaway file, never the volume");
if (existsSync(path)) throw new Error(`${path} already exists; seed only a fresh file`);

const store = openStore(path);
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const live: [number, string][] = [[40, "Mia"], [41, "Kai"], [52, "Zoe"], [53, "Ari"], [54, "Noa"], [65, "Liv"], [66, "Ren"]];
const away: [number, string][] = [[42, "Ivy"], [64, "Sol"], [90, "Tai"]];
for (const [cell, name] of away) store.claim(cell, randomUUID(), name, new Date(now - 2 * DAY));
for (const [cell, name] of live) store.claim(cell, randomUUID(), name, new Date(now - 60_000));
store.close();
console.log(`seeded ${path}: ${live.length} live, ${away.length} dormant`);
