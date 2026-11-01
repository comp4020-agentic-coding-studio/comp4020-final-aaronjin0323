// The arena page's decisions, as small pure functions. No DOM and no fetch,
// so spec/arena-ui.test.ts holds them without a browser. The movement
// numbers themselves are all in arena.js.
import { ARENA, CARRY_MAX, DROP_PROTECT_MS, GRACE_MS, MIN_PULL, PICKUP_DELAY_MS, PULL_MAX } from "./arena.js";

/** The slots' colours; each differs by a mark too (arena-app.js). */
export const SLOT_COLOURS = ["#ff6b4a", "#2ec4b6", "#ffc83d", "#b48cff"];

// ---- the connection
export const INITIAL_CONN = { status: "connecting", hasState: false, everLive: false };
export function connection(c, event) {
  if (event === "open") return { ...c, hasState: false };
  if (event === "state") return { status: "live", hasState: true, everLive: true };
  if (event === "error") return { status: c.everLive ? "reconnecting" : "connecting", hasState: false, everLive: c.everLive };
  return c;
}
export const canPlay = (c) => c.status === "live" && c.hasState;
/** How long before opening a refused stream again: 1 s, doubling, at most 15 s. */
export const retryDelay = (tries) => Math.min(15_000, 1000 * 2 ** Math.min(tries, 4));

/**
 * A launch from a pull, measured from where the press began, so it works
 * however fast your robot is going: opposite the drag, harder the further
 * it's pulled, full power at PULL_MAX. Shorter than MIN_PULL is no aim.
 * @returns {{ dir: number[], power: number } | null}
 */
export function aimFromPull(start, pointer) {
  const dx = start[0] - pointer[0], dy = start[1] - pointer[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_PULL) return null;
  return { dir: [dx / len, dy / len], power: Math.min(1, len / PULL_MAX) };
}

/** Keys: arrows turn the aim by KEY_TURN degrees and the power by KEY_POWER. */
export const KEY_TURN = 15;
export const KEY_POWER = 0.1;
export const KEY_AIM_START = { angle: 0, power: 0.8 };
const r2 = (x) => Math.round(x * 100) / 100;
/**
 * A key on the robot: the new aim and what to do, or null if the key isn't
 * the robot's.
 * @returns {{ aim: { angle: number, power: number }, act: "aim" | "launch" | "cancel" } | null}
 */
export function keyAim(aim, key) {
  const turn = { ArrowLeft: -KEY_TURN, ArrowRight: KEY_TURN }[key];
  if (turn) return { aim: { ...aim, angle: (aim.angle + turn + 360) % 360 }, act: "aim" };
  const more = { ArrowUp: KEY_POWER, ArrowDown: -KEY_POWER }[key];
  if (more) return { aim: { ...aim, power: r2(Math.min(1, Math.max(KEY_POWER, aim.power + more))) }, act: "aim" };
  if (key === "Enter" || key === " ") return { aim, act: "launch" };
  if (key === "Escape") return { aim, act: "cancel" };
  return null;
}
/** The launch a key aim makes. */
export function launchOfKeyAim(aim) {
  const a = (aim.angle * Math.PI) / 180;
  return { dir: [Math.round(Math.cos(a) * 1e6) / 1e6, Math.round(Math.sin(a) * 1e6) / 1e6], power: aim.power };
}

/**
 * Your own robot: the snapshot you predicted after your newest launch
 * stands until the server's snapshot of that launch (or a later one)
 * arrives; an older one, sent for someone else's change, doesn't undo it.
 */
export const trust = (mine, server) => (mine && server.seq < mine.seq ? mine : server);

/** CARRY_MAX places: what's carried, in order, then null for room left. */
export const cargoSlots = (carrying) => Array.from({ length: CARRY_MAX }, (_, i) => carrying[i]?.kind ?? null);
/** The unit way behind a robot at `pos`: where it came from; when it's
 * still, towards the middle, so its cargo never meets a wall. */
export function behind(vel, pos) {
  const s = Math.hypot(vel[0], vel[1]);
  if (s >= 1e-9) return [-vel[0] / s, -vel[1] / s];
  const dx = ARENA.w / 2 - pos[0], dy = ARENA.h / 2 - pos[1];
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? [0, 1] : [dx / d, dy / d];
}
/** How ready a dropped artifact is at `now`: 0 just dropped, 1 free to take. */
export const readiness = (readyAt, now) => (now >= readyAt ? 1 : Math.max(0, 1 - (readyAt - now) / PICKUP_DELAY_MS));
/** How strong a robot's shield is at `now`: 1 just knocked, fading to 0. */
export const shield = (protectedUntil, now) => (now >= protectedUntil ? 0 : Math.min(1, (protectedUntil - now) / DROP_PROTECT_MS));
/** The one line about you: playing, or your place in line. Never about anyone else. */
export function placeWords(place) {
  return place ? `The arena is full. You're number ${place} in line for the next robot.` : "";
}
/** The connection, in words: how long your robot waits for you. */
export function connectionMessage(c) {
  if (canPlay(c)) return "";
  return c.everLive ? `Connection lost, reconnecting. Your robot waits ${GRACE_MS / 1000} seconds for you.` : "Connecting…";
}
