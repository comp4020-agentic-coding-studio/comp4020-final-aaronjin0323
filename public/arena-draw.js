// Artifacts on a 2D canvas (ADR 30): a kind drawn in a material, with its
// seed varying the details. One function draws them on the floor, behind
// robots and on the shelf. Kinds differ by shape, materials by more than
// colour: tin has rivets, glass a highlight, gold a moving sheen, starlight
// a field of stars.
import { MATERIALS } from "./arena.js";
import { LOOK } from "./artifact-paint.js";
import { fish } from "./artifact-fish.js";
import { cloud } from "./artifact-cloud.js";
import { door } from "./artifact-door.js";

/** Draws an artifact centred at x, y, about r pixels round. `t` (seconds)
 * animates it; pass 0 for a still picture. */
export function drawItem(g, { kind, material = "tin", seed = 0 }, x, y, r, t = 0) {
  const look = LOOK[material] ?? LOOK.tin;
  g.save();
  g.translate(x, y);
  if (kind === "fish") fish(g, r, t, look, material, seed);
  else if (kind === "cloud") cloud(g, r, t, look, material, seed);
  else door(g, r, t, look, material, seed);
  g.restore();
}

/** What marks rarity on the floor: a halo for rare, turning rays for mythic. */
export function drawAura(g, material, x, y, r, t = 0) {
  const tier = MATERIALS[material]?.rarity;
  if (tier === "common" || !tier) return;
  const look = LOOK[material];
  g.save();
  g.translate(x, y);
  const halo = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.1);
  halo.addColorStop(0, `${look.glow}66`);
  halo.addColorStop(1, `${look.glow}00`);
  g.fillStyle = halo;
  g.beginPath();
  g.arc(0, 0, r * 2.1, 0, Math.PI * 2);
  g.fill();
  if (tier === "mythic") {
    g.rotate(t * 0.8);
    g.strokeStyle = `${look.glow}bb`;
    g.lineWidth = Math.max(1.5, r * 0.08);
    g.lineCap = "round";
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.moveTo(r * 1.25, 0);
      g.lineTo(r * (i % 2 ? 1.6 : 1.95), 0);
      g.stroke();
    }
  }
  g.restore();
}

/** A small picture of an artifact, as a canvas for a card. */
export function itemIcon(item, size = 72, { dark = false } = {}) {
  const c = document.createElement("canvas");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  c.className = "icon";
  c.setAttribute("aria-hidden", "true");
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  if (dark) {
    // an unknown entry: its shape, filled in, nothing of its surface
    drawItem(g, item, size / 2 + (item.kind === "door" ? size * 0.08 : 0), size / 2, size * 0.32, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#3a3754";
    g.fillRect(0, 0, size, size);
    return c;
  }
  drawAura(g, item.material, size / 2, size / 2, size * 0.24, 0);
  drawItem(g, item, size / 2 + (item.kind === "door" ? size * 0.08 : 0), size / 2, size * 0.32, 0);
  return c;
}
