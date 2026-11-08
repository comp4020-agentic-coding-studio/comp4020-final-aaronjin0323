import { LOOK, stream } from "./artifact-paint.js";

// A small arched garden door standing ajar onto a calm starry night, painted
// soft (night garden, pastel). The still picture (frame, leaf, sky, moon,
// spilt moonlight) is cached per size, material and seed; only the stars
// breathe each frame. The leaf swings open to the left, with a small gap at
// the hinge so the dark catalog shape still reads as a door ajar.

const hex = (c) => {
  const v = parseInt(c.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mix = (a, b, k) => {
  const [p, q] = [hex(a), hex(b)];
  return "#" + p.map((x, i) => Math.round(x + (q[i] - x) * k).toString(16).padStart(2, "0")).join("");
};
const rgba = (c, a) => `rgba(${hex(c).join(",")},${a})`;

// each material, softened from LOOK towards the night-garden palette
const PAINT = {
  tin: () => ({ body: mix(LOOK.tin.body, "#8a90b8", 0.8), shade: "#5d6390", lit: "#c9cbe6", alpha: 1, glow: "" }),
  glass: () => ({ body: mix(LOOK.glass.body, "#9fd9d3", 0.75), shade: "#5f9fa6", lit: "#e4fbf7", alpha: 0.72, glow: "#8fd3c8" }),
  gold: () => ({ body: mix(LOOK.gold.body, "#efd894", 0.8), shade: "#c9a865", lit: "#fbf0c8", alpha: 1, glow: "#f3dfa2" }),
  starlight: () => ({ body: mix(LOOK.starlight.body, "#6e5ca8", 0.75), shade: "#4a3d80", lit: "#cdb8f4", alpha: 1, glow: "#c3a8f0", stars: true }),
};

// the shapes, in units of r
const FT = 0.11; // frame thickness
const IW = 0.5 - FT; // inner half-width (and inner arch radius)
const ARCH = -0.25; // arch centre y
const BOT = 0.75; // threshold y
const LW = 0.4; // how wide the open leaf looks, foreshortened

function arched(g, r, half, top, bot) {
  g.beginPath();
  g.moveTo(-half * r, bot * r);
  g.lineTo(-half * r, top * r);
  g.arc(0, top * r, half * r, Math.PI, 0);
  g.lineTo(half * r, bot * r);
  g.closePath();
}

// the leaf: a point (s across the door 0..1 from the hinge, y in units of r)
// projected onto the swung-open leaf to the left of the frame
function leafMap(r, gap) {
  const hx = -0.5 * r - gap, cy = 0.2 * r;
  return (s, y) => [hx - s * LW * r, cy + (y * r - cy) * (1 + 0.1 * s)];
}
function leafPath(g, P, s0, s1, top, bot, round) {
  // a panel from s0..s1 across, top..bot down; round tops follow the arch
  const N = 10;
  g.beginPath();
  let [x, y] = P(s0, bot);
  g.moveTo(x, y);
  for (let i = 0; i <= N; i++) {
    const s = s0 + ((s1 - s0) * i) / N;
    let yy = top;
    if (round) {
      const dx = (s - 0.5) * 2 * IW, rr = IW - (round === true ? 0 : round);
      yy = top - Math.sqrt(Math.max(0, rr * rr - dx * dx));
    }
    [x, y] = P(s, yy);
    g.lineTo(x, y);
  }
  [x, y] = P(s1, bot);
  g.lineTo(x, y);
  g.closePath();
}

function paintStill(g, r, material, seed) {
  const p = (PAINT[material] ?? PAINT.tin)();
  const n = stream(seed);
  const gap = Math.max(1, r * 0.05);

  // moonlight spilling out over the ground in front of the doorway
  g.save();
  g.translate(0.02 * r, BOT * r);
  g.scale(1, 0.32);
  const spill = g.createRadialGradient(0, 0, 0, 0, 0, 0.75 * r);
  spill.addColorStop(0, rgba("#f6f1ff", 0.26));
  spill.addColorStop(0.5, rgba("#e9e4ff", 0.1));
  spill.addColorStop(1, rgba("#e9e4ff", 0));
  g.fillStyle = spill;
  g.beginPath();
  g.arc(0, 0, 0.75 * r, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // the night through the doorway
  g.save();
  arched(g, r, IW, ARCH, BOT);
  g.clip();
  const sky = g.createLinearGradient(0, (ARCH - IW) * r, 0, BOT * r);
  sky.addColorStop(0, "#14152b");
  sky.addColorStop(0.55, "#1d1f3a");
  sky.addColorStop(1, "#33366a");
  g.fillStyle = sky;
  g.fillRect(-r, -r, 2 * r, 2 * r);
  const neb = (x, y, rad, c, a) => {
    const w = g.createRadialGradient(x * r, y * r, 0, x * r, y * r, rad * r);
    w.addColorStop(0, rgba(c, a));
    w.addColorStop(1, rgba(c, 0));
    g.fillStyle = w;
    g.fillRect(-r, -r, 2 * r, 2 * r);
  };
  neb(-0.15 + n() * 0.2, -0.05 + n() * 0.2, 0.4, "#c3a8f0", 0.22);
  neb(0.05 + n() * 0.15, 0.25, 0.3, "#8fd3c8", 0.1);
  // a soft crescent moon, high on one side
  const side = n() < 0.5 ? -1 : 1;
  const mx = side * 0.13 * r, my = -0.38 * r, mr = 0.085 * r;
  neb(mx / r, my / r, 0.26, "#f6f1ff", 0.22);
  g.save();
  g.beginPath();
  g.arc(mx, my, mr, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = "#f3eed8";
  g.beginPath();
  g.arc(mx, my, mr, 0, Math.PI * 2);
  g.arc(mx + side * mr * 0.55, my - mr * 0.3, mr * 0.88, 0, Math.PI * 2);
  g.fill("evenodd");
  g.restore();
  // a far garden hill against the sky
  const hill = g.createLinearGradient(0, 0.45 * r, 0, BOT * r);
  hill.addColorStop(0, "#3e5a55");
  hill.addColorStop(1, "#2c3d48");
  g.fillStyle = hill;
  g.beginPath();
  g.moveTo(-IW * r, BOT * r);
  g.lineTo(-IW * r, (0.52 + n() * 0.06) * r);
  g.quadraticCurveTo(0, (0.38 + n() * 0.06) * r, IW * r, (0.55 + n() * 0.05) * r);
  g.lineTo(IW * r, BOT * r);
  g.closePath();
  g.fill();
  g.restore();

  // the arched frame, one soft glow at most
  const frame = () => {
    arched(g, r, 0.5, ARCH, BOT);
    g.moveTo(IW * r, BOT * r);
    g.lineTo(IW * r, ARCH * r);
    g.arc(0, ARCH * r, IW * r, 0, Math.PI, true);
    g.lineTo(-IW * r, BOT * r);
    g.closePath();
  };
  const body = g.createLinearGradient(-0.5 * r, -0.75 * r, 0.5 * r, 0.75 * r);
  body.addColorStop(0, p.lit);
  body.addColorStop(0.45, p.body);
  body.addColorStop(1, p.shade);
  g.save();
  g.globalAlpha = p.alpha;
  if (p.glow) {
    g.shadowColor = rgba(p.glow, 0.7);
    g.shadowBlur = Math.min(r * 0.35, 36);
  }
  frame();
  g.fillStyle = body;
  g.fill();
  g.restore();
  // inner light in the frame (glass glows from within, all get a soft rim)
  g.save();
  frame();
  g.clip();
  const inner = g.createRadialGradient(-0.2 * r, -0.45 * r, 0, -0.2 * r, -0.45 * r, 0.9 * r);
  inner.addColorStop(0, rgba("#f6f1ff", material === "glass" ? 0.45 : material === "gold" ? 0.3 : 0.18));
  inner.addColorStop(1, rgba("#f6f1ff", 0));
  g.fillStyle = inner;
  g.fillRect(-r, -r, 2 * r, 2 * r);
  if (p.stars) starDust(g, r, n, 6, [-0.5, 0.5], [-0.75, 0.7]);
  g.restore();
  g.strokeStyle = rgba(p.shade, 0.45);
  g.lineWidth = Math.max(0.8, r * 0.022);
  frame();
  g.stroke();
  // a low stone sill
  g.fillStyle = mix(p.shade, "#2c2f55", 0.35);
  g.globalAlpha = 0.9;
  const sh = Math.max(1.2, 0.06 * r);
  g.beginPath();
  g.roundRect(-0.58 * r, BOT * r - sh * 0.4, 1.16 * r, sh, sh / 2);
  g.fill();
  g.globalAlpha = 1;

  // the open leaf, its face catching the moonlight
  const P = leafMap(r, gap);
  const face = g.createLinearGradient(P(0, 0)[0], 0, P(1, 0)[0], 0);
  face.addColorStop(0, p.shade);
  face.addColorStop(0.6, p.body);
  face.addColorStop(1, mix(p.body, p.lit, 0.5));
  g.save();
  g.globalAlpha = p.alpha;
  leafPath(g, P, 0, 1, ARCH, BOT, true);
  g.fillStyle = face;
  g.fill();
  g.restore();
  g.save();
  leafPath(g, P, 0, 1, ARCH, BOT, true);
  g.clip();
  if (material === "glass") {
    const sheen = g.createRadialGradient(P(0.6, -0.2)[0], P(0.6, -0.2)[1], 0, P(0.6, -0.2)[0], P(0.6, -0.2)[1], 0.5 * r);
    sheen.addColorStop(0, rgba("#f6f1ff", 0.35));
    sheen.addColorStop(1, rgba("#f6f1ff", 0));
    g.fillStyle = sheen;
    g.fillRect(-1.2 * r, -r, 1.2 * r, 2 * r);
  }
  // two soft panels, a little sunk
  g.fillStyle = rgba(p.shade, 0.38);
  leafPath(g, P, 0.2, 0.8, ARCH + 0.04, 0.12, 0.13);
  g.fill();
  leafPath(g, P, 0.2, 0.8, 0.26, 0.62, false);
  g.fill();
  g.strokeStyle = rgba(p.lit, 0.3);
  g.lineWidth = Math.max(0.6, r * 0.014);
  leafPath(g, P, 0.2, 0.8, 0.26, 0.62, false);
  g.stroke();
  if (p.stars) starDust(g, r, n, 5, [-0.9, -0.55], [-0.6, 0.7]);
  g.restore();
  g.strokeStyle = rgba(p.shade, 0.5);
  g.lineWidth = Math.max(0.8, r * 0.02);
  leafPath(g, P, 0, 1, ARCH, BOT, true);
  g.stroke();
  // a tiny soft knob
  if (r >= 8) {
    const [kx, ky] = P(0.84, 0.2);
    g.fillStyle = rgba(p.lit, 0.85);
    g.beginPath();
    g.arc(kx, ky, Math.max(0.8, r * 0.028), 0, Math.PI * 2);
    g.fill();
  }
}

// tiny soft stars in the starlight material itself
function starDust(g, r, n, count, xs, ys) {
  for (let i = 0; i < count; i++) {
    const x = (xs[0] + n() * (xs[1] - xs[0])) * r, y = (ys[0] + n() * (ys[1] - ys[0])) * r;
    const s = Math.max(0.5, r * (0.007 + n() * 0.009));
    g.fillStyle = rgba("#f6f1ff", 0.16);
    g.beginPath();
    g.arc(x, y, s * 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba("#f6f1ff", 0.85);
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  }
}

// the night's stars, fixed by the seed: x, y (units of r), size, period, phase
function skyStars(seed) {
  const n = stream(seed * 13 + 5);
  const out = [];
  const count = 6 + Math.floor(n() * 5);
  for (let tries = 0; out.length < count && tries < 60; tries++) {
    const x = (n() * 2 - 1) * IW * 0.82, y = ARCH - IW * 0.8 + n() * (0.42 - ARCH + IW * 0.8);
    if (y < ARCH && Math.hypot(x, y - ARCH) > IW * 0.82) continue;
    if (Math.hypot(Math.abs(x) - 0.13, y + 0.38) < 0.14) continue; // keep clear of the moon
    out.push([x, y, 0.007 + n() * 0.013, 3 + n() * 3, n() * Math.PI * 2]);
  }
  return out;
}

const cache = new Map();
const PAD = { x0: -1.05, x1: 0.8, y0: -1.05, y1: 1.05 };
function still(r, s, material, seed) {
  const key = `${material}|${seed}|${Math.round(r * s * 4)}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const pad = Math.min(r * 0.35, 36) / r; // room for the glow
  const x0 = PAD.x0 - pad, y0 = PAD.y0 - pad;
  const cw = Math.ceil((PAD.x1 - x0 + pad) * r * s), ch = Math.ceil((PAD.y1 - y0 + pad) * r * s);
  if (cw < 1 || ch < 1) return null;
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  const cg = c.getContext("2d");
  cg.scale(s, s);
  cg.translate(-x0 * r, -y0 * r);
  paintStill(cg, r, material, seed);
  if (cache.size > 96) cache.clear();
  hit = { c, x: x0 * r, y: y0 * r, w: cw / s, h: ch / s, stars: skyStars(seed) };
  cache.set(key, hit);
  return hit;
}

export function door(g, r, t, look, material, seed) {
  if (!(r > 0)) return;
  const m = g.getTransform();
  const s = Math.max(1, Math.hypot(m.a, m.b));
  if (r * s < 1) return;
  const img = still(r, s, material, seed);
  if (!img) return;
  g.drawImage(img.c, img.x, img.y, img.w, img.h);
  // the stars beyond the door, slowly breathing (3-6 s)
  g.save();
  for (const [x, y, size, period, phase] of img.stars) {
    const a = 0.6 + 0.4 * Math.sin((t * Math.PI * 2) / period + phase);
    const sr = Math.max(0.45, size * r);
    g.fillStyle = `rgba(246,241,255,${(0.13 * a).toFixed(3)})`;
    g.beginPath();
    g.arc(x * r, y * r, sr * 2.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(246,241,255,${(0.45 + 0.5 * a).toFixed(3)})`;
    g.beginPath();
    g.arc(x * r, y * r, sr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
