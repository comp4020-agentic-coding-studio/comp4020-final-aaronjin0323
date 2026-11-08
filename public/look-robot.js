// A robot: its slot's colour AND its slot's mark (0 circle, 1 square,
// 2 triangle, 3 diamond), so nobody depends on colour alone (CLAUDE.md). `r`
// is ROBOT_R in pixels: the body must stay that size, as contacts use it.
// `isMe` marks your own robot. `vel` is its velocity in metres per second.
// With `reduced` nothing may move.
//
// The look: a toy puck seen from above, lit from the top left. A brushed
// metal rim, a glossy dome in the slot colour with the slot's mark inlaid in
// it (kept upright, so it always reads), and a dark glass visor with a
// headlight that turns to face where it's going. The rim, dome, mark and
// your own white ring never change, so they're drawn once per (slot,
// colour, isMe, r, devicePixelRatio) into an offscreen canvas and stamped.

const cache = new Map();

function rgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, to, k, a = 1) {
  const c = rgb(hex);
  const t = to === "white" ? [255, 255, 255] : [22, 19, 31];
  const m = c.map((v, i) => Math.round(v + (t[i] - v) * k));
  return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
}

function markPath(g, slot, cx, cy, m) {
  g.beginPath();
  if (slot === 0) g.arc(cx, cy, m, 0, Math.PI * 2);
  else if (slot === 1) { const s = m * 0.9; g.rect(cx - s, cy - s, s * 2, s * 2); }
  else if (slot === 2) { g.moveTo(cx, cy - m * 1.15); g.lineTo(cx + m * 1.12, cy + m * 0.8); g.lineTo(cx - m * 1.12, cy + m * 0.8); g.closePath(); }
  else { g.moveTo(cx, cy - m * 1.25); g.lineTo(cx + m * 1.25, cy); g.lineTo(cx, cy + m * 1.25); g.lineTo(cx - m * 1.25, cy); g.closePath(); }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

// The still parts of a robot, centred in a square of side `size` CSS px.
function body(slot, colour, isMe, r) {
  const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  const key = `${slot}|${colour}|${isMe ? 1 : 0}|${r.toFixed(2)}|${dpr}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const size = Math.ceil(r * 3.2);
  const cv = makeCanvas(Math.ceil(size * dpr), Math.ceil(size * dpr));
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const c = size / 2;

  // drop shadow, falling bottom-right
  const so = r * 0.14;
  const sh = g.createRadialGradient(c + so, c + so, r * 0.6, c + so, c + so, r * 1.22);
  sh.addColorStop(0, "rgba(6,4,14,.55)");
  sh.addColorStop(1, "rgba(6,4,14,0)");
  g.fillStyle = sh;
  g.beginPath(); g.arc(c + so, c + so, r * 1.22, 0, Math.PI * 2); g.fill();

  // metal rim: bright top-left, dark bottom-right
  const rim = g.createLinearGradient(c - r, c - r, c + r, c + r);
  rim.addColorStop(0, "#d9d5f0");
  rim.addColorStop(0.35, "#8f8ab3");
  rim.addColorStop(0.7, "#57527a");
  rim.addColorStop(1, "#2a2740");
  g.fillStyle = rim;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  // tinted band so the rim carries the slot colour too
  g.fillStyle = mix(colour, "dark", 0.2, 0.28);
  g.fill();

  // groove between rim and dome
  const dr = r * 0.8;
  g.fillStyle = "rgba(14,11,24,.75)";
  g.beginPath(); g.arc(c, c, r * 0.86, 0, Math.PI * 2); g.fill();

  // the dome, lit from the top left
  const dome = g.createRadialGradient(c - dr * 0.38, c - dr * 0.42, dr * 0.05, c, c, dr);
  dome.addColorStop(0, mix(colour, "white", 0.55));
  dome.addColorStop(0.45, colour);
  dome.addColorStop(1, mix(colour, "dark", 0.45));
  g.fillStyle = dome;
  g.beginPath(); g.arc(c, c, dr, 0, Math.PI * 2); g.fill();

  // the mark, inlaid: a light lip bottom-right, then the dark shape
  const m = r * (r < 14 ? 0.44 : 0.38);
  g.fillStyle = mix(colour, "white", 0.5, 0.4);
  markPath(g, slot, c + r * 0.03, c + r * 0.04, m);
  g.fill();
  g.fillStyle = "rgba(22,19,31,.86)";
  markPath(g, slot, c, c, m);
  g.fill();

  // gloss over the top-left of the dome
  g.save();
  g.translate(c - dr * 0.32, c - dr * 0.4);
  g.rotate(-Math.PI / 4);
  g.scale(1, 0.55);
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, dr * 0.55);
  gl.addColorStop(0, "rgba(255,255,255,.7)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gl;
  g.beginPath(); g.arc(0, 0, dr * 0.55, 0, Math.PI * 2); g.fill();
  g.restore();

  // rim highlight top-left and a crisp outline for contrast with the floor
  g.lineWidth = Math.max(0.6, r * 0.06);
  g.strokeStyle = "rgba(255,255,255,.55)";
  g.beginPath(); g.arc(c, c, r * 0.95, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = "rgba(10,8,18,.7)";
  g.beginPath(); g.arc(c, c, r - 0.5, 0, Math.PI * 2); g.stroke();

  // yours: a clean white ring just outside the body, with a dark keyline
  if (isMe) {
    const w = Math.min(4, Math.max(2.4, r * 0.13));
    g.lineWidth = w + 2;
    g.strokeStyle = "rgba(10,8,18,.6)";
    g.beginPath(); g.arc(c, c, r + w / 2 + 0.5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = w;
    g.strokeStyle = "#ffffff";
    g.stroke();
  }

  hit = { cv, size };
  cache.set(key, hit);
  return hit;
}

export function drawRobot(g, { x, y, r, slot, colour, isMe, vel, now, reduced }) {
  if (!(r > 0.5)) return; // no size yet (the canvas isn't laid out): nothing to stamp
  const { cv, size } = body(slot, colour, isMe, r);
  g.save();
  g.drawImage(cv, x - size / 2, y - size / 2, size, size);

  // facing: where it's going, or up when still
  const vx = vel?.[0] ?? 0, vy = vel?.[1] ?? 0;
  const speed = Math.hypot(vx, vy);
  const a = speed > 0.05 ? Math.atan2(vy, vx) : -Math.PI / 2;
  const base = g.globalAlpha;
  g.translate(x, y);
  g.rotate(a);

  // headlight beam ahead when moving (static, fades with speed)
  if (speed > 0.3) {
    const k = Math.min(1, speed / 6);
    const beam = g.createRadialGradient(r * 0.9, 0, 0, r * 0.9, 0, r * 1.1);
    beam.addColorStop(0, `rgba(255,226,160,${0.28 * k})`);
    beam.addColorStop(1, "rgba(255,226,160,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(r * 0.85, 0);
    g.arc(r * 0.85, 0, r * 1.1, -0.38, 0.38);
    g.closePath();
    g.fill();
  }

  // dark glass visor on the front of the dome
  const vr = r * 0.7, span = 0.6;
  g.lineCap = "round";
  g.lineWidth = Math.max(1.3, r * 0.16);
  g.strokeStyle = "rgba(16,13,28,.92)";
  g.beginPath(); g.arc(0, 0, vr, -span, span); g.stroke();
  g.lineWidth = Math.max(0.6, r * 0.07);
  g.strokeStyle = "rgba(150,230,255,.75)";
  g.beginPath(); g.arc(0, 0, vr, -span * 0.75, -span * 0.15); g.stroke();

  // headlight on the rim
  g.fillStyle = "#fff6dc";
  g.beginPath(); g.arc(r * 0.93, 0, Math.max(0.9, r * 0.11), 0, Math.PI * 2); g.fill();

  // a little status light at the back, breathing unless motion is reduced
  const pulse = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(now / 420 + slot * 1.7);
  g.globalAlpha = base * pulse;
  g.fillStyle = mix(colour, "white", 0.5);
  g.beginPath(); g.arc(-r * 0.93, 0, Math.max(0.7, r * 0.08), 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Motion behind a fast robot (only drawn when motion is allowed). `back` is
 * where it was 0.09 s ago, in pixels. A soft comet tail, widest at the robot
 * and tapering to nothing, with a brighter core. */
export function drawTrail(g, { x, y, back, r, colour }) {
  if (!(r > 0.5)) return;
  const dx = x - back[0], dy = y - back[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(dy, dx));
  const tail = len + r * 0.8;
  const layer = (w, a0) => {
    const grad = g.createLinearGradient(0, 0, -tail, 0);
    grad.addColorStop(0, mix(colour, "white", 0.15, a0));
    grad.addColorStop(0.5, mix(colour, "white", 0, a0 * 0.45));
    grad.addColorStop(1, mix(colour, "white", 0, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -w);
    g.quadraticCurveTo(-tail * 0.45, -w * 0.75, -tail, 0);
    g.quadraticCurveTo(-tail * 0.45, w * 0.75, 0, w);
    g.arc(0, 0, w, Math.PI / 2, -Math.PI / 2, true);
    g.fill();
  };
  layer(r * 0.95, 0.42);
  layer(r * 0.45, 0.6);
  g.restore();
}
