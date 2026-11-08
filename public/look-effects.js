// Moments on the arena, night-garden style: a contact rippling like water,
// an artifact settling under a moonlit ring, cargo on a string of lanterns.
// Amber and dashed means at risk (CLAUDE.md): cargo and scatters stay that.

const TAU = Math.PI * 2;
const CORAL = "241,154,139"; // contact
const AMBER = "242,184,128"; // at risk
const MOON = "246,241,255"; // moonlight

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - (1 - v) ** 3;

/** A soft ring of light: a radial wash that peaks at `rad` and fades both ways. */
function softRing(g, x, y, rad, width, rgb, a) {
  if (rad < 1 || a <= 0.003) return;
  const inner = Math.max(0, rad - width), outer = rad + width;
  const grad = g.createRadialGradient(x, y, inner, x, y, outer);
  grad.addColorStop(0, `rgba(${rgb},0)`);
  grad.addColorStop(0.5, `rgba(${rgb},${a})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, outer, 0, TAU);
  g.fill();
}

/** A gently curved dashed path from a contact to where a thing will land. */
function riskPath(g, [x1, y1, x2, y2], r, a) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1) return;
  const bow = len * 0.16; // bow to one side, like a drifting leaf's path
  const cx = (x1 + x2) / 2 - (dy / len) * bow, cy = (y1 + y2) / 2 + (dx / len) * bow;
  const w = Math.max(1, r * 0.13);
  g.lineCap = "round";
  // a faint soft wash beneath, then the dashes
  g.setLineDash([]);
  g.strokeStyle = `rgba(${AMBER},${0.12 * a})`;
  g.lineWidth = w * 3.2;
  g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(cx, cy, x2, y2); g.stroke();
  g.setLineDash([Math.max(2, r * 0.32), Math.max(2.5, r * 0.36)]);
  g.strokeStyle = `rgba(${AMBER},${0.8 * a})`;
  g.lineWidth = w;
  g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(cx, cy, x2, y2); g.stroke();
  // the landing spot: a soft amber glow and a small dashed ring
  const lr = Math.max(4, r * 0.85);
  softRing(g, x2, y2, lr * 0.4, lr * 0.9, AMBER, 0.16 * a);
  g.setLineDash([Math.max(1.5, lr * 0.28), Math.max(1.5, lr * 0.3)]);
  g.strokeStyle = `rgba(${AMBER},${0.75 * a})`;
  g.lineWidth = Math.max(1, r * 0.11);
  g.beginPath(); g.arc(x2, y2, lr, 0, TAU); g.stroke();
  g.setLineDash([]);
}

/** A contact: a ripple opening out like a stone dropped in a pond, a few
 * motes of light drifting off, and a dashed amber path to where each thing
 * is landing. `k` runs 0 to 1 over 700 ms; `r` is ARTIFACT_R in pixels;
 * `lines` are [fromX, fromY, toX, toY] in pixels. */
export function drawFlash(g, { x, y, r, k, lines, reduced }) {
  if (!(r > 0)) return;
  k = clamp01(k);
  const fade = 1 - k;
  g.save();
  // the paths are information, so they show either way; they just fade
  for (const line of lines ?? []) riskPath(g, line, r, fade ** 0.6);
  if (reduced) {
    // nothing moves: one still soft ring that only fades
    softRing(g, x, y, r * 2, r * 0.6, CORAL, 0.45 * fade);
    g.strokeStyle = `rgba(${CORAL},${0.55 * fade})`;
    g.lineWidth = Math.max(1, r * 0.12);
    g.beginPath(); g.arc(x, y, r * 2, 0, TAU); g.stroke();
    g.restore();
    return;
  }
  const e = easeOut(k);
  // a soft glow where they touched, gone quickly
  softRing(g, x, y, 0, r * (1.4 + e), CORAL, 0.35 * (1 - k) ** 2);
  // the first ripple: a wash of coral light with a fine bright crest
  const r1 = r * (0.9 + 3.1 * e);
  softRing(g, x, y, r1, r * 0.55, CORAL, 0.32 * fade);
  g.strokeStyle = `rgba(${CORAL},${0.6 * fade})`;
  g.lineWidth = Math.max(1, r * 0.11 * (1 - 0.5 * k));
  g.beginPath(); g.arc(x, y, r1, 0, TAU); g.stroke();
  // a second, fainter ripple following behind
  const k2 = clamp01((k - 0.18) / 0.82);
  if (k2 > 0) {
    const r2 = r * (0.7 + 2.3 * easeOut(k2));
    softRing(g, x, y, r2, r * 0.4, CORAL, 0.18 * fade);
    g.strokeStyle = `rgba(${MOON},${0.25 * fade})`;
    g.lineWidth = Math.max(0.75, r * 0.07);
    g.beginPath(); g.arc(x, y, r2, 0, TAU); g.stroke();
  }
  // a few petals of light drifting outward, turning a little as they go
  for (let i = 0; i < 6; i++) {
    const ang = i * (TAU / 6) + 0.4 + k * 0.5 * (i % 2 ? 1 : -1);
    const d = r * (0.9 + (1.8 + (i % 3) * 0.35) * e);
    const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d - r * 0.3 * k;
    const s = Math.max(1.2, r * 0.2) * (1 - 0.4 * k);
    const rgb = i % 2 ? MOON : CORAL;
    softRing(g, px, py, 0, s * 2.2, rgb, 0.22 * fade);
    g.fillStyle = `rgba(${rgb},${0.7 * fade})`;
    g.beginPath();
    g.ellipse(px, py, s, s * 0.55, ang + k, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** An artifact that can't be taken yet: a calm moonlight ring filling
 * clockwise, `ready` 0 to 1. It sits just outside the drawn artifact. */
export function drawSettling(g, { x, y, r, ready }) {
  if (!(r > 0)) return;
  ready = clamp01(ready);
  const size = Math.max(15, r * 1.15); // the artifact's drawn size on the floor
  const R = size + Math.max(3, r * 0.22);
  const w = Math.max(1.5, r * 0.11);
  const a0 = -Math.PI / 2, a1 = a0 + TAU * ready;
  g.save();
  g.lineCap = "round";
  // the faint full track
  g.strokeStyle = `rgba(${MOON},0.16)`;
  g.lineWidth = w;
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
  if (ready > 0) {
    // a soft halo under the arc, then the arc itself
    g.strokeStyle = `rgba(${MOON},0.14)`;
    g.lineWidth = w * 3;
    g.beginPath(); g.arc(x, y, R, a0, a1); g.stroke();
    g.strokeStyle = `rgba(${MOON},0.85)`;
    g.lineWidth = w;
    g.beginPath(); g.arc(x, y, R, a0, a1); g.stroke();
    // a small soft glow at the leading end
    softRing(g, x + Math.cos(a1) * R, y + Math.sin(a1) * R, 0, w * 2.6, MOON, 0.35);
  }
  g.restore();
}

/** The tether from a robot to its last piece of cargo: a string of tiny
 * amber lanterns, dotted, because what it holds is still at risk. */
export function drawTether(g, { x1, y1, x2, y2 }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  const gap = Math.max(4.5, Math.min(8, len / 6));
  g.save();
  g.lineCap = "round";
  // round caps on zero-length dashes draw a dot each: one glow, one lantern
  g.setLineDash([0, gap]);
  g.strokeStyle = `rgba(${AMBER},0.22)`;
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = `rgba(${AMBER},0.9)`;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.restore();
}

// the cargo slot never changes for a given size, so paint it once
const slotCache = new Map();
function slotSprite(r, dpr) {
  const key = `${r.toFixed(2)}@${dpr}`;
  let c = slotCache.get(key);
  if (c) return c;
  const pad = r * 0.6, half = r + pad, side = Math.ceil(half * 2 * dpr);
  if (side < 1) return null;
  c = document.createElement("canvas");
  c.width = c.height = side;
  const s = c.getContext("2d");
  s.scale(dpr, dpr);
  const o = half;
  // a faint amber glow around the bubble
  softRing(s, o, o, r, r * 0.5, AMBER, 0.2);
  // the bubble of night: deeper at the heart, misty at the rim, lit a touch from the top-left
  const grad = s.createRadialGradient(o - r * 0.35, o - r * 0.4, r * 0.1, o, o, r);
  grad.addColorStop(0, "rgba(59,63,110,0.85)");
  grad.addColorStop(0.55, "rgba(29,31,58,0.9)");
  grad.addColorStop(1, "rgba(20,21,43,0.8)");
  s.fillStyle = grad;
  s.beginPath(); s.arc(o, o, r, 0, TAU); s.fill();
  // the dashed amber outline: at risk
  s.lineCap = "round";
  s.setLineDash([Math.max(1.6, r * 0.34), Math.max(1.6, r * 0.3)]);
  s.strokeStyle = `rgba(${AMBER},0.8)`;
  s.lineWidth = Math.max(1, r * 0.12);
  s.beginPath(); s.arc(o, o, r, 0, TAU); s.stroke();
  if (slotCache.size > 32) slotCache.clear();
  slotCache.set(key, c);
  return c;
}

/** The holder behind one piece of cargo; the artifact is drawn on top. */
export function drawCargoSlot(g, { x, y, r }) {
  if (!(r >= 1)) return;
  const t = g.getTransform();
  const dpr = Math.max(1, Math.round(Math.hypot(t.a, t.b) * 100) / 100);
  const c = slotSprite(r, dpr);
  if (!c) return;
  const half = r * 1.6;
  g.drawImage(c, x - half, y - half, half * 2, half * 2);
}
