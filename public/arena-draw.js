// Artifacts on a 2D canvas (ADR 30): a kind drawn in a material, with its
// seed varying the details. One function draws them on the floor, behind
// robots and on the shelf. Kinds differ by shape, materials by more than
// colour: tin has rivets, glass a highlight, gold a moving sheen, starlight
// a field of stars.
import { MATERIALS } from "./arena.js";

const LOOK = {
  tin: { body: "#a3acb6", edge: "#5d6670", dark: "#2a2f36", light: "#d5dbe1", glow: "", alpha: 1 },
  glass: { body: "#8fe9ff", edge: "#eafcff", dark: "#0b4a63", light: "#ffffff", glow: "#8ff6ff", alpha: 0.6 },
  gold: { body: "#f0b93a", edge: "#fff0b3", dark: "#5a3a00", light: "#fff7d1", glow: "#ffd766", alpha: 1 },
  starlight: { body: "#2a1d6e", edge: "#d6c6ff", dark: "#ffffff", light: "#ffffff", glow: "#b48cff", alpha: 1 },
};
/** A small repeatable stream of numbers from a seed. */
const stream = (seed) => {
  let s = (seed % 2147483647) + 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
};

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

function fill(g, look, r, material, t) {
  g.globalAlpha *= look.alpha;
  if (material === "gold") {
    const sheen = ((t * 0.5) % 1) * 3 - 1.5;
    const m = g.createLinearGradient(-r, -r, r, r);
    m.addColorStop(0, look.dark === "#5a3a00" ? "#a9740f" : look.body);
    m.addColorStop(Math.max(0, Math.min(1, 0.5 + sheen * 0.33)), look.light);
    m.addColorStop(1, "#c48a16");
    return m;
  }
  return look.body;
}
const finish = (g, look) => {
  g.globalAlpha /= look.alpha;
  g.strokeStyle = look.edge;
  g.lineWidth = 1.2;
  g.stroke();
};
// what each material adds over a shape already drawn
function surface(g, r, t, look, material, seed) {
  const n = stream(seed + 7);
  if (material === "tin") {
    g.fillStyle = look.edge;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc((n() - 0.5) * r * 1, (n() - 0.5) * r * 0.5, Math.max(1, r * 0.05), 0, Math.PI * 2);
      g.fill();
    }
  } else if (material === "glass") {
    g.strokeStyle = "#ffffffcc";
    g.lineWidth = Math.max(1.2, r * 0.08);
    g.lineCap = "round";
    g.beginPath();
    g.arc(-r * 0.05, -r * 0.05, r * 0.42, Math.PI * 1.1, Math.PI * 1.55);
    g.stroke();
  } else if (material === "gold") {
    g.fillStyle = "#fffbe6";
    const s = (Math.sin(t * 3 + seed) + 1) / 2;
    for (const [dx, dy] of [[n() - 0.5, n() - 0.5]]) star(g, dx * r, dy * r * 0.6, r * (0.12 + 0.14 * s));
  } else if (material === "starlight") {
    for (let i = 0; i < 7; i++) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(t * 2 + i + seed));
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc((n() - 0.5) * r * 1.1, (n() - 0.5) * r * 0.6, Math.max(0.8, r * (0.03 + n() * 0.04)), 0, Math.PI * 2);
      g.fill();
    }
  }
}
function star(g, x, y, s) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, d = i % 2 ? s * 0.25 : s;
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.closePath();
  g.fill();
}
const glowing = (g, look, r) => {
  g.shadowColor = look.glow || "transparent";
  g.shadowBlur = look.glow ? r * 0.8 : 0;
};

// a flying fish: it bobs; the seed sets its fin and its markings
function fish(g, r, t, look, material, seed) {
  const n = stream(seed);
  const fin = 0.3 + n() * 0.3;
  g.translate(0, Math.sin(t * 3 + seed) * r * 0.12);
  g.rotate(Math.sin(t * 3 + 1 + seed) * 0.12);
  glowing(g, look, r);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  g.ellipse(r * 0.12, 0, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
  // all wound the same way, or their overlaps would cancel out to holes
  g.moveTo(-r * 0.5, 0);
  g.lineTo(-r * 0.98, r * 0.42);
  g.lineTo(-r * 0.98, -r * 0.42);
  g.closePath();
  g.moveTo(r * 0.15, -r * 0.34);
  g.lineTo(-r * 0.25, -r * 0.3);
  g.lineTo(-r * 0.2, -r * (0.42 + fin));
  g.closePath();
  g.fill();
  finish(g, look);
  g.shadowBlur = 0;
  surface(g, r, t, look, material, seed);
  g.fillStyle = look.dark;
  g.beginPath();
  g.arc(r * 0.5, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  g.fill();
}

// a cloud full of rain: the seed sets its puffs and how many drops fall
function cloud(g, r, t, look, material, seed) {
  const n = stream(seed);
  const drops = 2 + Math.floor(n() * 3);
  g.strokeStyle = material === "tin" ? look.edge : look.glow;
  g.lineWidth = Math.max(1.5, r * 0.1);
  g.lineCap = "round";
  for (let i = 0; i < drops; i++) {
    const x = (i - (drops - 1) / 2) * r * 0.4;
    const fall = ((t * 1.6 + i * 0.37) % 1) * r * 0.35;
    g.beginPath();
    g.moveTo(x, r * 0.2 + fall);
    g.lineTo(x - r * 0.08, r * 0.45 + fall);
    g.stroke();
  }
  glowing(g, look, r);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  const puffs = [[-r * 0.45, -r * 0.1, r * (0.3 + n() * 0.12)], [r * 0.45, -r * 0.1, r * (0.3 + n() * 0.12)], [0, -r * 0.34, r * (0.42 + n() * 0.14)]];
  for (const [cx, cy, cr] of puffs) {
    g.moveTo(cx + cr, cy);
    g.arc(cx, cy, cr, 0, Math.PI * 2);
  }
  g.fill();
  finish(g, look);
  g.shadowBlur = 0;
  surface(g, r, t, look, material, seed);
}

// a small door, ajar: the night behind it is the same seed every time
function door(g, r, t, look, material, seed) {
  const n = stream(seed);
  const w = r, h = r * 1.5;
  glowing(g, look, r);
  g.fillStyle = "#12123a";
  g.fillRect(-w / 2, -h / 2, w, h);
  g.shadowBlur = 0;
  g.fillStyle = "#ffe7a6";
  const stars = 3 + Math.floor(n() * 5);
  for (let i = 0; i < stars; i++) {
    g.beginPath();
    g.arc((n() - 0.5) * w * 0.85, (n() - 0.5) * h * 0.85, Math.max(0.8, r * (0.03 + n() * 0.05)), 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = look.edge;
  g.lineWidth = Math.max(1.5, r * 0.12);
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(-w / 2 - w * 0.45, -h / 2 + h * 0.1);
  g.lineTo(-w / 2 - w * 0.45, h / 2 - h * 0.1);
  g.lineTo(-w / 2, h / 2);
  g.closePath();
  g.fill();
  finish(g, look);
  g.save();
  g.translate(-w * 0.72, 0);
  g.scale(0.5, 1);
  surface(g, r, t, look, material, seed);
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
