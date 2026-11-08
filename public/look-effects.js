// Moments on the arena: a contact, an artifact settling, cargo on a tether.
// Amber and dashed means at risk (CLAUDE.md): cargo and scatters stay that.

const TAU = Math.PI * 2;
const RED = "255,107,74";
const AMBER = "255,182,72";

// A small stable hash so a contact's sparks don't flicker frame to frame.
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A contact: a shockwave and sparks, and a dashed arc to where each
 * scattered thing is landing. `k` runs 0 to 1 over 700 ms; `r` is
 * ARTIFACT_R in pixels; `lines` are [fromX, fromY, toX, toY] in pixels. */
export function drawFlash(g, { x, y, r, k, lines, reduced }) {
  k = Math.min(1, Math.max(0, k));
  const fade = 1 - k;
  const seed = Math.round(x * 7 + y * 13);
  // Sizes are tuned for r ~ 22 px and scale down with it on a phone.
  const u = Math.max(0.5, Math.min(1.3, r / 22));
  g.save();
  g.lineCap = "round";

  if (reduced) {
    // A still star-shaped mark that only fades.
    const a = fade * fade;
    const glow = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
    glow.addColorStop(0, `rgba(255,220,190,${0.55 * a})`);
    glow.addColorStop(0.5, `rgba(${RED},${0.35 * a})`);
    glow.addColorStop(1, `rgba(${RED},0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, r * 1.6, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(${RED},${0.9 * a})`;
    g.lineWidth = 2.5 * u;
    g.beginPath();
    g.arc(x, y, r + 8 * u, 0, TAU);
    g.stroke();
    g.lineWidth = 2 * u;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU + 0.2;
      const inner = r + 12 * u, outer = r + (i % 2 ? 17 : 22) * u;
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
      g.lineTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer);
      g.stroke();
    }
  } else {
    const ease = 1 - (1 - k) * (1 - k) * (1 - k); // fast out, slow settle
    // Hot core flash, gone by about k = 0.35.
    const core = Math.max(0, 1 - k / 0.35);
    if (core > 0) {
      const cr = r * (0.9 + 0.8 * ease);
      const hot = g.createRadialGradient(x, y, 0, x, y, cr * 1.4);
      hot.addColorStop(0, `rgba(255,244,230,${0.9 * core})`);
      hot.addColorStop(0.35, `rgba(255,170,120,${0.7 * core})`);
      hot.addColorStop(1, `rgba(${RED},0)`);
      g.fillStyle = hot;
      g.beginPath();
      g.arc(x, y, cr * 1.4, 0, TAU);
      g.fill();
    }
    // Shockwave: a thick soft ring thinning as it opens.
    const ring = r + (4 + 26 * ease) * u;
    g.strokeStyle = `rgba(${RED},${0.25 * fade})`;
    g.lineWidth = (10 * fade + 2) * u;
    g.beginPath();
    g.arc(x, y, ring, 0, TAU);
    g.stroke();
    g.strokeStyle = `rgba(${RED},${0.95 * fade})`;
    g.lineWidth = (3.5 * fade + 1) * u;
    g.beginPath();
    g.arc(x, y, ring, 0, TAU);
    g.stroke();
    // A second, fainter echo ring trailing behind.
    g.strokeStyle = `rgba(255,200,170,${0.45 * fade * fade})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, r + (2 + 20 * ease) * u, 0, TAU);
    g.stroke();
    // Sparks: short streaks flying out and shrinking.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * TAU + hash(seed + i) * 0.5;
      const reach = r * 0.7 + (42 + 30 * hash(seed + i * 3.1)) * ease * u;
      const len = ((7 + 9 * hash(seed + i * 5.7)) * fade + 2) * u;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const hx = x + cx * reach, hy = y + sy * reach;
      g.strokeStyle = i % 3 === 0 ? `rgba(255,230,200,${fade})` : `rgba(${RED},${fade})`;
      g.lineWidth = (3 * fade + 0.6) * u;
      g.beginPath();
      g.moveTo(hx - cx * len, hy - sy * len);
      g.lineTo(hx, hy);
      g.stroke();
    }
  }

  // Where each scattered thing is landing: an amber dashed arc + a dashed
  // ring at the spot (at risk, so amber and dashed, never solid gold).
  const la = reduced ? fade : Math.min(1, fade * 1.6);
  g.strokeStyle = `rgba(${AMBER},${0.9 * la})`;
  g.lineWidth = Math.max(1.5, 2 * u);
  g.setLineDash([5 * u + 1, 5 * u + 1]);
  if (!reduced) g.lineDashOffset = -k * 30 * u;
  for (let i = 0; i < lines.length; i++) {
    const [x1, y1, x2, y2] = lines[i];
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy) || 1;
    const bend = d * 0.25 * (i % 2 ? -1 : 1);
    const mx = (x1 + x2) / 2 - (dy / d) * bend, my = (y1 + y2) / 2 + (dx / d) * bend;
    g.beginPath();
    g.moveTo(x1, y1);
    g.quadraticCurveTo(mx, my, x2, y2);
    g.stroke();
    g.beginPath();
    g.arc(x2, y2, Math.max(4, r * 0.55), 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** An artifact that can't be taken yet: a ring filling, `ready` 0 to 1. */
export function drawSettling(g, { x, y, r, ready }) {
  ready = Math.min(1, Math.max(0, ready));
  const rr = r + 6;
  const start = -Math.PI / 2;
  const end = start + TAU * ready;
  g.save();
  g.lineCap = "round";
  // Dark under-track for contrast on any floor, then a faint white track.
  g.strokeStyle = "rgba(22,19,31,.55)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(x, y, rr, 0, TAU);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,.18)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(x, y, rr, 0, TAU);
  g.stroke();
  if (ready > 0) {
    // Soft halo under the fill, then the bright fill itself.
    g.strokeStyle = "rgba(255,255,255,.16)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x, y, rr, start, end);
    g.stroke();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x, y, rr, start, end);
    g.stroke();
    // The glowing head.
    const hx = x + Math.cos(end) * rr, hy = y + Math.sin(end) * rr;
    const glow = g.createRadialGradient(hx, hy, 0, hx, hy, 7);
    glow.addColorStop(0, "rgba(255,255,255,.75)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(hx, hy, 7, 0, TAU);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(hx, hy, 2.6, 0, TAU);
    g.fill();
  }
  // A small tick at twelve o'clock marks where the ring completes.
  g.strokeStyle = "rgba(255,255,255,.5)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y - rr - 4);
  g.lineTo(x, y - rr + 4);
  g.stroke();
  g.restore();
}

/** The tether from a robot to its last piece of cargo: an amber bead chain
 * (beads with gaps read as dashed, so at risk). */
export function drawTether(g, { x1, y1, x2, y2 }) {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  g.save();
  // A thin dark cord underneath so the beads read as strung.
  g.lineCap = "round";
  g.strokeStyle = "rgba(22,19,31,.6)";
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  g.strokeStyle = `rgba(${AMBER},.35)`;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  if (d > 1) {
    const ux = dx / d, uy = dy / d;
    const step = 7;
    const n = Math.floor(d / step);
    const off = (d - n * step) / 2;
    for (let i = 0; i <= n; i++) {
      const bx = x1 + ux * (off + i * step), by = y1 + uy * (off + i * step);
      // Slightly oval link along the tether, lit from the top-left.
      g.save();
      g.translate(bx, by);
      g.rotate(Math.atan2(uy, ux));
      g.fillStyle = "#a8651f";
      g.beginPath();
      g.ellipse(0, 0, 2.8, 2.1, 0, 0, TAU);
      g.fill();
      g.restore();
      g.fillStyle = "#ffb648";
      g.beginPath();
      g.arc(bx - 0.4, by - 0.4, 1.7, 0, TAU);
      g.fill();
      g.fillStyle = "rgba(255,240,210,.85)";
      g.beginPath();
      g.arc(bx - 0.9, by - 0.9, 0.7, 0, TAU);
      g.fill();
    }
  }
  g.restore();
}

/** The holder behind one piece of cargo; the artifact is drawn on top:
 * a little towed bubble with an amber dashed rim. */
export function drawCargoSlot(g, { x, y, r }) {
  g.save();
  // Contact shadow, offset down-right from the top-left light.
  g.fillStyle = "rgba(10,8,16,.45)";
  g.beginPath();
  g.ellipse(x + r * 0.12, y + r * 0.2, r * 1.02, r * 0.96, 0, 0, TAU);
  g.fill();
  // The bubble: a deep cup, lighter toward the top-left.
  const body = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, "#3a3754");
  body.addColorStop(0.7, "#211f33");
  body.addColorStop(1, "#16131f");
  g.fillStyle = body;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  // A faint amber warmth inside the rim.
  const warm = g.createRadialGradient(x, y, r * 0.6, x, y, r);
  warm.addColorStop(0, `rgba(${AMBER},0)`);
  warm.addColorStop(1, `rgba(${AMBER},.22)`);
  g.fillStyle = warm;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  // Glassy highlight crescent, top-left.
  g.strokeStyle = "rgba(255,255,255,.22)";
  g.lineWidth = Math.max(1.2, r * 0.09);
  g.lineCap = "round";
  g.beginPath();
  g.arc(x, y, r * 0.78, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
  // The amber dashed rim (at risk).
  g.setLineDash([4, 3]);
  g.lineCap = "butt";
  g.strokeStyle = "#ffb648";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.stroke();
  g.restore();
}
