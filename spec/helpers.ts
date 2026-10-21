import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import type { StateEvent } from "../src/types.ts";

// Shared by the HTTP spec files: a fixture visitor is a cookie, every POST
// carries an Origin matching the host (as a browser's would), and a stream
// is read event by event.

export const baseUrl = (): string => inject("baseUrl");

export type Visitor = { pid: string; cookie: string };
export const visitor = (): Visitor => {
  const pid = randomUUID();
  return { pid, cookie: `pid=${pid}` };
};

export type Answer = { status: number; body: any; headers: Headers };

export async function post(who: Visitor | null, path: string, body?: unknown, extra: Record<string, string> = {}, base = baseUrl()): Promise<Answer> {
  const url = new URL(path, base);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      ...(who ? { cookie: who.cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON: the test will say so
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export async function get(who: Visitor | null, path: string, base = baseUrl()): Promise<Answer> {
  const res = await fetch(new URL(path, base), { headers: who ? { cookie: who.cookie } : {} });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // HTML or text
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export type SseEvent = { event: string; data: string; at: number };

/** An open /events stream: every event it has received, and a way to wait
 * for the next one matching a test. */
export type Stream = {
  events: SseEvent[];
  raw: () => string;
  headers: Headers;
  next: (pred: (s: StateEvent) => boolean, ms?: number) => Promise<{ state: StateEvent; at: number }>;
  first: () => Promise<StateEvent>;
  close: () => void;
};

export async function open(who: Visitor, base = baseUrl()): Promise<Stream> {
  const ctl = new AbortController();
  const res = await fetch(new URL("/events", base), { headers: { cookie: who.cookie, accept: "text/event-stream" }, signal: ctl.signal });
  if (res.status !== 200 || !res.body) throw new Error(`/events answered ${res.status}`);
  const events: SseEvent[] = [];
  const waiters = new Set<() => void>();
  let buffer = "";
  let all = "";
  (async () => {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        all += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data.push(line.slice(6));
          }
          if (data.length) {
            events.push({ event, data: data.join("\n"), at: performance.now() });
            for (const w of waiters) w();
          }
        }
      }
    } catch {
      // aborted
    }
  })();

  const states = (): { state: StateEvent; at: number }[] =>
    events.filter((e) => e.event === "state").map((e) => ({ state: JSON.parse(e.data) as StateEvent, at: e.at }));

  function next(pred: (s: StateEvent) => boolean, ms = 3000, from = 0): Promise<{ state: StateEvent; at: number }> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const hit = states().slice(from).find((s) => pred(s.state));
        if (hit) {
          waiters.delete(check);
          clearTimeout(timer);
          resolve(hit);
        }
        return !!hit;
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`no matching state event within ${ms} ms`));
      }, ms);
      waiters.add(check);
      check();
    });
  }

  return {
    events,
    raw: () => all,
    headers: res.headers,
    // only events that arrive after this call
    next: (pred, ms) => next(pred, ms, states().length),
    first: async () => (await next(() => true, 3000, 0)).state,
    close: () => ctl.abort(),
  };
}

/** The museum as `who` sees it now: the first event of a fresh stream. */
export async function stateOf(who: Visitor, base = baseUrl()): Promise<StateEvent> {
  const s = await open(who, base);
  try {
    return await s.first();
  } finally {
    s.close();
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
