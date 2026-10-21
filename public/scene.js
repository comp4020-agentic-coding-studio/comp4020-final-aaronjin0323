// The gallery in 3D: a round floor suspended above dusk clouds, open
// arches, six plinths in a ring and the workbench at the centre. It only
// draws; every control lives in the DOM (app.js). Loaded with a dynamic
// import, so if WebGL or the CDN is missing the page carries on without it.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VISITOR_COLOURS } from "./recipes.js";
import { clearFrame, frameHeight, viewOffsetFor } from "./ui-logic.js";
import { animate, buildSculpture, disposeSculpture } from "./sculpture.js";

const TAU = Math.PI * 2;
const PLINTH_R = 5.4;
const FLOOR_R = 8.6;
const PLINTH_H = 1.0;
const ON_PLINTH = 0.78;

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

function skyDome() {
  const geo = new THREE.SphereGeometry(400, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color("#2c2a5c") },
      mid: { value: new THREE.Color("#8a6aa6") },
      low: { value: new THREE.Color("#f5a785") },
      glow: { value: new THREE.Color("#ffd9b0") },
      sun: { value: new THREE.Vector3(-0.55, 0.08, -0.83).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 glow; uniform vec3 sun;
      varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(low, mid, smoothstep(-0.05, 0.28, h));
        c = mix(c, top, smoothstep(0.25, 0.85, h));
        c = mix(c, vec3(0.98,0.80,0.72), smoothstep(0.0, -0.35, h) * 0.6);
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += glow * pow(s, 18.0) * 0.55 + glow * pow(s, 3.0) * 0.12;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** A sea of soft cloud puffs below the floor, lit warm from the low sun. */
function clouds() {
  const group = new THREE.Group();
  const puff = new THREE.IcosahedronGeometry(1, 3);
  // lilac in shadow, peach where the low sun catches them: distinct from the
  // ivory floor, so the gallery reads as floating above them
  const mat = new THREE.MeshStandardMaterial({ color: "#f3c9c4", roughness: 1, metalness: 0, emissive: "#5d4a8a", emissiveIntensity: 0.32 });
  const count = 220;
  const inst = new THREE.InstancedMesh(puff, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU;
    const r = 14 + Math.pow(rnd(), 0.8) * 140;
    const s = 3 + rnd() * 6 + r * 0.05;
    const y = -16 - rnd() * 6 - r * 0.05;
    m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(s * 1.6, s * 0.55, s * 1.3));
    inst.setMatrixAt(i, m);
  }
  inst.receiveShadow = false;
  group.add(inst);
  return group;
}

function floor() {
  const g = new THREE.Group();
  // the floating platform: a rounded slab that tapers to a point underneath
  const top = new THREE.Mesh(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R, 0.35, 96), new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.62 }));
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

/** Open arches round the rim, one bay per twelfth. Each bay has its own
 * materials so the bays between the camera and the centre can fade out
 * instead of walling off the view (fadeBays). */
function arches() {
  const g = new THREE.Group();
  const n = 12;
  const R = FLOOR_R - 0.45;
  const H = 3.4;
  const span = (TAU * R) / n;
  const bays = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const mat = new THREE.MeshStandardMaterial({ color: C.ivory, roughness: 0.55, transparent: true });
    const trim = new THREE.MeshStandardMaterial({ color: C.peach, roughness: 0.5, transparent: true });
    const bay = new THREE.Group();
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, H, 20), mat);
    pillar.position.set(Math.sin(a) * R, H / 2, Math.cos(a) * R);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.14, 20), trim);
    cap.position.set(pillar.position.x, H + 0.07, pillar.position.z);
    const mid = a + Math.PI / n;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(span / 2 - 0.05, 0.14, 12, 40, Math.PI), mat);
    arc.position.set(Math.sin(mid) * R * Math.cos(Math.PI / n), H + 0.07, Math.cos(mid) * R * Math.cos(Math.PI / n));
    arc.rotation.y = mid + Math.PI / 2;
    arc.castShadow = true;
    bay.add(pillar, cap, arc);
    // points along the curve, for telling when a frame cuts through it
    arc.updateMatrix();
    const r = span / 2 - 0.05;
    const curve = [...Array(9)].map((_, k) => new THREE.Vector3(Math.cos((k / 8) * Math.PI) * r, Math.sin((k / 8) * Math.PI) * r, 0).applyMatrix4(arc.matrix));
    bay.userData = { angle: mid, mats: [mat, trim], curve };
    bays.push(bay);
    g.add(bay);
  }
  g.userData.bays = bays;
  return g;
}

/** Fades the bays on the camera's side of the room, so the arches frame the
 * gallery from behind rather than block it from in front. */
function bayOpacity(angle, camYaw) {
  const d = Math.abs(((((angle - camYaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI);
  return 0.04 + 0.96 * THREE.MathUtils.smoothstep(d, 0.9, 1.6);
}
function fadeBays(bays, camYaw) {
  for (const bay of bays) {
    const o = bayOpacity(bay.userData.angle, camYaw);
    for (const m of bay.userData.mats) {
      m.opacity = o;
      m.depthWrite = o > 0.95;
    }
    bay.visible = o > 0.06;
  }
}

function plinth(slot) {
  const g = new THREE.Group();
  g.position.copy(slotPos(slot));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.9, PLINTH_H, 48), new THREE.MeshStandardMaterial({ color: "#f8f0e2", roughness: 0.5 }));
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
  g.add(body, band, top, plate);
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

function bench() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.55, 64), new THREE.MeshStandardMaterial({ color: "#f8efe0", roughness: 0.5 }));
  base.position.y = 0.275;
  base.castShadow = true;
  base.receiveShadow = true;
  const glassTop = new THREE.Mesh(
    new THREE.CylinderGeometry(1.42, 1.42, 0.1, 64),
    new THREE.MeshPhysicalMaterial({ color: "#bfe6e2", transmission: 0.9, roughness: 0.08, thickness: 0.3, ior: 1.4, attenuationColor: C.teal, attenuationDistance: 0.8 }),
  );
  glassTop.position.y = 0.6;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.43, 0.035, 10, 96), new THREE.MeshStandardMaterial({ color: C.chrome, metalness: 0.95, roughness: 0.15 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.65;
  for (const m of [base, glassTop, ring]) m.userData.pick = "bench";
  g.add(base, glassTop, ring);
  const holder = new THREE.Group();
  holder.position.y = 0.66;
  g.add(holder);
  // the "empty bench" marker: a slowly turning ghost ring
  const ghost = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 64), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.6 }));
  ghost.rotation.x = Math.PI / 2;
  ghost.position.y = 1.0;
  g.add(ghost);
  const leases = new THREE.Group();
  g.add(leases);
  return { group: g, holder, ghost, leases };
}

/** A few sculptural plants: a pot and stacked rounded shapes. */
function plants() {
  const g = new THREE.Group();
  const pot = new THREE.MeshStandardMaterial({ color: C.coral, roughness: 0.5 });
  const potAlt = new THREE.MeshStandardMaterial({ color: C.deepTeal, roughness: 0.45 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#5d9c7f", roughness: 0.55 });
  const leafWarm = new THREE.MeshStandardMaterial({ color: "#86b07a", roughness: 0.55 });
  const spots = [0, 2, 4].map((k) => (k / 6) * TAU + Math.PI / 6 + Math.PI / 6);
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

export async function createScene(canvas, { reducedMotion, time, onPick, covers = () => [], onMoved = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#c99bb0", 45, 190);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const rim = arches();
  // the sky, the clouds and the floor are the backdrop: never in the way
  const backdrop = [skyDome(), clouds(), floor()];
  for (const b of backdrop) b.userData.backdrop = true;
  scene.add(...backdrop, rim, plants());

  scene.add(new THREE.HemisphereLight("#ffe2c8", "#7a6aa8", 1.1));
  const sun = new THREE.DirectionalLight("#ffc79a", 2.4);
  sun.position.set(-9, 11, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#c9b8ff", 0.5);
  fill.position.set(8, 6, 10);
  scene.add(fill);
  const benchGlow = new THREE.PointLight("#ffd0a8", 6, 6, 1.8);
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

  // The bench view stands inside the pavilion, between plinths 6 and 1,
  // looking slightly down at the bench sculpture as it is now: on a phone a
  // tight close-up, on a desktop with room for the far plinths and arches
  // round it. It re-fits only when the shared draft changes (a release, or
  // someone else's edit), never from the local preview mid-drag, so the
  // camera doesn't chase a slider while it moves.
  const INSIDE_R = FLOOR_R - 1.0;
  function benchFit(tight) {
    // low, near eye height: the glass top reads as a thin lens, not a disc
    const pitch = tight ? 0.16 : 0.1;
    box.makeEmpty();
    if (wb.holder.children.length) box.setFromObject(wb.holder);
    if (box.isEmpty()) return { focusY: 1.2, dist: 6.6, pitch: 0.24 };
    // the sculpture itself, with only a sliver of glass under it
    const lo = Math.max(box.min.y, 0.45);
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    // fitted to the clear rectangle, not the whole canvas
    const aspect = clear.w / clear.h;
    const f = frameHeight(lo, box.max.y, clearFov(), aspect, tight ? 1.2 : 1.45, tight ? 2.5 : 3.8);
    const tanH = clearTan().h;
    const dist = Math.max(f.dist, (w * (tight ? 1.15 : 1.4)) / 2 / tanH + w / 2);
    // on a desktop, aim a little above the middle: the sculpture sits
    // lower, the glass falls behind the plinth row, the arches rise above
    const focusY = tight ? f.focusY : f.focusY + (box.max.y - lo) * 0.12;
    // never back out through the arches
    return { focusY, dist: Math.min(dist, INSIDE_R / Math.cos(pitch)), pitch };
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
  const solid = (o, camYaw) => {
    const bay = o.parent?.userData.mats ? o.parent.userData : null;
    return !bay || bayOpacity(bay.angle, camYaw) >= 0.5;
  };
  // the target of a close-up: what to keep clear, what to fit
  function targetOf(t) {
    const holder = t === "bench" ? wb.holder : plinths.get(t).holder;
    const root = t === "bench" ? wb.group : plinths.get(t).group;
    box.makeEmpty();
    if (holder.children.length) box.setFromObject(holder);
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
    const camYaw = Math.atan2(c.position.x, c.position.z);
    const rect = screenRect(c, target.box);
    if (!rect) return null;
    const all = [...target.meshes, ...obs];
    const mine = new Set(target.meshes);
    let occ = 0, vis = 0;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        castAt(c, rect.x + ((i + 0.5) / grid) * rect.w, rect.y + ((j + 0.5) / grid) * rect.h);
        const hits = ray.intersectObjects(all, false).filter((hh) => solid(hh.object, camYaw));
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
        const hit = ray.intersectObjects(obs, false).find((hh) => solid(hh.object, camYaw));
        if (hit && hit.distance < NEAR) near++;
      }
    }
    // An arch is cut when part of its curve is in the picture and part
    // runs off the top edge or behind the lens: a stump, not an arch.
    let cuts = 0;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const bay of rim.userData.bays) {
      if (bayOpacity(bay.userData.angle, camYaw) < 0.3) continue;
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
      for (const pitch of [0.12, 0.24, 0.38, 0.52]) {
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
    const best = coarse.slice(0, 8).map((q) => ({ ...q, score: score(q, 5) })).sort((x, y) => x.score - y.score)[0];
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
      goal.focus.set(0, f.focusY, 0);
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
    drag = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, moved: 0, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    interacting = performance.now();
  });
  canvas.addEventListener("pointermove", (e) => {
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

  // ---- sculptures: rebuilt only when their numbers change
  const shown = new Map(); // key -> { sig, group }
  function place(key, holder, recipe, parts) {
    const sig = recipe && parts ? `${recipe}:${JSON.stringify(parts)}` : "";
    const was = shown.get(key);
    if (was && was.sig === sig) return;
    if (was) {
      holder.remove(was.group);
      disposeSculpture(was.group);
    }
    if (!sig) return shown.delete(key);
    const group = buildSculpture(recipe, parts);
    group.traverse((o) => {
      if (o.isMesh) o.userData.pick = key === "bench" ? "bench" : key;
    });
    holder.add(group);
    shown.set(key, { sig, group });
  }

  let last = null;
  let aimed = false;
  let aimedShape = null;
  let override = null;
  let selected = { kind: "bench" };
  function sync() {
    if (!last) return;
    for (const s of last.slots) {
      const p = plinths.get(s.slot);
      place(`slot:${s.slot}`, p.holder, s.exhibit?.latest.recipe, s.exhibit?.latest.parts);
      const on = selected.kind === "slot" && selected.slot === s.slot;
      p.top.material.color.set(on ? "#ff8a73" : C.coral);
      p.spot.intensity = s.exhibit ? (on ? 26 : 14) : 4;
    }
    const d = last.draft;
    place("bench", wb.holder, d.recipe, d.recipe ? (override ?? d.parts) : null);
    wb.ghost.visible = !d.recipe;
    // a ring in the holder's colour for each part someone is shaping
    wb.leases.clear();
    const now = Date.now();
    const order = d.recipe ? Object.keys(d.parts) : [];
    for (const l of last.leases) {
      if (Date.parse(l.expiresAt) <= now - 1000) continue;
      const i = order.indexOf(l.part);
      if (i < 0) continue;
      const colour = VISITOR_COLOURS[l.holder.colour] ?? VISITOR_COLOURS[0];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55 + i * 0.13, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: colour }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.62;
      wb.leases.add(ring);
    }
    wake();
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
  function frame() {
    raf = 0;
    const t = still ? 0 : time();
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
    fadeBays(rim.userData.bays, Math.atan2(camera.position.x, camera.position.z));
    for (const { group } of shown.values()) animate(group, t);
    wb.ghost.rotation.z = t * 0.3;
    renderer.render(scene, camera);
    const settling = Math.abs(goal.yaw - view.yaw) + Math.abs(goal.pitch - view.pitch) + Math.abs(goal.dist - view.dist) + goal.focus.distanceTo(view.focus) > 0.001;
    if (!still || settling) wake();
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
      archTop: 3.4,
      view: { ...clear },
      box: m?.rect ?? { x: 0, y: 0, w: 0, h: 0 },
      occluded: m?.occluded ?? 1,
      near: m?.near ?? 1,
      cuts: m?.cuts ?? 99,
      moved,
    };
  };

  resize();
  wake();

  return {
    /** back to the opening pose, from wherever the visitor has turned */
    home() {
      aimAt({ kind: "bench" });
      wake();
    },
    update(state, sel, draftParts, holding = false) {
      const changed = JSON.stringify(sel) !== JSON.stringify(selected);
      last = state;
      selected = sel;
      override = state.draft.recipe ? draftParts : null;
      sync();
      // after sync, so the framing measures the sculpture now on the plinth;
      // re-aimed when the selected exhibit itself changes shape
      const shape = sel.kind === "slot" ? shown.get(`slot:${sel.slot}`)?.sig : sel.kind === "bench" ? `bench:${state.draft.id}:${state.draft.revision}` : null;
      // while a slider is held the framing waits for the release
      if (changed || !aimed || (shape !== aimedShape && !holding)) {
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
    /** Draw the bench from local numbers while a slider moves. */
    setDraftOverride(parts) {
      override = parts;
      if (!last) return;
      // coalesce rebuilds to one per frame
      if (!this._pending) {
        this._pending = true;
        requestAnimationFrame(() => {
          this._pending = false;
          sync();
        });
      }
    },
    focusPart() {},
  };
}
