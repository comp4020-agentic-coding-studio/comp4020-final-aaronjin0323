// The Orbit set's look, touch, buttons and sounds (ADR 15, 17, 18): its
// spheres, ribbon and bell in 3D, played by public/sets/orbit.js, with a
// flash in the player's colour on everything that happens. A set view
// plug-in (public/sets/README.md): the scene, the page, sound and the
// avatars ask it; none of them names an object. Never imports Three.js
// (it's handed THREE), so the page can read the buttons without WebGL.
import { PALETTE } from "../stage.js";
import orbit, { BELL, SPHERES, ribbonPoint } from "./orbit.js";
import { createFlashes, createPlayer } from "./shared-view.js";

const hexOf = (id) => PALETTE[orbit.colour[id]]?.hex ?? "#ccc";
const STAGE_R = orbit.radius;

/** A short name for an object, in a sentence: "the teal sphere". */
export const nameOf = (id) => (SPHERES.includes(id) ? `the ${id} sphere` : id === "ribbon" ? "the ribbon" : id === "bell" ? "the bell" : id);

/** The set's icon for the set row: an SVG symbol's inner markup, 24x24. */
export const icon = '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="4" r="2.6" fill="currentColor"/><circle cx="18.5" cy="15.5" r="2" fill="currentColor"/>';

/**
 * The stage card's gesture buttons, in tab order: one per object. Each is
 * `{ gesture: "kind:object", label, verb, title?, ball?: colour, icon?: svg }`;
 * `verb` is the one lowercase word the reticle's hint uses ("Hold to throw").
 * `heldLabel(id, name)` is the label while someone else holds it.
 */
export const buttons = [
  ...SPHERES.map((id) => ({ gesture: `throw:${id}`, label: `Throw the ${id} sphere`, verb: "throw", ball: hexOf(id) })),
  { gesture: "pluck:ribbon", label: "Pluck the ribbon", verb: "pluck", icon: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { gesture: "tap:bell", label: "Ring the bell", verb: "ring", icon: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' },
];
export const heldLabel = (id, who) => `Take the ${id} sphere from ${who} and throw it`;

/**
 * A button's gesture at loop moment `at`, from the stage as shown now (its
 * view `shown`). A throw goes up and inward from where the sphere is, as a
 * hand would; the page grabs it first.
 * @returns {Record<string, any>}
 */
export function fromButton(kind, object, at, shown) {
  if (kind === "throw") {
    const now = shown.spheres[object].pos;
    const inward = [-now[0], 0, -now[2]].map((x) => Number((x * 0.9).toFixed(3)));
    return { kind, object, at, from: now.map((x) => Number(x.toFixed(3))), v: [inward[0], 1.6, inward[2]] };
  }
  if (kind === "pluck") return { kind, object, at, u: Number(((at / 30) % 1).toFixed(3)) };
  return { kind, object, at };
}

/** The colours of a performance for a thumbnail: each object its gestures
 * touched, in order; a quiet loop shows the ribbon. */
export const swatch = (p) => (p.gestures.length ? [...new Set(p.gestures.map((g) => g.object))] : ["ribbon"]).map(hexOf);

/** What a held object looks like in a hand (yours, or a visitor's):
 * `{ r, colour, metalness, roughness }`, or null if it can't be held. */
export function held(id) {
  if (!SPHERES.includes(id)) return null;
  return { r: orbit.sphereR, colour: hexOf(id), metalness: id === "chrome" ? 0.95 : 0.55, roughness: id === "chrome" ? 0.08 : 0.25 };
}

// ---- sounds: `sounds(events, tone)` plays a batch with the shared tone()

// a different pitch per sphere, so a chain of events is a little tune
const PITCH = { chrome: 1, teal: 1.26, gold: 1.5, dusk: 0.84 };
/** @param {any[]} events @param {(o: object) => void} tone */
export function sounds(events, tone) {
  for (const e of events) {
    const p = PITCH[e.object] ?? 1;
    if (e.kind === "ring") {
      // a bell: inharmonic partials, long tail
      for (const [mult, gain] of [[1, 0.22], [2.76, 0.1], [5.4, 0.05]]) tone({ freq: 660 * mult, dur: 1.6, gain });
    } else if (e.kind === "catch") tone({ freq: 520 * p, dur: 0.25, gain: 0.18, slide: 1.5, type: "triangle" });
    else if (e.kind === "fling") tone({ freq: 700 * p, dur: 0.3, gain: 0.16, slide: 0.45, type: "triangle" });
    else if (e.kind === "knock") tone({ freq: 220 * p, dur: 0.12, gain: 0.25, type: "square", slide: 0.7 });
    else if (e.kind === "hop") tone({ freq: 380 * p, dur: 0.18, gain: 0.14, slide: 1.8 });
    else if (e.kind === "throw") tone({ freq: 300 * p, dur: 0.22, gain: 0.12, slide: 2.2 });
    else if (e.kind === "pluck") {
      tone({ freq: 196, dur: 0.6, gain: 0.2, type: "sawtooth", slide: 0.98 });
      tone({ freq: 392, dur: 0.4, gain: 0.08, type: "triangle" });
    }
  }
}

// ---- the 3D view

/** The ribbon's path, sampled once for the reticle and a pluck. */
const RIBBON_PATH = [...Array(240)].map((_, i) => ({ u: i / 240, q: ribbonPoint(i / 240) }));

/** A flat band along the curve, twisting gently, both sides lit. */
function ribbonGeometry(THREE, N = 360) {
  class RibbonCurve extends THREE.Curve {
    getPoint(u, target = new THREE.Vector3()) {
      return target.fromArray(ribbonPoint(u));
    }
  }
  const curve = new RibbonCurve();
  const W = 0.07;
  const frames = curve.computeFrenetFrames(N, true);
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = curve.getPoint(u);
    const a = Math.sin(u * Math.PI * 2 * 3) * 0.6;
    const n = frames.normals[i % N].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i % N].clone().multiplyScalar(Math.sin(a)));
    pos.push(...p.clone().addScaledVector(n, W).toArray(), ...p.clone().addScaledVector(n, -W).toArray());
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The bell's dome, clapper and knob, at a given detail. */
function bellGeometry(THREE, around, sphereW, sphereH) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(BELL.r * (0.25 + 0.75 * Math.sin((t * Math.PI) / 2) ** 0.8) * (t > 0.92 ? 1.12 : 1), BELL.r * (1.1 - 1.6 * t)));
  }
  return {
    dome: new THREE.LatheGeometry(pts, around),
    clapper: new THREE.SphereGeometry(BELL.r * 0.28, sphereW, sphereH),
    knob: new THREE.SphereGeometry(BELL.r * 0.22, sphereW, sphereH),
  };
}

let shared = null;
function materials(THREE) {
  if (shared) return shared;
  const hex = (id) => new THREE.Color(hexOf(id));
  shared = {
    ribbon: new THREE.MeshStandardMaterial({ color: hex("ribbon"), side: THREE.DoubleSide, roughness: 0.32, metalness: 0.2 }),
    bell: new THREE.MeshStandardMaterial({ color: hex("bell"), metalness: 0.85, roughness: 0.22, side: THREE.DoubleSide }),
    spheres: Object.fromEntries(SPHERES.map((id) => [id, new THREE.MeshStandardMaterial({ color: hex(id), metalness: held(id).metalness, roughness: held(id).roughness })])),
    ballGeo: new THREE.SphereGeometry(orbit.sphereR, 32, 20),
    ribbonGeo: ribbonGeometry(THREE),
    pulseGeo: new THREE.SphereGeometry(0.06, 12, 8),
    shadowGeo: new THREE.CircleGeometry(1, 32),
    bellGeo: bellGeometry(THREE, 40, 16, 10),
  };
  // the same objects with fewer facets, for a performance shrunk onto a
  // plinth (0.4 scale), where the extra detail is under a pixel
  shared.small = {
    ...shared,
    ballGeo: new THREE.SphereGeometry(orbit.sphereR, 16, 10),
    ribbonGeo: ribbonGeometry(THREE, 160),
    shadowGeo: new THREE.CircleGeometry(1, 16),
    bellGeo: bellGeometry(THREE, 16, 8, 6),
  };
  return shared;
}

/**
 * A performance on a holder group (the view interface, README.md).
 * `update(p, t, opts)` plays `p` to loop moment `t` and returns what
 * happened since the last call (for sounds). `opts.colourOf(tag)` names a
 * player's colour; `opts.held` lists objects in someone's hand here (drawn
 * by the scene instead); `opts.still` holds the loop at its start.
 * `small` builds it with fewer facets, for a plinth.
 * @param {any} THREE @param {{ small?: boolean }} [opts]
 */
export function createView(THREE, { small = false } = {}) {
  const m = small ? materials(THREE).small : materials(THREE);
  const root = new THREE.Group();
  const ribbon = new THREE.Mesh(m.ribbonGeo, m.ribbon);
  // no live shadow: the sun's map is baked once, for the still room
  ribbon.userData.object = "ribbon";
  const bell = new THREE.Group();
  const dome = new THREE.Mesh(m.bellGeo.dome, m.bell);
  const clapper = new THREE.Mesh(m.bellGeo.clapper, m.bell);
  clapper.position.y = -BELL.r * 0.55;
  const knob = new THREE.Mesh(m.bellGeo.knob, m.bell);
  knob.position.y = BELL.r * 1.15;
  bell.add(dome, clapper, knob);
  for (const o of [dome, clapper, knob]) o.userData.object = "bell";
  bell.position.fromArray(BELL.pos);
  root.add(ribbon, bell);
  const balls = {};
  const shadows = {};
  for (const id of SPHERES) {
    const b = new THREE.Mesh(m.ballGeo, m.spheres[id]);
    b.userData.object = id;
    // a soft round shadow on the stage floor under each sphere, so how high
    // it floats reads at a glance
    const s = new THREE.Mesh(m.shadowGeo, new THREE.MeshBasicMaterial({ color: "#3a2a40", transparent: true, opacity: 0.18, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.005;
    root.add(b, s);
    balls[id] = b;
    shadows[id] = s;
  }
  const flashGroup = new THREE.Group();
  root.add(flashGroup);
  const flashes = createFlashes(THREE, flashGroup);
  const pulseMeshes = [];
  const play = createPlayer();
  let bellSwing = 0;
  // whether anything visibly moved in the last update; the scene stops
  // drawing when nothing in view moves
  const lastPos = {};
  let movedAt = -Infinity;
  let live = [];

  function update(p, t, { colourOf = (_tag) => "#ffffff", held = /** @type {string[]} */ ([]), still = false } = {}) {
    const { stage, events: fresh } = play(p, t, still);
    for (const id of SPHERES) {
      const s = stage.spheres[id];
      const b = balls[id];
      b.visible = !held.includes(id);
      const was = lastPos[id];
      if (!was || was[0] !== s.pos[0] || was[1] !== s.pos[1] || was[2] !== s.pos[2]) {
        lastPos[id] = s.pos;
        if (was) movedAt = performance.now();
      }
      b.position.fromArray(s.pos);
      const sh = shadows[id];
      sh.visible = b.visible;
      sh.position.set(s.pos[0], 0.005, s.pos[2]);
      const k = Math.max(0.35, 1 - s.pos[1] / 2.6);
      sh.scale.setScalar(orbit.sphereR * 1.4 * k);
      sh.material.opacity = 0.22 * k;
    }
    // the bell swings a little after it rings
    if (stage.lastRing !== null) bellSwing = Math.max(0, 1 - (stage.t - stage.lastRing) / 1.2);
    else bellSwing = 0;
    bell.rotation.z = Math.sin(stage.t * 18) * 0.22 * bellSwing;
    // pulses: a bright bead running each way round the ribbon
    live = stage.pulses.filter((q) => q.age < 0.6);
    while (pulseMeshes.length < live.length * 2) {
      const pm = new THREE.Mesh(m.pulseGeo, new THREE.MeshBasicMaterial({ color: "#fff3d6" }));
      root.add(pm);
      pulseMeshes.push(pm);
    }
    pulseMeshes.forEach((pm, i) => {
      const q = live[i >> 1];
      pm.visible = !!q;
      if (!q) return;
      const u = q.u + (i & 1 ? 1 : -1) * q.age;
      pm.position.fromArray(ribbonPoint(((u % 1) + 1) % 1));
      pm.scale.setScalar(1.6 - q.age * 1.5);
    });
    // a flash for each thing that happened, in its player's colour
    for (const e of fresh) {
      const c = e.by ? colourOf(e.by) : e.object && orbit.colour[e.object] !== undefined ? hexOf(e.object) : "#fff";
      if (e.kind === "top") flashes.flash("floor", e.pos, "#fff1dc", STAGE_R);
      else if (e.kind === "home") continue;
      else if (e.kind === "ring") flashes.flash("ring", BELL.pos, c, 0.45);
      else if (e.kind === "catch") flashes.flash("halo", e.pos, hexOf(e.object), 0.26);
      else if (e.kind === "knock") flashes.flash("halo", e.pos, "#ffffff", 0.22);
      else if (e.kind === "fling" || e.kind === "hop" || e.kind === "throw") flashes.flash("halo", e.pos, c, 0.24);
      else if (e.kind === "pluck") flashes.flash("halo", e.pos, c, 0.2);
    }
    flashes.step();
    return fresh;
  }

  /** Every object's mesh by id, for touch, claim rings and the browser
   * check. */
  const objects = () => ({ ribbon, bell, ...balls });

  /**
   * What the reticle can rest on, in the stage's own frame: balls (each
   * `{ id, c, r }`) and a ray test for anything that isn't one. `skip` is
   * the object in your hand. Returns the nearest `{ id, t, point }` along
   * the ray (origin and unit dir in the stage's frame) within `reach`, or
   * null; `nearestHit` is walk.js's ray-to-ball test.
   */
  function aim(origin, dir, reach, skip, nearestHit) {
    const targets = [];
    for (const id of SPHERES) {
      const b = balls[id];
      if (id === skip || !b.visible) continue;
      targets.push({ id, kind: "sphere", c: [b.position.x, b.position.y, b.position.z], r: orbit.sphereR * 1.35 });
    }
    targets.push({ id: "bell", kind: "sphere", c: [...BELL.pos], r: BELL.r * 1.35 });
    let best = nearestHit(origin, dir, targets, reach);
    // the ribbon: the nearest point of its path within a hand's width of
    // the line of sight. It loops round the bell and spheres, so it only
    // wins over one the dot is on when it's clearly in front of it
    const before = best ? best.t - 0.3 : reach;
    for (const { q } of RIBBON_PATH) {
      const px = q[0] - origin[0], py = q[1] - origin[1], pz = q[2] - origin[2];
      const t = px * dir[0] + py * dir[1] + pz * dir[2];
      if (t < 0 || t > before || (best?.id === "ribbon" && t >= best.t)) continue;
      const dx = px - dir[0] * t, dy = py - dir[1] * t, dz = pz - dir[2] * t;
      if (dx * dx + dy * dy + dz * dz < 0.08 * 0.08) best = { id: "ribbon", t, point: [q[0], q[1], q[2]] };
    }
    return best;
  }

  /** Where the reticle's halo goes on what it rests on (stage frame) and
   * how big it is. */
  function haloOf(id, point) {
    if (balls[id]) return { c: balls[id].position.toArray(), r: orbit.sphereR * 1.45 };
    if (id === "bell") return { c: [...BELL.pos], r: BELL.r * 1.9 };
    return { c: point, r: 0.09 };
  }

  /**
   * What a quick press on `id` (released before it was picked up) plays:
   * a gesture without `at`, or null. `point` is where the reticle touched
   * it, in the stage's frame. A sphere hops; the ribbon is plucked there;
   * the bell rings.
   */
  function press(id, point) {
    if (balls[id]) return { kind: "throw", object: id, from: balls[id].position.toArray().map((x) => Number(x.toFixed(3))), v: [0, 1.4, 0] };
    if (id === "ribbon") {
      let best = 0;
      let bestD = Infinity;
      for (const { u, q } of RIBBON_PATH) {
        const d = (q[0] - point[0]) ** 2 + (q[1] - point[1]) ** 2 + (q[2] - point[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      return { kind: "pluck", object: "ribbon", u: Number(best.toFixed(3)) };
    }
    if (id === "bell") return { kind: "tap", object: "bell" };
    return null;
  }

  function dispose() {
    flashes.dispose();
    for (const s of Object.values(shadows)) s.material.dispose();
    for (const pm of pulseMeshes) pm.material.dispose();
  }

  // A sphere stepped at 60 Hz may sit still for a frame on a faster
  // screen, so "moved" holds for a moment after the last change.
  const moving = () => flashes.busy() || live.length > 0 || bellSwing > 0 || performance.now() - movedAt < 60;

  /** For the browser check's `stage` section: points of the fixed objects
   * to aim at, in the stage frame. */
  const marks = () => ({ ribbon: ribbonPoint(0.125), bell: [...BELL.pos] });

  return { root, update, objects, aim, haloOf, press, marks, dispose, busy: flashes.busy, moving };
}
