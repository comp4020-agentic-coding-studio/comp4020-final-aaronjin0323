// A performance in 3D: the orbit set's spheres, ribbon and bell, played by
// public/stage.js from the gestures and the loop clock, with a flash in the
// player's colour on everything that happens. It only draws; the scene
// (scene.js) handles touch and the page (app.js) sends gestures.
import * as THREE from "three";
import { BELL, GLIDE, LOOP, PALETTE, RIBBON, SETS, SPHERES, VISITOR_COLOURS, ease, follow, ribbonPoint } from "./stage.js";

const hex = (i) => new THREE.Color(PALETTE[i]?.hex ?? "#ccc");

/** The ribbon's centre line as a Three.js curve. */
class RibbonCurve extends THREE.Curve {
  getPoint(u, target = new THREE.Vector3()) {
    return target.fromArray(ribbonPoint(u));
  }
}

/** A flat band along the curve, twisting gently, both sides lit. */
function ribbonGeometry(curve) {
  const N = 360;
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

const shared = {};
function materials() {
  if (shared.ok) return shared;
  shared.ok = true;
  shared.ribbon = new THREE.MeshStandardMaterial({ color: hex(SETS.orbit.colour.ribbon), side: THREE.DoubleSide, roughness: 0.32, metalness: 0.2 });
  shared.bell = new THREE.MeshStandardMaterial({ color: hex(SETS.orbit.colour.bell), metalness: 0.85, roughness: 0.22 });
  shared.spheres = Object.fromEntries(SPHERES.map((id) => [id, new THREE.MeshStandardMaterial({ color: hex(SETS.orbit.colour[id]), metalness: id === "chrome" ? 0.95 : 0.55, roughness: id === "chrome" ? 0.08 : 0.25 })]));
  shared.ballGeo = new THREE.SphereGeometry(SETS.orbit.sphereR, 32, 20);
  shared.ribbonGeo = ribbonGeometry(new RibbonCurve());
  shared.pulseGeo = new THREE.SphereGeometry(0.06, 12, 8);
  shared.ringGeo = new THREE.TorusGeometry(1, 0.035, 8, 48);
  shared.shadowGeo = new THREE.CircleGeometry(1, 32);
  return shared;
}

/** The bell: a dome with a lip and a clapper, hanging from nothing. */
function bellMesh(m) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(BELL.r * (0.25 + 0.75 * Math.sin((t * Math.PI) / 2) ** 0.8) * (t > 0.92 ? 1.12 : 1), BELL.r * (1.1 - 1.6 * t)));
  }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m.bell);
  dome.material.side = THREE.DoubleSide;
  dome.castShadow = true;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(BELL.r * 0.28, 16, 10), m.bell);
  clapper.position.y = -BELL.r * 0.55;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(BELL.r * 0.22, 16, 10), m.bell);
  knob.position.y = BELL.r * 1.15;
  g.add(dome, clapper, knob);
  for (const o of [dome, clapper, knob]) o.userData.object = "bell";
  return g;
}

/**
 * A performance on a holder group. `update(p, t, opts)` plays the
 * performance `p` to loop moment `t` and returns what happened since the
 * last call (for sounds). `opts.colourOf(tag)` names a player's colour;
 * `opts.held` lists spheres being dragged (drawn by the scene instead).
 */
export function createStageView() {
  const m = materials();
  const root = new THREE.Group();
  const ribbon = new THREE.Mesh(m.ribbonGeo, m.ribbon);
  ribbon.castShadow = true;
  ribbon.userData.object = "ribbon";
  const bell = bellMesh(m);
  bell.position.fromArray(BELL.pos);
  root.add(ribbon, bell);
  const balls = {};
  const shadows = {};
  for (const id of SPHERES) {
    const b = new THREE.Mesh(m.ballGeo, m.spheres[id]);
    b.castShadow = true;
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
  // flashes: brief rings and halos where something happened, each in the
  // colour of whoever set it off
  const flashes = [];
  const flashGroup = new THREE.Group();
  root.add(flashGroup);
  // pulses running round the ribbon
  const pulseMeshes = [];

  // one run, replayed only when the gestures change, from the latest
  // moment the change can't have touched (stage.js, follow)
  const playing = follow();
  let lastT = -1;
  let bellSwing = 0;

  // Every flash is a thin ring that grows and fades in under half a
  // second: it marks where and by whom, without hiding the objects.
  function flash(kind, pos, colour, size = 1) {
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(m.ringGeo, mat);
    mesh.position.fromArray(pos);
    // a bell's ring and the loop's "from the top" lie flat; the rest face
    // up and outward
    mesh.rotation.x = kind === "ring" || kind === "floor" ? Math.PI / 2 : Math.PI / 3;
    flashGroup.add(mesh);
    flashes.push({ mesh, born: performance.now(), size, kind });
  }

  function update(p, t, { colourOf = () => "#ffffff", held = [], still = false } = {}) {
    const { run, fresh: changed } = playing(p);
    if (changed) lastT = -1;
    const replayed = lastT < 0;
    const moment = still ? 0 : t;
    const played = run.at(moment);
    // the last moments of the loop: every sphere eases home (stage.js, ease)
    const stage = ease(played.stage, p.set, moment);
    const events = played.events;
    // A new run replays the loop from its start up to now: only what's
    // happening right now is news (a gesture just made shows at once).
    // When the loop comes round, everything since its start is.
    const fresh = replayed ? events.filter((e) => e.t >= t - 0.12) : events;
    // "from the top": the loop came round, or the glide home began
    if (!replayed && !still) {
      if (t < lastT) fresh.push({ kind: "top", object: "stage", t, pos: [0, 0.02, 0] });
      else if (lastT < LOOP - GLIDE && t >= LOOP - GLIDE) fresh.push({ kind: "home", object: "stage", t, pos: [0, 0.02, 0] });
    }
    lastT = t;
    for (const id of SPHERES) {
      const s = stage.spheres[id];
      const b = balls[id];
      b.visible = !held.includes(id);
      b.position.fromArray(s.pos);
      const sh = shadows[id];
      sh.visible = b.visible;
      sh.position.set(s.pos[0], 0.005, s.pos[2]);
      const k = Math.max(0.35, 1 - s.pos[1] / 2.6);
      sh.scale.setScalar(SETS.orbit.sphereR * 1.4 * k);
      sh.material.opacity = 0.22 * k;
    }
    // the bell swings a little after it rings
    if (stage.lastRing !== null) bellSwing = Math.max(0, 1 - (stage.t - stage.lastRing) / 1.2);
    else bellSwing = 0;
    bell.rotation.z = Math.sin(stage.t * 18) * 0.22 * bellSwing;
    // pulses: a bright bead running each way round the ribbon
    const live = stage.pulses.filter((q) => q.age < 0.6);
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
      const c = e.by ? colourOf(e.by) : e.object && SETS.orbit.colour[e.object] !== undefined ? PALETTE[SETS.orbit.colour[e.object]].hex : "#fff";
      if (e.kind === "top") flash("floor", e.pos, "#fff1dc", SETS.orbit.radius);
      else if (e.kind === "home") continue;
      else if (e.kind === "ring") flash("ring", BELL.pos, c, 0.45);
      else if (e.kind === "catch") flash("halo", e.pos, PALETTE[SETS.orbit.colour[e.object]].hex, 0.26);
      else if (e.kind === "knock") flash("halo", e.pos, "#ffffff", 0.22);
      else if (e.kind === "fling" || e.kind === "hop") flash("halo", e.pos, c, 0.24);
      else if (e.kind === "throw") flash("halo", e.pos, c, 0.24);
      else if (e.kind === "pluck") flash("halo", e.pos, c, 0.2);
    }
    const now = performance.now();
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const age = (now - f.born) / (f.kind === "floor" ? 900 : 450);
      if (age >= 1) {
        flashGroup.remove(f.mesh);
        f.mesh.material.dispose();
        flashes.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(f.kind === "floor" ? f.size * (0.15 + age * 0.85) : f.size * (0.5 + age * 1.2));
      f.mesh.material.opacity = 0.9 * (1 - age) ** 2;
    }
    return fresh;
  }

  /** Where each object is now, for touch and the browser check. */
  function objects() {
    return { ribbon, bell, balls };
  }

  function dispose() {
    for (const f of flashes) f.mesh.material.dispose();
    for (const s of Object.values(shadows)) s.material.dispose();
    for (const pm of pulseMeshes) pm.material.dispose();
  }

  return { root, update, objects, dispose, busy: () => flashes.length > 0 };
}

export { LOOP, RIBBON, VISITOR_COLOURS };
