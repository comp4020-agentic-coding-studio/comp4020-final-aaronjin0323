// A robot: its slot's colour AND its slot's mark (0 circle, 1 square,
// 2 triangle, 3 diamond), so nobody depends on colour alone (CLAUDE.md). `r`
// is ROBOT_R in pixels: the body must stay that size, as contacts use it.
// `isMe` marks your own robot. `vel` is its velocity in metres per second.
// With `reduced` nothing may move.
//
// Look: a smooth pastel moon-stone. Moonlight washes it from the top-left,
// it shades softly to the bottom-right, the mark is pressed gently into it,
// and a faint glow of its own colour breathes around it. Your own robot
// wears a calm moonlight halo ring. No gloss, no rim, no parts.

const NIGHT = [20, 21, 43]; // #14152b
const MOON = [246, 241, 255]; // #f6f1ff
const GLOW_SPAN = 2.1; // glow reaches this many radii from the centre
const BREATH_MS = 5200;

const sprites = new Map();

function rgb(hex) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [200, 200, 220];
}
function mix(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}
function css(c, a = 1) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function makeCanvas(w, h) {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function markPath(g, slot, x, y, m) {
  g.beginPath();
  if (slot === 0) g.arc(x, y, m * 0.95, 0, Math.PI * 2);
  else if (slot === 1) {
    const s = m * 0.85, k = s * 0.28; // a softly rounded square
    g.moveTo(x - s + k, y - s);
    g.arcTo(x + s, y - s, x + s, y + s, k);
    g.arcTo(x + s, y + s, x - s, y + s, k);
    g.arcTo(x - s, y + s, x - s, y - s, k);
    g.arcTo(x - s, y - s, x + s, y - s, k);
  } else if (slot === 2) {
    g.moveTo(x, y - m * 1.15);
    g.lineTo(x + m * 1.1, y + m * 0.8);
    g.lineTo(x - m * 1.1, y + m * 0.8);
  } else {
    g.moveTo(x, y - m * 1.25);
    g.lineTo(x + m * 1.05, y);
    g.lineTo(x, y + m * 1.25);
    g.lineTo(x - m * 1.05, y);
  }
  g.closePath();
}

// The still parts: body, inset mark and (for you) the halo ring.
function bodySprite(slot, colour, isMe, r, dpr) {
  const key = `b|${slot}|${colour}|${isMe ? 1 : 0}|${r.toFixed(2)}|${dpr}`;
  let s = sprites.get(key);
  if (s) return s;
  const R = r * dpr;
  const half = Math.ceil(R * 1.75 + 3 * dpr);
  const size = half * 2;
  if (!(size >= 1)) return null;
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  const cx = half, cy = half;
  const base = rgb(colour);

  // a soft bed of shadow just under the pebble, to the bottom-right
  const sh = g.createRadialGradient(cx + R * 0.18, cy + R * 0.22, R * 0.6, cx + R * 0.18, cy + R * 0.22, R * 1.3);
  sh.addColorStop(0, css(NIGHT, 0.35));
  sh.addColorStop(1, css(NIGHT, 0));
  g.fillStyle = sh;
  g.beginPath();
  g.arc(cx + R * 0.18, cy + R * 0.22, R * 1.3, 0, Math.PI * 2);
  g.fill();

  // body: moonlit top-left fading through the slot colour to a soft shade
  const body = g.createRadialGradient(cx - R * 0.42, cy - R * 0.48, R * 0.05, cx - R * 0.1, cy - R * 0.1, R * 1.25);
  body.addColorStop(0, css(mix(base, MOON, 0.55)));
  body.addColorStop(0.45, css(mix(base, MOON, 0.12)));
  body.addColorStop(0.8, css(base));
  body.addColorStop(1, css(mix(base, NIGHT, 0.32)));
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();

  // a broad, faint moonlight wash (no hot-spot): just lifts the top-left
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  const wash = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  wash.addColorStop(0, css(MOON, 0.22));
  wash.addColorStop(0.5, css(MOON, 0));
  wash.addColorStop(0.75, css(NIGHT, 0));
  wash.addColorStop(1, css(NIGHT, 0.18));
  g.fillStyle = wash;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  // the mark, pressed in: a lit lower-right lip, then the recess itself
  const m = R * (r < 14 ? 0.5 : 0.42);
  const lip = Math.max(0.7 * dpr, R * 0.06);
  g.fillStyle = css(mix(base, MOON, 0.6), 0.75);
  markPath(g, slot, cx + lip, cy + lip, m);
  g.fill();
  const deep = mix(base, NIGHT, 0.52);
  const pit = g.createLinearGradient(cx - m, cy - m, cx + m, cy + m);
  pit.addColorStop(0, css(mix(deep, NIGHT, 0.25), 0.92));
  pit.addColorStop(1, css(deep, 0.85));
  g.fillStyle = pit;
  markPath(g, slot, cx, cy, m);
  g.fill();
  g.restore();

  // you: a calm moonlight halo ring with a soft bloom
  if (isMe) {
    const ringR = R * 1.42 + 1.5 * dpr;
    const lw = Math.max(1.6 * dpr, R * 0.15);
    const bloom = g.createRadialGradient(cx, cy, ringR - lw * 2.5, cx, cy, ringR + lw * 2.5);
    bloom.addColorStop(0, css(MOON, 0));
    bloom.addColorStop(0.5, css(MOON, 0.28));
    bloom.addColorStop(1, css(MOON, 0));
    g.fillStyle = bloom;
    g.beginPath();
    g.arc(cx, cy, ringR + lw * 2.5, 0, Math.PI * 2);
    g.arc(cx, cy, Math.max(0, ringR - lw * 2.5), 0, Math.PI * 2, true);
    g.fill();
    g.strokeStyle = css(MOON, 0.9);
    g.lineWidth = lw;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
  }

  s = { c, half: half / dpr, size: size / dpr };
  sprites.set(key, s);
  return s;
}

// The glow around it, drawn on its own so it can breathe.
function glowSprite(colour, r, dpr) {
  const key = `g|${colour}|${r.toFixed(2)}|${dpr}`;
  let s = sprites.get(key);
  if (s) return s;
  const R = r * dpr;
  const half = Math.ceil(R * GLOW_SPAN + dpr);
  const size = half * 2;
  if (!(size >= 1)) return null;
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  const base = rgb(colour);
  const glow = g.createRadialGradient(half, half, R * 0.7, half, half, R * GLOW_SPAN);
  glow.addColorStop(0, css(base, 0.42));
  glow.addColorStop(0.4, css(base, 0.16));
  glow.addColorStop(1, css(base, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  s = { c, half: half / dpr, size: size / dpr };
  sprites.set(key, s);
  return s;
}

export function drawRobot(g, { x, y, r, slot, colour, isMe, vel, now, reduced }) {
  if (!(r > 0.5)) return; // no size yet: nothing to draw
  if (sprites.size > 200) sprites.clear();
  const dpr = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
  const glow = glowSprite(colour, r, dpr);
  const body = bodySprite(slot, colour, isMe, r, dpr);
  if (!glow || !body) return;
  g.save(); // globalAlpha is inherited (0.3 for a ghost) and only multiplied
  const breath = reduced ? 0.8 : 0.8 + 0.2 * Math.sin(((now || 0) / BREATH_MS) * Math.PI * 2 + slot * 1.7);
  g.globalAlpha *= breath;
  g.drawImage(glow.c, x - glow.half, y - glow.half, glow.size, glow.size);
  g.globalAlpha /= breath;
  g.drawImage(body.c, x - body.half, y - body.half, body.size, body.size);
  g.restore();
}

/** Motion behind a fast robot (only drawn when motion is allowed). `back` is
 * where it was 0.09 s ago, in pixels. A soft tapering wake of light. */
export function drawTrail(g, { x, y, back, r, colour }) {
  if (!(r > 0.5) || !back) return;
  const dx = x - back[0], dy = y - back[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1)) return;
  const ux = dx / len, uy = dy / len; // towards the robot
  const nx = -uy, ny = ux;
  const tx = x - ux * len * 1.6, ty = y - uy * len * 1.6; // let it fade out past `back`
  const base = rgb(colour);
  g.save();
  for (const [w, a] of [[0.95, 0.16], [0.7, 0.2], [0.42, 0.26]]) {
    const hw = r * w;
    const grad = g.createLinearGradient(x, y, tx, ty);
    grad.addColorStop(0, css(base, a));
    grad.addColorStop(0.55, css(mix(base, MOON, 0.3), a * 0.45));
    grad.addColorStop(1, css(base, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x + nx * hw, y + ny * hw);
    g.quadraticCurveTo(x - ux * len * 0.7 + nx * hw * 0.55, y - uy * len * 0.7 + ny * hw * 0.55, tx, ty);
    g.quadraticCurveTo(x - ux * len * 0.7 - nx * hw * 0.55, y - uy * len * 0.7 - ny * hw * 0.55, x - nx * hw, y - ny * hw);
    g.arc(x, y, hw, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
    g.closePath();
    g.fill();
  }
  g.restore();
}
