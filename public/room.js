// What a room can be (ADR 31): the one table of walls, floors, lights and
// things to place, the check a layout must pass, and the view's geometry.
// Shared by the server and the page. All positions are fractions: on the
// floor, x and y are across its two sides; on a wall, x runs along both walls
// and y is height (0 at the floor, 1 at the top).

export const ROOM_MAX_ITEMS = 24;
/** The view: width over height, and where the wall meets the floor. */
export const ROOM_ASPECT = 12 / 7;

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
  bench: { group: "furniture", place: "floor", name: "Oak bench", w: 0.36, h: 0.1, seat: true },
  chair: { group: "furniture", place: "floor", name: "Low chair", w: 0.14, h: 0.17, seat: true },
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

// ---- the view (ADR 33): an isometric room. The floor is a diamond, its back
// corner at x 0, y 0, with a wall along each back edge. A wall item's x runs
// along both: 0 to 0.5 down the left wall, 0.5 to 1 along the right.
const SPREAD = 0.4; // half the floor's width, as a share of the view's width
const SLOPE = 0.3; // half the floor's height, as a share of the view's height
const BACK = 0.3; // where the back corner sits, down the view
const SCALE = 0.56; // how big things stand, against their sizes in ITEMS
/** How tall the walls stand, as a share of the view's height. */
export const WALL_H = 0.27;
/** A point on the floor, in the view, at `up` above it. */
export const iso = (x, y, up = 0) => ({ X: 0.5 + (x - y) * SPREAD, Y: BACK + (x + y) * SLOPE - up });
/** Where a wall item's x is on the floor's edge. */
const onWall = (x) => (x < 0.5 ? [0, 1 - 2 * x] : [2 * x - 1, 0]);
/** Where a thing stands in the view: fractions of its width and height. */
export function project({ x, y }, place) {
  if (place === "wall") {
    const [fx, fy] = onWall(x);
    return { ...iso(fx, fy, WALL_H * (0.28 + 0.46 * y)), s: SCALE };
  }
  return { ...iso(x, y), s: SCALE };
}
const unit = (v) => Math.max(0, Math.min(1, v));
/** Where a point in the view would put a thing: the inverse, kept in the room. */
export function unproject(X, Y, place) {
  if (place === "wall") {
    const left = X < 0.5;
    const along = unit(left ? (0.5 - X) / SPREAD : (X - 0.5) / SPREAD);
    const floorY = BACK + along * SLOPE;
    return [left ? (1 - along) / 2 : (along + 1) / 2, unit(((floorY - Y) / WALL_H - 0.28) / 0.46)];
  }
  const a = (X - 0.5) / SPREAD, b = (Y - BACK) / SLOPE;
  return [unit((a + b) / 2), unit((b - a) / 2)];
}
const depth = (i) => i.x + i.y;
/** Drawing order: the walls, what lies flat, then the floor from back to front. */
export function order(items) {
  const rank = (i) => (ITEMS[i.type].place === "wall" ? 0 : ITEMS[i.type].flat ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? depth(a) - depth(b) : 0) || a.uid - b.uid);
}
/** A thing's footprint on the floor: half its size along x and along y. */
export const footOf = (type) => {
  const w = ITEMS[type].w * 0.3;
  return ITEMS[type].flat ? [w, w * 0.62] : type === "bench" ? [w, w * 0.34] : [w, w];
};
/** A thing's box in the view, as fractions of the view's width and height. */
export function bounds(i) {
  const t = ITEMS[i.type], p = project(i, t.place);
  const h = t.h * p.s;
  if (t.place === "wall") {
    const w = (t.w * p.s) / ROOM_ASPECT;
    return { left: p.X - w / 2, right: p.X + w / 2, top: p.Y - h / 2, bottom: p.Y + h / 2, X: p.X, Y: p.Y, s: p.s };
  }
  const [fx, fy] = footOf(i.type);
  const across = (fx + fy) * SPREAD, down = (fx + fy) * SLOPE;
  return { left: p.X - across, right: p.X + across, top: p.Y - h - down, bottom: p.Y + down, X: p.X, Y: p.Y, s: p.s };
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
  const t = ITEMS[i.type], p = project(i, t.place);
  if (t.place === "wall") return { X: p.X, Y: p.Y - (t.h * p.s) / 2, s: p.s };
  return { X: p.X, Y: p.Y - t.h * p.s * t.top, s: p.s };
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

// ---- walking (ADR 33): a local robot, never stored or sent
export const WALK_SPEED = 0.32; // of the room's side, per second
export const WALK_R = 0.035;
export const WALK_START = { x: 0.9, y: 0.9 };
const EDGE = 0.04;
const REACH = 0.1;
/** How far from a thing's centre it stops a walker, or 0 if it doesn't. */
export const footR = (i) => {
  const t = ITEMS[i.type];
  if (t.place === "wall" || t.flat) return 0;
  return Math.max(...footOf(i.type)) * 0.9;
};
const solids = (items) => items.filter((i) => footR(i) > 0);
/** Whether a walker can't stand at `p`. */
export function blocked(p, items) {
  if (p.x < EDGE || p.x > 1 - EDGE || p.y < EDGE || p.y > 1 - EDGE) {
    if (p.x < EDGE - 1e-9 || p.x > 1 - EDGE + 1e-9 || p.y < EDGE - 1e-9 || p.y > 1 - EDGE + 1e-9) return true;
  }
  return solids(items).some((i) => Math.hypot(i.x - p.x, i.y - p.y) < footR(i) + WALK_R);
}
const hold = (v) => Math.max(EDGE, Math.min(1 - EDGE, v));
/** One step along `dir` for `dt` seconds, sliding along whatever stops it. */
export function stepWalker(w, dir, dt, items) {
  const len = Math.hypot(dir[0], dir[1]);
  if (!(len > 1e-9)) return w;
  const dx = (dir[0] / len) * WALK_SPEED * dt, dy = (dir[1] / len) * WALK_SPEED * dt;
  for (const n of [{ x: hold(w.x + dx), y: hold(w.y + dy) }, { x: w.x, y: hold(w.y + dy) }, { x: hold(w.x + dx), y: w.y }]) {
    if ((n.x !== w.x || n.y !== w.y) && !blocked(n, items)) return n;
  }
  return w;
}
const CELLS = 32;
const cellOf = (v) => Math.max(0, Math.min(CELLS - 1, Math.floor(v * CELLS)));
const centre = (c) => (c + 0.5) / CELLS;
/** The nearest spot to `p` a walker can stand. */
export function freeNear(p, items) {
  if (!blocked(p, items)) return { x: p.x, y: p.y };
  let best = null, far = Infinity;
  for (let a = 0; a < CELLS; a++) for (let b = 0; b < CELLS; b++) {
    const c = { x: centre(a), y: centre(b) };
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < far && !blocked(c, items)) [best, far] = [c, d];
  }
  return best ?? { x: p.x, y: p.y };
}
/** A clear way from one spot to another, or to beside it if it's taken: the
 * shortest over a grid. Each point is somewhere to walk to, in order. */
export function route(from, to, items) {
  const goal = freeNear(to, items);
  const key = (a, b) => a * CELLS + b;
  const start = [cellOf(from.x), cellOf(from.y)], end = [cellOf(goal.x), cellOf(goal.y)];
  const came = new Map([[key(...start), null]]);
  const queue = [start];
  const open = (a, b) => a >= 0 && b >= 0 && a < CELLS && b < CELLS && !blocked({ x: centre(a), y: centre(b) }, items);
  while (queue.length) {
    const [a, b] = queue.shift();
    if (a === end[0] && b === end[1]) break;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [na, nb] = [a + da, b + db];
      if (came.has(key(na, nb)) || !open(na, nb)) continue;
      if (da && db && !(open(a + da, b) && open(a, b + db))) continue; // no cutting corners
      came.set(key(na, nb), [a, b]);
      queue.push([na, nb]);
    }
  }
  if (!came.has(key(...end))) return [];
  const path = [];
  for (let c = end; c; c = came.get(key(...c))) path.unshift({ x: centre(c[0]), y: centre(c[1]) });
  path.push(goal);
  return path.slice(1);
}
/** What's in reach to use: an artifact on show or a seat, the nearest, or null. */
export function reachable(w, items, shown) {
  let best = null, far = Infinity;
  for (const i of items) {
    if (ITEMS[i.type].place !== "floor") continue;
    const use = shown[i.artifact ?? ""] || ITEMS[i.type].seat;
    const d = Math.hypot(i.x - w.x, i.y - w.y) - footR(i);
    if (use && d < REACH + WALK_R && d < far) [best, far] = [i, d];
  }
  return best;
}

const TONES = ["Amber", "Ash", "Birch", "Cobalt", "Ember", "Fern", "Ivory", "Jade", "Linen", "Marble", "Ochre", "Pewter", "Quartz", "Russet", "Sable", "Umber"];
const SPACES = ["Room", "Gallery", "Cabinet", "Annex"];
/** A room's name, from its tag alone: no one chooses it. */
export function roomName(tag) {
  const n = parseInt(tag.slice(0, 2), 16) || 0;
  const m = parseInt(tag.slice(2, 4), 16) || 0;
  return `The ${TONES[n % TONES.length]} ${SPACES[m % SPACES.length]}`;
}
