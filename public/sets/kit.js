// What every set's rules may import (ADR 18): the loop's clock, the size of
// the stage and a sine every engine computes to the same bits. A leaf: it
// imports nothing, so a set (public/sets/<id>.js) can import it while
// public/stage.js imports the set, without a cycle. stage.js re-exports
// all of it. Rules only: + - * / and Math.sqrt (spec/stage.test.ts).

/** The loop, in seconds: every gesture replays once per loop. */
export const LOOP = 30;
/** For this long at the end of each loop, everything eases back to where
 * it rests, so the loop comes round without a jump. */
export const GLIDE = 1.2;
/** The fixed step every screen simulates with. */
export const STEP = 1 / 60;

/** The stage every set plays on, in its own frame (metres, y up, the
 * centre of the floor at 0): things stay within `radius` of the centre and
 * under `ceiling`. A throw's `from` is checked against `THROW`. */
export const STAGE = { radius: 2.0, ceiling: 2.2 };
/** The bounds of every throw (the shared `throw` gesture): where it's let
 * go, and its speed on each axis. */
export const THROW = { fromLo: [-2.1, 0, -2.1], fromHi: [2.1, 2.4, 2.1], vMax: 6 };

const TAU = Math.PI * 2;

/**
 * Sine of a whole number of turns `x` (sin(x * TAU)), from + - * / only,
 * so every browser computes the same bits (CLAUDE.md: Math.sin may differ
 * in the last digit between engines). The turn is cut to its nearest
 * quarter, then a Taylor series runs over a small angle, good to about
 * 1e-13.
 * @param {number} x turns
 * @returns {number}
 */
export function turnSin(x) {
  const k = Math.round(x * 4); // nearest quarter turn
  const f = (x - k / 4) * TAU; // |f| <= pi/4
  const f2 = f * f;
  const s = f * (1 - (f2 / 6) * (1 - (f2 / 20) * (1 - (f2 / 42) * (1 - (f2 / 72) * (1 - (f2 / 110) * (1 - f2 / 156))))));
  const c = 1 - (f2 / 2) * (1 - (f2 / 12) * (1 - (f2 / 30) * (1 - (f2 / 56) * (1 - (f2 / 90) * (1 - f2 / 132)))));
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? s : q === 1 ? c : q === 2 ? -s : -c;
}

/** Cosine of `x` turns, the same way. @param {number} x turns @returns {number} */
export function turnCos(x) {
  return turnSin(x + 0.25);
}
