// The Chime Tree's look, touch, buttons and sounds (ADR 18): a ring of
// hanging tubes on a light three-legged frame, and a gold striker on a
// cord from the hub, played by public/sets/chimes.js. A set view plug-in
// (public/sets/README.md). Never imports Three.js (it's handed THREE), so
// the page reads the buttons, names and sounds without WebGL.
import { PALETTE } from "../stage.js";
import chimes, { CHIMES, HANG, NOTES, STRIKER_REST, TREE, chimeEnd } from "./chimes.js";
import { createFlashes, createPlayer } from "./shared-view.js";

const hexOf = (id) => PALETTE[chimes.colour[id]]?.hex ?? "#ccc";
const NOTE_NAME = { do: "C", re: "D", mi: "E", so: "G", la: "A", hido: "high C" };
const isChime = (id) => CHIMES.includes(id);

/** "the striker", "the G chime"; any other id unchanged. */
export const nameOf = (id) => (id === "striker" ? "the striker" : isChime(id) ? `the ${NOTE_NAME[id]} chime` : id);

/** The set row's icon: three tubes of falling length under a bar. */
export const icon =
  '<path d="M4 4h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5.5" y="6" width="3" height="14" rx="1.5" fill="currentColor"/><rect x="10.5" y="6" width="3" height="11" rx="1.5" fill="currentColor"/><rect x="15.5" y="6" width="3" height="8" rx="1.5" fill="currentColor"/>';

// a chime's button: a tube in its colour, longer for a lower note
const tubeIcon = (id, i) => {
  const h = Math.round(18 - i * 2.2);
  return `<path d="M5 3h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="9" y="4.5" width="6" height="${h}" rx="3" fill="${hexOf(id)}" stroke="currentColor" stroke-width="1.2"/>`;
};

/** The stage card's gesture buttons, in tab order: the striker, then the
 * chimes low to high. */
export const buttons = [
  { gesture: "throw:striker", label: "Swing the striker", ball: hexOf("striker") },
  ...CHIMES.map((id, i) => ({ gesture: `tap:${id}`, label: `Ring the ${NOTE_NAME[id]} chime`, icon: tubeIcon(id, i) })),
];
export const heldLabel = (_id, who) => `Take the striker from ${who} and swing it`;

const r3 = (x) => Number(x.toFixed(3));

/**
 * A button's gesture at loop moment `at`, from the stage as shown now. The
 * striker is drawn out from where it hangs and swung round the ring (the
 * way round turns with the loop moment, so two presses aren't the same).
 * @returns {Record<string, any>}
 */
export function fromButton(kind, object, at, _shown) {
  if (kind === "throw") {
    const a = (at / 30) * Math.PI * 2 * 3;
    const c = Math.cos(a), s = Math.sin(a);
    return { kind, object, at, from: [r3(0.5 * c), 1.4, r3(0.5 * s)], v: [r3(-2.4 * s), 0.3, r3(2.4 * c)] };
  }
  return { kind, object, at };
}

/** A performance's thumbnail colours: what its gestures touched, in
 * order; a quiet loop shows the striker and a chime. */
export const swatch = (p) => (p.gestures.length ? [...new Set(p.gestures.map((g) => g.object))] : ["striker", "so"]).map(hexOf);

/** The striker in a hand: heavy polished gold. */
export const held = (id) => (id === "striker" ? { r: TREE.strikerR, colour: hexOf("striker"), metalness: 0.9, roughness: 0.18 } : null);

// ---- sounds

/** @param {any[]} events @param {(o: object) => void} tone */
export function sounds(events, tone) {
  for (const e of events) {
    if (e.kind === "chime") {
      // a struck tube: the note, its octave, and a bright inharmonic ping
      // that fades first; louder the harder it swings
      const f = NOTES[CHIMES.indexOf(e.object)] ?? 660;
      const g = 0.05 + 0.16 * (e.power ?? 0.5);
      tone({ freq: f, dur: 2.2, gain: g });
      tone({ freq: f * 2, dur: 1.1, gain: g * 0.22 });
      tone({ freq: f * 2.76, dur: 0.45, gain: g * 0.1, type: "triangle" });
    } else if (e.kind === "strike") tone({ freq: 190, dur: 0.06, gain: 0.12, type: "triangle", slide: 0.6 });
    else if (e.kind === "throw") tone({ freq: 240, dur: 0.22, gain: 0.05, slide: 1.6 });
  }
}

// ---- the 3D view

// several geometries into one (non-indexed, positions and normals), so
// the whole frame is one draw call
function merged(THREE, parts) {
  const pos = [];
  const nor = [];
  for (const { geo, m } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// a rod from a to b, as a cylinder's matrix
function rod(THREE, a, b, r, around) {
  const A = new THREE.Vector3().fromArray(a), B = new THREE.Vector3().fromArray(b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(r, r, len, around, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return { geo, m: new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) };
}

// the frame: three slim legs from the floor up to the ring, three spokes
// to the hub the striker hangs from, the ring and the hub
function frameGeometry(THREE, around) {
  const parts = [];
  const I = new THREE.Matrix4();
  const N = CHIMES.length;
  for (let k = 0; k < 3; k++) {
    const a = ((k + 0.5 / (N / 3)) / 3) * Math.PI * 2 + Math.PI / N;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push(rod(THREE, [1.12 * c, 0, 1.12 * s], [TREE.ringR * c, TREE.ringY, TREE.ringR * s], 0.022, around));
    parts.push(rod(THREE, [TREE.ringR * c, TREE.ringY, TREE.ringR * s], [0, TREE.pivot[1], 0], 0.016, around));
    // a foot
    const foot = new THREE.CylinderGeometry(0.06, 0.07, 0.03, around);
    parts.push({ geo: foot, m: new THREE.Matrix4().makeTranslation(1.12 * c, 0.015, 1.12 * s) });
  }
  const ring = new THREE.TorusGeometry(TREE.ringR, 0.018, Math.max(4, around / 2), around * 4);
  parts.push({ geo: ring, m: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, TREE.ringY, 0) });
  parts.push({ geo: new THREE.SphereGeometry(0.05, around, Math.max(4, around / 2)), m: I.clone().makeTranslation(0, TREE.pivot[1], 0) });
  return merged(THREE, parts);
}

let shared = null;
function materials(THREE) {
  if (shared) return shared;
  const tube = (i, around) => {
    const g = new THREE.CylinderGeometry(TREE.tubeR, TREE.tubeR, HANG[i].len, around, 1, false);
    return g;
  };
  shared = {
    frame: new THREE.MeshStandardMaterial({ color: "#8a6a4a", roughness: 0.55, metalness: 0.25 }),
    tubes: CHIMES.map((id, i) => new THREE.MeshStandardMaterial({ color: hexOf(id), metalness: 0.2 + (0.7 * i) / (CHIMES.length - 1), roughness: 0.4 - (0.25 * i) / (CHIMES.length - 1) })),
    striker: new THREE.MeshStandardMaterial({ color: hexOf("striker"), metalness: 0.9, roughness: 0.18 }),
    cord: new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 0.8 }),
    frameGeo: frameGeometry(THREE, 12),
    tubeGeo: CHIMES.map((_, i) => tube(i, 16)),
    ballGeo: new THREE.SphereGeometry(TREE.strikerR, 28, 18),
    cordGeo: new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true).translate(0, -0.5, 0),
    shadowGeo: new THREE.CircleGeometry(1, 28),
  };
  shared.small = {
    ...shared,
    frameGeo: frameGeometry(THREE, 6),
    tubeGeo: CHIMES.map((_, i) => tube(i, 8)),
    ballGeo: new THREE.SphereGeometry(TREE.strikerR, 14, 9),
    shadowGeo: new THREE.CircleGeometry(1, 14),
  };
  return shared;
}

/** A Chime Tree performance on a holder group (README.md's view
 * interface). `small` builds it with fewer facets, for a plinth.
 * @param {any} THREE @param {{ small?: boolean }} [opts] */
export function createView(THREE, { small = false } = {}) {
  const m = small ? materials(THREE).small : materials(THREE);
  const root = new THREE.Group();
  const frame = new THREE.Mesh(m.frameGeo, m.frame);
  frame.userData.object = "frame";
  root.add(frame);
  // each chime swings about its top, round the ring's outward line
  const hangers = [];
  const tubes = {};
  CHIMES.forEach((id, i) => {
    const g = new THREE.Group();
    g.position.fromArray(HANG[i].top);
    const t = new THREE.Mesh(m.tubeGeo[i], m.tubes[i]);
    t.userData.object = id;
    // the tube's centre is its position, so the probe sees it swing
    t.position.y = -HANG[i].len / 2;
    g.add(t);
    root.add(g);
    hangers.push(g);
    tubes[id] = t;
  });
  const outAxis = HANG.map((h) => new THREE.Vector3().fromArray(h.out));
  const striker = new THREE.Mesh(m.ballGeo, m.striker);
  striker.userData.object = "striker";
  const cord = new THREE.Mesh(m.cordGeo, m.cord);
  cord.userData.object = "striker";
  cord.position.fromArray(TREE.pivot);
  const shadow = new THREE.Mesh(m.shadowGeo, new THREE.MeshBasicMaterial({ color: "#3a2a40", transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  root.add(striker, cord, shadow);
  const flashGroup = new THREE.Group();
  root.add(flashGroup);
  const flashes = createFlashes(THREE, flashGroup);
  const play = createPlayer();
  const down = new THREE.Vector3(0, -1, 0);
  const pivot = new THREE.Vector3().fromArray(TREE.pivot);
  const tmp = new THREE.Vector3();
  let lastKey = "";
  let movedAt = -Infinity;

  function update(p, t, { colourOf = (_tag) => "#ffffff", held = /** @type {string[]} */ ([]), still = false } = {}) {
    const { stage, events: fresh } = play(p, t, still);
    const sw = stage.swing;
    sw.forEach((th, i) => hangers[i].quaternion.setFromAxisAngle(outAxis[i], -th));
    const s = stage.striker;
    striker.position.fromArray(s);
    const inHand = held.includes("striker");
    striker.visible = !inHand;
    // the cord: from the hub to the striker (to rest while it's in a hand)
    tmp.fromArray(inHand ? STRIKER_REST : s).sub(pivot);
    const len = tmp.length();
    cord.scale.set(1, len, 1);
    cord.quaternion.setFromUnitVectors(down, tmp.normalize());
    shadow.visible = striker.visible;
    shadow.position.set(s[0], 0.005, s[2]);
    const k = Math.max(0.35, 1 - s[1] / 2.6);
    shadow.scale.setScalar(TREE.strikerR * 1.5 * k);
    shadow.material.opacity = 0.22 * k;
    const key = `${s.join()}|${sw.join()}|${inHand}`;
    if (key !== lastKey) {
      if (lastKey) movedAt = performance.now();
      lastKey = key;
    }
    for (const e of fresh) {
      const c = e.by && !isChime(e.by) && e.by !== "striker" ? colourOf(e.by) : e.object && chimes.colour[e.object] !== undefined ? hexOf(e.object) : "#fff";
      if (e.kind === "top") flashes.flash("floor", e.pos, "#fff1dc", 2);
      else if (e.kind === "chime") flashes.flash("halo", e.pos, c, 0.12 + 0.14 * (e.power ?? 0.5));
      else if (e.kind === "strike") flashes.flash("halo", e.pos, "#ffffff", 0.14);
      else if (e.kind === "throw") flashes.flash("halo", e.pos, c, 0.2);
    }
    flashes.step();
    return fresh;
  }

  const objects = () => ({ striker, ...tubes });

  // the tubes as a row of balls along each, for the reticle
  function aim(origin, dir, reach, skip, nearestHit) {
    const targets = [];
    if (skip !== "striker" && striker.visible) targets.push({ id: "striker", kind: "sphere", c: striker.position.toArray(), r: TREE.strikerR * 1.4 });
    CHIMES.forEach((id, i) => {
      for (let f = 0.1; f <= 1; f += 0.15) {
        tmp.set(0, -HANG[i].len * f, 0).applyQuaternion(hangers[i].quaternion).add(hangers[i].position);
        targets.push({ id, kind: "sphere", c: tmp.toArray(), r: 0.075 });
      }
    });
    return nearestHit(origin, dir, targets, reach);
  }

  function haloOf(id, point) {
    if (id === "striker") return { c: striker.position.toArray(), r: TREE.strikerR * 1.6 };
    return { c: point, r: 0.11 };
  }

  // a quick press: a chime rings; the striker gets a gentle push round
  function press(id, _point) {
    if (isChime(id)) return { kind: "tap", object: id };
    if (id === "striker") {
      const p = striker.position;
      const rr = Math.hypot(p.x, p.z);
      const tx = rr > 0.05 ? -p.z / rr : 1, tz = rr > 0.05 ? p.x / rr : 0;
      return { kind: "throw", object: "striker", from: [r3(p.x), r3(p.y), r3(p.z)], v: [r3(tx * 1.8), 0.2, r3(tz * 1.8)] };
    }
    return null;
  }

  function dispose() {
    flashes.dispose();
    shadow.material.dispose();
  }

  const moving = () => flashes.busy() || performance.now() - movedAt < 60;

  /** Fixed points for the browser check: each chime's middle at rest,
   * and the hub. */
  const marks = () => ({ hub: [...TREE.pivot], ...Object.fromEntries(CHIMES.map((id, i) => [id, chimeEnd(i, 0).map((x, k) => (x + HANG[i].top[k]) / 2)])) });

  return { root, update, objects, aim, haloOf, press, marks, dispose, busy: flashes.busy, moving };
}
