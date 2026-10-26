// The room in 3D (ADR 21): the fountain on its pedestal in the middle, six
// plinths round it each playing its exhibit, and everyone's pointers.
// Loaded with a dynamic import, so without WebGL or the CDN the page still
// works from the panel. The scene says what was touched (onGesture,
// onSelect); the page sends it.
import * as THREE from "three";
import { BALLS, BALL_R, BELL, DOME, createRun, gestureMoment, shown } from "./fountain.js";
import { BALL_COLOURS, VISITOR_COLOURS, flickFrom } from "./ui.js";

const STAGE_Y = 0.7; // the pedestal's top: the fountain's floor
const PLINTH_R = 5.4; // how far the plinths stand from the middle
const PLINTH_H = 1.1;
const MINI = 0.34; // an exhibit is the fountain at this scale
const ROOM_R = 9;

/** Where plinth `slot` (1-6) stands, on the floor. */
export function plinthAt(slot) {
  // none of them stands between the opening view and the stage
  const a = ((slot - 1) / 6) * Math.PI * 2;
  return [Math.cos(a) * PLINTH_R, 0, Math.sin(a) * PLINTH_R];
}

export async function createScene(canvas, { onGesture, onSelect, onPointer, loopNow, reducedMotion, coverRight }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog("#3a3358", 14, 30);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);

  // ---- light: a warm key from the side, a cool fill, a glow over the stage
  scene.add(new THREE.HemisphereLight("#cfd8ff", "#5a4a40", 0.9));
  const key = new THREE.DirectionalLight("#ffe2c0", 2.2);
  key.position.set(-6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
  scene.add(key);
  const glow = new THREE.PointLight("#ffd9a8", 6, 6, 1.6);
  glow.position.set(0, STAGE_Y + 2.6, 0);
  scene.add(glow);

  // ---- the room: a round floor, a ring of columns, a low wall
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R + 4, 64), new THREE.MeshStandardMaterial({ color: "#e9dfd0", roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const inlay = new THREE.Mesh(new THREE.RingGeometry(PLINTH_R - 0.05, PLINTH_R + 0.05, 96), new THREE.MeshStandardMaterial({ color: "#c9b79c", roughness: 0.6 }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.002;
  scene.add(inlay);
  const stoneMat = new THREE.MeshStandardMaterial({ color: "#f3ece1", roughness: 0.7 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 5, 20), stoneMat);
    col.position.set(Math.cos(a) * ROOM_R, 2.5, Math.sin(a) * ROOM_R);
    col.castShadow = true;
    scene.add(col);
  }
  const beam = new THREE.Mesh(new THREE.TorusGeometry(ROOM_R, 0.22, 10, 96), stoneMat);
  beam.rotation.x = Math.PI / 2;
  beam.position.y = 5.05;
  scene.add(beam);

  // ---- the fountain: pedestal, glass dome, the bell on its thread, the balls
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(DOME.radius + 0.25, DOME.radius + 0.45, STAGE_Y, 64), new THREE.MeshStandardMaterial({ color: "#efe6d8", roughness: 0.6 }));
  pedestal.position.y = STAGE_Y / 2;
  pedestal.castShadow = pedestal.receiveShadow = true;
  scene.add(pedestal);
  const stage = makeFountain(1);
  stage.group.position.y = STAGE_Y;
  scene.add(stage.group);

  // ---- the plinths, each with a small fountain playing its exhibit
  const plinths = [];
  for (let slot = 1; slot <= 6; slot++) {
    const [x, , z] = plinthAt(slot);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, PLINTH_H, 40), stoneMat.clone());
    body.position.y = PLINTH_H / 2;
    body.castShadow = body.receiveShadow = true;
    body.userData = { kind: "plinth", slot };
    g.add(body);
    const mini = makeFountain(MINI);
    mini.group.position.y = PLINTH_H;
    g.add(mini.group);
    const label = textSprite(String(slot), { size: 64, bg: "rgba(38,34,61,.85)" });
    label.position.set(0, PLINTH_H * 0.55, 0);
    g.add(label);
    const title = textSprite("", { size: 36, bg: "rgba(251,246,238,.92)", color: "#26223d" });
    title.position.set(0, PLINTH_H + DOME.height * MINI + 0.38, 0);
    g.add(title);
    scene.add(g);
    plinths.push({ slot, group: g, body, mini, title, run: null, key: "" });
  }

  // ---- the shared stage's performance
  let stageRun = createRun([]);
  let stageKey = "";
  let seen = 0;
  let you = null;

  // ---- others' pointers: an orb in their colour, with their name
  const others = new Map();
  function setPointers(list) {
    const live = new Set();
    for (const p of list) {
      if (you && p.tag === you.tag) continue;
      live.add(p.tag);
      let o = others.get(p.tag);
      if (!o) {
        const c = VISITOR_COLOURS[p.colour % VISITOR_COLOURS.length];
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 24), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        orb.add(ring);
        const name = textSprite(p.name, { size: 30, bg: c, color: "#fff" });
        name.position.y = 0.22;
        orb.add(name);
        scene.add(orb);
        o = { orb, ring, name, nameText: p.name, to: new THREE.Vector3() };
        orb.position.fromArray(p.p);
        others.set(p.tag, o);
      }
      if (o.nameText !== p.name) {
        o.orb.remove(o.name);
        o.name = textSprite(p.name, { size: 30, bg: VISITOR_COLOURS[p.colour % VISITOR_COLOURS.length], color: "#fff" });
        o.name.position.y = 0.22;
        o.orb.add(o.name);
        o.nameText = p.name;
      }
      o.to.fromArray(p.p);
    }
    for (const [tag, o] of others) if (!live.has(tag)) {
      scene.remove(o.orb);
      others.delete(tag);
    }
  }

  // ---- the camera: it orbits a target; choosing a plinth flies there
  const STAGE_VIEW = { y: 1.1, dist: 12.5, polar: 0.98 };
  const view = { target: new THREE.Vector3(0, STAGE_VIEW.y, 0), dist: STAGE_VIEW.dist, az: Math.PI / 2, polar: STAGE_VIEW.polar };
  const goal = { ...view, target: view.target.clone() };
  let selected = { kind: "stage" };
  function select(sel) {
    selected = sel;
    if (sel.kind === "stage") Object.assign(goal, { target: new THREE.Vector3(0, STAGE_VIEW.y, 0), dist: STAGE_VIEW.dist, polar: STAGE_VIEW.polar });
    else {
      const [x, , z] = plinthAt(sel.slot);
      const az = Math.atan2(z, x);
      Object.assign(goal, { target: new THREE.Vector3(x, PLINTH_H + 0.35, z), dist: 3.1, polar: 1.12, az });
    }
    if (reducedMotion()) copyView(goal, view);
  }
  const copyView = (from, to) => {
    to.target.copy(from.target);
    to.dist = from.dist;
    to.az = from.az;
    to.polar = from.polar;
  };
  function placeCamera(dt) {
    const k = reducedMotion() ? 1 : 1 - Math.exp(-dt * 4);
    view.target.lerp(goal.target, k);
    view.dist += (goal.dist - view.dist) * k;
    let da = goal.az - view.az;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    view.az += da * k;
    view.polar += (goal.polar - view.polar) * k;
    const s = Math.sin(view.polar);
    camera.position.set(view.target.x + view.dist * s * Math.cos(view.az), view.target.y + view.dist * Math.cos(view.polar), view.target.z + view.dist * s * Math.sin(view.az));
    camera.lookAt(view.target);
  }

  // ---- touch: press a ball and drag to flick it; click the bell; drag
  // empty space to look round; click a plinth to go to it
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const touchables = () => [...stage.balls.values(), stage.bell, ...plinths.map((p) => p.body)];
  function hitAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(touchables(), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (o) return { kind: o.userData.kind, id: o.userData.id, slot: o.userData.slot, point: h.point };
    }
    const f = ray.intersectObject(floor)[0];
    return f ? { kind: "floor", point: f.point } : null;
  }
  const aim = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
  aim.visible = false;
  aim.renderOrder = 10;
  scene.add(aim);

  let press = null; // { id, kind, x, y, moved, ball?, plane?, from? }
  const pointersDown = new Map();
  let pinch = null;
  let playable = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointersDown.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersDown.size === 2) {
      const [a, b] = [...pointersDown.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: goal.dist };
      press = null;
      aim.visible = false;
      return;
    }
    const hit = hitAt(e.clientX, e.clientY);
    press = { kind: hit?.kind ?? "none", id: hit?.id, slot: hit?.slot, x: e.clientX, y: e.clientY, moved: 0 };
    if (playable && hit?.kind === "ball") {
      const ball = stage.balls.get(hit.id);
      const centre = ball.getWorldPosition(new THREE.Vector3());
      const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
      press.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
      press.from = centre;
      canvas.dataset.dragging = "";
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointersDown.has(e.pointerId)) pointersDown.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointersDown.size === 2) {
      const [a, b] = [...pointersDown.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      goal.dist = THREE.MathUtils.clamp((pinch.dist * pinch.d) / Math.max(d, 1), 2.6, 13);
      return;
    }
    const hit = hitAt(e.clientX, e.clientY);
    sendPointer(hit?.point ?? null);
    if (!press) {
      canvas.dataset.hover = hit?.kind === "ball" || hit?.kind === "bell" ? (playable ? hit.kind : "") : hit?.kind === "plinth" ? "plinth" : "";
      return;
    }
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    press.moved = Math.max(press.moved, Math.hypot(dx, dy));
    if (press.plane) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const p = ray.ray.intersectPlane(press.plane, new THREE.Vector3());
      if (p) {
        press.to = p;
        aim.geometry.setFromPoints([press.from, p]);
        aim.visible = true;
      }
    } else if (press.moved > 4) {
      // turn round the target
      goal.az += (e.movementX || 0) * 0.006;
      goal.polar = THREE.MathUtils.clamp(goal.polar - (e.movementY || 0) * 0.004, 0.55, 1.45);
      if (reducedMotion()) copyView(goal, view);
    }
  });
  const release = (e) => {
    pointersDown.delete(e.pointerId);
    if (pinch) {
      if (pointersDown.size < 2) pinch = null;
      return;
    }
    const p = press;
    press = null;
    aim.visible = false;
    delete canvas.dataset.dragging;
    if (!p || e.type === "pointercancel") return;
    if (p.plane && playable) {
      const to = p.moved > 6 && p.to ? p.to : p.from;
      onGesture({ kind: "flick", ball: p.id, v: flickFrom(p.from.toArray(), to.toArray()), at: gestureMoment(loopNow()) });
      return;
    }
    if (p.moved > 6) return;
    if (p.kind === "bell" && playable) onGesture({ kind: "ring", at: gestureMoment(loopNow()) });
    else if (p.kind === "plinth") onSelect({ kind: "slot", slot: p.slot });
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    canvas.dataset.hover = "";
    sendPointer(null);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    goal.dist = THREE.MathUtils.clamp(goal.dist * (1 + Math.sign(e.deltaY) * 0.08), 2.6, 13);
    if (reducedMotion()) copyView(goal, view);
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const turn = { ArrowLeft: -0.12, ArrowRight: 0.12 }[e.key];
    if (turn) {
      goal.az += turn;
      e.preventDefault();
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      goal.dist = THREE.MathUtils.clamp(goal.dist * (e.key === "ArrowUp" ? 0.92 : 1.08), 2.6, 13);
      e.preventDefault();
    }
  });

  // your pointer, for everyone else: at most 10 a second, and null when it leaves
  let lastSent = 0, pending = undefined, sendTimer = null;
  function sendPointer(p) {
    pending = p ? [clamp(p.x, -8, 8), clamp(p.y, 0, 4), clamp(p.z, -8, 8)] : null;
    if (sendTimer) return;
    const wait = Math.max(0, 100 - (performance.now() - lastSent));
    sendTimer = setTimeout(() => {
      sendTimer = null;
      lastSent = performance.now();
      onPointer(pending);
    }, wait);
  }

  // ---- flashes: a ring of light where something happened
  const flashes = [];
  function flash(pos, colour, size) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 32), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(pos[0], pos[1] + STAGE_Y, pos[2]);
    m.lookAt(camera.position);
    m.scale.setScalar(size * 0.3);
    scene.add(m);
    flashes.push({ m, t: 0, size });
  }
  let onEvent = () => {};

  // ---- each frame
  function update(state, me) {
    you = me;
    const key = JSON.stringify(state.stage.gestures.map((g) => [g.seq, g.by, g.at]));
    if (key !== stageKey) {
      stageKey = key;
      stageRun = createRun(state.stage.gestures);
      seen = stageRun.at(loopNow()).events.length;
    }
    for (const p of plinths) {
      const ex = state.slots[p.slot - 1].exhibit;
      const k = ex ? `${ex.id}:${ex.latest.n}` : "";
      if (k === p.key) continue;
      p.key = k;
      p.run = ex ? createRun(ex.latest.gestures) : null;
      p.mini.group.visible = !!ex;
      setText(p.title, ex ? ex.latest.title : "");
      p.title.visible = !!ex;
    }
  }
  /** Your own gesture, played at once before the server answers. */
  function playLocal(gestures) {
    stageKey = "local";
    stageRun = createRun(gestures);
    seen = stageRun.at(Math.max(0, loopNow() - 1 / 60)).events.length;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    resize();
    placeCamera(dt);
    const t = loopNow();
    const st = stageRun.at(t);
    if (st.events.length < seen) seen = 0;
    for (; seen < st.events.length; seen++) {
      const e = st.events[seen];
      onEvent(e);
      if (e.kind === "ring") flash(BELL.pos, "#ffe7a6", 1.2);
      else if (e.kind === "knock") flash(e.pos, "#ffffff", 0.6);
      else if (e.kind === "flick") flash(e.pos, BALL_COLOURS[e.ball], 0.5);
    }
    stage.show(shown(st, t), t);
    for (const p of plinths) if (p.run) p.mini.show(shown(p.run.at(t), t), t);
    for (const f of flashes.slice()) {
      f.t += dt;
      f.m.scale.setScalar(f.size * (0.3 + f.t * 1.6));
      f.m.material.opacity = Math.max(0, 0.8 - f.t * 1.6);
      if (f.t > 0.5) {
        scene.remove(f.m);
        flashes.splice(flashes.indexOf(f), 1);
      }
    }
    for (const o of others.values()) {
      o.orb.position.lerp(o.to, 1 - Math.exp(-dt * 12));
      o.ring.lookAt(camera.position);
    }
    for (const p of plinths) p.body.material.emissive.set(selected.kind === "slot" && selected.slot === p.slot ? "#3a2a10" : "#000000");
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const cover = coverRight();
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio()) || camera.userData.cover !== cover) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // centre the room in the part the panel doesn't cover
      if (cover > 0) camera.setViewOffset(w + cover, h, cover, 0, w, h);
      else camera.clearViewOffset();
      camera.userData.cover = cover;
      camera.updateProjectionMatrix();
    }
  }
  placeCamera(1);
  requestAnimationFrame(frame);

  // For the browser check: where things are on screen, and what's playing.
  canvas.probe = () => {
    const r = canvas.getBoundingClientRect();
    const onScreen = (obj) => {
      const v = obj.getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    return {
      balls: Object.fromEntries([...stage.balls].map(([id, m]) => [id, { ...onScreen(m), pos: m.position.toArray() }])),
      bell: onScreen(stage.bell),
      plinths: plinths.map((p) => ({ slot: p.slot, ...onScreen(p.body), showing: p.mini.group.visible })),
      others: [...others.keys()],
      gestures: stageKey,
    };
  };

  return {
    update,
    playLocal,
    select,
    setPointers,
    setPlayable: (p) => (playable = p),
    onEvent: (fn) => (onEvent = fn),
  };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** The fountain, at a scale: glass dome, bell on its thread, four balls. */
function makeFountain(scale) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  group.add(inner);
  const glass = new THREE.MeshPhysicalMaterial({ color: "#dff4f2", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(DOME.radius, DOME.radius, DOME.height, 64, 1, true), glass);
  dome.position.y = DOME.height / 2;
  dome.renderOrder = 2;
  inner.add(dome);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(DOME.radius, 64), glass.clone());
  lid.material.opacity = 0.28;
  lid.rotation.x = Math.PI / 2;
  lid.position.y = DOME.height;
  inner.add(lid);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(DOME.radius, 0.03, 8, 96), new THREE.MeshStandardMaterial({ color: "#c7ccd2", metalness: 0.9, roughness: 0.25 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = DOME.height;
  inner.add(rim);
  const base = new THREE.Mesh(new THREE.CircleGeometry(DOME.radius, 64), new THREE.MeshStandardMaterial({ color: "#bfe3df", roughness: 0.3, metalness: 0.1 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.003;
  base.receiveShadow = true;
  inner.add(base);

  // the bell hangs upward from the floor on a thread, its mouth to the sky
  const bellGroup = new THREE.Group();
  inner.add(bellGroup);
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, BELL.pos[1] - BELL.r * 0.9, 6), new THREE.MeshBasicMaterial({ color: "#6b5a46" }));
  thread.position.y = (BELL.pos[1] - BELL.r * 0.9) / 2;
  bellGroup.add(thread);
  // a church bell's outline, crown to lip (then turned mouth up)
  const R = BELL.r;
  const profile = [[0.001, 0.95], [0.3, 0.95], [0.48, 0.85], [0.55, 0.6], [0.57, 0.2], [0.66, -0.3], [0.86, -0.7], [1.0, -0.85], [0.96, -0.92]].map(([x, y]) => new THREE.Vector2(x * R, y * R));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), new THREE.MeshStandardMaterial({ color: "#e8bb55", metalness: 0.5, roughness: 0.3, emissive: "#4a3300", side: THREE.DoubleSide }));
  bell.rotation.x = Math.PI; // mouth up
  bell.position.y = BELL.pos[1];
  bell.castShadow = true;
  bell.userData = { kind: "bell", id: "bell" };
  bellGroup.add(bell);

  const balls = new Map();
  for (const id of BALLS) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ color: BALL_COLOURS[id], roughness: 0.25, metalness: 0.15 }));
    m.castShadow = true;
    m.userData = { kind: "ball", id };
    inner.add(m);
    balls.set(id, m);
  }

  function show(v, t) {
    for (const id of BALLS) balls.get(id).position.fromArray(v.balls[id].pos);
    // the bell swings on its thread for a moment after it rings
    const since = v.bell.rungAt < 0 ? 99 : t - v.bell.rungAt;
    const swing = since >= 0 && since < 2 ? Math.sin(since * 18) * Math.exp(-since * 2.5) * 0.18 : 0;
    bellGroup.rotation.z = swing;
  }
  return { group, balls, bell, show };
}

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2b2747");
  grad.addColorStop(0.55, "#6b5a86");
  grad.addColorStop(0.8, "#e2a27f");
  grad.addColorStop(1, "#f3cfa3");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A label that always faces the camera. */
function textSprite(text, { size = 32, bg = "#000", color = "#fff" } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  s.userData.style = { size, bg, color };
  s.renderOrder = 20;
  setText(s, text);
  return s;
}
function setText(sprite, text) {
  const { size, bg, color } = sprite.userData.style;
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text || " ").width) + size;
  c.width = w;
  c.height = Math.ceil(size * 1.6);
  g.font = font;
  g.fillStyle = bg;
  const r = c.height / 2;
  g.beginPath();
  g.roundRect(0, 0, w, c.height, r);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillText(text, w / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map?.dispose();
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  const h = 0.22;
  sprite.scale.set((h * w) / c.height, h, 1);
}
