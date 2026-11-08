import { stream } from "./artifact-paint.js";

// A small rain cloud painted like soft pastel: billowing puffs blended into
// one body, moonlight from the top-left, a soft shade underneath, and slow
// gentle rain. The seed sets the puffs and the drops. Centred at 0,0 in a
// box about 2r wide and 1.8r tall, rain included; t = 0 is a still picture.

// LOOK's colours are bright; each is mixed most of the way towards the
// night-garden palette so the cloud reads as a soft painting.
const TONES = {
  tin: { body: "#a2adc9", light: "#e9e4ff", shade: "#4a5282", glow: "#c9cdf0", rain: "#d4d9f4", inner: "", alpha: 1, mix: 0.85 },
  glass: { body: "#9fd9d4", light: "#f2fffc", shade: "#4f8c97", glow: "#bff3ea", rain: "#8fd3c8", inner: "#f0fffb", alpha: 0.8, mix: 0.8 },
  gold: { body: "#efd696", light: "#fbf1d2", shade: "#b98f55", glow: "#f3dfa2", rain: "#e8c97a", inner: "#fff4d6", alpha: 1, mix: 0.75 },
  starlight: { body: "#584a98", light: "#c3a8f0", shade: "#26224f", glow: "#c3a8f0", rain: "#e9e4ff", inner: "#8a74cf", alpha: 1, mix: 0.85 },
};

const hex = (c) => {
  const v = parseInt(c.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix = (a, b, k) => {
  if (!a || a[0] !== "#") return b;
  const x = hex(a), y = hex(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
};
const rgba = (c, a) => {
  const m = c[0] === "#" ? hex(c) : c.match(/\d+/g).map(Number);
  return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
};
const TAU = Math.PI * 2;

export function cloud(g, r, t, look, material, seed) {
  if (!(r > 0.5)) return;
  const tone = TONES[material] ?? TONES.tin;
  const body = mix(look?.body, tone.body, tone.mix);
  const n = stream(seed);
  const breathe = (period, phase) => Math.sin((t / period) * TAU + phase);
  const bob = r * 0.025 * breathe(5.2, seed);

  // puffs: [x, y, radius] in units of r, varied a little by the seed
  const j = () => (n() - 0.5) * 0.08;
  const puffs = [
    [-0.6 + j(), -0.06 + j() * 0.5, 0.29 + j()],
    [-0.22 + j(), -0.36 + j(), 0.4 + j()],
    [0.24 + j(), -0.42 + j(), 0.36 + j()],
    [0.6 + j(), -0.1 + j() * 0.5, 0.29 + j()],
    [-0.3 + j(), 0.0, 0.26],
    [0.1 + j(), 0.0, 0.27],
    [0.38 + j(), 0.0, 0.25],
  ].map(([x, y, s], i) => [x * r, y * r + bob, s * r * (1 + 0.025 * breathe(4.2 + i * 0.4, i * 1.7 + seed))]);
  const tops = puffs.slice(0, 4);

  rain(g, r, t, tone, material, n, bob);

  const shape = () => {
    g.beginPath();
    for (const [x, y, s] of puffs) {
      g.moveTo(x + s, y);
      g.arc(x, y, s, 0, TAU);
    }
    // a soft flat-ish base joining the lower puffs
    const bx = -0.62 * r, by = -0.12 * r + bob, bw = 1.24 * r, bh = 0.34 * r, br = 0.17 * r;
    g.moveTo(bx + br, by);
    g.arcTo(bx + bw, by, bx + bw, by + bh, br);
    g.arcTo(bx + bw, by + bh, bx, by + bh, br);
    g.arcTo(bx, by + bh, bx, by, br);
    g.arcTo(bx, by, bx + bw, by, br);
    g.closePath();
  };

  g.save();
  // the body, once, with the only (small) soft blur as a gentle outer edge
  g.globalAlpha *= tone.alpha;
  shape();
  g.shadowColor = rgba(tone.glow, material === "tin" ? 0.35 : 0.6);
  g.shadowBlur = Math.max(1.5, Math.min(r * 0.3, 24));
  g.fillStyle = body;
  g.fill();
  g.shadowBlur = 0;
  g.shadowColor = "transparent";

  // everything else is soft washes inside the body
  g.clip();
  const wash = g.createLinearGradient(-0.5 * r, -0.85 * r + bob, 0.25 * r, 0.3 * r + bob);
  wash.addColorStop(0, rgba(tone.light, 0.55));
  wash.addColorStop(0.45, rgba(tone.light, 0));
  wash.addColorStop(0.62, rgba(tone.shade, 0));
  wash.addColorStop(1, rgba(tone.shade, material === "glass" ? 0.45 : 0.7));
  g.fillStyle = wash;
  g.fillRect(-r * 1.1, -r, r * 2.2, r * 1.5);

  // a soft shade under each upper billow, so the puffs read without outlines
  for (const [x, y, s] of tops) {
    const sh = g.createRadialGradient(x + s * 0.15, y + s * 0.95, 0, x + s * 0.15, y + s * 0.95, s * 0.75);
    sh.addColorStop(0, rgba(tone.shade, 0.28));
    sh.addColorStop(1, rgba(tone.shade, 0));
    g.fillStyle = sh;
    g.fillRect(x - s, y, s * 2.3, s * 1.8);
  }
  // moonlight on the top-left of each billow, faded to nothing (no hot-spot)
  for (const [x, y, s] of tops) {
    const hx = x - s * 0.3, hy = y - s * 0.35;
    const hl = g.createRadialGradient(hx, hy, 0, hx, hy, s * 0.95);
    hl.addColorStop(0, rgba(tone.light, material === "starlight" ? 0.3 : 0.42));
    hl.addColorStop(1, rgba(tone.light, 0));
    g.fillStyle = hl;
    g.fillRect(hx - s, hy - s, s * 2, s * 2);
  }
  // a lantern-like light inside (not tin)
  if (tone.inner) {
    const k = 0.75 + 0.25 * breathe(5.6, seed * 0.3);
    const ix = -0.05 * r, iy = -0.2 * r + bob;
    const inn = g.createRadialGradient(ix, iy, 0, ix, iy, r * 0.62);
    inn.addColorStop(0, rgba(tone.inner, (material === "starlight" ? 0.45 : 0.5) * k));
    inn.addColorStop(1, rgba(tone.inner, 0));
    g.fillStyle = inn;
    g.fillRect(-r, -r, r * 2, r * 1.5);
  }
  if (material === "starlight") stars(g, r, t, seed, bob);
  g.restore();
}

// slow, gentle rain: a few soft drops falling from under the cloud
function rain(g, r, t, tone, material, n, bob) {
  const count = 4 + Math.floor(n() * 3);
  const size = Math.max(1, r * 0.075);
  g.save();
  for (let i = 0; i < count; i++) {
    const x0 = (-0.45 + (0.9 * (i + 0.5)) / count + (n() - 0.5) * 0.12) * r;
    const period = 3.4 + n() * 1.8;
    const p = (t / period + n()) % 1;
    const y = (0.16 + p * 0.68) * r + bob * (1 - p);
    const x = x0 - p * 0.05 * r;
    const a = Math.min(1, (1 - p) * 3) * (material === "glass" ? 0.8 : 0.9);
    if (a <= 0.02) continue;
    if (material === "starlight" || material === "gold") {
      // soft motes of light: a faint halo and a small bright core
      const halo = g.createRadialGradient(x, y, 0, x, y, size * 2.6);
      halo.addColorStop(0, rgba(tone.glow, 0.5 * a));
      halo.addColorStop(1, rgba(tone.glow, 0));
      g.fillStyle = halo;
      g.fillRect(x - size * 2.6, y - size * 2.6, size * 5.2, size * 5.2);
      g.fillStyle = rgba(tone.rain, a);
      if (material === "gold") drop(g, x, y, size * 0.9);
      else {
        g.beginPath();
        g.arc(x, y, size * 0.65, 0, TAU);
        g.fill();
      }
    } else {
      const k = material === "glass" ? 0.75 : 0.9;
      if (size > 3) {
        // a soft wash in the drop: lit top-left, fading to the rain colour
        const d = g.createRadialGradient(x - size * 0.35, y - size * 0.3, 0, x, y, size * 1.6);
        d.addColorStop(0, rgba("#f6f1ff", a * k));
        d.addColorStop(1, rgba(tone.rain, a * k * (material === "glass" ? 0.7 : 0.8)));
        g.fillStyle = d;
      } else g.fillStyle = rgba(tone.rain, a * k);
      drop(g, x, y, size);
    }
  }
  g.restore();
}

// a teardrop: pointed top, round bottom
function drop(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s * 1.9);
  g.bezierCurveTo(x + s * 0.35, y - s * 1.1, x + s, y - s * 0.5, x + s, y + s * 0.1);
  g.arc(x, y + s * 0.1, s, 0, Math.PI);
  g.bezierCurveTo(x - s, y - s * 0.5, x - s * 0.35, y - s * 1.1, x, y - s * 1.9);
  g.fill();
}

// tiny soft stars twinkling slowly inside the starlight cloud
function stars(g, r, t, seed, bob) {
  const n = stream(seed + 31);
  const count = r < 14 ? 3 : r > 80 ? 14 : 7;
  for (let i = 0; i < count; i++) {
    const x = (n() - 0.5) * 1.5 * r, y = (-0.6 + n() * 0.7) * r + bob;
    const s = Math.max(0.7, Math.min(r * (0.02 + n() * 0.02), 2 + n() * 2.5));
    const a = 0.45 + 0.45 * Math.sin((t / (3.5 + n() * 2)) * TAU + i * 2.1);
    const h = g.createRadialGradient(x, y, 0, x, y, s * 3);
    h.addColorStop(0, `rgba(246,241,255,${0.9 * a})`);
    h.addColorStop(0.35, `rgba(233,228,255,${0.35 * a})`);
    h.addColorStop(1, "rgba(233,228,255,0)");
    g.fillStyle = h;
    g.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
  }
}
