// The gallery in 3D: a round floor suspended above dusk clouds, open
// arches, six plinths in a ring and the workbench at the centre. It only
// draws; every control lives in the DOM (app.js). Loaded with a dynamic
// import, so if WebGL or the CDN is missing the page carries on without it.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VISITOR_COLOURS } from "./recipes.js";
import { frameHeight } from "./ui-logic.js";
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
    bay.userData = { angle: mid, mats: [mat, trim] };
    bays.push(bay);
    g.add(bay);
  }
  g.userData.bays = bays;
  return g;
}

/** Fades the bays on the camera's side of the room, so the arches frame the
 * gallery from behind rather than block it from in front. */
function fadeBays(bays, camYaw) {
  for (const bay of bays) {
    const d = Math.abs(((((bay.userData.angle - camYaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI);
    const o = 0.04 + 0.96 * THREE.MathUtils.smoothstep(d, 0.9, 1.6);
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

export async function createScene(canvas, { reducedMotion, time, onPick }) {
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
  scene.add(skyDome(), clouds(), floor(), rim, plants());

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
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  // yaw 0 looks in between plinths 6 and 1, so neither hides the bench
  const view = { yaw: 0, pitch: 0.48, dist: 21, focus: new THREE.Vector3(0, 0.8, 0) };
  const goal = { yaw: view.yaw, pitch: view.pitch, dist: view.dist, focus: view.focus.clone() };
  let interacting = 0;
  let side = 0; // px the panel covers on the right

  // the yaw equal to `a` (mod a turn) nearest the current goal, so the
  // camera takes the short way round
  const nearestYaw = (a) => goal.yaw + ((((a - goal.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

  // The selected exhibit's vertical extent, from what's actually on the
  // plinth; an empty plinth frames as an ordinary one.
  const box = new THREE.Box3();
  function fitSlot(slot) {
    const holder = plinths.get(slot)?.holder;
    box.makeEmpty();
    if (holder && holder.children.length) box.setFromObject(holder);
    const lo = box.isEmpty() ? PLINTH_H : Math.min(box.min.y, PLINTH_H);
    const hi = box.isEmpty() ? PLINTH_H + 1.5 : box.max.y;
    return frameHeight(lo, hi, camera.fov, camera.aspect);
  }

  // On a phone the bench view is a close-up of the bench sculpture as it
  // is now. It re-fits only when the shared draft changes (a release, or
  // someone else's edit), never from the local preview mid-drag, so the
  // camera doesn't chase a slider while it moves.
  function benchFit() {
    box.makeEmpty();
    if (wb.holder.children.length) box.setFromObject(wb.holder);
    if (box.isEmpty()) return { focusY: 1.6, dist: 7 };
    // the sculpture itself, with only a sliver of glass under it
    const lo = Math.max(box.min.y, 0.45);
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const f = frameHeight(lo, box.max.y, camera.fov, camera.aspect, 1.2, 2.5);
    const tanH = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
    return { focusY: f.focusY, dist: Math.max(f.dist, (w * 1.15) / 2 / tanH + w / 2) };
  }

  function aimAt(selected) {
    if (selected.kind === "slot") {
      const a = slotAngle(selected.slot);
      const p = slotPos(selected.slot);
      // from the centre side, a little round, with the arches and the sky
      // behind the exhibit, standing back far enough for all of it
      const f = fitSlot(selected.slot);
      goal.focus.set(p.x, f.focusY, p.z);
      goal.yaw = nearestYaw(a + Math.PI + 0.35);
      goal.pitch = 0.24;
      goal.dist = f.dist;
    } else if (selected.kind === "bench" && innerWidth < 600 && last?.draft.recipe) {
      const f = benchFit();
      goal.focus.set(0, f.focusY, 0);
      goal.dist = f.dist;
      goal.pitch = 0.16;
    } else if (selected.kind === "bench") {
      // the whole floating floor, with sky and clouds round it, the bench
      // in the middle
      const narrow = innerWidth < 600;
      // on a phone the stage is short and wide: aim higher so the floor
      // fills it rather than floating over empty fog
      goal.focus.set(0, narrow ? 1.6 : 0.2, 0);
      goal.dist = narrow ? 22 : 23;
      goal.pitch = 0.4;
    } else {
      // a storeroom exhibit isn't in the room: show the room
      goal.focus.set(0, 0.8, 0);
      goal.dist = 21;
      goal.pitch = 0.48;
    }
  }

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    side = Number(getComputedStyle(canvas).getPropertyValue("--panel-cover").replace("px", "")) || 0;
    // Shift the picture left by half the panel, so what's selected sits in
    // the part of the screen the panel doesn't cover.
    if (side) camera.setViewOffset(w + side, h, side, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
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
    wake();
  });

  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
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
    // a slow drift around the room when nobody's touching it
    if (!still && performance.now() - interacting > 6000 && !drag) goal.yaw += 0.0007;
    const k = still ? 1 : 0.08;
    view.yaw += (goal.yaw - view.yaw) * k;
    view.pitch += (goal.pitch - view.pitch) * k;
    view.dist += (goal.dist - view.dist) * k;
    view.focus.lerp(goal.focus, k);
    camera.position.set(view.focus.x + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.focus.y + Math.sin(view.pitch) * view.dist, view.focus.z + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(view.focus);
    fadeBays(rim.userData.bays, Math.atan2(camera.position.x, camera.position.z));
    for (const { group } of shown.values()) animate(group, t);
    wb.ghost.rotation.z = t * 0.3;
    renderer.render(scene, camera);
    const settling = Math.abs(goal.yaw - view.yaw) + Math.abs(goal.pitch - view.pitch) + Math.abs(goal.dist - view.dist) + goal.focus.distanceTo(view.focus) > 0.001;
    if (!still || settling) wake();
  }

  resize();
  wake();

  return {
    update(state, sel, draftParts, holding = false) {
      const changed = JSON.stringify(sel) !== JSON.stringify(selected);
      last = state;
      selected = sel;
      override = state.draft.recipe ? draftParts : null;
      sync();
      // after sync, so the framing measures the sculpture now on the plinth;
      // re-aimed when the selected exhibit itself changes shape
      const shape = sel.kind === "slot" ? shown.get(`slot:${sel.slot}`)?.sig : sel.kind === "bench" && innerWidth < 600 ? `bench:${state.draft.id}:${state.draft.revision}` : null;
      // while a slider is held the framing waits for the release
      if (changed || !aimed || (shape !== aimedShape && !holding)) {
        aimAt(sel);
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
