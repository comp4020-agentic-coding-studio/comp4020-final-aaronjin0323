// What every set's view shares (ADR 18; public/sets/README.md): playing a
// performance to the loop moment with the glide home and the "from the top"
// marks, and the brief rings of light where something happened. Takes
// THREE as an argument, like every view, so nothing here loads Three.js:
// the page imports the views even without WebGL.
import { GLIDE, LOOP, ease, follow } from "../stage.js";

/**
 * Plays one performance for a screen: `play(p, t, still)` returns the
 * stage as shown at loop moment t (eased home in the last GLIDE) and the
 * events that are news on this screen: after a replay only what's
 * happening now (a gesture just made shows at once), otherwise everything
 * since the last call, plus `top` (the loop came round) and `home` (the
 * glide began), which every set's view and sound may answer.
 */
export function createPlayer() {
  // one run, replayed only when the gestures change, from the latest
  // moment the change can't have touched (stage.js, follow)
  const playing = follow();
  let lastT = -1;
  /** @param {import("../stage.js").Performance} p @param {number} t @param {boolean} still */
  return function play(p, t, still) {
    const { run, fresh: changed } = playing(p);
    if (changed) lastT = -1;
    const replayed = lastT < 0;
    const moment = still ? 0 : t;
    const played = run.at(moment);
    const stage = ease(played.stage, p.set, moment);
    const events = played.events;
    const fresh = replayed ? events.filter((e) => e.t >= t - 0.12) : events;
    if (!replayed && !still) {
      if (t < lastT) fresh.push({ kind: "top", object: "stage", t, pos: [0, 0.02, 0] });
      else if (lastT < LOOP - GLIDE && t >= LOOP - GLIDE) fresh.push({ kind: "home", object: "stage", t, pos: [0, 0.02, 0] });
    }
    lastT = t;
    return { stage, events: fresh };
  };
}

/**
 * Brief rings of light on a group: `flash(kind, pos, colour, size)` adds a
 * thin ring that grows and fades in under half a second (`floor`: lying
 * flat across the stage, slower, for "from the top"; `ring`: flat; any
 * other kind: facing up and outward). `step()` ages them (call it every
 * update); `busy()` while any shows.
 * @param {any} THREE @param {any} group
 */
export function createFlashes(THREE, group) {
  const geo = ringGeometry(THREE);
  const flashes = [];
  return {
    flash(kind, pos, colour, size = 1) {
      const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.fromArray(pos);
      mesh.rotation.x = kind === "ring" || kind === "floor" ? Math.PI / 2 : Math.PI / 3;
      group.add(mesh);
      flashes.push({ mesh, born: performance.now(), size, kind });
    },
    step() {
      const now = performance.now();
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const age = (now - f.born) / (f.kind === "floor" ? 900 : 450);
        if (age >= 1) {
          group.remove(f.mesh);
          f.mesh.material.dispose();
          flashes.splice(i, 1);
          continue;
        }
        f.mesh.scale.setScalar(f.kind === "floor" ? f.size * (0.15 + age * 0.85) : f.size * (0.5 + age * 1.2));
        f.mesh.material.opacity = 0.9 * (1 - age) ** 2;
      }
    },
    busy: () => flashes.length > 0,
    dispose() {
      for (const f of flashes) f.mesh.material.dispose();
    },
  };
}

// one torus for every flash of every view
let ringGeo = null;
const ringGeometry = (THREE) => (ringGeo ??= new THREE.TorusGeometry(1, 0.035, 8, 48));
