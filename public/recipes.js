// The sculpture recipes, and the bounds on every part of them. This is
// the one copy: the server imports it to refuse an edit outside the bounds,
// and the page imports it (served at /recipes.js) to draw the sliders and the
// sculpture. A sculpture is never a mesh, only a recipe id and numbers from
// these ranges, so anything the server accepts the page can draw.
//
// Plain JS on purpose, so the browser can load it without a build step.

/** The colours a part can take, by index. Warm ivory, peach, coral, teal,
 * chrome and dusk, matching the gallery (CLAUDE.md, "The look"). */
export const PALETTE = [
  { name: "ivory", hex: "#f4ead8" },
  { name: "peach", hex: "#f6b38e" },
  { name: "coral", hex: "#ef6f5e" },
  { name: "teal", hex: "#3fa7a3" },
  { name: "deep teal", hex: "#1f6f78" },
  { name: "chrome", hex: "#c9d1d6" },
  { name: "dusk", hex: "#7a6aa8" },
  { name: "gold", hex: "#e3b65b" },
];

const colour = (label, def) => ({ label, kind: "colour", min: 0, max: PALETTE.length - 1, step: 1, default: def });
const num = (label, min, max, step, def) => ({ label, kind: "number", min, max, step, default: def });

// Every part can be lifted, turned and scaled: the transform edits a lease
// guards (docs/adr/0012). Its own parameters come after.
const transform = () => ({
  lift: num("Lift", -0.5, 1.5, 0.05, 0),
  turn: num("Turn", 0, 360, 5, 0),
  scale: num("Scale", 0.5, 1.5, 0.05, 1),
});

// Orbit's spheres (ADR 15): on the shelf until placed, then where they
// were dropped, measured from the ribbon's centre. public/orbit.js decides
// whether the ribbon catches one.
const sphere = (name, tint, angle) => ({
  name,
  params: {
    placed: num("On the sculpture", 0, 1, 1, 0),
    angle: num("Around", 0, 355, 5, angle),
    height: num("Height", -0.8, 0.8, 0.05, 0),
    distance: num("Out", 0, 2, 0.05, 1),
    ride: num("Rides the ribbon", 0, 1, 1, 0),
    along: num("Along the ribbon", 0, 0.995, 0.005, 0),
    size: num("Size", 0.1, 0.3, 0.01, 0.17),
    colour: colour("Colour", tint),
  },
});

/** @type {Record<string, {name: string, blurb: string, parts: Record<string, {name: string, params: Record<string, {label: string, kind: "number" | "colour", min: number, max: number, step: number, default: number}>}>}>} */
export const RECIPES = {
  loop: {
    name: "Loop & Lantern",
    blurb: "A looping ribbon around a glass cube, with spheres in orbit.",
    parts: {
      ribbon: {
        name: "Ribbon",
        params: {
          ...transform(),
          turns: num("Loops", 1, 5, 1, 2),
          twist: num("Twist", 0, 6, 0.5, 1.5),
          radius: num("Reach", 0.6, 1.6, 0.05, 1),
          colour: colour("Colour", 2),
          speed: num("Drift", 0, 2, 0.1, 0.4),
        },
      },
      cube: {
        name: "Glass cube",
        params: {
          ...transform(),
          size: num("Size", 0.4, 1.4, 0.05, 0.8),
          colour: colour("Tint", 3),
          spin: num("Spin", 0, 2, 0.1, 0.3),
          tilt: num("Tilt", 0, 45, 1, 20),
        },
      },
      spheres: {
        name: "Spheres",
        params: {
          ...transform(),
          count: num("Count", 1, 9, 1, 5),
          orbit: num("Orbit", 0.8, 2.2, 0.05, 1.4),
          size: num("Size", 0.08, 0.35, 0.01, 0.16),
          colour: colour("Colour", 5),
          bob: num("Bob", 0, 1, 0.05, 0.4),
        },
      },
    },
  },
  arches: {
    name: "Arch Totem",
    blurb: "Stacked blocks under floating arches and a tilted halo.",
    parts: {
      stack: {
        name: "Stack",
        params: {
          ...transform(),
          segments: num("Blocks", 2, 7, 1, 4),
          height: num("Block height", 0.2, 0.6, 0.02, 0.34),
          taper: num("Taper", 0, 1, 0.05, 0.4),
          colour: colour("Colour", 0),
        },
      },
      arch: {
        name: "Arches",
        params: {
          ...transform(),
          count: num("Count", 1, 4, 1, 2),
          span: num("Span", 0.6, 1.8, 0.05, 1.1),
          colour: colour("Colour", 1),
          sway: num("Sway", 0, 1, 0.05, 0.3),
        },
      },
      halo: {
        name: "Halo",
        params: {
          ...transform(),
          radius: num("Radius", 0.5, 1.5, 0.05, 0.9),
          thickness: num("Thickness", 0.02, 0.15, 0.01, 0.05),
          colour: colour("Colour", 7),
          tilt: num("Tilt", 0, 90, 1, 30),
        },
      },
    },
  },
  bloom: {
    name: "Glass Bloom",
    blurb: "Glass petals on a bending stem, with motes drifting up.",
    parts: {
      petals: {
        name: "Petals",
        params: {
          ...transform(),
          count: num("Count", 3, 12, 1, 7),
          curl: num("Curl", 0, 1, 0.05, 0.5),
          length: num("Length", 0.5, 1.6, 0.05, 1),
          colour: colour("Colour", 3),
        },
      },
      stem: {
        name: "Stem",
        params: {
          ...transform(),
          height: num("Height", 0.5, 2, 0.05, 1.2),
          bend: num("Bend", 0, 1, 0.05, 0.3),
          colour: colour("Colour", 4),
        },
      },
      motes: {
        name: "Motes",
        params: {
          ...transform(),
          count: num("Count", 0, 24, 1, 10),
          spread: num("Spread", 0.5, 2, 0.05, 1.1),
          colour: colour("Colour", 1),
          drift: num("Drift", 0, 1, 0.05, 0.5),
        },
      },
    },
  },
  orbit: {
    name: "Orbit",
    blurb: "Drop spheres on a ribbon; they ride it, however anyone bends it.",
    parts: {
      ribbon: {
        name: "Ribbon",
        params: {
          turns: num("Loops", 1, 4, 1, 2),
          radius: num("Reach", 0.6, 1.5, 0.05, 1),
          twist: num("Twist", 0, 4, 0.5, 1),
          tilt: num("Tilt", 0, 40, 1, 12),
          colour: colour("Colour", 2),
        },
      },
      chrome: sphere("Chrome sphere", 5, 0),
      teal: sphere("Teal sphere", 3, 90),
      gold: sphere("Gold sphere", 7, 180),
      dusk: sphere("Dusk sphere", 6, 270),
    },
  },
};

/**
 * The starting numbers for a recipe: every part at its defaults.
 * @param {string} recipeId
 * @returns {Record<string, Record<string, number>>}
 */
export function defaultParts(recipeId) {
  const recipe = Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : null;
  if (!recipe) throw new Error(`no recipe ${recipeId}`);
  /** @type {Record<string, Record<string, number>>} */
  const parts = {};
  for (const [partId, part] of Object.entries(recipe.parts)) {
    parts[partId] = {};
    for (const [key, p] of Object.entries(part.params)) parts[partId][key] = p.default;
  }
  return parts;
}

// Snap to the parameter's step from its min, and drop float noise.
const snap = (p, v) => Number((p.min + Math.round((v - p.min) / p.step) * p.step).toFixed(4));

/**
 * Checks an edit to one part. `values` may name any subset of the part's
 * parameters. Returns the snapped values, or the reason it's refused: an
 * unknown recipe, part or parameter, a non-number, or a number outside the
 * range. Out of range is refused, never clamped (CLAUDE.md, Decisions).
 * Own keys only, so `constructor` or `__proto__` is never a parameter.
 * @param {string} recipeId
 * @param {string} partId
 * @param {unknown} values
 * @returns {{ ok: true, values: Record<string, number> } | { ok: false, reason: string }}
 */
export function checkEdit(recipeId, partId, values) {
  const recipe = Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : null;
  if (!recipe) return { ok: false, reason: "unknown recipe" };
  const part = Object.hasOwn(recipe.parts, partId) ? recipe.parts[partId] : null;
  if (!part) return { ok: false, reason: "unknown part" };
  if (typeof values !== "object" || values === null || Array.isArray(values)) return { ok: false, reason: "values must be an object" };
  const keys = Object.keys(values);
  if (keys.length === 0) return { ok: false, reason: "no values" };
  const out = {};
  for (const key of keys) {
    const p = Object.hasOwn(part.params, key) ? part.params[key] : null;
    if (!p) return { ok: false, reason: `unknown parameter ${key}` };
    const v = values[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, reason: `${key} must be a number` };
    if (v < p.min || v > p.max) return { ok: false, reason: `${key} must be between ${p.min} and ${p.max}` };
    out[key] = snap(p, v);
  }
  return { ok: true, values: out };
}

/**
 * Checks a whole sculpture (a recipe id and every part's numbers), as held in
 * the database or copied from an exhibit. Every part and parameter must be
 * present and in range.
 * @param {string} recipeId
 * @param {unknown} parts
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkSculpture(recipeId, parts) {
  const recipe = Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : null;
  if (!recipe) return { ok: false, reason: "unknown recipe" };
  if (typeof parts !== "object" || parts === null) return { ok: false, reason: "parts must be an object" };
  for (const [partId, part] of Object.entries(recipe.parts)) {
    const given = parts[partId];
    if (!given) return { ok: false, reason: `missing part ${partId}` };
    if (Object.keys(given).length !== Object.keys(part.params).length) return { ok: false, reason: `wrong parameters on ${partId}` };
    const checked = checkEdit(recipeId, partId, given);
    if (!checked.ok) return checked;
  }
  if (Object.keys(parts).length !== Object.keys(recipe.parts).length) return { ok: false, reason: "unknown part" };
  return { ok: true };
}

/** The colours a visitor marker can take, by index (`VisitorView.colour`).
 * Chosen to stay apart from each other on ivory and on dusk. */
export const VISITOR_COLOURS = ["#e2553f", "#2e8f8a", "#7b5cc4", "#d98a1c", "#3c7bd1", "#c2477e", "#5a9a3a", "#8a6a4a"];
