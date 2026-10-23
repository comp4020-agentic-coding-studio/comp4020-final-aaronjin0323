// The Swap Doors set's look, touch, buttons and sounds (ADR 18): two open
// door frames, coral and teal, each with a soft glowing membrane in its
// opening, and three bouncy balls, played by public/sets/doors.js. A ball
// through a door flashes in its colour at both doors and goes "whoop"; a
// door turned clunks. A set view plug-in (public/sets/README.md). Never
// imports Three.js (it's handed THREE), so the page reads the buttons
// without WebGL.
import { PALETTE } from "../stage.js";
import doors, { BALLS, BALL_R, DOORS, DOOR_AT, FACINGS, FRAME, shotInto } from "./doors.js";
import { createFlashes, createPlayer } from "./shared-view.js";

const hexOf = (id) => PALETTE[doors.colour[id]]?.hex ?? "#ccc";
const doorWord = (id) => (id === "coraldoor" ? "coral" : "teal");

/** A short name for an object, in a sentence: "the plum ball". */
export const nameOf = (id) => (BALLS.includes(id) ? `the ${id} ball` : DOORS.includes(id) ? `the ${doorWord(id)} door` : id);

/** The set row's icon: two door frames, a ball between them. */
export const icon =
  '<path d="M3 20V6h6v14M15 20V6h6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.2" fill="currentColor"/>';

const doorIcon = (id) => `<path d="M6 21V4h12v17" fill="none" stroke="${hexOf(id)}" stroke-width="2.6" stroke-linejoin="round"/><rect x="8.5" y="6.5" width="7" height="14" rx="1" fill="${hexOf(id)}" opacity="0.3"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`;

/** The stage card's gesture buttons, in tab order: one per object. */
export const buttons = [
  ...BALLS.map((id) => ({ gesture: `throw:${id}`, label: `Throw the ${id} ball`, ball: hexOf(id) })),
  ...DOORS.map((id) => ({ gesture: `tap:${id}`, label: `Turn the ${doorWord(id)} door`, icon: doorIcon(id) })),
];
export const heldLabel = (id, who) => `Take the ${id} ball from ${who} and throw it`;

// a door's facing as shown (eighths), whole: what a throw aims through
const facingNow = (shown) => Object.fromEntries(DOORS.map((id) => [id, ((Math.round(shown.doors[id].turn) % FACINGS) + FACINGS) % FACINGS]));

/**
 * A button's gesture at loop moment `at`, from the stage as shown now. A
 * throw lobs the ball from where it is into the door that faces it best;
 * a door's button turns it.
 * @returns {Record<string, any>}
 */
export function fromButton(kind, object, at, shown) {
  if (kind === "throw") {
    const from = shown.balls[object].pos.map((x) => Number(x.toFixed(3)));
    return { kind, object, at, from, v: shotInto(from, facingNow(shown)) };
  }
  return { kind, object, at };
}

/** The colours of a performance for a thumbnail: what its gestures
 * touched, in order; a quiet loop shows both doors. */
export const swatch = (p) => (p.gestures.length ? [...new Set(p.gestures.map((g) => g.object))] : DOORS).map(hexOf);

/** What a held ball looks like in a hand, or null. */
export function held(id) {
  if (!BALLS.includes(id)) return null;
  return { r: BALL_R, colour: hexOf(id), metalness: 0.05, roughness: 0.38 };
}

// ---- sounds

// a note of one pentatonic scale per ball, so passes make a little tune
const NOTE = { apricot: 523.25, lemon: 659.25, plum: 392 };
/** @param {any[]} events @param {(o: object) => void} tone */
export function sounds(events, tone) {
  for (const e of events) {
    const f = NOTE[e.object] ?? 440;
    if (e.kind === "enter") tone({ freq: f * 0.75, dur: 0.2, gain: 0.13, slide: 2, type: "sine" });
    else if (e.kind === "exit") tone({ freq: f * 1.5, dur: 0.24, gain: 0.12, slide: 0.5, type: "sine", delay: 0.07 });
    else if (e.kind === "bounce") tone({ freq: f * 2, dur: 0.05, gain: Math.min(0.1, 0.025 * (e.speed ?? 1)), type: "triangle", slide: 0.8 });
    else if (e.kind === "knock") tone({ freq: f * 1.5, dur: 0.07, gain: 0.12, type: "triangle", slide: 0.7 });
    else if (e.kind === "throw") tone({ freq: f * 0.5, dur: 0.16, gain: 0.08, slide: 1.6 });
    else if (e.kind === "turn") {
      // a door turning: a wooden clunk
      tone({ freq: 140, dur: 0.16, gain: 0.2, type: "square", slide: 0.6 });
      tone({ freq: 90, dur: 0.22, gain: 0.16, slide: 0.8, delay: 0.03 });
    }
  }
}

// ---- the 3D view

/** A door frame: two posts and a lintel as one U-shaped extrusion. */
function frameGeometry(THREE, small) {
  const o = FRAME.half + FRAME.bar;
  const i = FRAME.half - FRAME.bar;
  const top = FRAME.H + FRAME.bar;
  const inner = FRAME.H - FRAME.bar;
  const s = new THREE.Shape();
  s.moveTo(-o, 0);
  s.lineTo(-o, top);
  s.lineTo(o, top);
  s.lineTo(o, 0);
  s.lineTo(i, 0);
  s.lineTo(i, inner);
  s.lineTo(-i, inner);
  s.lineTo(-i, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: FRAME.bar * 2, bevelEnabled: !small, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
  g.translate(0, 0, -FRAME.bar);
  return g;
}

/** The membrane's soft glow: bright in the middle, fading to the frame. */
function glowTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 36, 4, 32, 36, 40);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0.2)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shared = null;
function materials(THREE) {
  if (shared) return shared;
  const glow = glowTexture(THREE);
  const base = {
    frames: Object.fromEntries(DOORS.map((id) => [id, new THREE.MeshStandardMaterial({ color: hexOf(id), roughness: 0.42, metalness: 0.15 })])),
    balls: Object.fromEntries(BALLS.map((id) => [id, new THREE.MeshStandardMaterial({ color: hexOf(id), roughness: held(id).roughness, metalness: held(id).metalness })])),
    glow,
    membraneGeo: new THREE.PlaneGeometry((FRAME.half - FRAME.bar) * 2, FRAME.H - FRAME.bar),
  };
  shared = {
    ...base,
    frameGeo: frameGeometry(THREE, false),
    ballGeo: new THREE.SphereGeometry(BALL_R, 28, 18),
    shadowGeo: new THREE.CircleGeometry(1, 28),
  };
  // fewer facets for a plinth (0.4 scale)
  shared.small = { ...base, frameGeo: frameGeometry(THREE, true), ballGeo: new THREE.SphereGeometry(BALL_R, 12, 8), shadowGeo: new THREE.CircleGeometry(1, 12) };
  return shared;
}

// How long a door takes to swing to its new facing, on screen (s).
const SWING = 0.35;
// a door's facing in eighths as shown: easing from where it was to where
// it is over SWING after a tap
function shownTurn(d) {
  const k = Math.min(1, Math.max(0, d.age / SWING));
  const e = k * k * (3 - 2 * k);
  let delta = (((d.turn - d.was) % FACINGS) + FACINGS) % FACINGS;
  if (delta > FACINGS / 2) delta -= FACINGS;
  return d.was + delta * e;
}

/**
 * A performance on a holder group (the view interface, README.md).
 * @param {any} THREE @param {{ small?: boolean }} [opts]
 */
export function createView(THREE, { small = false } = {}) {
  const m = small ? materials(THREE).small : materials(THREE);
  const root = new THREE.Group();
  const frames = {};
  const membranes = {};
  for (const id of DOORS) {
    const g = new THREE.Group();
    g.position.fromArray(DOOR_AT[id]);
    const frame = new THREE.Mesh(m.frameGeo, m.frames[id]);
    frame.userData.object = id;
    const mat = new THREE.MeshBasicMaterial({ color: hexOf(id), map: m.glow, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
    const mem = new THREE.Mesh(m.membraneGeo, mat);
    mem.position.y = (FRAME.H - FRAME.bar) / 2;
    mem.userData.object = id;
    mem.renderOrder = 2;
    g.add(frame, mem);
    g.userData.object = id;
    root.add(g);
    frames[id] = g;
    membranes[id] = { mesh: mem, glow: 0, at: -Infinity };
  }
  const balls = {};
  const shadows = {};
  for (const id of BALLS) {
    const b = new THREE.Mesh(m.ballGeo, m.balls[id]);
    b.userData.object = id;
    const s = new THREE.Mesh(m.shadowGeo, new THREE.MeshBasicMaterial({ color: "#3a2a40", transparent: true, opacity: 0.2, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.004;
    root.add(b, s);
    balls[id] = b;
    shadows[id] = s;
  }
  const flashGroup = new THREE.Group();
  root.add(flashGroup);
  const flashes = createFlashes(THREE, flashGroup);
  const play = createPlayer();
  const lastPos = {};
  const lastTurn = {};
  let movedAt = -Infinity;
  let swinging = false;

  // a door group turned to `turn` eighths: its local +z (the front) along
  // the facing (cos, sin) in the stage's x-z plane
  const face = (g, turn) => {
    const a = (turn / FACINGS) * Math.PI * 2;
    g.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
  };

  function update(p, t, { colourOf = (_tag) => "#ffffff", held = /** @type {string[]} */ ([]), still = false } = {}) {
    const { stage, events: fresh } = play(p, t, still);
    const now = performance.now();
    for (const id of BALLS) {
      const s = stage.balls[id];
      const b = balls[id];
      b.visible = !held.includes(id);
      const was = lastPos[id];
      if (!was || was[0] !== s.pos[0] || was[1] !== s.pos[1] || was[2] !== s.pos[2]) {
        lastPos[id] = s.pos;
        if (was) movedAt = now;
      }
      b.position.fromArray(s.pos);
      const sh = shadows[id];
      sh.visible = b.visible;
      sh.position.set(s.pos[0], 0.004, s.pos[2]);
      const k = Math.max(0.35, 1 - s.pos[1] / 2.4);
      sh.scale.setScalar(BALL_R * 1.3 * k);
      sh.material.opacity = 0.24 * k;
    }
    swinging = false;
    for (const id of DOORS) {
      const d = stage.doors[id];
      const turn = shownTurn(d);
      if (d.age < SWING) swinging = true;
      if (lastTurn[id] !== undefined && lastTurn[id] !== turn) movedAt = now;
      lastTurn[id] = turn;
      face(frames[id], turn);
    }
    for (const e of fresh) {
      const c = e.by ? colourOf(e.by) : doors.colour[e.object] !== undefined ? hexOf(e.object) : "#fff";
      if (e.kind === "top") flashes.flash("floor", e.pos, "#fff1dc", 2);
      else if (e.kind === "home") continue;
      else if (e.kind === "enter" || e.kind === "exit") {
        // the ball's colour, at both doors, and the membrane brightens
        flashes.flash("halo", e.pos, hexOf(e.object), 0.26);
        const mb = membranes[e.door];
        if (mb) {
          mb.glow = 1;
          mb.at = now;
          mb.mesh.material.color.set(hexOf(e.object));
        }
      } else if (e.kind === "turn") flashes.flash("ring", [e.pos[0], 0.02, e.pos[2]], c, 0.5);
      else if (e.kind === "throw") flashes.flash("halo", e.pos, c, 0.18);
      else if (e.kind === "knock") flashes.flash("halo", e.pos, "#ffffff", 0.16);
      else if (e.kind === "bounce" && e.speed > 2 && e.pos[1] < 0.05) flashes.flash("ring", e.pos, hexOf(e.object), 0.12);
    }
    // a membrane glows bright for a moment, back to its own colour
    for (const id of DOORS) {
      const mb = membranes[id];
      if (mb.glow > 0) {
        mb.glow = Math.max(0, 1 - (now - mb.at) / 600);
        if (mb.glow === 0) mb.mesh.material.color.set(hexOf(id));
      }
      mb.mesh.material.opacity = 0.42 + 0.45 * mb.glow;
    }
    flashes.step();
    return fresh;
  }

  const objects = () => ({ ...frames, ...balls });

  /** Reticle: a ball first (small, so it wins when hit at all), else the
   * door whose frame or opening the ray meets first. */
  function aim(origin, dir, reach, skip, nearestHit) {
    const targets = [];
    for (const id of BALLS) {
      const b = balls[id];
      if (id === skip || !b.visible) continue;
      targets.push({ id, kind: "sphere", c: [b.position.x, b.position.y, b.position.z], r: BALL_R * 1.8 });
    }
    const ball = nearestHit(origin, dir, targets, reach);
    if (ball) return ball;
    let best = null;
    for (const id of DOORS) {
      const g = frames[id];
      const c = DOOR_AT[id];
      // the door's plane: normal is its front, sideways is along it
      const n = [Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)];
      const side = [n[2], 0, -n[0]];
      const den = dir[0] * n[0] + dir[2] * n[2];
      if (Math.abs(den) < 1e-6) continue;
      const t = ((c[0] - origin[0]) * n[0] + (c[2] - origin[2]) * n[2]) / den;
      if (t < 0 || t > reach || (best && best.t <= t)) continue;
      const q = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      const lat = (q[0] - c[0]) * side[0] + (q[2] - c[2]) * side[2];
      if (Math.abs(lat) > FRAME.half + FRAME.bar + 0.05 || q[1] < 0 || q[1] > FRAME.H + FRAME.bar + 0.05) continue;
      best = { id, t, point: q };
    }
    return best;
  }

  function haloOf(id, point) {
    if (balls[id]) return { c: balls[id].position.toArray(), r: BALL_R * 1.9 };
    if (frames[id]) return { c: [DOOR_AT[id][0], FRAME.H / 2, DOOR_AT[id][2]], r: 0.58 };
    return { c: point, r: 0.1 };
  }

  /** A quick press: a ball hops straight up; a door turns. */
  function press(id, _point) {
    if (balls[id]) return { kind: "throw", object: id, from: balls[id].position.toArray().map((x) => Number(x.toFixed(3))), v: [0, 2.6, 0] };
    if (frames[id]) return { kind: "tap", object: id };
    return null;
  }

  function dispose() {
    flashes.dispose();
    for (const s of Object.values(shadows)) s.material.dispose();
    for (const mb of Object.values(membranes)) mb.mesh.material.dispose();
  }

  const moving = () => flashes.busy() || swinging || Object.values(membranes).some((mb) => mb.glow > 0) || performance.now() - movedAt < 60;

  /** For the browser check: a point on each door's lintel to aim at. */
  const marks = () => Object.fromEntries(DOORS.map((id) => [id, [DOOR_AT[id][0], FRAME.H * 0.6, DOOR_AT[id][2]]]));

  return { root, update, objects, aim, haloOf, press, marks, dispose, busy: flashes.busy, moving };
}
