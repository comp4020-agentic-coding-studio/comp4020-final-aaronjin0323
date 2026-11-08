// The arena floor, drawn first each frame: the gallery's floor seen from
// above (ADR 38), in the rooms' palette. Dark oak boards in a dim hall,
// warm pools of light from the lamps above, the brightest round the vault,
// deepening towards the walls, and a dark skirting at the rim with a fine
// cream edge. `w` and `h` are the arena's size in CSS pixels, `m` pixels per
// metre. Nothing on it moves, so `now` and `reduced` change nothing.

const DUSK = [22, 18, 14]; // #16130f, the rooms' page
const OAK = [92, 70, 48], OAK_LIGHT = [118, 92, 64], OAK_DARK = [70, 52, 35];
const LAMP = [255, 222, 170], CREAM = [239, 232, 219];
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

/** A pool of light, fading to nothing. */
function pool(g, x, y, r, a, sx = 1, sy = 1) {
  g.save();
  g.translate(x, y); g.scale(sx, sy);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grad.addColorStop(0, rgba(LAMP, a));
  grad.addColorStop(0.45, rgba(LAMP, a * 0.45));
  grad.addColorStop(1, rgba(LAMP, 0));
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.restore();
}

function paintStatic(g, w, h, m) {
  const R = rand(4020), min = Math.min(w, h);
  g.fillStyle = rgba(OAK, 1);
  g.fillRect(0, 0, w, h);

  // Boards run across the hall, about 0.55 m wide, each its own tone, their
  // ends staggered, with a little grain along each.
  const bh = Math.max(6, 0.55 * m);
  for (let y = 0, row = 0; y < h; y += bh, row++) {
    let x = -R() * w * 0.3;
    while (x < w) {
      const len = (2.2 + R() * 2.6) * m;
      const t = R();
      const tone = t < 0.33 ? OAK_DARK : t < 0.66 ? OAK : OAK_LIGHT;
      g.fillStyle = rgba(tone, 0.35 + R() * 0.25);
      g.fillRect(x, y, len, bh);
      g.strokeStyle = "rgba(40,28,16,0.18)";
      g.lineWidth = Math.max(0.5, bh * 0.025);
      for (let k = 0; k < 4; k++) {
        const gy = y + bh * (0.15 + R() * 0.7);
        g.beginPath();
        g.moveTo(x, gy);
        g.bezierCurveTo(x + len * 0.3, gy + (R() - 0.5) * bh * 0.25, x + len * 0.7, gy + (R() - 0.5) * bh * 0.25, x + len, gy);
        g.stroke();
      }
      g.fillStyle = "rgba(30,20,12,0.32)"; // the joint at the board's end
      g.fillRect(x, y, Math.max(1, bh * 0.04), bh);
      x += len;
    }
    g.fillStyle = "rgba(30,20,12,0.3)"; // the seam between rows
    g.fillRect(0, y, w, Math.max(1, bh * 0.045));
    g.fillStyle = "rgba(255,236,206,0.06)";
    g.fillRect(0, y + Math.max(1, bh * 0.045), w, Math.max(1, bh * 0.03));
  }

  // The hall is dim: darken the whole floor, then let the lamps light it.
  g.fillStyle = rgba(DUSK, 0.38);
  g.fillRect(0, 0, w, h);
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const [fx, fy] of [[0.2, 0.28], [0.8, 0.28], [0.2, 0.74], [0.8, 0.74]]) pool(g, fx * w, fy * h, min * 0.36, 0.11, 1.25, 1);
  pool(g, w / 2, h / 2, min * 0.5, 0.13, 1.3, 1); // the vault is the most lit place
  g.restore();

  // Deepening towards the walls.
  const vig = g.createRadialGradient(w / 2, h / 2, min * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vig.addColorStop(0, rgba(DUSK, 0));
  vig.addColorStop(1, rgba(DUSK, 0.62));
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // The skirting: a dark band at most 0.15 m, a fine cream edge inside it,
  // and a soft shadow it casts on the boards.
  const bw = Math.max(2, 0.15 * m);
  g.fillStyle = rgba(DUSK, 0.92);
  g.fillRect(0, 0, w, bw); g.fillRect(0, h - bw, w, bw);
  g.fillRect(0, 0, bw, h); g.fillRect(w - bw, 0, bw, h);
  const shade = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, rgba(DUSK, 0.45));
    gr.addColorStop(1, rgba(DUSK, 0));
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  const sw = bw * 2.5;
  shade(0, bw, 0, bw + sw, 0, bw, w, sw);
  shade(0, h - bw, 0, h - bw - sw, 0, h - bw - sw, w, sw);
  shade(bw, 0, bw + sw, 0, bw, 0, sw, h);
  shade(w - bw, 0, w - bw - sw, 0, w - bw - sw, 0, sw, h);
  g.strokeStyle = rgba(CREAM, 0.16);
  g.lineWidth = 1;
  g.strokeRect(bw + 0.5, bw + 0.5, w - 2 * bw - 1, h - 2 * bw - 1);
}

let cache = null, cacheKey = "";

export function drawFloor(g, { w, h, m }) {
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
  g.drawImage(cache, 0, 0, w, h);
}
