// Every set's view module, by set id (ADR 18), found from the registry
// SETS in public/stage.js: set `<id>` has its view at
// public/sets/<id>-view.js. Nothing to add here when a set lands. Loaded
// with a top-level await, so importers get every view ready; none of them
// imports Three.js, so the page reads buttons, names and sounds without
// WebGL.
import { SETS } from "../stage.js";

/** @type {Record<string, any>} */
export const VIEWS = Object.fromEntries(await Promise.all(Object.keys(SETS).map(async (id) => [id, await import(`./${id}-view.js`)])));

/** The view module for a set id, or null. @param {unknown} id */
export const viewOf = (id) => (typeof id === "string" && Object.hasOwn(VIEWS, id) ? VIEWS[id] : null);

/** A short name for an object of any set, in a sentence ("the teal
 * sphere"); its id if no set has it. @param {string} id */
export function objectName(id) {
  for (const v of Object.values(VIEWS)) {
    const n = v.nameOf(id);
    if (n !== id) return n;
  }
  return id;
}

/** What a held object looks like (`{ r, colour, metalness, roughness }`),
 * from whichever set has it, or null. @param {unknown} id */
export function heldLook(id) {
  if (typeof id !== "string") return null;
  for (const v of Object.values(VIEWS)) {
    const h = v.held(id);
    if (h) return h;
  }
  return null;
}
