// The page's decisions, as small pure functions: the shared clock, the
// connection, a flick from a drag, the latest chain in words, and where
// "Leave it" can put a loop.
// No DOM and no fetch, so spec/ui.test.ts holds them without a browser.
import { BALLS, LOOP, V_MAX, loopMoment } from "./fountain.js";

/** The page's clock offset from the server's, in ms. */
export function clockOffset(serverTime, receivedAt) {
  const t = Date.parse(serverTime);
  return Number.isFinite(t) ? t - receivedAt : 0;
}
/** The shared loop moment, in seconds, from the local time and the offset. */
export const loopNow = (localMs, offset) => loopMoment((localMs + offset) / 1000);

/** The connection: play is allowed only once the current connection's
 * first state has arrived. */
export const INITIAL_CONN = { status: "connecting", hasState: false, everLive: false };
export function connection(c, event) {
  if (event === "open") return { ...c, hasState: false };
  if (event === "state") return { status: "live", hasState: true, everLive: true };
  if (event === "error") return { status: c.everLive ? "reconnecting" : "connecting", hasState: false, everLive: c.everLive };
  return c;
}
export const canPlay = (c) => c.status === "live" && c.hasState;
export function connectionMessage(c) {
  if (canPlay(c)) return "";
  return c.everLive ? "Connection lost, reconnecting. You can watch; play comes back when it does." : "Connecting…";
}

const clampV = (x) => Math.max(-(V_MAX - 0.01), Math.min(V_MAX - 0.01, x));
const r3 = (x) => Math.round(x * 1000) / 1000;
/** How hard a drag throws: m/s per metre dragged. */
export const FLICK_GAIN = 5;
/** A press with no drag hops the ball down a little; it falls back up. */
const HOP = [0, -2.2, 0];

/** A ball's velocity from where the drag started and ended, in the room. */
export function flickFrom(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  if (Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) < 0.03) return [...HOP];
  return d.map((x) => r3(clampV(x * FLICK_GAIN)));
}

/** A gesture button's flick: down and in towards the bell, from where the ball is. */
export function buttonFlick(pos) {
  return [r3(clampV(-pos[0] * 1.8)), -3.4, r3(clampV(-pos[2] * 1.8))];
}

/**
 * Every place "Leave it" can put the stage's loop: each empty plinth, and
 * for each taken one, a new version of its exhibit or a replacement (the
 * old exhibit going to the storeroom).
 */
export function publishTargets(state) {
  const out = [];
  for (const s of state.slots) {
    if (!s.exhibit) out.push({ kind: "empty", slot: s.slot, label: `Plinth ${s.slot} (empty)` });
  }
  for (const s of state.slots) {
    if (!s.exhibit) continue;
    const t = s.exhibit.latest.title;
    out.push({ kind: "version", slot: s.slot, exhibitId: s.exhibit.id, label: `Plinth ${s.slot}: a new version of "${t}"` });
    out.push({ kind: "replace", slot: s.slot, label: `Plinth ${s.slot}: replace "${t}" (it moves to the storeroom)` });
  }
  return out;
}
/** The request a target makes. */
export function publishBody(target, title) {
  if (target.kind === "version") return { title, exhibitId: target.exhibitId };
  if (target.kind === "replace") return { title, slot: target.slot, replace: true };
  return { title, slot: target.slot };
}

const NAMES = { teal: "Teal", coral: "Coral", gold: "Gold", plum: "Plum" };
/** A short playful title from what's in the loop. */
export function suggestTitle(gestures) {
  const rings = gestures.filter((g) => g.kind === "ring").length;
  const balls = [...new Set(gestures.filter((g) => g.kind === "flick").map((g) => g.ball))].filter((b) => BALLS.includes(b));
  if (!balls.length) return rings > 2 ? "Bell Weather" : "One Small Bell";
  const who = balls.map((b) => NAMES[b]).join(" & ");
  if (balls.length === 1) return rings ? `${who} Rings True` : `${who} Falls Up`;
  return rings ? `${who} at the Bell` : `${who}, Upside Down`;
}

/** How long the latest chain stays told after its gesture, in seconds. */
const STORY_S = 4;
/**
 * The latest chain in words (ADR 23): the newest gesture up to loop moment
 * t, then what the balls it moved went on to do. `name(tag)` names a
 * visitor; `you` is your tag. "" when nothing has happened lately.
 */
export function chainStory(events, t, name, you) {
  const who = (tag) => (tag === you ? "You" : name(tag));
  const whose = (tag, ball, mover) => (tag === mover || !tag ? ball : tag === you ? `your ${ball}` : `${name(tag)}'s ${ball}`);
  let start = -1;
  for (let i = 0; i < events.length && events[i].t <= t; i++) {
    const e = events[i];
    if (e.kind === "flick" || (e.kind === "ring" && !e.ball)) start = i;
  }
  if (start < 0 || t - events[start].t > STORY_S) return "";
  const o = events[start];
  const links = [o.kind === "flick" ? `${who(o.by)} flicked ${o.ball}` : `${who(o.by)} rang the bell`];
  for (let i = start + 1; i < events.length && events[i].t <= t && links.length < 5; i++) {
    const e = events[i];
    if (e.by !== o.by) continue;
    let link = "";
    if (e.kind === "knock") link = `${e.hit === e.ball ? e.other : e.ball} knocked ${whose(e.was, e.hit, o.by)}`;
    else if (e.kind === "ring" && e.ball) link = `${e.ball} rang the bell`;
    if (link && !links.includes(link)) links.push(link);
  }
  return `${links.join("; ")}.`;
}

/** Seconds into the loop as "0:07". */
export const clock = (t) => `0:${String(Math.floor(t)).padStart(2, "0")}`;
export { LOOP };

/** A visitor's colour, by their colour index. */
export const VISITOR_COLOURS = ["#e9785f", "#3aa6a0", "#8a63b8", "#e3b45a", "#4f86c6", "#c95b8f", "#6aa84f", "#d08a3c"];
/** The balls' own colours. */
export const BALL_COLOURS = { teal: "#3aa6a0", coral: "#e9785f", gold: "#e3b45a", plum: "#8a63b8" };
export const BALL_NAMES = NAMES;
