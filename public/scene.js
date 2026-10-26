// The gallery in 3D: a round floor floating above sunset clouds, stone
// arches on pillars, six plinths in a ring, each playing a performance, and
// the stage at the centre where visitors play together (ADR 16), seen in
// first person (ADR 17): the camera is your eyes, you walk by the rules in
// walk.js, and the reticle in the middle of the view is your hand. Touching
// an object on the stage is a gesture: the scene works out which
// (onGesture) and the page sends it. Every control also lives in the DOM
// (app.js); other visitors are drawn by avatars.js.
// Loaded with a dynamic import, so if WebGL or the CDN is missing the page
// carries on without it.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLIDE, LOOP, STAGE, THROW, VISITOR_COLOURS, gestureMoment, isHoldable, loopMoment, setOf } from "./stage.js";
import { createStageView } from "./stageview.js";
import { heldLook, viewOf } from "./sets/views.js";
import { aimHint, clearFrame } from "./ui-logic.js";
import { EYE, REACH, START, clampPitch, collide, forward, lookDir, nearestHit, plinthNear, standBefore, step, throwVelocity } from "./walk.js";
import { createAvatars } from "./avatars.js";

const TAU = Math.PI * 2;
const PLINTH_R = 5.4;
const FLOOR_R = 8.6;
const PLINTH_H = 1.0;
// a performance on a plinth, scaled so its flying room fits the plinth top
const ON_PLINTH = 0.4;

const C = {
  ivory: "#f4ead8",
  ivoryDeep: "#e6d6bb",
  peach: "#f6b38e",
  coral: "#ef6f5e",
  teal: "#3fa7a3",
  deepTeal: "#1f6f78",
  chrome: "#c9d1d6",
  dusk: "#7a6aa8",
};

const slotAngle = (slot) => ((slot - 1) / 6) * TAU + Math.PI / 6;
const slotPos = (slot) => new THREE.Vector3(Math.sin(slotAngle(slot)) * PLINTH_R, 0, Math.cos(slotAngle(slot)) * PLINTH_R);

// The low sun, off to the side of the opening view: it sets the sky's glow,
// the warm key light and the long shadows together.
const SUN_DIR = new THREE.Vector3(-0.9, 0.42, -0.2).normalize();

/** A soft sunset: peach at the horizon, rose, then lavender overhead. */
function skyDome() {
  const geo = new THREE.SphereGeometry(400, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#a99cd0") },
      mid: { value: new THREE.Color("#d8b8d2") },
      low: { value: new THREE.Color("#f8d0b8") },
      glow: { value: new THREE.Color("#fff0dc") },
      sun: { value: SUN_DIR.clone().setY(0.1).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    // colours arrive in linear space; the include encodes them for the
    // screen, or the sunset comes out dark and oversaturated
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 glow; uniform vec3 sun;
      varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(low, mid, smoothstep(-0.02, 0.22, h));
        c = mix(c, top, smoothstep(0.2, 0.75, h));
        c = mix(c, low, smoothstep(0.0, -0.3, h));
        float s = max(dot(normalize(vDir), sun), 0.0);
        c = mix(c, glow, pow(s, 12.0) * 0.6 + pow(s, 3.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** Three layers of cloud below the floor, each further, lower, flatter and
 * hazier than the last: lilac in shadow, peach where the low sun meets them. */
function clouds() {
  const group = new THREE.Group();
  // a puff far off, under haze, needs few facets: the near layer keeps
  // more (1400 puffs at detail 3 were 450k triangles a frame)
  const puffs = { near: new THREE.IcosahedronGeometry(1, 2), far: new THREE.IcosahedronGeometry(1, 1) };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const layers = [
    { count: 70, r: [13, 48], y: -7, size: [3, 6], flat: 0.5, color: "#fff0e6", shade: "#8f7cbc", haze: 0.12 },
    { count: 110, r: [46, 150], y: -14, size: [7, 13], flat: 0.42, color: "#fde3da", shade: "#9a8ac6", haze: 0.18 },
    { count: 100, r: [150, 320], y: -26, size: [14, 26], flat: 0.34, color: "#f4dbe2", shade: "#a99ad2", haze: 0.26 },
  ];
  for (const L of layers) {
    const mat = new THREE.MeshStandardMaterial({ color: L.color, roughness: 1, metalness: 0, emissive: L.shade, emissiveIntensity: L.haze });
    // each cloud a heap of puffs: a big one in the middle, smaller ones
    // round and on top, so they read as billows, not flat discs
    const per = 5;
    const inst = new THREE.InstancedMesh(L.y > -10 ? puffs.near : puffs.far, mat, L.count * per);
    let k = 0;
    for (let i = 0; i < L.count; i++) {
      const a = rnd() * TAU;
      const r = L.r[0] + Math.pow(rnd(), 0.8) * (L.r[1] - L.r[0]);
      const sz = L.size[0] + rnd() * (L.size[1] - L.size[0]);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = L.y - rnd() * sz * 0.4;
      for (let j = 0; j < per; j++) {
        const t = j === 0 ? 1 : 0.45 + rnd() * 0.4;
        const ang = rnd() * TAU;
        const off = j === 0 ? 0 : sz * (0.6 + rnd() * 0.5);
        const lift = j === 0 ? 0 : sz * (0.1 + rnd() * 0.35) * L.flat * 2;
        m.compose(
          new THREE.Vector3(cx + Math.cos(ang) * off, cy + lift, cz + Math.sin(ang) * off),
          q,
          new THREE.Vector3(sz * t * 1.2, sz * t * L.flat * 1.3, sz * t * 1.1),
        );
        inst.setMatrixAt(k++, m);
      }
    }
    inst.userData.cloudLayer = L.y;
    group.add(inst);
  }
  return group;
}

/** The far horizon: a band of warm haze where the cloud sea meets the sky. */
function horizon() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(250,214,196,0)");
  g.addColorStop(0.55, "rgba(250,214,196,0.85)");
  g.addColorStop(1, "rgba(236,204,220,1)");
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(370, 370, 90, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  band.position.y = -52;
  band.userData.horizon = true;
  return band;
}

/** A few small islands drifting in the distance, each a faceted rock with a
 * mossy top and a cypress or a tiny ivory folly. */
function islands() {
  const group = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: "#dcb6a0", roughness: 0.95, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: "#b4c49a", roughness: 0.9 });
  const cypress = new THREE.MeshStandardMaterial({ color: "#6f9a7e", roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.85 });
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots = [
    { p: [-12, 9, -70], s: 3.2, folly: true },
    { p: [34, 7, -78], s: 4.2, folly: false },
    { p: [-70, -2, 18], s: 5, folly: true },
    { p: [58, 1.5, 34], s: 2.4, folly: false },
  ];
  for (const { p, s, folly } of spots) {
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(1, 2.2, 7, 2);
    const pos = cone.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 1.09) pos.setXYZ(i, pos.getX(i) * (0.85 + rnd() * 0.3), pos.getY(i), pos.getZ(i) * (0.85 + rnd() * 0.3));
    cone.computeVertexNormals();
    const body = new THREE.Mesh(cone, rock);
    body.rotation.x = Math.PI;
    body.position.y = -1.1;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1, 0.22, 24), moss);
    top.position.y = 0.11;
    g.add(body, top);
    if (folly) {
      for (const x of [-0.32, 0.32]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.6, 10), stone);
        col.position.set(x, 0.52, 0);
        g.add(col);
      }
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 20, Math.PI), stone);
      arc.position.y = 0.82;
      g.add(arc);
    } else {
      for (const [x, z, h] of [[-0.3, 0.1, 0.9], [0.1, -0.2, 1.2], [0.4, 0.25, 0.7]]) {
        const tree = new THREE.Mesh(new THREE.ConeGeometry(0.14, h, 10), cypress);
        tree.position.set(x, 0.22 + h / 2, z);
        g.add(tree);
      }
    }
    g.scale.setScalar(s);
    g.position.set(...p);
    g.rotation.y = rnd() * TAU;
    g.userData.island = p[1];
    group.add(g);
  }
  return group;
}

/** A soft round shadow laid on the floor under something standing on it. */
const contactTexture = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(90,60,70,0.55)");
    g.addColorStop(0.55, "rgba(90,60,70,0.28)");
    g.addColorStop(1, "rgba(90,60,70,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();
function contactShadow(radius, mat = new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false })) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  m.renderOrder = 1;
  m.userData.contact = true;
  m.userData.flat = true;
  return m;
}

function floor() {
  const g = new THREE.Group();
  // the floating platform: a rounded slab that tapers to a point underneath
  const top = new THREE.Mesh(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R, 0.35, 96), new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.8 }));
  top.position.y = -0.175;
  top.receiveShadow = true;
  g.add(top);
  const under = new THREE.Mesh(new THREE.ConeGeometry(FLOOR_R * 0.98, 4.8, 96, 1, true), new THREE.MeshStandardMaterial({ color: "#e9c9b0", roughness: 0.9, side: THREE.DoubleSide }));
  under.rotation.x = Math.PI;
  under.position.y = -0.35 - 2.4;
  g.add(under);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(FLOOR_R, 0.09, 12, 128), new THREE.MeshStandardMaterial({ color: C.coral, roughness: 0.4, metalness: 0.2 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.01;
  g.add(lip);
  // inlaid rings in a deeper ivory, like a terrazzo floor
  for (const [r, w, col] of [
    [1.9, 0.05, C.peach],
    [3.2, 0.03, C.ivoryDeep],
    [PLINTH_R, 0.9, C.ivoryDeep],
  ]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - w / 2, r + w / 2, 128), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    ring.receiveShadow = true;
    g.add(ring);
  }
  return g;
}

/** Sixteen stone pillars round the rim, each pair carrying a solid arch
 * that spans between them along the ring. */
const ARCH_THICK = 0.36;
function arches() {
  const g = new THREE.Group();
  const n = 16;
  const R = FLOOR_R - 0.45;
  const H = 2.4; // the pillar, base to the top of its capital
  const half = R * Math.sin(Math.PI / n); // half the span between pillar centres
  const inset = R * Math.cos(Math.PI / n);
  // the arch's face: a half ring, extruded into a deep stone band
  const face = new THREE.Shape();
  const ro = half + ARCH_THICK / 2;
  const ri = half - ARCH_THICK / 2;
  face.absarc(0, 0, ro, 0, Math.PI, false);
  face.lineTo(-ri, 0);
  face.absarc(0, 0, ri, Math.PI, 0, true);
  face.lineTo(ro, 0);
  const archGeo = new THREE.ExtrudeGeometry(face, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 40 });
  archGeo.translate(0, 0, -0.25);
  const shaftGeo = new THREE.CylinderGeometry(0.3, 0.34, H - 0.5, 24);
  const baseGeo = new THREE.BoxGeometry(0.86, 0.26, 0.86);
  const capGeo = new THREE.BoxGeometry(0.8, 0.24, 0.8);
  // one stone and one trim material for the whole ring; each bay's shaft
  // and arch merged into one mesh (kept per bay so raycasts still cull bay
  // by bay), and every base and capital into one: seventeen draw calls
  // instead of sixty-four
  const mat = new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: C.ivoryDeep, roughness: 0.85 });
  const shade = new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false });
  const trimParts = [];
  const place = (geo, x, y, z, ry) => geo.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
  // ExtrudeGeometry is non-indexed and grouped, the cylinders and boxes
  // indexed: bring every part to the same plain shape before merging
  const strip = (geo) => {
    const out = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(out.attributes)) if (!["position", "normal", "uv"].includes(k)) out.deleteAttribute(k);
    out.clearGroups();
    return out;
  };
  const bays = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const bay = new THREE.Group();
    const px = Math.sin(a) * R, pz = Math.cos(a) * R;
    trimParts.push(place(baseGeo, px, 0.13, pz, a), place(capGeo, px, H - 0.12, pz, a));
    const foot = contactShadow(0.85, shade);
    foot.position.set(px, 0.006, pz);
    // the arch to the next pillar, tangent to the ring, its feet on the
    // two capitals
    const mid = a + Math.PI / n;
    const arc = new THREE.Object3D();
    arc.position.set(Math.sin(mid) * inset, H, Math.cos(mid) * inset);
    arc.rotation.y = mid;
    arc.updateMatrix();
    const stone = new THREE.Mesh(mergeGeometries([place(shaftGeo, px, 0.26 + (H - 0.5) / 2, pz, a), archGeo.clone().applyMatrix4(arc.matrix)].map(strip)), mat);
    stone.castShadow = true;
    stone.receiveShadow = true;
    bay.add(stone, foot);
    // points along the curve, for telling when a frame cuts through it
    const curve = [...Array(9)].map((_, k) => new THREE.Vector3(Math.cos((k / 8) * Math.PI) * half, Math.sin((k / 8) * Math.PI) * half, 0).applyMatrix4(arc.matrix));
    const feet = [curve[0], curve[8]];
    const top = new THREE.Vector3(px, H, pz);
    bay.userData = { angle: mid, mid: arc.position.clone(), curve, feet, top };
    bays.push(bay);
    g.add(bay);
  }
  const trims = new THREE.Mesh(mergeGeometries(trimParts.map(strip)), trim);
  trims.castShadow = true;
  trims.receiveShadow = true;
  g.add(trims);
  g.userData.bays = bays;
  g.userData.R = R;
  g.userData.H = H;
  g.userData.thick = ARCH_THICK;
  return g;
}

function plinth(slot) {
  const g = new THREE.Group();
  g.position.copy(slotPos(slot));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.9, PLINTH_H, 48), new THREE.MeshStandardMaterial({ color: "#f8f0e2", roughness: 0.78 }));
  body.position.y = PLINTH_H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.805, 0.805, 0.08, 48), new THREE.MeshStandardMaterial({ color: C.chrome, metalness: 0.95, roughness: 0.18 }));
  band.position.y = PLINTH_H - 0.12;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.8, 0.06, 48), new THREE.MeshStandardMaterial({ color: C.coral, roughness: 0.45 }));
  top.position.y = PLINTH_H + 0.03;
  top.receiveShadow = true;
  // a numbered disc on the floor in front, facing the centre
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshStandardMaterial({ map: numberTexture(slot), roughness: 0.6 }));
  plate.rotation.x = -Math.PI / 2;
  const inward = slotPos(slot).normalize().multiplyScalar(-1.15);
  plate.position.set(inward.x, 0.01, inward.z);
  plate.rotation.z = Math.atan2(inward.x, inward.z) + Math.PI;
  plate.userData.flat = true;
  g.add(body, band, top, plate, contactShadow(1.35));
  g.userData.pick = `slot:${slot}`;
  for (const m of [body, band, top]) m.userData.pick = `slot:${slot}`;
  const holder = new THREE.Group();
  holder.position.y = PLINTH_H + 0.06;
  holder.scale.setScalar(ON_PLINTH);
  g.add(holder);
  // warm exhibit light from above
  const spot = new THREE.SpotLight("#ffd6aa", 14, 7, 0.42, 0.65, 1.6);
  spot.position.set(0, 5.4, 0);
  spot.target = holder;
  g.add(spot);
  return { group: g, holder, top, spot };
}

function numberTexture(n) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = C.coral;
  x.beginPath();
  x.arc(64, 64, 62, 0, TAU);
  x.fill();
  x.fillStyle = C.ivory;
  x.font = "bold 76px system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The stage at the centre: a wide round glass top on a stone drum, as
 * big as the space every set plays in, with a faint ring of light at the
 * wall things bounce off. */
function bench() {
  const g = new THREE.Group();
  const R = STAGE.radius;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.3, 0.55, 72), new THREE.MeshStandardMaterial({ color: "#f8efe0", roughness: 0.78 }));
  base.position.y = 0.275;
  base.castShadow = true;
  base.receiveShadow = true;
  const glassTop = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.1, 72),
    // teal glass without transmission, which would draw the whole scene a
    // second time every frame: see-through by opacity, glossy by clearcoat
    // and the room's reflections
    new THREE.MeshPhysicalMaterial({ color: "#62bdb5", emissive: C.teal, emissiveIntensity: 0.18, transparent: true, opacity: 0.68, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, ior: 1.4, envMapIntensity: 1.3 }),
  );
  glassTop.position.y = 0.6;
  glassTop.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.13, 0.035, 10, 120), new THREE.MeshStandardMaterial({ color: C.chrome, metalness: 0.95, roughness: 0.15 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.65;
  for (const m of [base, glassTop, ring]) m.userData.pick = "bench";
  g.add(base, glassTop, ring, contactShadow(R + 0.7));
  const holder = new THREE.Group();
  holder.position.y = 0.66;
  g.add(holder);
  // where the wall is: a faint glowing band the spheres bounce off
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 0.5, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: "#fff1dc", transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  wall.position.y = 0.25;
  holder.add(wall);
  const ghost = new THREE.Group();
  ghost.visible = false;
  const leases = new THREE.Group();
  holder.add(leases);
  return { group: g, holder, ghost, leases };
}

/** A few sculptural plants: a pot and stacked rounded shapes. */
function plants() {
  const g = new THREE.Group();
  const pot = new THREE.MeshStandardMaterial({ color: C.coral, roughness: 0.5 });
  const potAlt = new THREE.MeshStandardMaterial({ color: C.deepTeal, roughness: 0.45 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#5d9c7f", roughness: 0.55 });
  const leafWarm = new THREE.MeshStandardMaterial({ color: "#86b07a", roughness: 0.55 });
  // between plinths, and never straight behind the bench from the opening
  // view (yaw 0), where a plant would read as part of the sculpture
  const spots = [1, 5, 2].map((k) => (k / 6) * TAU);
  spots.forEach((a, i) => {
    const p = new THREE.Group();
    const r = PLINTH_R + 1.6;
    p.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.6, 32), i % 2 ? potAlt : pot);
    vase.position.y = 0.3;
    vase.castShadow = true;
    p.add(vase);
    if (i === 0) {
      // a stacked cactus of capsules
      for (const [x, y, s, rz] of [
        [0, 1.0, 1, 0],
        [0.32, 1.35, 0.6, -0.5],
        [-0.28, 1.15, 0.55, 0.6],
      ]) {
        const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * s, 0.7 * s, 8, 20), leaf);
        c.position.set(x, y, 0);
        c.rotation.z = rz;
        c.castShadow = true;
        p.add(c);
      }
    } else if (i === 1) {
      // a topiary of three spheres
      for (const [y, s] of [
        [0.95, 0.42],
        [1.6, 0.32],
        [2.08, 0.22],
      ]) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(s, 32, 20), leafWarm);
        b.position.y = y;
        b.castShadow = true;
        p.add(b);
      }
    } else {
      // a fan of long flat leaves
      for (let k = 0; k < 7; k++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), leaf);
        l.scale.set(0.16, 0.9, 0.05);
        l.position.y = 1.1;
        l.rotation.set(0, (k / 7) * Math.PI, (k - 3) * 0.2);
        l.castShadow = true;
        p.add(l);
      }
    }
    g.add(p);
  });
  return g;
}

export async function createScene(canvas, { reducedMotion, time, onPick, covers = () => [], onMoved = () => {}, onGesture = () => {}, onEvents = () => {}, onPose = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // 1.5 is as sharp as the eye tells apart in a soft pastel room, at
  // little more than half the pixels of 2
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Only the room casts the sun's shadows, and the room never moves: the
  // shadow map is drawn once, on the first frame, not every frame (the
  // spheres' shadows are the soft blobs each set's view lays under them).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#efcfcf", 90, 420);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const rim = arches();
  // the sky, the clouds and the floor are the backdrop: never in the way
  const sky = skyDome();
  const backdrop = [sky, horizon(), clouds(), islands(), floor()];
  for (const b of backdrop) b.userData.backdrop = true;
  scene.add(...backdrop, rim, plants());

  // a cool lavender fill from the sky, warm bounce from the floor and clouds
  const ambientFill = new THREE.HemisphereLight("#c9c6f2", "#f2cdb8", 1.05);
  scene.add(ambientFill);
  // the warm low sun, from the side of the opening view: long soft shadows,
  // a bright edge on stone, highlights on chrome, light through the glass
  const sun = new THREE.DirectionalLight("#ffc896", 2.8);
  sun.position.copy(SUN_DIR).multiplyScalar(22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 6;
  scene.add(sun);
  const benchGlow = new THREE.PointLight("#ffd0a8", 5, 6, 1.8);
  benchGlow.position.set(0, 3.2, 0);
  scene.add(benchGlow);

  const plinths = new Map();
  for (let s = 1; s <= 6; s++) {
    const p = plinth(s);
    plinths.set(s, p);
    scene.add(p.group);
  }
  const wb = bench();
  scene.add(wb.group);
  const avatars = createAvatars(scene);

  // ---- the camera is your eyes (ADR 17): where you stand and look
  const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 900);
  camera.rotation.order = "YXZ";
  const me = { at: [...START.at], look: [...START.look] };
  let glide = null; // { from, to, t0, dur }
  // The part of the canvas nobody's panel covers, in canvas px: reported to
  // the browser check; the view itself is centred on the canvas, where the
  // reticle is.
  let clear = { x: 0, y: 0, w: 1, h: 1 };
  // whether the visitor has walked or turned away from the start
  let moved = false;
  const setMoved = (m) => {
    if (m === moved) return;
    moved = m;
    onMoved(m);
  };
  const placeCamera = () => {
    camera.position.set(me.at[0], EYE, me.at[1]);
    camera.rotation.set(me.look[1], me.look[0], 0);
    camera.updateMatrixWorld();
  };

  function applyClear() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const r = canvas.getBoundingClientRect();
    clear = clearFrame({ x: r.left, y: r.top, w, h }, covers());
    if (clear.w < 40 || clear.h < 40) clear = { x: 0, y: 0, w, h };
    camera.aspect = w / h;
    // a portrait view (the phone) needs a taller lens to see the stage
    camera.fov = w / h < 1 ? 70 : 58;
    camera.updateProjectionMatrix();
  }
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    applyClear();
    wake();
  };
  new ResizeObserver(resize).observe(canvas);

  const box = new THREE.Box3();
  // what the stage's on-screen box is measured from, in its holder's frame:
  // where the play mostly is, on any set: the middle of the stage, low
  const STAGE_BOX = new THREE.Box3(new THREE.Vector3(-1.4, 0.05, -1.4), new THREE.Vector3(1.4, 1.5, 1.4));

  // ---- measuring what the camera shows, for the browser check
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const v3 = new THREE.Vector3();
  // The meshes that could get in the way: everything but the backdrop,
  // the floor plates and the target itself (with its plinth or bench).
  function obstacles(skip) {
    const out = [];
    const walk = (o) => {
      if (o === skip || o.userData.backdrop || o.userData.flat || o.userData.avatar) return;
      if (!o.visible && !o.userData.mats) return;
      if (o.isMesh) out.push(o);
      for (const c of o.children) walk(c);
    };
    walk(scene);
    return out;
  }
  const meshesOf = (root) => {
    const out = [];
    root.traverse((o) => o.isMesh && o.visible && out.push(o));
    return out;
  };
  function targetOf(t) {
    const holder = t === "bench" ? wb.holder : plinths.get(t).holder;
    const root = t === "bench" ? wb.group : plinths.get(t).group;
    holder.updateMatrixWorld();
    box.makeEmpty();
    if (holder.children.length) box.copy(STAGE_BOX).applyMatrix4(holder.matrixWorld);
    if (box.isEmpty()) {
      const c = t === "bench" ? new THREE.Vector3(0, 0.66, 0) : slotPos(t).setY(PLINTH_H);
      box.set(c.clone().add(new THREE.Vector3(-0.6, 0, -0.6)), c.clone().add(new THREE.Vector3(0.6, 1.3, 0.6)));
    }
    const meshes = meshesOf(holder);
    if (!meshes.length && t !== "bench") meshes.push(plinths.get(t).top);
    return { box: box.clone(), meshes, skip: root };
  }
  const corners = (b) => [...Array(8)].map((_, i) => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
  function screenRect(c, b) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of corners(b)) {
      if (v3.copy(p).applyMatrix4(c.matrixWorldInverse).z > -0.05) return null; // behind the lens
      p.project(c);
      const sx = ((p.x + 1) / 2) * w;
      const sy = ((1 - p.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const castAt = (c, sx, sy) => {
    ndc.set((sx / canvas.clientWidth) * 2 - 1, -(sy / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, c);
  };
  const NEAR = 1.8;
  /** What camera `c` shows of a target: its rect on the canvas, the share
   * of rays to it that hit something else first, the share of the clear
   * view taken by something near the lens, and arches the top edge cuts. */
  function measure(c, target, obs, grid = 5) {
    const rect = screenRect(c, target.box);
    if (!rect) return null;
    const all = [...target.meshes, ...obs];
    const mine = new Set(target.meshes);
    let occ = 0, vis = 0;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        castAt(c, rect.x + ((i + 0.5) / grid) * rect.w, rect.y + ((j + 0.5) / grid) * rect.h);
        const hits = ray.intersectObjects(all, false);
        const first = hits.findIndex((hh) => mine.has(hh.object));
        if (first === 0) vis++;
        else if (first > 0) occ++;
      }
    }
    let near = 0, rays = 0;
    const gx = grid + 1, gy = grid - 1;
    for (let i = 0; i < gx; i++) {
      for (let j = 0; j < gy; j++) {
        castAt(c, clear.x + ((i + 0.5) / gx) * clear.w, clear.y + ((j + 0.5) / gy) * clear.h);
        rays++;
        const hit = ray.intersectObjects(obs, false)[0];
        if (hit && hit.distance < NEAR) near++;
      }
    }
    // An arch is cut when part of its curve is in the picture and part
    // runs off the top edge or behind the lens.
    let cuts = 0;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const bay of rim.userData.bays) {
      let shown = 0, gone = 0;
      for (const p of bay.userData.curve) {
        if (v3.copy(p).applyMatrix4(c.matrixWorldInverse).z > -0.1) { gone++; continue; }
        v3.copy(p).project(c);
        const x = ((v3.x + 1) / 2) * w;
        const y = ((1 - v3.y) / 2) * h;
        if (y < 0) gone++;
        else if (x >= 0 && x <= w && y <= h) shown++;
      }
      if (shown && gone) cuts++;
    }
    return { rect, occluded: occ + vis ? occ / (occ + vis) : 1, near: near / rays, cuts };
  }

  // the stage's frame, in world space: its holder sits on the bench, at
  // y 0.66, unrotated and unscaled
  const stageFrame = () => {
    wb.holder.updateMatrixWorld();
    return wb.holder.matrixWorld;
  };
  const toStage = (v) => v.clone().applyMatrix4(stageFrame().clone().invert());
  const r3 = (a) => a.map((x) => Number(x.toFixed(3)));

  // ---- the reticle: what your hand would touch, straight ahead
  const reticleEl = canvas.parentElement?.querySelector("[data-reticle]") ?? null;
  const hintEl = canvas.parentElement?.querySelector("[data-aim-hint]") ?? null;
  const touchScreen = matchMedia("(hover: none) and (pointer: coarse)");
  let reticle = null; // { id, point: [x, y, z] (world), local: (stage frame), t }
  // The set's view says what the dot can rest on (its `aim`), in the
  // stage's own frame: the holder is only lifted, never turned or scaled.
  function aim() {
    if (!stageView || !playable) return null;
    const lift = wb.holder.position.y;
    const origin = [me.at[0], EYE - lift, me.at[1]];
    const dir = lookDir(me.look);
    const hit = stageView.view().aim(origin, dir, REACH, holding, nearestHit);
    if (!hit) return null;
    return { id: hit.id, t: hit.t, local: hit.point, point: [hit.point[0], hit.point[1] + lift, hit.point[2]] };
  }
  // a soft halo round what the reticle rests on
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.4, side: THREE.BackSide, depthWrite: false }));
  halo.visible = false;
  halo.renderOrder = 4;
  scene.add(halo);
  function showReticle() {
    halo.visible = !!reticle;
    if (reticle) {
      const h = stageView.view().haloOf(reticle.id, reticle.local);
      halo.position.fromArray(h.c).applyMatrix4(stageFrame());
      halo.scale.setScalar(h.r);
    }
    const on = reticle ? reticle.id : "";
    if (reticleEl && reticleEl.dataset.on !== on) {
      if (on) reticleEl.dataset.on = on;
      else delete reticleEl.dataset.on;
    }
    // and how to touch it, in the set's own words (ADR 19)
    if (hintEl) {
      const id = holding ?? reticle?.id ?? null;
      const text = aimHint(viewOf(liveSet())?.buttons ?? [], id, { holdable: canHold(id), holding, touch: touchScreen.matches });
      if (hintEl.textContent !== text) hintEl.textContent = text;
      hintEl.hidden = !text;
    }
  }

  // ---- the hand: hold to pick up what the set lets you hold, release to
  // throw it where you look; a quick press plays whatever the set's view
  // says (`press`: Orbit hops a sphere, plucks the ribbon, rings the bell).
  // The scene only says what the gesture was (onGesture); the page sends it.
  const HOLD_MS = 180;
  let press = null; // { object, point, t0 }
  let holding = null; // the object floating in front of you
  const heldBall = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.2 }));
  heldBall.visible = false;
  scene.add(heldBall);
  const liveSet = () => last?.draft.parts?.set ?? "";
  const canHold = (id) => !!id && isHoldable(liveSet(), id);
  // held in your right hand: ahead, a little low and to the right, so it
  // never covers the reticle you aim with
  const heldPoint = () => {
    const d = lookDir(me.look);
    const right = [-d[2], 0, d[0]];
    const n = Math.hypot(right[0], right[2]) || 1;
    return [me.at[0] + d[0] * 0.8 + (right[0] / n) * 0.32, EYE - 0.3 + d[1] * 0.8, me.at[1] + d[2] * 0.8 + (right[2] / n) * 0.32];
  };
  function pressHand() {
    if (!playable || press) return;
    const t = reticle;
    press = { object: t?.id ?? null, point: t?.local ?? null, t0: performance.now() };
    if (canHold(press.object)) onGesture({ kind: "grab", object: press.object });
    if (press.object) canvas.dataset.touching = press.object;
    wake();
  }
  function releaseHand() {
    const p = press;
    press = null;
    delete canvas.dataset.touching;
    if (!p || !p.object) return;
    const at = gestureMoment(loopMoment(drawTime()));
    if (holding && holding === p.object) {
      // thrown where you look, harder the longer you held; from where it
      // floated, kept inside the stage's room (less the held thing's size)
      const r = heldLook(holding)?.r ?? 0.17;
      const local = toStage(new THREE.Vector3().fromArray(heldPoint()));
      const R = STAGE.radius - r;
      const rr = Math.hypot(local.x, local.z);
      if (rr > R) {
        local.x *= R / rr;
        local.z *= R / rr;
      }
      local.y = THREE.MathUtils.clamp(local.y, r, STAGE.ceiling - r);
      const vm = THROW.vMax - 0.1;
      const v = throwVelocity(lookDir(me.look), performance.now() - p.t0).map((x) => THREE.MathUtils.clamp(x, -vm, vm));
      onGesture({ kind: "throw", object: p.object, at, from: r3(local.toArray()), v });
    } else if (stageView) {
      // a quick press: whatever the set's view says it plays
      const g = stageView.view().press(p.object, p.point);
      if (g) onGesture({ ...g, at });
    }
    if (holding === p.object) {
      holding = null;
      heldBall.visible = false;
    }
    wake();
  }

  // ---- looking and walking
  const LOOK_K = 0.0024; // radians per pixel of mouse
  const DRAG_K = 0.005; // per pixel of finger or unlocked drag
  function turn(dyaw, dpitch) {
    glide = null;
    me.look[0] += dyaw;
    me.look[1] = clampPitch(me.look[1] + dpitch);
    wake();
  }
  const locked = () => document.pointerLockElement === canvas;
  let lockBroken = false; // this browser refused pointer lock: drag to look
  let unlockedAt = 0;
  function requestLock() {
    if (lockBroken || locked() || !canvas.requestPointerLock) return;
    try {
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === "function") r.catch(() => (lockBroken = true));
    } catch {
      lockBroken = true;
    }
  }
  document.addEventListener("pointerlockerror", () => (lockBroken = true));
  document.addEventListener("pointerlockchange", () => {
    canvas.dataset.locked = locked() ? "1" : "";
    // the how-to-move hint has done its job
    if (locked()) document.body.dataset.fpUsed = "1";
    if (!locked()) {
      unlockedAt = performance.now();
      if (press) releaseHand();
    }
    wake();
  });
  // Escape that only let go of the mouse isn't also "back to the stage"
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && (locked() || performance.now() - unlockedAt < 250)) e.preventDefault();
    },
    true,
  );

  // the mouse: under pointer lock it looks, and its button is the hand;
  // unlocked, a press on something is the hand, a drag looks, and a click
  // on nothing takes the pointer
  let drag = null; // { id, x, y, moved, touch }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      // a finger on the view drags to look
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, touch: true };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (locked()) return pressHand();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, touch: false, onSomething: !!reticle };
    canvas.setPointerCapture(e.pointerId);
    if (reticle) pressHand();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (locked()) return turn(-e.movementX * LOOK_K, -e.movementY * LOOK_K);
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.hypot(dx, dy);
    turn(-dx * DRAG_K, -dy * DRAG_K);
  });
  const endPointer = (e) => {
    if (locked() && e.pointerType !== "touch") return e.type === "pointerup" && releaseHand();
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.touch) return;
    if (press) releaseHand();
    else if (!d.onSomething && d.moved < 5 && e.type === "pointerup") requestLock();
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // the keyboard: WASD or the arrows walk while the view has focus or the
  // pointer; unlocked, left and right turn, for keyboard-only visitors
  const keys = new Set();
  const WALK_KEYS = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  window.addEventListener("keydown", (e) => {
    const k = keyName(e);
    if (!WALK_KEYS.has(k) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!locked() && document.activeElement !== canvas) return;
    e.preventDefault();
    if (!keys.has(k)) keyDownAt.set(k, performance.now());
    keys.add(k);
    glide = null;
    wake();
  });
  // a tap is a short step or turn, not nothing: a key counts as held for
  // at least a moment after it went down
  const keyDownAt = new Map();
  const TAP_MS = 140;
  window.addEventListener("keyup", (e) => {
    const k = keyName(e);
    const left = TAP_MS - (performance.now() - (keyDownAt.get(k) ?? 0));
    if (left > 0) setTimeout(() => keys.delete(k), left);
    else keys.delete(k);
  });
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("blur", () => {
    keys.clear();
    if (locked()) document.exitPointerLock();
  });
  // the phone: a thumb joystick and a hand button over the view
  const joyEl = canvas.parentElement?.querySelector("[data-joy]") ?? null;
  const handEl = canvas.parentElement?.querySelector("[data-hand]") ?? null;
  const joy = { id: null, x: 0, y: 0, fwd: 0, side: 0 };
  if (joyEl) {
    const knob = joyEl.querySelector("[data-joy-knob]");
    const set = (e) => {
      const r = joyEl.getBoundingClientRect();
      const R = r.width * 0.36;
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      joy.side = dx / R;
      joy.fwd = -dy / R;
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
      glide = null;
      wake();
    };
    joyEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      joy.id = e.pointerId;
      joyEl.setPointerCapture(e.pointerId);
      set(e);
    });
    joyEl.addEventListener("pointermove", (e) => e.pointerId === joy.id && set(e));
    const end = (e) => {
      if (e.pointerId !== joy.id) return;
      joy.id = null;
      joy.fwd = joy.side = 0;
      if (knob) knob.style.transform = "";
    };
    joyEl.addEventListener("pointerup", end);
    joyEl.addEventListener("pointercancel", end);
  }
  if (handEl) {
    handEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handEl.setPointerCapture(e.pointerId);
      handEl.dataset.down = "1";
      pressHand();
    });
    const up = () => {
      delete handEl.dataset.down;
      releaseHand();
    };
    handEl.addEventListener("pointerup", up);
    handEl.addEventListener("pointercancel", up);
    handEl.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  function input() {
    let fwd = joy.fwd, side = joy.side, yawRate = 0;
    if (keys.has("w") || keys.has("ArrowUp")) fwd += 1;
    if (keys.has("s") || keys.has("ArrowDown")) fwd -= 1;
    if (keys.has("d")) side += 1;
    if (keys.has("a")) side -= 1;
    if (keys.has("ArrowRight")) locked() ? (side += 1) : (yawRate -= 1);
    if (keys.has("ArrowLeft")) locked() ? (side -= 1) : (yawRate += 1);
    return { fwd: THREE.MathUtils.clamp(fwd, -1, 1), side: THREE.MathUtils.clamp(side, -1, 1), yawRate };
  }

  // ---- gliding to a spot: back to the start, or in front of a plinth
  const wrapA = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  function glideTo(to) {
    if (still) {
      me.at = [...to.at];
      me.look = [...to.look];
      glide = null;
    } else {
      glide = { from: { at: [...me.at], look: [...me.look] }, to, t0: performance.now(), dur: 600 };
    }
    wake();
  }
  function stepGlide(now) {
    if (!glide) return;
    const k = Math.min(1, (now - glide.t0) / glide.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const { from, to } = glide;
    me.at = collide([from.at[0] + (to.at[0] - from.at[0]) * e, from.at[1] + (to.at[1] - from.at[1]) * e]);
    me.look = [from.look[0] + wrapA(to.look[0] - from.look[0]) * e, from.look[1] + (to.look[1] - from.look[1]) * e];
    if (k >= 1) glide = null;
  }

  // ---- walking up to a plinth shows its card; turning back to the stage
  // shows the stage's. Only on a change, so the panel's own choices stand.
  let near = "bench";
  function noticePlinths() {
    if (glide) return;
    const slot = plinthNear(me.at, me.look);
    let key = null;
    if (slot) key = `slot:${slot}`;
    else {
      const f = forward(me.look[0]);
      const d = Math.hypot(me.at[0], me.at[1]);
      const facing = d > 1e-6 ? (-me.at[0] * f[0] - me.at[1] * f[1]) / d : 1;
      if (d < 4 || facing > Math.cos(0.6)) key = "bench";
    }
    if (key && key !== near) {
      near = key;
      onPick(key);
    }
  }

  // ---- your pose, for everyone else: at most 8 a second, and at least
  // every 2 s so the server doesn't forget you
  let poseSent = 0;
  let poseKey = "";
  function sendPose(now) {
    if (now - poseSent < 125) return;
    const reach = holding ? heldPoint() : reticle ? reticle.point : null;
    const pose = { at: r3(me.at), look: [Number(wrapA(me.look[0]).toFixed(3)), Number(me.look[1].toFixed(3))], reach: reach ? r3(reach) : null, holding: holding ?? null };
    const key = JSON.stringify(pose);
    if (key === poseKey && now - poseSent < 2000) return;
    poseKey = key;
    poseSent = now;
    onPose(pose);
  }

  // ---- performances: the stage, and one on each plinth
  const views = new Map(); // key -> { view, holder, perf }
  let stageView = null;
  let playable = false;
  function place(key, holder, perf) {
    let v = views.get(key);
    const isPerf = perf && !!setOf(perf.set);
    if (!isPerf) {
      if (v) {
        holder.remove(v.view.root);
        v.view.dispose();
        views.delete(key);
      }
      return null;
    }
    if (!v) {
      const view = createStageView({ small: key !== "bench" });
      // every view root built for this performance, now and on a new set
      view.each((root) =>
        root.traverse((o) => {
          if (o.isMesh) o.userData.pick = key;
        }),
      );
      holder.add(view.root);
      v = { view, holder, perf };
      views.set(key, v);
    }
    v.perf = perf;
    return v.view;
  }

  let last = null;
  let selected = { kind: "bench" };
  let pending = []; // the visitor's own gestures, drawn before the server has them
  function sync() {
    if (!last) return;
    for (const s of last.slots) {
      const p = plinths.get(s.slot);
      const v = s.exhibit?.latest;
      place(`slot:${s.slot}`, p.holder, v && v.recipe === "stage" ? v.parts : null);
      const on = selected.kind === "slot" && selected.slot === s.slot;
      p.top.material.color.set(on ? "#ff8a73" : C.coral);
      p.spot.intensity = s.exhibit ? (on ? 26 : 14) : 4;
    }
    stageView = place("bench", wb.holder, last.draft.parts);
    playable = !!stageView;
    wb.ghost.visible = false;
    // a ring on the stage floor in each holder's colour, for each object
    // someone has in hand
    wb.leases.clear();
    const now = Date.now();
    for (const c of last.claims ?? []) {
      if (Date.parse(c.expiresAt) <= now - 1000) continue;
      const colour = VISITOR_COLOURS[c.holder.colour] ?? VISITOR_COLOURS[0];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 40), new THREE.MeshBasicMaterial({ color: colour }));
      ring.rotation.x = Math.PI / 2;
      ring.userData.sphere = c.part;
      wb.leases.add(ring);
    }
    wake();
  }

  // the colour of the player with this tag, if they're known
  function colourOf(tag) {
    const who = [...(last?.present ?? []), ...(last?.draft.contributors ?? [])].find((p) => p.tag === tag);
    if (who) return VISITOR_COLOURS[who.colour] ?? VISITOR_COLOURS[0];
    for (const s of last?.slots ?? []) {
      const c = s.exhibit?.latest.contributors.find((p) => p.tag === tag);
      if (c) return VISITOR_COLOURS[c.colour] ?? VISITOR_COLOURS[0];
    }
    return "#fff3d6";
  }

  // ---- the loop: draws only when something visibly changes (a cool
  // laptop). While anything in view moves it runs at the display's rate;
  // when only distant plinths move, at about 30 a second; when nothing
  // moves it stops, and a timer wakes it for the next thing the loop has
  // scheduled (a gesture's moment, the glide home, the wrap) so
  // performances still play on time. Input, a state or poses event, a
  // gesture, a resize and the tab coming back wake it too.
  let raf = 0;
  let timer = 0;
  let still = reducedMotion.matches;
  reducedMotion.addEventListener("change", (e) => {
    still = e.matches;
    wake();
  });
  function wake() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    // a backgrounded tab draws nothing; it wakes when it comes back
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const wakeIn = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      wake();
    }, ms);
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  // your pose stays fresh for the others while the loop idles (the server
  // forgets a pose after 5 s; sendPose sends at most every 2 s when
  // nothing changed)
  setInterval(() => {
    if (!raf && !document.hidden) sendPose(performance.now());
  }, 1000);
  // the time sculptures are drawn at: the shared clock, or 0 when still
  const drawTime = () => (still ? 0 : time());

  // what the camera can see of each performance: whether it's in the view
  // at all, and how far away (a plinth's play is small: far off, it
  // needn't drive frames)
  const frustum = new THREE.Frustum();
  const viewSphere = new THREE.Sphere();
  const projView = new THREE.Matrix4();
  const aimFrustum = () => frustum.setFromProjectionMatrix(projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  function sight(key, v) {
    v.holder.getWorldPosition(viewSphere.center);
    const isStage = key === "bench";
    viewSphere.center.y += isStage ? 0.8 : 0.4;
    viewSphere.radius = isStage ? 2.4 : 1.0;
    return { seen: frustum.intersectsSphere(viewSphere), dist: viewSphere.center.distanceTo(camera.position) };
  }
  const NEAR_PLINTH = 4; // closer than this, a plinth plays at full rate
  const FAR_PLINTH = 9; // further than this, it doesn't drive frames
  const isSelected = (key) => (key === "bench" ? selected.kind === "bench" : key === `slot:${selected.slot}`);
  // whose loop wakes the idle page: what's in view and near enough, and
  // the selected performance, whose sound plays wherever you look
  function watched(key, v) {
    if (isSelected(key)) return true;
    const { seen, dist } = sight(key, v);
    return seen && (key === "bench" || dist <= FAR_PLINTH);
  }
  // (only a pending gesture on this set's objects: one made just before the
  // stage switched sets would otherwise land on the new set's rules)
  const perfOf = (key, v) => {
    if (key !== "bench" || !pending.length) return v.perf;
    const mine = pending.filter((g) => !!setOf(v.perf.set)?.objects.includes(g.object));
    return mine.length ? { ...v.perf, gestures: [...v.perf.gestures, ...mine] } : v.perf;
  };

  // Plays every performance to now (without drawing): the views step on,
  // and what happened is heard. Called by each frame, and by probe() when
  // the loop is idle, so a check always reads the present.
  function playViews() {
    const moment = loopMoment(drawTime());
    for (const [key, v] of views) {
      const isStage = key === "bench";
      const events = v.view.update(perfOf(key, v), moment, { colourOf, held: isStage && holding ? [holding] : [], still });
      // sound for what's in view: the stage, or the chosen plinth
      if (events.length && isSelected(key)) {
        onEvents(events, v.view.set());
        // for the browser check: what this screen just saw happen, and when
        if (isStage) {
          canvas.dataset.heard = events.map((e) => e.kind).join(" ");
          canvas.dataset.heardAt = String(Date.now());
        }
      }
    }
    // claim rings follow the objects they mark, just under each
    if (stageView) {
      const objs = stageView.objects();
      for (const ring of wb.leases.children) {
        const b = Object.hasOwn(objs, ring.userData.sphere) ? objs[ring.userData.sphere] : null;
        if (b) ring.position.copy(b.position).setY(b.position.y - (heldLook(ring.userData.sphere)?.r ?? 0.17) - 0.02);
      }
    }
  }

  // How soon the next frame: "full" (the display's rate), "half" (about
  // 30 a second: only plinths some way off move), "listen" (only the
  // selected performance moves, out of sight: stepped for its sounds,
  // never drawn), or "idle".
  function pace(walking, avatarsBusy) {
    if (walking || glide || press || drag || avatarsBusy) return "full";
    aimFrustum();
    let half = false;
    let listen = false;
    for (const [key, v] of views) {
      if (!v.view.moving()) continue;
      const { seen, dist } = sight(key, v);
      if (seen && (key === "bench" || dist <= NEAR_PLINTH)) return "full";
      if (seen && dist <= FAR_PLINTH) half = true;
      else if (isSelected(key)) listen = true;
    }
    return half ? "half" : listen ? "listen" : "idle";
  }
  // after a frame or a listen: when to come back
  function schedule(p) {
    if (p === "full") wake();
    else if (p === "half") wakeIn(26);
    else if (p === "listen") {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        if (raf || document.hidden) return;
        playViews();
        schedule(pace(false, false));
      }, 33);
    } else {
      const next = nextScheduled();
      if (next !== null) wakeIn(next * 1000 + 12);
    }
  }

  // Seconds until the next scheduled thing in a watched loop: a gesture's
  // moment, the start of the glide home, or the wrap. From the gestures'
  // moments and the loop clock alone; no simulation.
  function nextScheduled() {
    if (still) return null;
    const m = loopMoment(drawTime());
    let soonest = Infinity;
    const consider = (x) => {
      const d = x > m + 1e-3 ? x - m : x + LOOP - m;
      if (d < soonest) soonest = d;
    };
    for (const [key, v] of views) {
      if (!watched(key, v)) continue;
      for (const g of perfOf(key, v).gestures) consider(g.at);
      consider(LOOP - GLIDE);
      consider(LOOP);
    }
    return Number.isFinite(soonest) ? soonest : null;
  }

  let lastFrame = performance.now();
  function frame() {
    raf = 0;
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    // walk and turn
    const inp = input();
    const walking = inp.fwd !== 0 || inp.side !== 0 || inp.yawRate !== 0;
    if (inp.yawRate) me.look[0] += inp.yawRate * 1.8 * dt;
    if (inp.fwd || inp.side) me.at = step(me.at, me.look, { fwd: inp.fwd, side: inp.side }, dt);
    stepGlide(now);
    placeCamera();
    setMoved(Math.hypot(me.at[0] - START.at[0], me.at[1] - START.at[1]) > 0.6 || Math.abs(wrapA(me.look[0] - START.look[0])) > 0.2);
    const yaw = me.look[0].toFixed(3);
    if (canvas.dataset.yaw !== yaw) canvas.dataset.yaw = yaw;
    noticePlinths();
    // a press held long enough on something holdable picks it up; it
    // looks as the set's view says (`held`)
    if (press && !holding && canHold(press.object) && now - press.t0 >= HOLD_MS) {
      holding = press.object;
      const look = heldLook(holding);
      heldBall.scale.setScalar(look?.r ?? 0.17);
      heldBall.material.color.set(look?.colour ?? "#ccc");
      heldBall.material.metalness = look?.metalness ?? 0.6;
      heldBall.material.roughness = look?.roughness ?? 0.2;
    }
    heldBall.visible = !!holding;
    if (holding) heldBall.position.fromArray(heldPoint());
    playViews();
    reticle = aim();
    showReticle();
    const avatarsBusy = avatars.update(dt, camera, canvas.clientWidth, canvas.clientHeight, still);
    renderer.render(scene, camera);
    sendPose(now);
    // keep going while anything in sight moves; otherwise sleep until the
    // loop's next scheduled moment (just after it, so its step has come)
    schedule(pace(walking, avatarsBusy));
  }

  // For the browser check: where the camera stands, the uncovered part of
  // the canvas, and what the camera now shows of a target ("bench" or a
  // slot), all in canvas px; and the first-person state (ADR 17).
  canvas.probe = (t = "bench") => {
    // idle, the meshes stand where they were last drawn: bring them to now
    // first, and wake if that set anything going
    if (!raf) {
      playViews();
      if ([...views.values()].some((v) => v.view.moving())) wake();
    }
    placeCamera();
    const target = targetOf(t);
    const m = measure(camera, target, obstacles(target.skip), 7);
    return {
      camR: Math.hypot(camera.position.x, camera.position.z),
      camY: camera.position.y,
      yaw: me.look[0],
      archR: FLOOR_R - 0.45,
      archTop: rim.userData.H,
      view: { ...clear },
      box: m?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      occluded: m?.occluded ?? 1,
      near: m?.near ?? 1,
      cuts: m?.cuts ?? 99,
      moved,
      look: lookOf(),
      stage: stageOf(),
      fp: {
        at: [...me.at],
        look: [...me.look],
        reticle: { id: reticle?.id ?? null },
        holding,
        locked: locked(),
        others: avatars.others(),
      },
    };
  };
  canvas.renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, pixelRatio: renderer.getPixelRatio(), shadowsEveryFrame: renderer.shadowMap.autoUpdate }); // GPU cost of the last frame, for the browser check's `gpu`
  // For the browser check only: point the eyes somewhere, as a mouse would.
  canvas.lookAtPoint = (x, y, z) => {
    const dx = x - me.at[0], dy = y - EYE, dz = z - me.at[1];
    me.look = [Math.atan2(-dx, -dz), clampPitch(Math.atan2(dy, Math.hypot(dx, dz)))];
    glide = null;
    wake();
  };
  // For checks before or without a server: draw a `poses` event as if the
  // stream had sent it.
  canvas.showPoses = (ev, youTag) => {
    avatars.set(ev, youTag);
    wake();
  };

  // For the browser check's `stage` section: where each object of the
  // stage is on the canvas and in the stage's frame.
  function stageOf() {
    if (!stageView) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const px = (v) => {
      const p = v.clone().project(camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    };
    // every object of the set by id (`spheres` keeps its old name for the
    // checks: Orbit's spheres are there), and the view's fixed marks
    const set = stageView.set();
    const spheres = {};
    for (const [id, b] of Object.entries(stageView.objects())) {
      const world = b.getWorldPosition(new THREE.Vector3());
      spheres[id] = { at: px(world), pos: toStage(world).toArray(), visible: b.visible };
    }
    const marks = {};
    for (const [k, q] of Object.entries(stageView.view().marks())) marks[k] = px(new THREE.Vector3().fromArray(q).applyMatrix4(stageFrame()));
    return { set, spheres, ...marks, rings: wb.leases.children.length, moment: loopMoment(drawTime()), loop: LOOP };
  }

  // For the browser check's `look` section: the arches' build, the depth
  // behind the room, the lights, and where on the canvas the bare sky is.
  function lookOf() {
    const bays = rim.userData.bays;
    const tops = bays.map((b) => b.userData.top);
    let archGap = 0, archAlong = 0;
    for (const b of bays) {
      for (const f of b.userData.feet) {
        archGap = Math.max(archGap, Math.min(...tops.map((t) => t.distanceTo(f))));
        archAlong = Math.max(archAlong, Math.abs(Math.hypot(f.x, f.z) - rim.userData.R));
      }
    }
    const tagged = (key) => {
      const out = [];
      scene.traverse((o) => o.userData[key] !== undefined && out.push(o));
      return out;
    };
    const islands = tagged("island");
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const onScreen = (p) => {
      if (v3.copy(p).applyMatrix4(camera.matrixWorldInverse).z > 0) return false;
      v3.copy(p).project(camera);
      const x = ((v3.x + 1) / 2) * w, y = ((1 - v3.y) / 2) * h;
      return x >= clear.x && x <= clear.x + clear.w && y >= clear.y && y <= clear.y + clear.h;
    };
    // the horizon: straight ahead, far off, at eye level
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd).setY(0).normalize();
    v3.copy(camera.position).addScaledVector(fwd, 380).setY(camera.position.y).project(camera);
    const horizonY = ((1 - v3.y) / 2) * h;
    // the bare sky: rays that hit nothing but the dome
    const things = [];
    scene.traverse((o) => o.isMesh && o !== sky && o.visible && things.push(o));
    const skyPx = [];
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 16; j++) {
        const x = clear.x + ((i + 0.5) / 24) * clear.w, y = clear.y + ((j + 0.5) / 16) * clear.h;
        if (y > horizonY) continue;
        castAt(camera, x, y);
        if (!ray.intersectObjects(things, false).length) skyPx.push([Math.round(x), Math.round(y)]);
      }
    }
    const sunDir = sun.position.clone().normalize();
    const elev = Math.asin(sunDir.y);
    const side = Math.acos(Math.abs(new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize().dot(fwd)));
    return {
      archThick: rim.userData.thick,
      archGap,
      archAlong,
      cloudLayers: tagged("cloudLayer").length,
      horizon: tagged("horizon").length > 0,
      horizonY,
      islands: islands.length,
      islandsInView: islands.filter((o) => onScreen(o.getWorldPosition(new THREE.Vector3()))).length,
      warmSide: sun.color.r > sun.color.b * 1.15 && elev < 0.7 && side > 0.7 && side < Math.PI - 0.7,
      coolFill: ambientFill.color.b > ambientFill.color.r,
      contactShadows: tagged("contact").length,
      skyPx,
    };
  }

  resize();
  placeCamera();
  wake();

  let othersKey = "";
  const spotFor = (sel) => (sel.kind === "slot" ? standBefore(sel.slot) : sel.kind === "bench" ? START : null);
  return {
    /** walk back to the starting spot, facing the stage */
    home() {
      near = "bench";
      glideTo(START);
    },
    /** walk to stand before what's selected: a plinth, or the start */
    walkTo(sel) {
      const to = spotFor(sel);
      if (!to) return;
      near = sel.kind === "slot" ? `slot:${sel.slot}` : "bench";
      glideTo(to);
    },
    /** others' heads, hands and held spheres, from a `poses` event */
    setPoses(ev, youTag) {
      avatars.set(ev, youTag);
      // the stream echoes your own keep-alive pose back: only someone
      // else's change needs drawing (their heads ease in over frames)
      const key = JSON.stringify((ev?.poses ?? []).filter((p) => p && p.tag !== youTag));
      if (key === othersKey) return;
      othersKey = key;
      wake();
    },
    update(state, sel) {
      last = state;
      selected = sel;
      // the server has the gestures now: stop drawing them as pending
      const have = new Set(state.draft.parts?.gestures.map((g) => JSON.stringify(g)) ?? []);
      pending = pending.filter((g) => !have.has(JSON.stringify(g)) && Date.now() - (g._at ?? 0) < 4000);
      sync();
    },
    /** Draw one of this visitor's gestures at once, before the server has it. */
    play(gesture) {
      pending.push(gesture);
      wake();
    },
    /** Forget a pending gesture the server refused. */
    unplay(gesture) {
      pending = pending.filter((g) => g !== gesture);
      wake();
    },
    /** The loop moment the stage is at now (0 when held still). */
    moment: () => loopMoment(drawTime()),
  };
}
