// The gallery in 3D: a round floor floating above sunset clouds, stone
// arches on pillars, six plinths in a ring, each playing a performance, and
// the stage at the centre where visitors play together (ADR 16). Touching an
// object on the stage is a gesture: the scene works out which (onGesture)
// and the page sends it. Every control also lives in the DOM (app.js).
// Loaded with a dynamic import, so if WebGL or the CDN is missing the page
// carries on without it.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BELL, LOOP, SETS, SPHERES, VISITOR_COLOURS, loopMoment, ribbonPoint } from "./stage.js";
import { createStageView } from "./stageview.js";
import { clearFrame, frameHeight, viewOffsetFor } from "./ui-logic.js";

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
  const puff = new THREE.IcosahedronGeometry(1, 3);
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
    const inst = new THREE.InstancedMesh(puff, mat, L.count * per);
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
 * that spans between them along the ring. Each bay (a pillar and the arch
 * to its neighbour) has its own materials, so the bays between the camera
 * and the centre can fade out instead of walling off the view (fadeBays). */
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
  const bays = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const mat = new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.82, transparent: true });
    const trim = new THREE.MeshStandardMaterial({ color: C.ivoryDeep, roughness: 0.85, transparent: true });
    const shade = new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false });
    const bay = new THREE.Group();
    const px = Math.sin(a) * R, pz = Math.cos(a) * R;
    const base = new THREE.Mesh(baseGeo, trim);
    base.position.set(px, 0.13, pz);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.set(px, 0.26 + (H - 0.5) / 2, pz);
    const cap = new THREE.Mesh(capGeo, trim);
    cap.position.set(px, H - 0.12, pz);
    for (const m of [base, shaft, cap]) {
      m.rotation.y = a;
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const foot = contactShadow(0.85, shade);
    foot.position.set(px, 0.006, pz);
    // the arch to the next pillar, tangent to the ring, its feet on the
    // two capitals
    const mid = a + Math.PI / n;
    const arc = new THREE.Mesh(archGeo, mat);
    arc.position.set(Math.sin(mid) * inset, H, Math.cos(mid) * inset);
    arc.rotation.y = mid;
    arc.castShadow = true;
    arc.receiveShadow = true;
    bay.add(base, shaft, cap, foot, arc);
    // points along the curve, for telling when a frame cuts through it
    arc.updateMatrix();
    const curve = [...Array(9)].map((_, k) => new THREE.Vector3(Math.cos((k / 8) * Math.PI) * half, Math.sin((k / 8) * Math.PI) * half, 0).applyMatrix4(arc.matrix));
    const feet = [curve[0], curve[8]];
    const top = new THREE.Vector3(px, H, pz);
    bay.userData = { angle: mid, mid: arc.position.clone(), mats: [mat, trim], shades: [shade], curve, feet, top };
    bays.push(bay);
    g.add(bay);
  }
  g.userData.bays = bays;
  g.userData.R = R;
  g.userData.H = H;
  g.userData.thick = ARCH_THICK;
  return g;
}

/** Fades the bays near the camera, so the arches frame the gallery from
 * behind rather than block it from in front. By distance, not by side of
 * the room: a close-up from near the centre keeps the arches behind the
 * exhibit it looks at. */
function bayOpacity(bay, cam) {
  const d = Math.hypot(bay.mid.x - cam.x, bay.mid.z - cam.z);
  return 0.04 + 0.96 * THREE.MathUtils.smoothstep(d, 2.6, 4.6);
}
function fadeBays(bays, cam) {
  for (const bay of bays) {
    const o = bayOpacity(bay.userData, cam);
    for (const m of bay.userData.mats) {
      m.opacity = o;
      m.depthWrite = o > 0.95;
    }
    for (const m of bay.userData.shades) m.opacity = o;
    bay.visible = o > 0.06;
  }
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
 * big as the space the spheres can fly in, with a faint ring of light at
 * the wall they bounce off. */
function bench() {
  const g = new THREE.Group();
  const R = SETS.orbit.radius;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.3, 0.55, 72), new THREE.MeshStandardMaterial({ color: "#f8efe0", roughness: 0.78 }));
  base.position.y = 0.275;
  base.castShadow = true;
  base.receiveShadow = true;
  const glassTop = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.1, 72),
    new THREE.MeshPhysicalMaterial({ color: "#bfe6e2", transmission: 0.9, roughness: 0.08, thickness: 0.3, ior: 1.4, attenuationColor: C.teal, attenuationDistance: 0.8 }),
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

export async function createScene(canvas, { reducedMotion, time, onPick, covers = () => [], onMoved = () => {}, onGesture = () => {}, onEvents = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

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

  // ---- camera: orbit around a focus point; drag and arrow keys turn it
  // the vertical field of view of the clear part of the scene
  const CLEAR_FOV = 42;
  const camera = new THREE.PerspectiveCamera(CLEAR_FOV, 1, 0.1, 900);
  // yaw 0 looks in between plinths 6 and 1, so neither hides the bench;
  // until the first state arrives, already inside the pavilion
  const view = { yaw: 0, pitch: 0.22, dist: 7, focus: new THREE.Vector3(0, 1.3, 0) };
  const goal = { yaw: view.yaw, pitch: view.pitch, dist: view.dist, focus: view.focus.clone() };
  let interacting = 0;
  // The clear rectangle: the canvas minus whatever lies over it, in canvas
  // px, and the offset frame that centres the picture on it.
  let clear = { x: 0, y: 0, w: 1, h: 1 };
  let full = { fullW: 1, fullH: 1, offX: 0, offY: 0 };
  // the half-angle tangents of the clear rectangle, and its vertical fov
  const clearTan = () => {
    const t = Math.tan((camera.fov * Math.PI) / 360);
    return { v: (t * clear.h) / full.fullH, h: (t * clear.w) / full.fullH };
  };
  const clearFov = () => (2 * Math.atan(clearTan().v) * 180) / Math.PI;
  // whether the visitor has turned, dragged or zoomed since the last aim
  let moved = false;
  const setMoved = (m) => {
    if (m === moved) return;
    moved = m;
    onMoved(m);
  };

  // the yaw equal to `a` (mod a turn) nearest the current goal, so the
  // camera takes the short way round
  const nearestYaw = (a) => goal.yaw + ((((a - goal.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

  const box = new THREE.Box3();
  // what a camera fits of a performance, in its holder's frame: where the
  // play mostly is (the ribbon, the bell and the spheres at rest), not the
  // whole flying room nor where the spheres happen to be, so the camera
  // holds still as it plays and the objects are big enough to touch
  const STAGE_BOX = new THREE.Box3(new THREE.Vector3(-1.4, 0.05, -1.4), new THREE.Vector3(1.4, 1.5, 1.4));

  // The bench view stands inside the pavilion, between plinths 6 and 1,
  // looking slightly down at the bench sculpture as it is now: on a phone a
  // tight close-up, on a desktop with room for the far plinths and arches
  // round it. It re-fits only when the shared draft changes (a release, or
  // someone else's edit), never from the local preview mid-drag, so the
  // camera doesn't chase a slider while it moves.
  const INSIDE_R = FLOOR_R - 1.0;
  // a visitor's eye, standing in the gallery
  const EYE = 1.62;
  function benchFit(tight) {
    box.makeEmpty();
    // the stage's own extent, not where its spheres happen to be this frame,
    // so the camera holds still while a performance plays
    box.copy(STAGE_BOX).applyMatrix4(wb.holder.matrixWorld);
    if (box.isEmpty()) return { focusY: 1.2, dist: 6.6, pitch: Math.asin((EYE - 1.2) / 6.6) };
    // the sculpture itself, with only a sliver of glass under it
    const lo = Math.max(box.min.y, 0.45);
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    // fitted to the clear rectangle, not the whole canvas
    const aspect = clear.w / clear.h;
    const f = frameHeight(lo, box.max.y, clearFov(), aspect, tight ? 1.2 : 1.3, tight ? 2.5 : 3.2);
    const tanH = clearTan().h;
    const dist = Math.min(Math.max(f.dist, (w * (tight ? 1.15 : 1.25)) / 2 / tanH + w / 2), INSIDE_R);
    // standing, not hovering: the camera at eye height, so the glass top
    // reads as a thin lens and the arches rise round the sculpture
    const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp((EYE - f.focusY) / dist, -1, 1)), -0.08, 0.3);
    return { focusX: 0, focusY: f.focusY, dist: Math.min(dist, INSIDE_R / Math.cos(pitch)), pitch };
  }

  // ---- composing a close-up: measure what a pose would show
  const ray = new THREE.Raycaster();
  const probeCam = new THREE.PerspectiveCamera();
  const ndc = new THREE.Vector2();
  const v3 = new THREE.Vector3();
  // The meshes that could get in the way: everything but the backdrop,
  // the floor plates and the target itself (with its plinth or bench).
  function obstacles(skip) {
    const out = [];
    const walk = (o) => {
      if (o === skip || o.userData.backdrop || o.userData.flat) return;
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
  // a faded bay is see-through from this camera, so it's never in the way
  const solid = (o, cam) => {
    const bay = o.parent?.userData.mats ? o.parent.userData : null;
    return !bay || bayOpacity(bay, cam) >= 0.5;
  };
  // the target of a close-up: what to keep clear, what to fit
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
    // an empty plinth: its top is what has to be seen
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
  /** What camera `c` shows of a target: its rect on the canvas, the share
   * of rays to it that hit something else first, the share of the clear
   * view taken by something near the lens, and arches the top edge cuts. */
  function measure(c, target, obs, grid = 5) {
    const cam = c.position;
    const rect = screenRect(c, target.box);
    if (!rect) return null;
    const all = [...target.meshes, ...obs];
    const mine = new Set(target.meshes);
    let occ = 0, vis = 0;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        castAt(c, rect.x + ((i + 0.5) / grid) * rect.w, rect.y + ((j + 0.5) / grid) * rect.h);
        const hits = ray.intersectObjects(all, false).filter((hh) => solid(hh.object, cam));
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
        const hit = ray.intersectObjects(obs, false).find((hh) => solid(hh.object, cam));
        if (hit && hit.distance < NEAR) near++;
      }
    }
    // An arch is cut when part of its curve is in the picture and part
    // runs off the top edge or behind the lens: a stump, not an arch.
    let cuts = 0;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const bay of rim.userData.bays) {
      if (bayOpacity(bay.userData, cam) < 0.3) continue;
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
    // how far the target spills out of the clear rectangle, in px
    const m = 10;
    const outside = Math.max(0, clear.x + m - rect.x) + Math.max(0, rect.x + rect.w - (clear.x + clear.w - m)) + Math.max(0, clear.y + m - rect.y) + Math.max(0, rect.y + rect.h - (clear.y + clear.h - m));
    return { rect, occluded: occ + vis ? occ / (occ + vis) : 1, near: near / rays, cuts, outside };
  }
  const NEAR = 1.8;
  const posed = (c, focus, yaw, pitch, dist) => {
    c.position.set(focus.x + Math.sin(yaw) * Math.cos(pitch) * dist, focus.y + Math.sin(pitch) * dist, focus.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    c.lookAt(focus);
    c.updateMatrixWorld();
    return c;
  };
  // inside the ring of arches, under the height of an arch's crown
  const inside = (c) => Math.hypot(c.position.x, c.position.z) < INSIDE_R && c.position.y < 4.6 && c.position.y > 0.5;
  const turn = (a, b) => Math.abs(((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI);
  /** The close-up of plinth `slot`: of poses round it, inside the pavilion,
   * the one with the least in front of the exhibit, nothing big at the
   * lens, no arch cut through its curve, and the exhibit clear of every
   * panel, preferring a nearer, more frontal view from the centre side. */
  function compose(slot) {
    probeCam.copy(camera);
    const target = targetOf(slot);
    const obs = obstacles(target.skip);
    const b = target.box;
    // with a little of the plinth top under it, for footing
    b.min.y = Math.min(b.min.y, PLINTH_H - 0.15);
    const focus = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() / 2;
    const t = clearTan();
    const d0 = Math.max(2.6, (radius * 1.02) / Math.min(t.v, t.h));
    const front = slotAngle(slot) + Math.PI + 0.35;
    const coarse = [];
    for (let k = 0; k < 24; k++) {
      const yaw = (k / 24) * TAU;
      for (const pitch of [0.12, 0.24, 0.38, 0.52, 0.66]) {
        // the nearest distance that keeps it clear of the panels
        for (const f of [0.8, 0.9, 1, 1.1, 1.22, 1.36, 1.52, 1.7, 1.9]) {
          const c = posed(probeCam, focus, yaw, pitch, d0 * f);
          if (!inside(c)) break;
          const r = screenRect(c, b);
          if (!r) break;
          const m = 10;
          if (r.x < clear.x + m || r.y < clear.y + m || r.x + r.w > clear.x + clear.w - m || r.y + r.h > clear.y + clear.h - m) continue;
          const prior = 0.9 * (f - 0.8) + 0.6 * Math.abs(pitch - 0.24) + 0.18 * turn(yaw, front);
          coarse.push({ yaw, pitch, dist: d0 * f, prior });
          break;
        }
      }
    }
    const score = (q, grid) => {
      const mm = measure(posed(probeCam, focus, q.yaw, q.pitch, q.dist), target, obs, grid);
      if (!mm) return Infinity;
      return 14 * mm.occluded + 10 * mm.near + 1.4 * mm.cuts + 0.05 * mm.outside + q.prior;
    };
    for (const q of coarse) q.score = score(q, 3);
    coarse.sort((x, y) => x.score - y.score);
    const best = coarse.slice(0, 8).map((q) => ({ ...q, score: score(q, 7) })).sort((x, y) => x.score - y.score)[0];
    // nothing fits inside (a huge exhibit): the old view, from the centre side
    return { focus, ...(best ?? { yaw: front, pitch: 0.24, dist: d0 }) };
  }

  function aimAt(selected) {
    applyClear();
    setMoved(false);
    if (selected.kind === "slot") {
      const q = compose(selected.slot);
      goal.focus.copy(q.focus);
      goal.yaw = nearestYaw(q.yaw);
      goal.pitch = q.pitch;
      goal.dist = q.dist;
    } else if (selected.kind === "bench") {
      const f = benchFit(innerWidth < 600);
      goal.focus.set(f.focusX ?? 0, f.focusY, 0);
      goal.yaw = nearestYaw(0);
      goal.dist = f.dist;
      goal.pitch = f.pitch;
    } else {
      // a storeroom exhibit isn't in the room: show the room
      goal.focus.set(0, 0.8, 0);
      goal.dist = 21;
      goal.pitch = 0.48;
    }
  }

  // Measure what lies over the canvas and centre the picture on the rest:
  // the canvas becomes a window onto a larger frame, so what's aimed at
  // sits in the middle of the part nobody's panel covers.
  function applyClear() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const r = canvas.getBoundingClientRect();
    clear = clearFrame({ x: r.left, y: r.top, w, h }, covers());
    if (clear.w < 40 || clear.h < 40) clear = { x: 0, y: 0, w, h };
    full = viewOffsetFor(w, h, clear);
    // the aspect of the whole (offset) frame, or the picture stretches;
    // and a lens wide enough that the clear part alone sees CLEAR_FOV
    camera.aspect = full.fullW / full.fullH;
    camera.fov = (2 * Math.atan((Math.tan((CLEAR_FOV * Math.PI) / 360) * full.fullH) / clear.h) * 180) / Math.PI;
    camera.setViewOffset(full.fullW, full.fullH, full.offX, full.offY, w, h);
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

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (touchDown(e)) return;
    drag = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, moved: 0, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    interacting = performance.now();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touch) return touchMove(e);
    hover(e);
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    goal.yaw = drag.yaw - dx * 0.006;
    goal.pitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.004, 0.08, 1.15);
    interacting = performance.now();
    if (drag.moved >= 6) setMoved(true);
    wake();
  });
  const endDrag = (e) => {
    if (touch) return touchUp(e);
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved < 6 && e.type === "pointerup") pick(e);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.001), 4, 22);
      interacting = performance.now();
      setMoved(true);
      wake();
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: [-0.18, 0], ArrowRight: [0.18, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key];
    if (!step) {
      if (e.key === "+" || e.key === "=") goal.dist = Math.max(4, goal.dist * 0.9);
      else if (e.key === "-") goal.dist = Math.min(22, goal.dist * 1.1);
      else return;
    } else {
      goal.yaw += step[0];
      goal.pitch = THREE.MathUtils.clamp(goal.pitch + step[1], 0.08, 1.15);
    }
    e.preventDefault();
    interacting = performance.now();
    setMoved(true);
    wake();
  });

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...[...plinths.values()].map((p) => p.group), wb.group], true).find((h) => {
      for (let o = h.object; o; o = o.parent) if (o.userData.pick) return true;
      return false;
    });
    if (!hit) return;
    let o = hit.object;
    while (o && !o.userData.pick) o = o.parent;
    onPick(o.userData.pick);
  }

  // ---- touching the stage (ADR 16): which object is under the finger,
  // and what the gesture is. Dragging a sphere picks it up and letting go
  // throws it at the finger's speed; a tap on a sphere hops it, on the
  // ribbon plucks it there, on the bell rings it. The scene only says what
  // the gesture was (onGesture); the page sends it.
  function pointerRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  // the stage's frame, in world space: its holder sits on the bench
  const stageFrame = () => {
    wb.holder.updateMatrixWorld();
    return wb.holder.matrixWorld;
  };
  const toStage = (v) => v.clone().applyMatrix4(stageFrame().clone().invert());
  function objectAt(e) {
    if (!stageView || !playable) return null;
    pointerRay(e);
    const o = stageView.objects();
    const targets = [o.ribbon, ...Object.values(o.balls).filter((b) => b.visible)];
    o.bell.traverse((m) => m.isMesh && targets.push(m));
    // a sphere is small: a near miss on screen still counts, so it can be
    // caught by a finger
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) return { object: hit.object.userData.object, point: hit.point };
    const r = canvas.getBoundingClientRect();
    let best = null;
    for (const [id, b] of Object.entries(o.balls)) {
      if (!b.visible) continue;
      const w = b.getWorldPosition(new THREE.Vector3());
      const v = w.clone().project(camera);
      const d = Math.hypot(((v.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - v.y) / 2) * r.height - (e.clientY - r.top));
      if (d < 30 && (!best || d < best.d)) best = { d, object: id, point: w };
    }
    return best;
  }
  let touch = null; // { object, x, y, moved, trail: [{x, y, p, at}] }
  const grabPlane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const heldBall = new THREE.Mesh(new THREE.SphereGeometry(SETS.orbit.sphereR, 32, 20), new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.2 }));
  const heldRing = new THREE.Mesh(new THREE.TorusGeometry(SETS.orbit.sphereR * 1.6, 0.02, 8, 40), new THREE.MeshBasicMaterial({ color: "#fff" }));
  heldBall.add(heldRing);
  heldBall.visible = false;
  scene.add(heldBall);
  function touchDown(e) {
    const hit = objectAt(e);
    if (!hit) return false;
    canvas.setPointerCapture(e.pointerId);
    interacting = performance.now();
    touch = { object: hit.object, x: e.clientX, y: e.clientY, moved: 0, trail: [], point: hit.point.clone() };
    if (SPHERES.includes(hit.object)) {
      // picked up: held on a plane facing the camera through the sphere
      grabPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point);
      const mat = stageView.objects().balls[hit.object].material;
      heldBall.material.color.copy(mat.color);
      heldBall.material.metalness = mat.metalness;
      heldBall.material.roughness = mat.roughness;
      heldBall.position.copy(hit.point);
      onGesture({ kind: "grab", object: hit.object });
    }
    canvas.dataset.touching = hit.object;
    wake();
    return true;
  }
  function touchMove(e) {
    touch.moved = Math.max(touch.moved, Math.hypot(e.clientX - touch.x, e.clientY - touch.y));
    interacting = performance.now();
    if (!SPHERES.includes(touch.object)) return;
    pointerRay(e);
    if (!ray.ray.intersectPlane(grabPlane, hitPoint)) return;
    // kept within the stage, and above its floor
    const local = toStage(hitPoint);
    const R = SETS.orbit.radius - SETS.orbit.sphereR;
    const rr = Math.hypot(local.x, local.z);
    if (rr > R) local.multiplyScalar(R / rr).setY(local.y * (rr / R));
    local.y = THREE.MathUtils.clamp(local.y, SETS.orbit.sphereR, SETS.orbit.ceiling - SETS.orbit.sphereR);
    const world = local.clone().applyMatrix4(stageFrame());
    heldBall.position.copy(world);
    heldBall.visible = touch.moved >= 6;
    touch.trail.push({ p: local, at: performance.now() });
    while (touch.trail.length > 8) touch.trail.shift();
    wake();
  }
  function touchUp(e) {
    const t = touch;
    touch = null;
    heldBall.visible = false;
    delete canvas.dataset.touching;
    const at = loopMoment(drawTime());
    const r3 = (v) => v.toArray().map((x) => Number(x.toFixed(3)));
    if (SPHERES.includes(t.object)) {
      if (t.moved < 6) {
        // a tap: a little hop straight up from where it is
        const p = toStage(stageView.objects().balls[t.object].getWorldPosition(new THREE.Vector3()));
        onGesture({ kind: "throw", object: t.object, at, from: r3(p), v: [0, 1.4, 0] });
      } else {
        // let go: thrown at the speed the finger was moving over its last
        // few positions, capped to what the stage allows
        const tr = t.trail;
        const a = tr[0];
        const b = tr[tr.length - 1];
        const dt = b && a && b.at > a.at ? (b.at - a.at) / 1000 : 1;
        const v = b && a ? b.p.clone().sub(a.p).divideScalar(Math.max(dt, 0.016)) : new THREE.Vector3();
        if (v.length() > 5.5) v.setLength(5.5);
        onGesture({ kind: "throw", object: t.object, at, from: r3(b?.p ?? toStage(t.point)), v: r3(v) });
      }
    } else if (t.object === "ribbon") {
      // plucked where it was touched: the nearest point of its path
      const local = toStage(t.point);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < 240; i++) {
        const q = ribbonPoint(i / 240);
        const d = (q[0] - local.x) ** 2 + (q[1] - local.y) ** 2 + (q[2] - local.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i / 240;
        }
      }
      onGesture({ kind: "pluck", object: "ribbon", at, u: Number(best.toFixed(3)) });
    } else if (t.object === "bell") {
      onGesture({ kind: "tap", object: "bell", at });
    }
    wake();
  }
  function hover(e) {
    if (drag || touch) return;
    const hit = objectAt(e);
    canvas.style.cursor = hit ? (SPHERES.includes(hit.object) ? "grab" : "pointer") : "";
  }

  // ---- performances: the stage, and one on each plinth
  const views = new Map(); // key -> { view, holder, perf }
  let stageView = null;
  let playable = false;
  function place(key, holder, perf) {
    let v = views.get(key);
    const isPerf = perf && Object.hasOwn(SETS, perf.set);
    if (!isPerf) {
      if (v) {
        holder.remove(v.view.root);
        v.view.dispose();
        views.delete(key);
      }
      return null;
    }
    if (!v) {
      const view = createStageView();
      view.root.traverse((o) => {
        if (o.isMesh) o.userData.pick = key;
      });
      holder.add(view.root);
      v = { view, holder, perf };
      views.set(key, v);
    }
    v.perf = perf;
    return v.view;
  }

  let last = null;
  let aimed = false;
  let aimedShape = null;
  let selected = { kind: "bench" };
  let pending = []; // the visitor's own gestures, drawn before the server has them
  let held = []; // spheres this visitor has in hand, and others' claims
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
    // a ring on the stage floor in each holder's colour, for each sphere
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

  // ---- the loop: renders while anything moves, idles otherwise
  let raf = 0;
  let still = reducedMotion.matches;
  // the pinned-scene shell in style.css starts at this width
  const phoneLayout = matchMedia("(max-width: 860px)");
  reducedMotion.addEventListener("change", (e) => {
    still = e.matches;
    wake();
  });
  function wake() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  // the time sculptures are drawn at: the shared clock, or 0 when still
  const drawTime = () => (still ? 0 : time());
  function frame() {
    raf = 0;
    const t = drawTime();
    // a slow drift around the room when nobody's touching it; never in the
    // phone layout, where the scene sits over controls being scrolled
    if (!still && !phoneLayout.matches && performance.now() - interacting > 6000 && !drag) goal.yaw += 0.0007;
    const k = still ? 1 : 0.08;
    view.yaw += (goal.yaw - view.yaw) * k;
    view.pitch += (goal.pitch - view.pitch) * k;
    view.dist += (goal.dist - view.dist) * k;
    view.focus.lerp(goal.focus, k);
    camera.position.set(view.focus.x + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.focus.y + Math.sin(view.pitch) * view.dist, view.focus.z + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(view.focus);
    // the camera's angle, for the browser check to read
    const yaw = view.yaw.toFixed(3);
    if (canvas.dataset.yaw !== yaw) canvas.dataset.yaw = yaw;
    fadeBays(rim.userData.bays, camera.position);
    const moment = loopMoment(t);
    const hand = touch && SPHERES.includes(touch.object) && touch.moved >= 6 ? [touch.object] : [];
    let busy = false;
    for (const [key, v] of views) {
      const isStage = key === "bench";
      const perf = isStage && pending.length ? { ...v.perf, gestures: [...v.perf.gestures, ...pending] } : v.perf;
      const events = v.view.update(perf, moment, { colourOf, held: isStage ? hand : [], still });
      busy ||= v.view.busy();
      // sound for what's in view: the stage, or the chosen plinth
      if (events.length && ((isStage && selected.kind === "bench") || key === `slot:${selected.slot}`)) {
        onEvents(events);
        // for the browser check: what this screen just saw happen, and when
        if (isStage) {
          canvas.dataset.heard = events.map((e) => e.kind).join(" ");
          canvas.dataset.heardAt = String(Date.now());
        }
      }
    }
    // claim rings follow the spheres they mark
    if (stageView) {
      const balls = stageView.objects().balls;
      for (const ring of wb.leases.children) {
        const b = balls[ring.userData.sphere];
        if (b) ring.position.copy(b.position).setY(b.position.y - SETS.orbit.sphereR - 0.02);
      }
    }
    renderer.render(scene, camera);
    const settling = Math.abs(goal.yaw - view.yaw) + Math.abs(goal.pitch - view.pitch) + Math.abs(goal.dist - view.dist) + goal.focus.distanceTo(view.focus) > 0.001;
    if (!still || settling || busy) wake();
  }

  // For the browser check: where the camera stands, the clear rectangle,
  // and what the camera now shows of a target ("bench" or a slot), all in
  // canvas px, measured with a finer grid than the composer uses.
  canvas.probe = (t = "bench") => {
    camera.updateMatrixWorld();
    const target = targetOf(t);
    const m = measure(camera, target, obstacles(target.skip), 7);
    return {
      camR: Math.hypot(camera.position.x, camera.position.z),
      camY: camera.position.y,
      yaw: view.yaw,
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
    };
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
    const o = stageView.objects();
    const spheres = {};
    for (const [id, b] of Object.entries(o.balls)) {
      const world = b.getWorldPosition(new THREE.Vector3());
      spheres[id] = { at: px(world), pos: toStage(world).toArray(), visible: b.visible };
    }
    const onRibbon = new THREE.Vector3().fromArray(ribbonPoint(0.125)).applyMatrix4(stageFrame());
    const bell = new THREE.Vector3().fromArray(BELL.pos).applyMatrix4(stageFrame());
    return { spheres, ribbon: px(onRibbon), bell: px(bell), rings: wb.leases.children.length, moment: loopMoment(drawTime()), loop: LOOP };
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
  wake();

  return {
    /** back to the opening pose, from wherever the visitor has turned */
    home() {
      aimAt({ kind: "bench" });
      wake();
    },
    update(state, sel) {
      const changed = JSON.stringify(sel) !== JSON.stringify(selected);
      last = state;
      selected = sel;
      // the server has the gestures now: stop drawing them as pending
      const have = new Set(state.draft.parts?.gestures.map((g) => JSON.stringify(g)) ?? []);
      pending = pending.filter((g) => !have.has(JSON.stringify(g)) && Date.now() - (g._at ?? 0) < 4000);
      sync();
      // re-aimed when what's selected changes, never as a performance plays
      const shape = sel.kind === "slot" ? `slot:${sel.slot}:${!!state.slots[sel.slot - 1]?.exhibit}` : sel.kind;
      if (changed || !aimed || shape !== aimedShape) {
        aimAt(sel);
        // the first view eases in a step, from just behind and to the side
        // of where it settles, rather than swooping in from outside the room
        if (!aimed) {
          view.focus.copy(goal.focus);
          view.pitch = goal.pitch + (still ? 0 : 0.05);
          view.dist = goal.dist + (still ? 0 : 0.9);
          view.yaw = goal.yaw - (still ? 0 : 0.22);
        }
        aimed = true;
        aimedShape = shape;
      }
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
