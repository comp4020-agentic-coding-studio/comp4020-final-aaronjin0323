// The other visitors in the room (ADR 17): each a soft floating head in
// their colour with a small visor for where they look, their name above it,
// a hand orb where they reach, and what they hold floating in front (as its
// set's view says it looks).
// Drawn from the `poses` event; names reach the canvas only through
// fillText, never as markup.
import * as THREE from "three";
import { VISITOR_COLOURS } from "./stage.js";
import { heldLook } from "./sets/views.js";
import { EYE, lookDir } from "./walk.js";

const HEAD_R = 0.18;
const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

const headGeo = new THREE.SphereGeometry(HEAD_R, 32, 20);
const visorGeo = new THREE.SphereGeometry(1, 24, 12);
const handGeo = new THREE.SphereGeometry(0.06, 16, 10);
const ballGeo = new THREE.SphereGeometry(1, 24, 16);

/** A name on a little rounded card, as a sprite that always faces you. */
function nameSprite(name, colour) {
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const font = "600 44px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  x.font = font;
  const w = Math.min(560, Math.ceil(x.measureText(name).width) + 56);
  c.width = w;
  c.height = 76;
  x.font = font;
  x.fillStyle = "rgba(44, 38, 64, 0.82)";
  x.beginPath();
  x.roundRect(2, 2, w - 4, 72, 36);
  x.fill();
  x.fillStyle = colour;
  x.beginPath();
  x.arc(34, 38, 11, 0, TAU);
  x.fill();
  x.fillStyle = "#fbf6ec";
  x.textBaseline = "middle";
  x.fillText(name, 54, 40, w - 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const h = 0.2;
  sprite.scale.set((h * w) / 76, h, 1);
  sprite.renderOrder = 5;
  return sprite;
}

export function createAvatars(scene) {
  const root = new THREE.Group();
  scene.add(root);
  /** @type {Map<string, any>} */
  const people = new Map();

  function make(p) {
    const colour = VISITOR_COLOURS[p.colour] ?? VISITOR_COLOURS[0];
    const g = new THREE.Group();
    g.rotation.order = "YXZ";
    const skin = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.05, emissive: colour, emissiveIntensity: 0.18, transparent: true });
    const head = new THREE.Mesh(headGeo, skin);
    const visorMat = new THREE.MeshStandardMaterial({ color: "#2d2640", roughness: 0.2, metalness: 0.4, transparent: true });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.scale.set(0.11, 0.05, 0.06);
    visor.position.set(0, 0.02, -HEAD_R * 0.92);
    g.add(head, visor);
    root.add(g);
    const label = nameSprite(p.name, colour);
    root.add(label);
    const handMat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.5, roughness: 0.3, transparent: true });
    const hand = new THREE.Mesh(handGeo, handMat);
    hand.visible = false;
    root.add(hand);
    const ballMat = new THREE.MeshStandardMaterial({ metalness: 0.6, roughness: 0.22, transparent: true });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.visible = false;
    root.add(ball);
    return {
      g, label, hand, ball, mats: [skin, visorMat, handMat, ballMat, label.material],
      name: p.name, colour: p.colour,
      at: [...p.at], look: [...p.look], reach: p.reach ? [...p.reach] : null,
      goal: p, opacity: 0, leaving: false, screen: { x: 0, y: 0 }, visible: false,
    };
  }

  function drop(tag, a) {
    root.remove(a.g, a.label, a.hand, a.ball);
    a.label.material.map.dispose();
    for (const m of a.mats) m.dispose();
    people.delete(tag);
  }

  /** The newest `poses` event: everyone but you, as they stand now. */
  function set(ev, youTag) {
    const seen = new Set();
    for (const p of ev?.poses ?? []) {
      if (!p || p.tag === youTag || !Array.isArray(p.at) || !Array.isArray(p.look)) continue;
      seen.add(p.tag);
      let a = people.get(p.tag);
      // a new name or colour: a new label
      if (a && (a.name !== p.name || a.colour !== p.colour)) {
        drop(p.tag, a);
        a = undefined;
      }
      if (!a) {
        a = make(p);
        people.set(p.tag, a);
      }
      a.goal = p;
      a.leaving = false;
    }
    for (const [tag, a] of people) if (!seen.has(tag)) a.leaving = true;
  }

  const v = new THREE.Vector3();
  /** Eases everyone toward their newest pose; true while anyone is moving. */
  function update(dt, camera, w, h, still) {
    const k = still ? 1 : 1 - Math.exp(-dt * 12);
    let busy = false;
    for (const [tag, a] of [...people]) {
      const p = a.goal;
      const fade = a.leaving ? 0 : 1;
      a.opacity += (fade - a.opacity) * (still ? 1 : 1 - Math.exp(-dt * 6));
      if (a.leaving && a.opacity < 0.02) {
        drop(tag, a);
        continue;
      }
      const before = a.at[0] + a.at[1] + a.look[0] + a.look[1];
      a.at[0] += (p.at[0] - a.at[0]) * k;
      a.at[1] += (p.at[1] - a.at[1]) * k;
      a.look[0] += wrap(p.look[0] - a.look[0]) * k;
      a.look[1] += (p.look[1] - a.look[1]) * k;
      if (Math.abs(a.at[0] + a.at[1] + a.look[0] + a.look[1] - before) > 1e-4 || Math.abs(fade - a.opacity) > 0.02) busy = true;
      a.g.position.set(a.at[0], EYE, a.at[1]);
      a.g.rotation.set(a.look[1], a.look[0], 0);
      a.label.position.set(a.at[0], EYE + HEAD_R + 0.2, a.at[1]);
      // the hand: where they reach, eased the same way
      if (p.reach) {
        if (!a.reach) a.reach = [a.at[0], EYE - 0.3, a.at[1]];
        for (let i = 0; i < 3; i++) a.reach[i] += (p.reach[i] - a.reach[i]) * k;
        a.hand.position.fromArray(a.reach);
        a.hand.visible = true;
      } else {
        a.reach = null;
        a.hand.visible = false;
      }
      // what they hold floats in front of them, a little low
      const look = heldLook(p.holding);
      a.ball.visible = !!look;
      if (look) {
        a.ball.scale.setScalar(look.r);
        a.ball.material.color.set(look.colour);
        const d = lookDir(a.look);
        a.ball.position.set(a.at[0] + d[0] * 0.55, EYE - 0.18 + d[1] * 0.55, a.at[1] + d[2] * 0.55);
      }
      for (const m of a.mats) m.opacity = a.opacity;
      // where the head is on your screen, for the browser check
      v.set(a.at[0], EYE, a.at[1]).applyMatrix4(camera.matrixWorldInverse);
      const front = v.z < 0;
      v.set(a.at[0], EYE, a.at[1]).project(camera);
      a.screen = { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      a.visible = front && a.opacity > 0.5 && a.screen.x >= 0 && a.screen.x <= w && a.screen.y >= 0 && a.screen.y <= h;
    }
    return busy;
  }

  function others() {
    return [...people].filter(([, a]) => !a.leaving).map(([tag, a]) => ({ tag, head: { x: a.screen.x, y: a.screen.y }, visible: a.visible, holding: heldLook(a.goal.holding) ? a.goal.holding : null }));
  }

  return { set, update, others };
}
