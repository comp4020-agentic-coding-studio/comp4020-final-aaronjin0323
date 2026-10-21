// Turns a recipe id and its numbers into a Three.js group, and moves it.
// Nothing here talks to the server or keeps state between frames: a
// sculpture's pose at time t comes only from its saved parameters and t, so
// two screens with the same shared clock show the same phase (CLAUDE.md,
// "Animation is never a write").
//
//   const g = buildSculpture("loop", parts);   // parts as in a StateEvent
//   animate(g, t);                              // t: shared seconds
//   disposeSculpture(g);                        // when it's replaced
import * as THREE from "three";
import { PALETTE, RECIPES } from "./recipes.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const hex = (i) => new THREE.Color((PALETTE[i] ?? PALETTE[0]).hex);

// A small deterministic hash, so motes and the like scatter the same way on
// every screen without Math.random.
const hash = (i, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const glass = (colour, opts = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: hex(colour).lerp(new THREE.Color("#ffffff"), 0.35),
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: 0.6,
    ior: 1.45,
    attenuationColor: hex(colour),
    attenuationDistance: 1.2,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    specularIntensity: 1,
    envMapIntensity: 1.2,
    ...opts,
  });

const satin = (colour, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: hex(colour), metalness: 0.15, roughness: 0.42, ...opts });

// Chrome is the one colour that reads as metal rather than paint.
const finish = (colour, opts = {}) =>
  PALETTE[colour]?.name === "chrome" || PALETTE[colour]?.name === "gold"
    ? new THREE.MeshStandardMaterial({ color: hex(colour), metalness: 0.95, roughness: 0.16, ...opts })
    : satin(colour, opts);

const mesh = (geometry, material) => {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Wraps a part in its transform (lift, turn, scale) and an inner group the
 * animator moves, so motion never fights the saved transform. */
function partShell(partId, p, baseY = 0) {
  const outer = new THREE.Group();
  outer.name = partId;
  outer.position.y = baseY + p.lift;
  outer.rotation.y = p.turn * DEG;
  outer.scale.setScalar(p.scale);
  const inner = new THREE.Group();
  outer.add(inner);
  return { outer, inner };
}

// ---------- Loop & Lantern ----------

/** A closed, looping path around the cube: a circle that dips and rises
 * `turns` times, with its reach breathing in and out. */
class LoopCurve extends THREE.Curve {
  constructor(turns, reach) {
    super();
    this.turns = turns;
    this.reach = reach;
  }
  getPoint(u, target = new THREE.Vector3()) {
    const a = u * TAU;
    const r = this.reach * (1 + 0.22 * Math.cos(this.turns * a + Math.PI / 2));
    return target.set(r * Math.cos(a), 0.42 * this.reach * Math.sin(this.turns * a), r * Math.sin(a));
  }
}

/** A tube flattened into a ribbon whose face turns `twist` half-turns along
 * its length: TubeGeometry for the path and frames, then each ring squashed
 * along a frame axis that rotates as it goes. Half-turns that don't add up
 * to a whole leave a Möbius seam, which suits an impossible museum. */
function ribbonGeometry(curve, twist, width = 0.16, flat = 0.22) {
  const tubular = 260;
  const radial = 12;
  const geo = new THREE.TubeGeometry(curve, tubular, width, radial, true);
  const pos = geo.attributes.position;
  const centre = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u % 1, centre);
    const N = geo.normals[i % tubular];
    const B = geo.binormals[i % tubular];
    const th = twist * Math.PI * u;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      d.fromBufferAttribute(pos, k).sub(centre);
      const dn = d.dot(N);
      const db = d.dot(B);
      // into the rotated frame, flatten one axis, back out
      const x = c * dn + s * db;
      const y = (-s * dn + c * db) * flat;
      const n2 = c * x - s * y;
      const b2 = s * x + c * y;
      pos.setXYZ(k, centre.x + N.x * n2 + B.x * b2, centre.y + N.y * n2 + B.y * b2, centre.z + N.z * n2 + B.z * b2);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function buildLoop(parts, animators) {
  const root = new THREE.Group();
  const CENTRE = 1.25;

  const r = parts.ribbon;
  const ribbon = partShell("ribbon", r, CENTRE);
  ribbon.inner.add(mesh(ribbonGeometry(new LoopCurve(r.turns, r.radius), r.twist), finish(r.colour, { side: THREE.DoubleSide, roughness: 0.3, metalness: 0.25 })));
  animators.push((t) => {
    ribbon.inner.rotation.y = t * r.speed * 0.45;
  });
  root.add(ribbon.outer);

  const c = parts.cube;
  const cube = partShell("cube", c, CENTRE);
  const box = mesh(new THREE.BoxGeometry(c.size, c.size, c.size, 1, 1, 1), glass(c.colour));
  box.castShadow = false;
  // The lantern: a warm core inside the glass, lit from within.
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(c.size * 0.2, 2),
    new THREE.MeshStandardMaterial({ color: "#fff1d6", emissive: "#ffc48a", emissiveIntensity: 2.2, roughness: 0.4 }),
  );
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: hex(c.colour).lerp(new THREE.Color("#ffffff"), 0.6), transparent: true, opacity: 0.55 }));
  const tilted = new THREE.Group();
  tilted.rotation.set(c.tilt * DEG, 0, c.tilt * 0.6 * DEG);
  tilted.add(box, edges);
  cube.inner.add(tilted, core);
  animators.push((t) => {
    cube.inner.rotation.y = t * c.spin * 0.6;
  });
  root.add(cube.outer);

  const s = parts.spheres;
  const orbs = partShell("spheres", s, CENTRE);
  const ball = new THREE.SphereGeometry(s.size, 28, 18);
  const balls = [];
  for (let i = 0; i < s.count; i++) {
    const m = mesh(ball, finish(s.colour));
    balls.push(m);
    orbs.inner.add(m);
  }
  animators.push((t) => {
    balls.forEach((m, i) => {
      const a = t * 0.35 + (i / s.count) * TAU;
      m.position.set(Math.cos(a) * s.orbit, Math.sin(t * 1.1 + i * 1.7) * s.bob * 0.35 + (i % 2 ? 0.15 : -0.15), Math.sin(a) * s.orbit);
    });
  });
  root.add(orbs.outer);
  return root;
}

// ---------- Arch Totem ----------

function buildArches(parts, animators) {
  const root = new THREE.Group();
  const st = parts.stack;
  const stack = partShell("stack", st);
  let y = 0;
  const blocks = [];
  for (let i = 0; i < st.segments; i++) {
    const w = 0.78 * (1 - (st.taper * i) / Math.max(1, st.segments));
    // alternate a rounded drum and a squared block, for a playful rhythm
    const g = i % 2 === 0 ? new THREE.BoxGeometry(w, st.height, w) : new THREE.CylinderGeometry(w * 0.55, w * 0.6, st.height, 40);
    const m = mesh(g, finish(st.colour, { roughness: 0.55 }));
    m.position.y = y + st.height / 2;
    m.rotation.y = i * 0.4;
    y += st.height + 0.02;
    blocks.push(m);
    stack.inner.add(m);
  }
  const top = y;
  animators.push((t) => {
    blocks.forEach((m, i) => (m.rotation.y = i * 0.4 + Math.sin(t * 0.4 + i) * 0.12));
  });
  root.add(stack.outer);

  const ar = parts.arch;
  const arch = partShell("arch", ar, top * 0.55);
  const arches = [];
  for (let i = 0; i < ar.count; i++) {
    const g = new THREE.TorusGeometry(ar.span / 2, 0.07, 18, 64, Math.PI);
    const m = mesh(g, finish(ar.colour, { roughness: 0.35 }));
    const holder = new THREE.Group();
    holder.rotation.y = (i / ar.count) * Math.PI;
    holder.add(m);
    arches.push(m);
    arch.inner.add(holder);
  }
  animators.push((t) => {
    arches.forEach((m, i) => (m.rotation.z = Math.sin(t * 0.7 + i * 1.3) * ar.sway * 0.35));
  });
  root.add(arch.outer);

  const h = parts.halo;
  const halo = partShell("halo", h, top + 0.45);
  const ring = mesh(new THREE.TorusGeometry(h.radius, h.thickness, 20, 96), finish(h.colour));
  const tilt = new THREE.Group();
  tilt.rotation.x = Math.PI / 2 - h.tilt * DEG;
  tilt.add(ring);
  halo.inner.add(tilt);
  animators.push((t) => {
    halo.inner.rotation.y = t * 0.3;
    halo.inner.position.y = Math.sin(t * 0.9) * 0.06;
  });
  root.add(halo.outer);
  return root;
}

// ---------- Glass Bloom ----------

function buildBloom(parts, animators) {
  const root = new THREE.Group();
  const st = parts.stem;
  const stem = partShell("stem", st);
  const tip = new THREE.Vector3(st.bend * 0.7, st.height, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-st.bend * 0.2, st.height * 0.55, 0), tip);
  stem.inner.add(mesh(new THREE.TubeGeometry(curve, 48, 0.055, 12, false), finish(st.colour, { roughness: 0.3 })));
  const leaf = mesh(new THREE.SphereGeometry(0.5, 20, 12), finish(st.colour, { roughness: 0.4 }));
  leaf.scale.set(0.28, 0.035, 0.12);
  leaf.position.copy(curve.getPoint(0.35)).add(new THREE.Vector3(0.12, 0, 0));
  leaf.rotation.z = 0.5;
  stem.inner.add(leaf);
  animators.push((t) => {
    stem.inner.rotation.z = Math.sin(t * 0.55) * 0.03 * (0.4 + st.bend);
  });
  root.add(stem.outer);

  // The petals sit where the stem ends, wherever its transform puts it.
  const tipWorld = tip.clone().multiplyScalar(st.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), st.turn * DEG);
  tipWorld.y += st.lift;
  const pe = parts.petals;
  const petals = partShell("petals", pe);
  petals.outer.position.add(tipWorld);
  const petalGeo = new THREE.SphereGeometry(0.5, 32, 16);
  const mat = glass(pe.colour, { thickness: 0.3, attenuationDistance: 0.6 });
  const pitches = [];
  for (let i = 0; i < pe.count; i++) {
    const around = new THREE.Group();
    around.rotation.y = (i / pe.count) * TAU;
    const pitch = new THREE.Group();
    const m = new THREE.Mesh(petalGeo, mat);
    m.scale.set(0.26, 0.05, pe.length * 0.62);
    m.position.z = pe.length * 0.3;
    pitch.add(m);
    around.add(pitch);
    pitches.push(pitch);
    petals.inner.add(around);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), new THREE.MeshStandardMaterial({ color: "#ffe6b8", emissive: "#f6b38e", emissiveIntensity: 1.4 }));
  petals.inner.add(heart);
  animators.push((t) => {
    const breathe = Math.sin(t * 0.6) * 0.07;
    pitches.forEach((p, i) => (p.rotation.x = -(0.15 + pe.curl * 1.05) + breathe + Math.sin(t * 0.8 + i) * 0.02));
  });
  root.add(petals.outer);

  const mo = parts.motes;
  const motes = partShell("motes", mo);
  const moteGeo = new THREE.SphereGeometry(0.035, 10, 8);
  const moteMat = new THREE.MeshStandardMaterial({ color: hex(mo.colour), emissive: hex(mo.colour), emissiveIntensity: 0.9 });
  const dots = [];
  for (let i = 0; i < mo.count; i++) {
    const m = new THREE.Mesh(moteGeo, moteMat);
    dots.push(m);
    motes.inner.add(m);
  }
  const span = 2.6;
  animators.push((t) => {
    dots.forEach((m, i) => {
      const a = hash(i) * TAU + t * 0.12 * (hash(i, 3) - 0.5);
      const r = mo.spread * (0.35 + 0.65 * hash(i, 1));
      const rise = (hash(i, 2) * span + t * (0.08 + mo.drift * 0.35)) % span;
      m.position.set(Math.cos(a) * r, 0.2 + rise, Math.sin(a) * r);
      m.scale.setScalar(Math.sin((rise / span) * Math.PI) * 0.9 + 0.1);
    });
  });
  root.add(motes.outer);
  return root;
}

const BUILDERS = { loop: buildLoop, arches: buildArches, bloom: buildBloom };

/**
 * A sculpture as a Three.js group, from a recipe id and every part's numbers.
 * Unknown recipes give an empty group rather than throwing, so a page that
 * meets a recipe it doesn't know still draws everything else.
 * @param {string} recipeId
 * @param {Record<string, Record<string, number>>} parts
 * @returns {THREE.Group}
 */
export function buildSculpture(recipeId, parts) {
  const group = new THREE.Group();
  const animators = [];
  group.userData.animators = animators;
  group.userData.recipe = recipeId;
  const build = Object.hasOwn(BUILDERS, recipeId) ? BUILDERS[recipeId] : null;
  if (!build || !parts) return group;
  // Fill any missing number with its default, so a partial payload still draws.
  const full = {};
  for (const [partId, part] of Object.entries(RECIPES[recipeId].parts)) {
    full[partId] = {};
    for (const [key, p] of Object.entries(part.params)) full[partId][key] = parts[partId]?.[key] ?? p.default;
  }
  group.add(build(full, animators));
  animate(group, 0);
  return group;
}

/** Poses a sculpture at shared time t (seconds). Pure: same t, same pose. */
export function animate(group, t) {
  for (const f of group.userData.animators ?? []) f(t);
}

/** Frees a sculpture's GPU memory once it's been replaced. */
export function disposeSculpture(group) {
  const seen = new Set();
  group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!seen.has(m)) {
        seen.add(m);
        m.dispose();
      }
    }
  });
}
