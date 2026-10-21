import { tagOf } from "./db.ts";
import type { VisitorView } from "./types.ts";

// Who did what, one line per event on stdout, for `flyctl logs` to show:
//
//   gesture who=3fa1c2 kind=tap object=bell at=2.5 rev=12
//   publish who=3fa1c2 title="Bell Panic" exhibit=4 n=1 slot=4
//
// An event name, then key=value fields. A person is a tag: the first 6 hex
// of a SHA-256 of their pid. The pid is the only proof of who anyone is and
// logs leave the server, so it's never written; the tag tells two visitors
// apart and can't be turned back into a cookie.
//
// Names and titles are typed by strangers, so every string goes through
// quote(): it can't end the line, start a fake one, or hide text behind a
// bidi override. Values that aren't quoted (tags, numbers, fixed words) come
// only from raw() at a call site with a constant or from the helpers below,
// never from input.

type Raw = { raw: string };
export type Value = string | number | boolean | Raw | null | undefined;
export const raw = (s: string): Raw => ({ raw: s });

export const tag = tagOf;

// JSON string syntax, plus escapes for what JSON leaves raw but a terminal or
// log viewer may still act on: line and paragraph separators (U+2028/9) and
// format characters such as bidi overrides. The result still parses as JSON.
export const quote = (s: string): string =>
  JSON.stringify(s).replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, (ch) =>
    // per UTF-16 unit, so the result still parses as JSON
    Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, "0")}`).join(""),
  );

/** A person by pid: their tag, never the pid. */
export const who = (pid: string): Raw => raw(tag(pid));
/** A person as displayed: tag:"Name". */
export const person = (v: VisitorView): Raw => raw(`${v.tag}:${quote(v.name)}`);

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
