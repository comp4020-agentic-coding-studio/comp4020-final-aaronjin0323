import { createHash } from "node:crypto";
import { heights } from "./board.ts";
import { N, type Tile } from "./db.ts";

// Who did what, one line per event on stdout, for `flyctl logs` to show:
//
//   claim who=3fa1c2 label="Mia" at=r4c7 from=r2c2 lifted=9b01de:"Kai"
//
// An event name, then key=value fields. A person is a tag: the first 6 hex of
// a SHA-256 of their pid. The pid is the only proof of who anyone is and logs
// leave the server, so it's never written; the tag tells two visitors apart
// and can't be turned back into a cookie. Tiles are row/column from 1, as the
// page says them.
//
// Labels are typed by strangers, so every string goes through quote(): a
// label can't end the line, start a fake one, or hide text behind a bidi
// override. Values that aren't quoted (tags, tiles, numbers, fixed words)
// come only from raw() at a call site with a constant or from the helpers
// below, never from input.

type Raw = { raw: string };
type Value = string | number | boolean | Raw | null | undefined;
export const raw = (s: string): Raw => ({ raw: s });

export const tag = (pid: string): string => createHash("sha256").update(pid).digest("hex").slice(0, 6);

// JSON string syntax, plus escapes for what JSON leaves raw but a terminal or
// log viewer may still act on: line and paragraph separators (U+2028/9) and
// format characters such as bidi overrides. The result still parses as JSON.
export const quote = (s: string): string =>
  JSON.stringify(s).replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, (ch) =>
    // per UTF-16 unit, so the result still parses as JSON
    Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, "0")}`).join(""),
  );

export const who = (pid: string): Raw => raw(tag(pid));
export const at = (id: number): Raw => raw(`r${Math.floor(id / N) + 1}c${(id % N) + 1}`);
const person = (pid: string, label: string | null): string => `${tag(pid)}:${quote(label ?? "")}`;
export const people = (list: Tile[]): Raw | undefined =>
  list.length ? raw(list.map((t) => person(t.claimerId!, t.label)).join(",")) : undefined;
export const holder = (t: Tile): Raw | undefined => (t.claimerId ? raw(person(t.claimerId, t.label)) : undefined);

export function line(event: string, fields: Record<string, Value> = {}): string {
  const parts = [event];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "object" ? value.raw : typeof value === "string" ? quote(value) : String(value);
    parts.push(`${key}=${text}`);
  }
  return parts.join(" ");
}

export function log(event: string, fields: Record<string, Value> = {}): void {
  process.stdout.write(line(event, fields) + "\n");
}

export type ClaimEffects = {
  from: number | null; // the tile the claimer let go of, if they moved
  renamedFrom: string | null; // their old label, if they re-claimed their own tile
  tookFrom: Tile | null; // the dormant tile's previous holder
  lifted: Tile[]; // other people whose height went up
  dropped: Tile[]; // and down
};

// What a successful claim did, from the board before and after it, both at
// the claim's `now`. A height change only counts for a tile that kept its
// holder, as on the page. Settling on a dormant tile lifts its neighbours,
// since a dormant tile lifts nobody.
export function claimEffects(before: Tile[], after: Tile[], pid: string, cellId: number, now: Date): ClaimEffects {
  const was = before[cellId];
  const fromTile = before.find((t) => t.claimerId === pid);
  const hb = heights(before, now);
  const ha = heights(after, now);
  const kept = after.filter((t) => t.claimerId !== null && t.claimerId !== pid && t.claimerId === before[t.id].claimerId);
  return {
    from: fromTile && fromTile.id !== cellId ? fromTile.id : null,
    renamedFrom: was.claimerId === pid && was.label !== after[cellId].label ? was.label : null,
    tookFrom: was.claimerId !== null && was.claimerId !== pid ? was : null,
    lifted: kept.filter((t) => ha[t.id] > hb[t.id]),
    dropped: kept.filter((t) => ha[t.id] < hb[t.id]),
  };
}

// Everyone a tile going dormant just dropped a floor: each claimed neighbour,
// dormant ones too, since a dormant tile lifts nobody.
export function dormancyDrops(tiles: Tile[], id: number): Tile[] {
  const row = Math.floor(id / N);
  const col = id % N;
  return tiles.filter((t) => {
    const dr = Math.abs(Math.floor(t.id / N) - row);
    const dc = Math.abs((t.id % N) - col);
    return t.id !== id && dr <= 1 && dc <= 1 && t.claimerId !== null;
  });
}
