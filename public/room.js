// What a room can be (ADR 31): the one table of walls, floors, lights and
// things to place, the check a layout must pass, and the view's geometry.
// Shared by the server and the page. All positions are fractions: x across
// the room; y is depth on the floor (0 at the wall, 1 at the front) and height
// on the wall (0 at the floor, 1 at the ceiling).

export const ROOM_MAX_ITEMS = 24;
/** The view: width over height, and where the wall meets the floor. */
export const ROOM_ASPECT = 12 / 7;
export const HORIZON = 0.64;

export const WALLS = {
  plaster: { name: "Warm plaster" },
  sage: { name: "Sage limewash" },
  walnut: { name: "Walnut panels" },
  midnight: { name: "Midnight lacquer" },
};
export const FLOORS = {
  oak: { name: "Pale oak" },
  terrazzo: { name: "Terrazzo" },
  slate: { name: "Dark slate" },
  wool: { name: "Felted wool" },
};
export const LIGHTS = {
  warm: { name: "Afternoon" },
  cool: { name: "North light" },
  dusk: { name: "After hours" },
};
/**
 * Things to place. `group` sorts the palette; `place` is the floor or the
 * wall; `w` and `h` are its size as fractions of the view's height, at full
 * scale; `top` is where an artifact rests, as a share of `h` up from the base.
 */
export const ITEMS = {
  plinth: { group: "stand", place: "floor", name: "White plinth", w: 0.13, h: 0.3, top: 1 },
  column: { group: "stand", place: "floor", name: "Slim column", w: 0.07, h: 0.4, top: 1 },
  case: { group: "stand", place: "floor", name: "Glass case", w: 0.17, h: 0.42, top: 0.74 },
  shelf: { group: "stand", place: "wall", name: "Wall shelf", w: 0.16, h: 0.03, top: 1 },
  bench: { group: "furniture", place: "floor", name: "Oak bench", w: 0.36, h: 0.1 },
  chair: { group: "furniture", place: "floor", name: "Low chair", w: 0.14, h: 0.17 },
  table: { group: "furniture", place: "floor", name: "Round table", w: 0.17, h: 0.16 },
  rug: { group: "decor", place: "floor", name: "Woven rug", w: 0.62, h: 0.05, flat: true },
  plant: { group: "decor", place: "floor", name: "Potted olive", w: 0.14, h: 0.4 },
  vase: { group: "decor", place: "floor", name: "Tall vase", w: 0.08, h: 0.22 },
  painting: { group: "decor", place: "wall", name: "Framed study", w: 0.26, h: 0.34 },
  sconce: { group: "decor", place: "wall", name: "Wall light", w: 0.05, h: 0.09 },
};

export const DEFAULT_ROOM = {
  wall: "plaster",
  floor: "oak",
  light: "warm",
  items: [
    { uid: 1, type: "plinth", x: 0.28, y: 0.35 },
    { uid: 2, type: "column", x: 0.5, y: 0.2 },
    { uid: 3, type: "plinth", x: 0.72, y: 0.35 },
    { uid: 4, type: "bench", x: 0.5, y: 0.82 },
  ],
};

const isUnit = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const r3 = (x) => Math.round(x * 1000) / 1000;
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

/**
 * A layout from a page, whole or not at all: only what's in the tables, and
 * no field that isn't known, which is what keeps free text out of rooms.
 * Who owns an artifact is the store's to say.
 * @returns {{ ok: true, layout: object } | { ok: false, error: string }}
 */
export function checkLayout(x) {
  const no = (error) => ({ ok: false, error });
  if (!x || typeof x !== "object" || Array.isArray(x)) return no("a layout is an object");
  if (!only(x, ["wall", "floor", "light", "items"])) return no("a layout is { wall, floor, light, items }");
  if (!has(WALLS, x.wall)) return no("no such wall");
  if (!has(FLOORS, x.floor)) return no("no such floor");
  if (!has(LIGHTS, x.light)) return no("no such light");
  if (!Array.isArray(x.items) || x.items.length > ROOM_MAX_ITEMS) return no(`at most ${ROOM_MAX_ITEMS} items`);
  const uids = new Set(), shown = new Set(), items = [];
  for (const i of x.items) {
    if (!i || typeof i !== "object" || Array.isArray(i)) return no("an item is an object");
    if (!only(i, ["uid", "type", "x", "y", "artifact"])) return no("an item is { uid, type, x, y, artifact? }");
    if (!Number.isInteger(i.uid) || i.uid < 1 || i.uid > 1_000_000 || uids.has(i.uid)) return no("each item has its own uid");
    uids.add(i.uid);
    if (!has(ITEMS, i.type)) return no("no such item");
    if (!isUnit(i.x) || !isUnit(i.y)) return no("x and y are from 0 to 1");
    const out = { uid: i.uid, type: i.type, x: r3(i.x), y: r3(i.y) };
    if (i.artifact !== undefined) {
      if (ITEMS[i.type].group !== "stand") return no("artifacts stand on stands");
      if (typeof i.artifact !== "string" || i.artifact.length > 40 || shown.has(i.artifact)) return no("an artifact is shown once");
      shown.add(i.artifact);
      out.artifact = i.artifact;
    }
    items.push(out);
  }
  return { ok: true, layout: { wall: x.wall, floor: x.floor, light: x.light, items } };
}

// ---- the view: one wall, one floor, in simple perspective
const FLOOR_NEAR = 1.06; // how wide the front of the floor runs, against the wall
/** How much smaller the far end of the floor is drawn. */
const FAR = 0.62;
const wide = (y) => FAR + (FLOOR_NEAR - FAR) * y;
/** Where a thing stands in the view: fractions of its width and height, and its scale. */
export function project({ x, y }, place) {
  if (place === "wall") return { X: 0.5 + (x - 0.5) * 0.92, Y: HORIZON * (1 - y * 0.9), s: FAR + 0.14 };
  return { X: 0.5 + (x - 0.5) * wide(y), Y: HORIZON + (1 - HORIZON) * y * 0.96, s: FAR + (1.14 - FAR) * y };
}
/** Where a point in the view would put a thing: the inverse, kept in the room. */
export function unproject(X, Y, place) {
  const unit = (v) => Math.max(0, Math.min(1, v));
  if (place === "wall") return [unit((X - 0.5) / 0.92 + 0.5), unit((1 - Y / HORIZON) / 0.9)];
  const y = unit((Y - HORIZON) / ((1 - HORIZON) * 0.96));
  return [unit((X - 0.5) / wide(y) + 0.5), y];
}
/** Drawing order: the wall, what lies flat, then the floor from far to near. */
export function order(items) {
  const rank = (i) => (ITEMS[i.type].place === "wall" ? 0 : ITEMS[i.type].flat ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? a.y - b.y : 0) || a.uid - b.uid);
}
/** A thing's box in the view, as fractions of the view's width and height. */
export function bounds(i) {
  const t = ITEMS[i.type], p = project(i, t.place);
  const w = (t.w * p.s) / ROOM_ASPECT, h = t.h * p.s;
  return { left: p.X - w / 2, right: p.X + w / 2, top: t.place === "wall" ? p.Y - h / 2 : p.Y - h, bottom: t.place === "wall" ? p.Y + h / 2 : p.Y, X: p.X, Y: p.Y, s: p.s };
}
/** The frontmost thing at a point in the view, or null. */
export function hitItem(items, X, Y) {
  const near = order(items).reverse();
  return near.find((i) => {
    const b = bounds(i);
    return X >= b.left && X <= b.right && Y >= b.top - 0.01 && Y <= b.bottom + 0.01;
  }) ?? null;
}
/** Where an artifact rests on a stand, in the view. */
export function restOn(i) {
  const t = ITEMS[i.type], b = bounds(i);
  if (t.place === "wall") return { X: b.X, Y: b.top, s: b.s };
  return { X: b.X, Y: b.bottom - t.h * b.s * t.top, s: b.s };
}
/** Where a new thing goes: the first spot clear of what's already placed
 * there, working out from the middle, so nothing lands on top of anything. */
export function freeSpot(items, place) {
  const xs = [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6];
  const ys = place === "wall" ? [0.6, 0.35, 0.8] : [0.5, 0.25, 0.72, 0.1, 0.9];
  const there = items.filter((i) => ITEMS[i.type].place === place);
  for (const y of ys) for (const x of xs) if (there.every((o) => Math.hypot(o.x - x, o.y - y) > 0.12)) return [x, y];
  return [0.5, ys[0]];
}
export const nextUid = (items) => items.reduce((m, i) => Math.max(m, i.uid), 0) + 1;

const TONES = ["Amber", "Ash", "Birch", "Cobalt", "Ember", "Fern", "Ivory", "Jade", "Linen", "Marble", "Ochre", "Pewter", "Quartz", "Russet", "Sable", "Umber"];
const SPACES = ["Room", "Gallery", "Cabinet", "Annex"];
/** A room's name, from its tag alone: no one chooses it. */
export function roomName(tag) {
  const n = parseInt(tag.slice(0, 2), 16) || 0;
  const m = parseInt(tag.slice(2, 4), 16) || 0;
  return `The ${TONES[n % TONES.length]} ${SPACES[m % SPACES.length]}`;
}
