// The hall page's decisions, as small pure functions (ADR 24). No DOM and
// no fetch, so spec/hall-ui.test.ts holds them without a browser. The
// movement numbers themselves are all in hall.js.
import { CARRY_MAX, HALL, KINDS, MIN_PULL, PULL_MAX } from "./hall.js";

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

// ---- collecting (ADR 25): what the page shows of cargo and the display,
// always from the server's word

/** The kinds' names, for the screen. */
export const KIND_NAMES = { fish: "luminous fish", cloud: "rain cloud", door: "door onto stars" };
/** CARRY_MAX slots: what's carried, in order, then null for room left. */
export const cargoSlots = (carrying) => Array.from({ length: CARRY_MAX }, (_, i) => carrying[i]?.kind ?? null);
/** Cargo in words: what, how much room is left, and what to do when full. */
export function cargoWords(carrying) {
  const names = carrying.map((c) => KIND_NAMES[c.kind]).join(", ");
  if (!carrying.length) return `Carrying nothing. Room for ${CARRY_MAX}.`;
  if (carrying.length >= CARRY_MAX) return `Full: ${CARRY_MAX} of ${CARRY_MAX} (${names}). Take them to your zone.`;
  return `Carrying ${carrying.length} of ${CARRY_MAX}: ${names}. Room for ${CARRY_MAX - carrying.length} more.`;
}
/** The unit way behind a robot at `pos`: where it came from; when it's
 * still, towards the middle of the hall, so its cargo never meets a wall. */
export function behind(vel, pos) {
  const s = Math.hypot(vel[0], vel[1]);
  if (s >= 1e-9) return [-vel[0] / s, -vel[1] / s];
  const dx = HALL.w / 2 - pos[0], dy = HALL.h / 2 - pos[1];
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? [0, 1] : [dx / d, dy / d];
}

/** What a display slot can hold: empty, or a kind you own. */
export const slotChoices = (collection) => [null, ...KINDS.filter((k) => collection[k] > 0)];
/** The display with `kind` in `slot`: if that kind was shown elsewhere it
 * moves, swapping with what was in `slot`, so each kind shows once. */
export function placeIn(display, slot, kind) {
  const out = [...display];
  const was = kind === null ? -1 : out.indexOf(kind);
  if (was >= 0 && was !== slot) out[was] = out[slot];
  out[slot] = kind;
  return out;
}
