// The Tipping Point set's look, touch, buttons and sounds (ADR 18): a long
// warm-wood plank on a chrome pivot and three faceted stones, played by
// public/sets/seesaw.js. A set view plug-in (public/sets/README.md); never
// imports Three.js (it's handed THREE), so the page reads the buttons,
// names and sounds without WebGL.
import { PALETTE } from "../stage.js";
import seesaw, { PLANK, STONES, plankPoint } from "./seesaw.js";
import { createFlashes, createPlayer } from "./shared-view.js";

const hexOf = (id) => PALETTE[seesaw.colour[id]]?.hex ?? "#ccc";
const R = seesaw.radii;
const WOOD = "#e6c99c";
const CHROME = PALETTE[5].hex;
const TAU = Math.PI * 2;

const NAMES = { pebble: "the small coral stone", stone: "the teal stone", boulder: "the big dusk stone", plank: "the plank" };
/** A short name for an object, in a sentence. */
export const nameOf = (id) => (Object.hasOwn(NAMES, id) ? NAMES[id] : id);

/** The set row's icon: a plank tipped on a pivot, a stone in the air. */
export const icon =
  '<path d="M3 17L21 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 14l-3 6h6z" fill="currentColor"/><circle cx="6" cy="6" r="2.4" fill="currentColor"/>';

const LABEL = { pebble: "Drop the small stone", stone: "Drop the middle stone", boulder: "Drop the big stone" };
/** The stage card's gesture buttons, in tab order: a stone each, then the plank. */
export const buttons = [
  ...STONES.map((id) => ({ gesture: `throw:${id}`, label: `${LABEL[id]} on the high end`, ball: hexOf(id) })),
  {
    gesture: "nudge:plank",
    label: "Tip the plank",
    icon: '<path d="M3 16L21 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 15l-2.5 5h5z" fill="currentColor"/><path d="M18 3v4m0 0l-2-2m2 2l2-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
];
export const heldLabel = (id, who) => `Take ${nameOf(id)} from ${who} and drop it`;

const r3 = (x) => Number(x.toFixed(3));

/**
 * A button's gesture at loop moment `at`, from the stage as shown now. A
 * stone is lifted and dropped on whichever end of the plank is high (the
 * one that catapults the other end); the plank's button pushes its high
 * end down.
 */
export function fromButton(kind, object, at, shown) {
  const high = shown.a >= 0 ? 1 : -1;
  if (kind === "throw") {
    const end = plankPoint(shown.a, high * (PLANK.half - 0.25));
    return { kind, object, at, from: [r3(end[0]), 1.9, 0], v: [0, -0.5, 0] };
  }
  if (kind === "nudge") return { kind, object, at, side: high };
  return { kind, object, at };
}

/** A performance's colours for a thumbnail: each stone its gestures
 * touched, in order; a quiet loop shows the plank and the small stone. */
export const swatch = (p) => {
  const ids = [...new Set(p.gestures.map((g) => g.object))];
  return (ids.length ? ids : ["plank", "pebble"]).map((id) => (id === "plank" ? WOOD : hexOf(id)));
};

/** A stone in a hand: `{ r, colour, metalness, roughness }`, or null. */
export function held(id) {
  if (!STONES.includes(id)) return null;
  return { r: R[id], colour: hexOf(id), metalness: 0.05, roughness: 0.75 };
}

// ---- sounds: notes from one pentatonic scale, so a loop of drops and
// launches is a little tune. Lower for heavier stones.
const NOTE = { pebble: 392, stone: 262, boulder: 165 };
/** @param {any[]} events @param {(o: object) => void} tone */
export function sounds(events, tone) {
  for (const e of events) {
    const f = NOTE[e.object] ?? 220;
    const k = Math.min(1, (e.speed ?? 2) / 4);
    if (e.kind === "land") {
      // a wooden thunk: a quick knock and a low body
      tone({ freq: f, type: "triangle", dur: 0.16, gain: 0.12 + 0.18 * k, slide: 0.55 });
      tone({ freq: f / 2, type: "sine", dur: 0.28, gain: 0.1 + 0.14 * k, slide: 0.7 });
    } else if (e.kind === "tip") {
      // the pivot creaks as the plank starts to swing
      tone({ freq: 96, type: "sawtooth", dur: 0.32, gain: 0.05, slide: 1.35 });
      tone({ freq: 141, type: "sawtooth", dur: 0.22, gain: 0.03, slide: 1.25, delay: 0.06 });
    } else if (e.kind === "launch") {
      // a whoosh up, ending on the stone's note an octave higher
      tone({ freq: f * 0.5, type: "sine", dur: 0.45, gain: 0.14, slide: 4 });
      tone({ freq: f * 2, type: "triangle", dur: 0.3, gain: 0.06, delay: 0.32 });
    } else if (e.kind === "clack") tone({ freq: 196, type: "triangle", dur: 0.08, gain: 0.06 + 0.08 * k, slide: 0.8 });
    else if (e.kind === "thud") tone({ freq: f / 2, type: "sine", dur: 0.2, gain: 0.08 + 0.12 * k, slide: 0.6 });
    else if (e.kind === "knock") tone({ freq: f * 3, type: "square", dur: 0.05, gain: 0.05 + 0.05 * k, slide: 0.9 });
    else if (e.kind === "nudge") tone({ freq: 220, type: "triangle", dur: 0.12, gain: 0.14, slide: 0.7 });
    else if (e.kind === "throw") tone({ freq: f, dur: 0.18, gain: 0.08, slide: 1.5 });
    else if (e.kind === "hop") tone({ freq: f * 1.5, dur: 0.15, gain: 0.08, slide: 1.6 });
  }
}

// ---- the 3D view

/** The plank seen from the side, lips at both ends, pushed out to its width. */
function plankGeometry(THREE) {
  const h = PLANK.half;
  const t = PLANK.thick / 2;
  const lip = 0.05;
  const s = new THREE.Shape();
  s.moveTo(-h, -t);
  s.lineTo(h, -t);
  s.lineTo(h, t + lip);
  s.lineTo(h - PLANK.lip, t + lip);
  s.lineTo(h - PLANK.lip, t);
  s.lineTo(-h + PLANK.lip, t);
  s.lineTo(-h + PLANK.lip, t + lip);
  s.lineTo(-h, t + lip);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: PLANK.width, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
  g.translate(0, 0, -PLANK.width / 2);
  return g;
}

/** The pivot: a flared chrome post from the floor up to the axle. */
function postGeometry(THREE, around) {
  const y = PLANK.pivotY;
  const pts = [
    [0.0, 0],
    [0.26, 0],
    [0.26, 0.03],
    [0.12, 0.08],
    [0.07, y * 0.6],
    [0.06, y - 0.04],
    [0.0, y - 0.04],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  return new THREE.LatheGeometry(pts, around);
}

let shared = null;
function materials(THREE) {
  if (shared) return shared;
  const stone = (id) => new THREE.MeshStandardMaterial({ color: hexOf(id), roughness: 0.75, metalness: 0.05, flatShading: true });
  shared = {
    wood: new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.62, metalness: 0.02 }),
    chrome: new THREE.MeshStandardMaterial({ color: CHROME, roughness: 0.12, metalness: 0.95 }),
    stones: Object.fromEntries(STONES.map((id) => [id, stone(id)])),
    stoneGeo: Object.fromEntries(STONES.map((id) => [id, new THREE.IcosahedronGeometry(R[id], 1)])),
    plankGeo: plankGeometry(THREE),
    postGeo: postGeometry(THREE, 28),
    axleGeo: new THREE.CylinderGeometry(0.05, 0.05, PLANK.width + 0.14, 20),
    shadowGeo: new THREE.CircleGeometry(1, 28),
  };
  shared.axleGeo.rotateX(Math.PI / 2);
  // fewer facets on a plinth, where the detail is under a pixel
  shared.small = {
    ...shared,
    stoneGeo: Object.fromEntries(STONES.map((id) => [id, new THREE.IcosahedronGeometry(R[id], 0)])),
    postGeo: postGeometry(THREE, 12),
    axleGeo: new THREE.CylinderGeometry(0.05, 0.05, PLANK.width + 0.14, 8).rotateX(Math.PI / 2),
    shadowGeo: new THREE.CircleGeometry(1, 12),
  };
  return shared;
}

// points along the plank the reticle can rest on (each a ball of PICK_R)
const PICK = [-1.3, -0.87, -0.43, 0, 0.43, 0.87, 1.3];
const PICK_R = 0.22;

/** A performance on a holder group (the view interface, README.md). */
export function createView(THREE, { small = false } = {}) {
  const m = small ? materials(THREE).small : materials(THREE);
  const root = new THREE.Group();
  const post = new THREE.Mesh(m.postGeo, m.chrome);
  post.userData.object = "plank";
  const plank = new THREE.Group();
  plank.position.y = PLANK.pivotY;
  const board = new THREE.Mesh(m.plankGeo, m.wood);
  board.userData.object = "plank";
  const axle = new THREE.Mesh(m.axleGeo, m.chrome);
  axle.userData.object = "plank";
  plank.add(board, axle);
  root.add(post, plank);
  const balls = {};
  const shadows = {};
  for (const id of STONES) {
    const b = new THREE.Mesh(m.stoneGeo[id], m.stones[id]);
    b.userData.object = id;
    const s = new THREE.Mesh(m.shadowGeo, new THREE.MeshBasicMaterial({ color: "#3a2a40", transparent: true, opacity: 0.2, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.005;
    root.add(b, s);
    balls[id] = b;
    shadows[id] = s;
  }
  // the plank's own soft shadow: a long oval under it
  const plankShadow = new THREE.Mesh(m.shadowGeo, new THREE.MeshBasicMaterial({ color: "#3a2a40", transparent: true, opacity: 0.14, depthWrite: false }));
  plankShadow.rotation.x = -Math.PI / 2;
  plankShadow.position.y = 0.004;
  plankShadow.scale.set(PLANK.half * 0.95, PLANK.width * 0.6, 1);
  root.add(plankShadow);
  const flashGroup = new THREE.Group();
  root.add(flashGroup);
  const flashes = createFlashes(THREE, flashGroup);
  const play = createPlayer();
  const lastPos = {};
  let lastA = null;
  let movedAt = -Infinity;
  let shownA = PLANK.limit;

  function update(p, t, { colourOf = (_tag) => "#ffffff", held = /** @type {string[]} */ ([]), still = false } = {}) {
    const { stage, events: fresh } = play(p, t, still);
    shownA = stage.a;
    if (lastA !== null && lastA !== stage.a) movedAt = performance.now();
    lastA = stage.a;
    plank.rotation.z = stage.a * TAU;
    plankShadow.scale.x = PLANK.half * 0.95 * (0.94 + 0.06 * (1 - Math.abs(stage.a) / PLANK.limit));
    for (const id of STONES) {
      const s = stage.stones[id];
      const b = balls[id];
      b.visible = !held.includes(id);
      const was = lastPos[id];
      if (!was || was[0] !== s.pos[0] || was[1] !== s.pos[1] || was[2] !== s.pos[2]) {
        if (was) {
          movedAt = performance.now();
          // it rolls as it goes
          b.rotation.z -= (s.pos[0] - was[0]) / R[id];
          b.rotation.x += (s.pos[2] - was[2]) / R[id];
        }
        lastPos[id] = s.pos;
      }
      b.position.fromArray(s.pos);
      const sh = shadows[id];
      sh.visible = b.visible;
      sh.position.set(s.pos[0], 0.006, s.pos[2]);
      const k = Math.max(0.35, 1 - s.pos[1] / 2.4);
      sh.scale.setScalar(R[id] * 1.3 * k);
      sh.material.opacity = 0.24 * k;
    }
    for (const e of fresh) {
      const c = e.by && e.by !== "plank" ? colourOf(e.by) : e.object && seesaw.colour[e.object] !== undefined && e.object !== "plank" ? hexOf(e.object) : "#fff4e0";
      if (e.kind === "top") flashes.flash("floor", e.pos, "#fff1dc", 2);
      else if (e.kind === "home") continue;
      else if (e.kind === "launch") flashes.flash("ring", e.pos, hexOf(e.object), 0.4);
      else if (e.kind === "land" || e.kind === "thud") flashes.flash("halo", e.pos, hexOf(e.object), R[e.object] * 1.8);
      else if (e.kind === "knock") flashes.flash("halo", e.pos, "#ffffff", 0.18);
      else if (e.kind === "clack") flashes.flash("halo", e.pos, "#fff4e0", 0.2);
      else if (e.kind === "nudge" || e.kind === "throw" || e.kind === "hop") flashes.flash("halo", e.pos, c, 0.22);
    }
    flashes.step();
    return fresh;
  }

  const objects = () => ({ plank: board, ...balls });

  function aim(origin, dir, reach, skip, nearestHit) {
    const targets = [];
    for (const id of STONES) {
      const b = balls[id];
      if (id === skip || !b.visible) continue;
      targets.push({ id, kind: "sphere", c: [b.position.x, b.position.y, b.position.z], r: R[id] * 1.5 });
    }
    const stone = nearestHit(origin, dir, targets, reach);
    const planks = PICK.map((lx) => ({ id: "plank", kind: "sphere", c: plankPoint(shownA, lx), r: PICK_R }));
    const board = nearestHit(origin, dir, planks, reach);
    // a stone sitting on the plank wins over the wood just round it
    if (stone && (!board || stone.t <= board.t + 0.25)) return stone;
    return board;
  }

  function haloOf(id, point) {
    if (balls[id]) return { c: balls[id].position.toArray(), r: R[id] * 1.6 };
    return { c: point, r: 0.16 };
  }

  /** A quick press: a stone hops where it is; the plank is pushed down
   * where it was touched (its middle hops everything on it). */
  function press(id, point) {
    if (balls[id]) return { kind: "throw", object: id, from: balls[id].position.toArray().map(r3), v: [0, 2.2, 0] };
    if (id === "plank" && point) {
      const s = Math.sin(shownA * TAU);
      const c = Math.cos(shownA * TAU);
      const lx = point[0] * c + (point[1] - PLANK.pivotY) * s;
      return { kind: "nudge", object: "plank", side: Math.abs(lx) < 0.3 ? 0 : lx > 0 ? 1 : -1 };
    }
    return null;
  }

  function dispose() {
    flashes.dispose();
    for (const s of Object.values(shadows)) s.material.dispose();
    plankShadow.material.dispose();
  }

  const moving = () => flashes.busy() || performance.now() - movedAt < 60;

  /** Fixed points to aim at, for the browser check: the plank's two ends
   * as it rests, and its middle. */
  const marks = () => ({ left: plankPoint(shownA, -1.1), right: plankPoint(shownA, 1.1), pivot: plankPoint(shownA, 0) });

  return { root, update, objects, aim, haloOf, press, marks, dispose, busy: flashes.busy, moving };
}
