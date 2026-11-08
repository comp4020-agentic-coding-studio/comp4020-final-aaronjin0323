// The arena floor, drawn first each frame: a moonlit night-garden lawn seen
// from above. Misty blue-violet ground, soft moss near the edges, faint
// moonlight from the top-left, a calm halo where the vault sits, a soft
// hedge-like rim, and a few fireflies. `w` and `h` are the arena's size in
// CSS pixels, `m` pixels per metre, `now` server time (ms). With `reduced`
// (prefers-reduced-motion) nothing moves: the fireflies rest, unlit.

const NIGHT = "#1d1f3a", DEEP = "#14152b";
const MIST = [44, 47, 85], MIST2 = [59, 63, 110], MOSS = [62, 90, 85], MOSS2 = [79, 111, 95];
const MOON = [233, 228, 255], GOLD = [243, 223, 162];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// A tiny fixed random so the floor is the same every time.
function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeCanvas(pw, ph) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(pw, ph);
  const c = document.createElement("canvas");
  c.width = pw; c.height = ph;
  return c;
}

/** A soft round wash fading to nothing. */
function wash(g, x, y, r, colour, a, sx = 1, sy = 1, rot = 0) {
  g.save();
  g.translate(x, y); g.rotate(rot); g.scale(sx, sy);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grad.addColorStop(0, rgba(colour, a));
  grad.addColorStop(0.55, rgba(colour, a * 0.45));
  grad.addColorStop(1, rgba(colour, 0));
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.restore();
}

function paintStatic(g, w, h, m) {
  const R = rand(4020), min = Math.min(w, h);

  // Ground: lighter mist at the moonlit top-left, deeper night bottom-right.
  const base = g.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#262949");
  base.addColorStop(0.5, NIGHT);
  base.addColorStop(1, "#181930");
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Painterly mist washes, stretched and turned so they read as brushed.
  for (let i = 0; i < 14; i++) {
    const x = R() * w, y = R() * h, r = (0.18 + R() * 0.22) * min * 1.4;
    wash(g, x, y, r, R() < 0.5 ? MIST : MIST2, 0.12 + R() * 0.1, 1.6 + R() * 0.8, 0.7 + R() * 0.3, R() * Math.PI);
  }
  // A few darker pools between them, for depth.
  for (let i = 0; i < 6; i++) {
    wash(g, R() * w, R() * h, (0.15 + R() * 0.15) * min, [20, 21, 43], 0.22, 1.5, 0.8, R() * Math.PI);
  }

  // Moss near the edges and in the corners: clusters of soft blobs.
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  const spots = corners.map(([x, y]) => [x, y, 1.0]);
  for (let i = 0; i < 6; i++) {
    const side = Math.floor(R() * 4), t = 0.18 + R() * 0.64;
    const p = side === 0 ? [t * w, 0] : side === 1 ? [t * w, h] : side === 2 ? [0, t * h] : [w, t * h];
    spots.push([p[0], p[1], 0.6 + R() * 0.3]);
  }
  for (const [cx, cy, k] of spots) {
    const n = 4 + Math.floor(R() * 3);
    for (let j = 0; j < n; j++) {
      const r = (0.6 + R() * 1.0) * m * k * 1.4;
      const ox = (R() - 0.5) * 2.2 * m * k, oy = (R() - 0.5) * 2.2 * m * k;
      // pull each blob slightly inside the edge
      const x = cx + ox + (cx < w / 2 ? 0.5 : -0.5) * m * k;
      const y = cy + oy + (cy < h / 2 ? 0.5 : -0.5) * m * k;
      wash(g, x, y, r, R() < 0.55 ? MOSS : MOSS2, 0.24 + R() * 0.12, 1.2 + R() * 0.5, 0.8, R() * Math.PI);
    }
  }

  // Faint moonlight falling from the top-left.
  const moon = g.createRadialGradient(-0.05 * w, -0.1 * h, 0, -0.05 * w, -0.1 * h, Math.hypot(w, h) * 0.75);
  moon.addColorStop(0, rgba(MOON, 0.11));
  moon.addColorStop(0.45, rgba(MOON, 0.04));
  moon.addColorStop(1, rgba(MOON, 0));
  g.fillStyle = moon;
  g.fillRect(0, 0, w, h);

  // A calm halo of mist around the vault; the vault itself is drawn elsewhere.
  const vx = w / 2, vy = h / 2, vr = 1.1 * m;
  const halo = g.createRadialGradient(vx, vy, vr * 0.9, vx, vy, vr * 3.2);
  halo.addColorStop(0, rgba(MIST2, 0.3));
  halo.addColorStop(0.5, rgba(MIST2, 0.12));
  halo.addColorStop(1, rgba(MIST2, 0));
  g.fillStyle = halo;
  g.beginPath(); g.arc(vx, vy, vr * 3.2, 0, Math.PI * 2); g.fill();

  // Soft vignette into deeper night.
  const vig = g.createRadialGradient(w / 2, h / 2, min * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.58);
  vig.addColorStop(0, "rgba(20,21,43,0)");
  vig.addColorStop(1, "rgba(20,21,43,0.6)");
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // The rim: a low hedge in soft shadow, at most 0.15 m, fading inwards.
  const bw = Math.max(2, 0.15 * m);
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, rgba([20, 21, 43], 0.85));
    gr.addColorStop(0.35, rgba(MOSS, 0.35));
    gr.addColorStop(1, rgba(MOSS, 0));
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, 0, bw, 0, 0, w, bw);
  edge(0, h, 0, h - bw, 0, h - bw, w, bw);
  edge(0, 0, bw, 0, 0, 0, bw, h);
  edge(w, 0, w - bw, 0, w - bw, 0, bw, h);
  // A whisper of moonlight on the inner lip, brighter on the lit top-left.
  const lip = g.createLinearGradient(0, 0, w, h);
  lip.addColorStop(0, rgba(MOON, 0.09));
  lip.addColorStop(0.5, rgba(MOON, 0.03));
  lip.addColorStop(1, rgba(MOON, 0.02));
  g.strokeStyle = lip;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect ? g.roundRect(bw, bw, w - 2 * bw, h - 2 * bw, bw * 2) : g.rect(bw, bw, w - 2 * bw, h - 2 * bw);
  g.stroke();
}

let cache = null, cacheKey = "";
let sprite = null, spriteKey = "";

function firefly(size, dpr) {
  const key = `${size}|${dpr}`;
  if (sprite && spriteKey === key) return sprite;
  const px = Math.max(2, Math.ceil(size * 2 * dpr));
  const c = makeCanvas(px, px), s = c.getContext("2d");
  const r = px / 2;
  const grad = s.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,248,220,1)");
  grad.addColorStop(0.12, rgba(GOLD, 0.9));
  grad.addColorStop(0.4, rgba(GOLD, 0.22));
  grad.addColorStop(1, rgba(GOLD, 0));
  s.fillStyle = grad;
  s.fillRect(0, 0, px, px);
  sprite = c; spriteKey = key;
  return c;
}

const FLIES = (() => {
  const R = rand(8020);
  return Array.from({ length: 8 }, () => ({
    x: 0.08 + R() * 0.84, y: 0.1 + R() * 0.8,
    ax: 0.03 + R() * 0.05, ay: 0.03 + R() * 0.05,
    px: 20 + R() * 20, py: 24 + R() * 22, // drift periods, seconds
    pb: 3 + R() * 4, ph: R() * Math.PI * 2, // breathing period, phase
  }));
})();

export function drawFloor(g, { w, h, m, now, reduced }) {
  if (!(w >= 1 && h >= 1)) return;
  const dpr = Math.abs(g.getTransform().a) || 1;
  const key = `${w}|${h}|${m}|${dpr}`;
  if (!cache || cacheKey !== key) {
    const c = makeCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    const s = c.getContext("2d");
    s.scale(dpr, dpr);
    paintStatic(s, w, h, m);
    cache = c; cacheKey = key;
  }
  g.save();
  g.drawImage(cache, 0, 0, w, h);
  if (!reduced) {
    // Fireflies: slow Lissajous drift, slow breathing glow.
    const size = Math.max(5, 0.32 * m), spr = firefly(size, dpr), t = now / 1000;
    for (const f of FLIES) {
      const x = (f.x + f.ax * Math.sin((t / f.px) * Math.PI * 2 + f.ph)) * w;
      const y = (f.y + f.ay * Math.sin((t / f.py) * Math.PI * 2 + f.ph * 1.7)) * h;
      const b = 0.5 + 0.5 * Math.sin((t / f.pb) * Math.PI * 2 + f.ph);
      g.globalAlpha = 0.12 + 0.55 * b * b;
      g.drawImage(spr, x - size, y - size, size * 2, size * 2);
    }
  }
  g.restore();
}
