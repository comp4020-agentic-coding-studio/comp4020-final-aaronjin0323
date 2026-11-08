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

/** What marks rarity: a soft lantern halo for rare, and for mythic a second,
 * wider halo breathing slowly with a ring of tiny motes. Pastel, never harsh. */
const AURA = { glass: "143,211,200", gold: "243,223,162", starlight: "195,168,240" };
export function drawAura(g, material, x, y, r, t = 0) {
  const tier = MATERIALS[material]?.rarity;
  const rgb = AURA[material];
  if (tier === "common" || !tier || !rgb) return;
  g.save();
  g.translate(x, y);
  const halo = g.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2);
  halo.addColorStop(0, `rgba(${rgb},.38)`);
  halo.addColorStop(0.55, `rgba(${rgb},.14)`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = halo;
  g.beginPath();
  g.arc(0, 0, r * 2, 0, Math.PI * 2);
  g.fill();
  if (tier === "mythic") {
    const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 6);
    const outer = g.createRadialGradient(0, 0, r * 1.4, 0, 0, r * (2.5 + 0.2 * breath));
    outer.addColorStop(0, `rgba(${rgb},0)`);
    outer.addColorStop(0.5, `rgba(${rgb},${0.1 + 0.08 * breath})`);
    outer.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = outer;
    g.beginPath();
    g.arc(0, 0, r * 2.8, 0, Math.PI * 2);
    g.fill();
    g.rotate(t * 0.12);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tw = 0.45 + 0.4 * Math.sin(t * 1.1 + i * 1.7);
      g.fillStyle = `rgba(246,241,255,${tw})`;
      g.beginPath();
      g.arc(Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7, Math.max(0.9, r * 0.055), 0, Math.PI * 2);
      g.fill();
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
  drawAura(g, item.material, size / 2, size / 2, size * 0.17, 0); // the widest halo, 2.8r, stays inside the card
  drawItem(g, item, size / 2 + (item.kind === "door" ? size * 0.08 : 0), size / 2, size * 0.32, 0);
  return c;
}
