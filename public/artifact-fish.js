import { stream } from "./artifact-paint.js";

// A flying fish as a soft pastel painting (night garden): a calm body lit
// from the top-left by the moon, translucent wing-fins with faint rays, a
// forked tail and a small quiet eye. It floats slowly and its wings breathe.
// The seed sets the wing length and a few soft markings.

// the shared material colours, softened towards the night-garden palette
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => {
  const [p, q] = [hex(a), hex(b)];
  return `#${p.map((v, i) => Math.round(v + (q[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
};
const rgba = (h, a) => `rgba(${hex(h).join(",")},${a})`;
const PASTEL = {
  // pale stone / old silver in moonlight
  tin: { body: "#aeb3c8", light: "#e6e3f4", dark: "#5c6283", fin: "#c9cfe6", finA: 0.74, edge: "#e9e4ff", glow: "", alpha: 1 },
  // pale aqua with a soft inner light
  glass: { body: "#a6dcd8", light: "#effcf8", dark: "#4f7f8c", fin: "#c6efe8", finA: 0.5, edge: "#f6f1ff", glow: "#8fd3c8", alpha: 0.78 },
  // soft pale moon-gold
  gold: { body: "#ead09a", light: "#f8edcc", dark: "#a98a58", fin: "#f3dfa2", finA: 0.6, edge: "#f6f1ff", glow: "#f3dfa2", alpha: 1 },
  // deep lavender night with stars inside
  starlight: { body: "#4b4189", light: "#9f92d8", dark: "#272350", fin: "#c3a8f0", finA: 0.5, edge: "#e9e4ff", glow: "#c3a8f0", alpha: 1 },
};
function colours(look, material) {
  const p = PASTEL[material] ?? PASTEL.tin;
  // keep a breath of the shared look so every kind agrees on a material
  return {
    ...p,
    body: look?.body ? mix(look.body, p.body, 0.8) : p.body,
    light: look?.light ? mix(look.light, p.light, 0.75) : p.light,
  };
}

function bodyPath(g, r) {
  g.beginPath();
  g.moveTo(r * 0.66, r * 0.03);
  g.bezierCurveTo(r * 0.6, -r * 0.19, r * 0.26, -r * 0.27, -r * 0.05, -r * 0.24);
  g.bezierCurveTo(-r * 0.3, -r * 0.21, -r * 0.48, -r * 0.1, -r * 0.6, -r * 0.04);
  g.lineTo(-r * 0.6, r * 0.05);
  g.bezierCurveTo(-r * 0.45, r * 0.14, -r * 0.2, r * 0.24, r * 0.1, r * 0.23);
  g.bezierCurveTo(r * 0.4, r * 0.22, r * 0.62, r * 0.15, r * 0.66, r * 0.03);
  g.closePath();
}

function tailPath(g, r) {
  g.beginPath();
  g.moveTo(-r * 0.5, -r * 0.05);
  g.quadraticCurveTo(-r * 0.72, -r * 0.13, -r * 0.95, -r * 0.37);
  g.quadraticCurveTo(-r * 0.86, -r * 0.14, -r * 0.79, r * 0.01);
  g.quadraticCurveTo(-r * 0.88, r * 0.2, -r * 1.0, r * 0.45);
  g.quadraticCurveTo(-r * 0.72, r * 0.18, -r * 0.5, r * 0.07);
  g.closePath();
}

// a wing-fin from its root on the body out to a tip `tipX` back and `h` out;
// `up` is 1 for the near wing (above) and -1 for the far one (below)
function wingPath(g, r, tipX, h, up) {
  const y = (v) => -up * v;
  g.beginPath();
  g.moveTo(r * 0.24, y(r * 0.04));
  g.bezierCurveTo(r * 0.16, y(h * 0.5), -r * 0.16, y(h * 1.02), tipX, y(h));
  // a gently scalloped trailing edge
  g.quadraticCurveTo(tipX * 1.02, y(h * 0.76), tipX * 0.84, y(h * 0.6));
  g.quadraticCurveTo(tipX * 0.72, y(h * 0.4), tipX * 0.52, y(h * 0.3));
  g.quadraticCurveTo(tipX * 0.3, y(h * 0.18), -r * 0.1, y(r * 0.06));
  g.closePath();
}

// where the rays end, along the wing's outer edge
const RAYS = [[0.2, 0.78], [0.45, 0.94], [0.72, 0.98], [0.94, 0.88], [0.88, 0.64]];

function paintWing(g, r, c, tipX, h, up, alpha) {
  const y = (v) => -up * v;
  wingPath(g, r, tipX, h, up);
  const w = g.createLinearGradient(r * 0.15, y(r * 0.05), tipX, y(h));
  w.addColorStop(0, rgba(c.fin, c.finA * alpha));
  w.addColorStop(1, rgba(c.light, c.finA * alpha * 0.7));
  g.fillStyle = w;
  g.fill();
  if (r < 6) return;
  // faint soft rays, fanning from the root
  g.strokeStyle = rgba(c.edge, 0.2 * alpha);
  g.lineWidth = Math.max(0.5, r * 0.01);
  g.lineCap = "round";
  g.beginPath();
  for (const [kx, ky] of RAYS) {
    g.moveTo(r * 0.12, y(r * 0.06));
    g.lineTo(r * 0.12 + (tipX - r * 0.12) * kx * 0.94, y(h * ky * 0.92));
  }
  g.stroke();
  // a breath of edge, no line
  wingPath(g, r, tipX, h, up);
  g.strokeStyle = rgba(c.edge, 0.26 * alpha);
  g.lineWidth = Math.max(0.5, r * 0.014);
  g.stroke();
}

export function fish(g, r, t, look, material, seed) {
  if (!(r > 0.5)) return;
  const c = colours(look, material);
  const n = stream(seed);
  const span = 0.86 + n() * 0.26; // the seed's wing length
  const dots = 2 + Math.floor(n() * 3);
  const stripe = n() < 0.5;
  const phase = n() * Math.PI * 2;
  const TAU = Math.PI * 2;
  // a slow float (5 s) and wing breathing (4 s)
  const float = Math.sin((t * TAU) / 5 + phase);
  const breath = 1 + 0.06 * Math.sin((t * TAU) / 4 + phase);
  g.save();
  g.translate(r * 0.16, r * 0.08 + float * r * 0.05);
  g.rotate(float * 0.035);

  // a soft lantern glow for rare and mythic ones, breathing gently
  if (c.glow) {
    const a = 0.24 + 0.06 * Math.sin((t * TAU) / 6 + phase);
    const halo = g.createRadialGradient(-r * 0.05, -r * 0.08, r * 0.1, -r * 0.05, -r * 0.08, r * 1.15);
    halo.addColorStop(0, rgba(c.glow, a));
    halo.addColorStop(0.55, rgba(c.glow, a * 0.35));
    halo.addColorStop(1, rgba(c.glow, 0));
    g.fillStyle = halo;
    g.fillRect(-r * 1.25, -r * 1.25, r * 2.5, r * 2.5);
  }

  const tipX = -r * 0.6 * span, tipY = r * 0.68 * span * breath;
  // the far wing, below and dimmer
  paintWing(g, r, c, -r * 0.48 * span, r * 0.5 * span * (2 - breath), -1, 0.7);

  // forked tail
  g.globalAlpha *= c.alpha;
  tailPath(g, r);
  const tg = g.createLinearGradient(-r * 0.5, 0, -r, 0);
  tg.addColorStop(0, c.body);
  tg.addColorStop(1, c.fin);
  g.fillStyle = tg;
  g.fill();
  g.strokeStyle = rgba(c.edge, 0.22);
  g.lineWidth = Math.max(0.5, r * 0.015);
  g.stroke();

  // the body: moonlit back, pale belly
  bodyPath(g, r);
  const bg = g.createLinearGradient(-r * 0.2, -r * 0.3, r * 0.05, r * 0.26);
  bg.addColorStop(0, c.light);
  bg.addColorStop(0.35, c.body);
  bg.addColorStop(0.8, mix(c.body, c.dark, 0.35));
  bg.addColorStop(1, mix(c.body, c.light, 0.3));
  g.fillStyle = bg;
  g.fill();
  g.globalAlpha /= c.alpha;

  g.save();
  bodyPath(g, r);
  g.clip();
  // soft moonlight wash from the top-left (a wash, never a hot-spot)
  const moon = g.createRadialGradient(r * 0.2, -r * 0.3, 0, r * 0.2, -r * 0.3, r * 0.6);
  moon.addColorStop(0, rgba(c.light, material === "starlight" ? 0.3 : 0.45));
  moon.addColorStop(1, rgba(c.light, 0));
  g.fillStyle = moon;
  g.fillRect(-r * 0.7, -r * 0.3, r * 1.4, r * 0.6);
  // glass and gold hold a soft inner light
  if (material === "glass" || material === "gold") {
    const inner = g.createRadialGradient(r * 0.05, r * 0.02, 0, r * 0.05, r * 0.02, r * 0.42);
    inner.addColorStop(0, rgba(material === "glass" ? "#f6fffc" : "#fff6dc", 0.5));
    inner.addColorStop(1, rgba(c.light, 0));
    g.fillStyle = inner;
    g.fillRect(-r * 0.7, -r * 0.3, r * 1.4, r * 0.6);
  }
  if (r >= 5) {
    const m = stream(seed + 13);
    // a soft lateral stripe, or a row of soft spots
    if (stripe) {
      g.strokeStyle = rgba(c.light, 0.18);
      g.lineWidth = r * 0.035;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(r * 0.38, -r * 0.02);
      g.quadraticCurveTo(-r * 0.05, -r * 0.06, -r * 0.5, 0);
      g.stroke();
    }
    g.fillStyle = rgba(material === "starlight" ? c.light : c.dark, 0.18);
    for (let i = 0; i < dots; i++) {
      g.beginPath();
      g.arc(r * (0.15 - i * 0.16 - m() * 0.04), -r * (0.1 + m() * 0.06), r * (0.03 + m() * 0.02), 0, TAU);
      g.fill();
    }
    // tiny soft stars inside the night of a starlight fish
    if (material === "starlight") {
      for (let i = 0; i < 9; i++) {
        const x = r * (0.6 - m() * 1.15), y = r * (m() - 0.5) * 0.36;
        const a = 0.6 + 0.35 * Math.sin((t * TAU) / (3.5 + i * 0.4) + i * 1.7 + phase);
        const s = r * (0.006 + m() * 0.01);
        g.fillStyle = `rgba(246,241,255,${a * 0.18})`;
        g.beginPath();
        g.arc(x, y, s * 2.2, 0, TAU);
        g.fill();
        g.fillStyle = `rgba(246,241,255,${a})`;
        g.beginPath();
        g.arc(x, y, Math.max(0.5, s), 0, TAU);
        g.fill();
      }
    }
    // a faint gill curve
    g.strokeStyle = rgba(c.dark, 0.2);
    g.lineWidth = Math.max(0.5, r * 0.015);
    g.beginPath();
    g.arc(r * 0.5, r * 0.02, r * 0.14, Math.PI * 0.75, Math.PI * 1.22);
    g.stroke();
  }
  g.restore();
  // a very soft outline
  bodyPath(g, r);
  g.strokeStyle = rgba(c.edge, 0.3);
  g.lineWidth = Math.max(0.5, r * 0.018);
  g.stroke();

  // a small pelvic fin
  g.beginPath();
  g.moveTo(-r * 0.15, r * 0.2);
  g.quadraticCurveTo(-r * 0.3, r * 0.3, -r * 0.42, r * 0.34);
  g.quadraticCurveTo(-r * 0.33, r * 0.24, -r * 0.3, r * 0.15);
  g.closePath();
  g.fillStyle = rgba(c.fin, c.finA * 0.8);
  g.fill();

  // the near wing, over the body
  paintWing(g, r, c, tipX, tipY, 1, 1);

  // a small calm eye
  const ex = r * 0.47, ey = -r * 0.04;
  g.fillStyle = rgba(material === "starlight" ? "#14152b" : mix(c.dark, "#1d1f3a", 0.5), 0.85);
  g.beginPath();
  g.arc(ex, ey, Math.max(0.8, r * 0.05), 0, TAU);
  g.fill();
  if (r >= 8) {
    g.fillStyle = "rgba(246,241,255,0.7)";
    g.beginPath();
    g.arc(ex - r * 0.015, ey - r * 0.015, r * 0.014, 0, TAU);
    g.fill();
  }
  g.restore();
}
