// The hall page's decisions, as small pure functions (ADR 24). No DOM and
// no fetch, so spec/hall-ui.test.ts holds them without a browser. The
// movement numbers themselves are all in hall.js.
import { MIN_PULL, PULL_MAX } from "./hall.js";

/**
 * A launch from a pull: away from where the pointer is, harder the further
 * it's pulled, full power at PULL_MAX. Shorter than MIN_PULL is no aim.
 * @returns {{ dir: number[], power: number } | null}
 */
export function aimFromPull(robot, pointer) {
  const dx = robot[0] - pointer[0], dy = robot[1] - pointer[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_PULL) return null;
  return { dir: [dx / len, dy / len], power: Math.min(1, len / PULL_MAX) };
}

/** Keys: arrows turn the aim by KEY_TURN degrees and the power by KEY_POWER. */
export const KEY_TURN = 15;
export const KEY_POWER = 0.1;
/** Aiming right (0°; 90° is down the screen), at half power. */
export const KEY_AIM_START = { angle: 0, power: 0.5 };
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

const WAYS = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
/** An aim in words, for the screen and for a screen reader. */
export function aimWords({ dir, power }) {
  const eighth = Math.round(Math.atan2(dir[1], dir[0]) / (Math.PI / 4));
  return `Aiming ${WAYS[(eighth + 8) % 8]}, power ${Math.round(power * 100)}%`;
}

/**
 * Your own robot: the snapshot you predicted after your newest launch
 * stands until the server's snapshot of that launch (or a later one)
 * arrives; an older one, sent for someone else's change, doesn't undo it.
 */
export const trust = (mine, server) => (mine && server.seq < mine.seq ? mine : server);
