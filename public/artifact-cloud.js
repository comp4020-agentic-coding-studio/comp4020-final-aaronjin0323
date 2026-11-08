import { glowing, star, stream } from "./artifact-paint.js";

// Each material's cloud: a lit top (hi), its body (mid), a shaded underside
// (lo), the soft shadow one puff casts on the puff behind it (shade), and
// the colour of its rim light.
const TONE = {
  tin: { hi: "#f4f7fa", mid: "#a9b2bc", lo: "#5f6873", shade: "rgba(30,36,44,0.32)", rim: "rgba(255,255,255,0.75)", alpha: 1 },
  glass: { hi: "rgba(255,255,255,0.95)", mid: "rgba(150,236,255,0.62)", lo: "rgba(20,110,150,0.7)", shade: "rgba(10,70,100,0.28)", rim: "rgba(255,255,255,0.95)", alpha: 1 },
  gold: { hi: "#fff6c9", mid: "#f0b93a", lo: "#9a6409", shade: "rgba(90,50,0,0.35)", rim: "rgba(255,250,215,0.9)", alpha: 1 },
  starlight: { hi: "#8a70ee", mid: "#3a2a8c", lo: "#150c40", shade: "rgba(8,3,30,0.45)", rim: "rgba(214,198,255,0.85)", alpha: 1 },
};

/** The puffs, back row first, then the front row, and the flat base. */
function layout(r, n) {
  const j = (a) => (n() - 0.5) * a * r;
  const baseY = r * 0.14, slab = { x: -r * 0.8, y: baseY - r * 0.34, w: r * 1.6, h: r * 0.34 };
  const back = [
    [-r * 0.1 + j(0.16), -r * 0.3 + j(0.08), r * (0.4 + n() * 0.08)],
    [r * 0.36 + j(0.1), -r * 0.2 + j(0.08), r * (0.28 + n() * 0.07)],
  ];
  if (n() < 0.65) back.push([-r * 0.44 + j(0.08), -r * 0.16 + j(0.06), r * (0.24 + n() * 0.06)]);
  const front = [];
  const fl = r * (0.26 + n() * 0.05), fr = r * (0.24 + n() * 0.05);
  front.push([-r * 0.56, baseY - fl, fl]);
  front.push([r * 0.56, baseY - fr, fr]);
  if (n() < 0.5) { const c = r * (0.24 + n() * 0.05); front.push([j(0.3), baseY - c * 0.75, c]); }
  return { baseY, slab, back, front };
}

function outline(g, { slab, back, front }) {
  g.beginPath();
  for (const [x, y, c] of [...back, ...front]) { g.moveTo(x + c, y); g.arc(x, y, c, 0, Math.PI * 2); }
  g.moveTo(slab.x + slab.h / 2, slab.y);
  g.roundRect(slab.x, slab.y, slab.w, slab.h, slab.h / 2);
}

function puff(g, x, y, c, tone, shadow) {
  if (shadow) {
    g.fillStyle = tone.shade;
    g.beginPath();
    g.arc(x + c * 0.1, y + c * 0.14, c * 1.04, 0, Math.PI * 2);
    g.fill();
  }
  const m = g.createRadialGradient(x - c * 0.38, y - c * 0.45, c * 0.08, x, y, c * 1.02);
  m.addColorStop(0, tone.hi);
  m.addColorStop(0.5, tone.mid);
  m.addColorStop(1, tone.lo);
  g.fillStyle = m;
  g.beginPath();
  g.arc(x, y, c, 0, Math.PI * 2);
  g.fill();
  // a rim of light along the top-left edge
  g.strokeStyle = tone.rim;
  g.lineWidth = Math.max(0.8, c * 0.09);
  g.lineCap = "round";
  g.beginPath();
  g.arc(x, y, c * 0.8, Math.PI * 1.08, Math.PI * 1.45);
  g.stroke();
}

function drop(g, x, y, w, h) {
  g.beginPath();
  g.moveTo(x + w, y);
  g.arc(x, y, w, 0, Math.PI);
  g.quadraticCurveTo(x - w, y - h * 0.45, x, y - h);
  g.quadraticCurveTo(x + w, y - h * 0.45, x + w, y);
}

function rain(g, r, t, material, n, baseY) {
  const count = 3 + Math.floor(n() * 3);
  const top = baseY + r * 0.1, span = r * 0.66;
  for (let i = 0; i < count; i++) {
    const x = ((i + 0.5) / count - 0.5) * r * 1.25 + (n() - 0.5) * r * 0.12;
    const k = (t * 0.9 + i * 0.61 + n() * 0.3) % 1;
    const y = top + k * span;
    const fade = Math.min(1, k * 6, (1 - k) * 4);
    g.save();
    g.globalAlpha *= 0.35 + 0.65 * fade;
    if (material === "gold") {
      // coins, turning as they fall
      const s = Math.max(1.4, r * 0.1), turn = Math.abs(Math.cos(t * 4 + i * 1.7));
      const m = g.createLinearGradient(x - s, y - s, x + s, y + s);
      m.addColorStop(0, "#fff3b8"); m.addColorStop(0.5, "#f0b93a"); m.addColorStop(1, "#8a5806");
      g.fillStyle = m;
      g.beginPath();
      g.ellipse(x, y, s * (0.25 + 0.75 * turn), s, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#7a4e05";
      g.lineWidth = Math.max(0.5, s * 0.16);
      g.stroke();
      if (r > 14) {
        g.strokeStyle = "rgba(255,246,200,0.8)";
        g.lineWidth = Math.max(0.5, s * 0.1);
        g.beginPath();
        g.ellipse(x, y, s * (0.25 + 0.75 * turn) * 0.62, s * 0.62, 0, Math.PI * 0.9, Math.PI * 1.6);
        g.stroke();
      }
    } else if (material === "starlight") {
      const s = Math.max(1.6, r * (0.1 + 0.04 * Math.sin(t * 5 + i)));
      g.fillStyle = "#e9dfff";
      star(g, x, y, s);
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(x, y, s * 0.22, 0, Math.PI * 2); g.fill();
    } else {
      const w = Math.max(1, r * 0.065), h = w * 2.9;
      const glass = material === "glass";
      const m = g.createLinearGradient(x - w, y - h, x + w, y + w);
      m.addColorStop(0, glass ? "rgba(235,253,255,0.95)" : "#e6eef6");
      m.addColorStop(1, glass ? "rgba(60,190,230,0.85)" : "#5a7187");
      g.fillStyle = m;
      drop(g, x, y, w, h);
      g.fill();
      if (r > 14) {
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.beginPath();
        g.ellipse(x - w * 0.35, y - w * 0.2, w * 0.22, w * 0.42, -0.3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

// a billowy rain cloud: the seed sets its puffs and how many drops fall
export function cloud(g, r, t, look, material, seed) {
  const n = stream(seed);
  const tone = TONE[material] ?? TONE.tin;
  // a slow breath so the cloud drifts a little
  const drift = Math.sin(t * 0.8 + seed) * r * 0.02;
  const shape = layout(r, n);

  g.save();
  rain(g, r, t, material, n, shape.baseY);

  g.translate(drift, 0);
  // the glow, cast once from the whole silhouette
  g.save();
  glowing(g, look, r);
  g.fillStyle = tone.lo;
  outline(g, shape);
  g.fill();
  g.shadowBlur = 0;
  // the edge, stroked before the puffs so only its outer half shows
  g.strokeStyle = look.edge;
  g.globalAlpha *= material === "glass" ? 0.9 : 0.7;
  g.lineWidth = Math.max(1.2, r * 0.06);
  g.stroke();
  g.restore();

  g.save();
  outline(g, shape);
  g.clip();
  // the flat underside first; the puffs billow over it
  const { slab } = shape;
  const u = g.createLinearGradient(0, slab.y, 0, slab.y + slab.h);
  u.addColorStop(0, tone.mid);
  u.addColorStop(1, tone.lo);
  g.fillStyle = u;
  g.fillRect(slab.x, slab.y - r * 0.3, slab.w, slab.h + r * 0.3);
  for (const [x, y, c] of shape.back) puff(g, x, y, c, tone, false);
  for (const [x, y, c] of shape.front) puff(g, x, y, c, tone, true);
  // a cool bounce of light along the base
  g.strokeStyle = material === "starlight" ? "rgba(180,140,255,0.5)" : "rgba(255,255,255,0.22)";
  g.lineWidth = Math.max(0.8, r * 0.04);
  g.beginPath();
  g.moveTo(slab.x + slab.h * 0.6, shape.baseY - r * 0.04);
  g.lineTo(slab.x + slab.w - slab.h * 0.6, shape.baseY - r * 0.04);
  g.stroke();
  material === "tin" ? tinWork(g, r, shape) : material === "gold" ? sheen(g, r, t) : null;
  if (material === "starlight") night(g, r, t, seed);
  if (material === "glass") {
    // a long refraction streak across the top
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = Math.max(1, r * 0.05);
    g.lineCap = "round";
    g.beginPath();
    g.arc(r * 0.05, r * 0.3, r * 0.78, Math.PI * 1.22, Math.PI * 1.42);
    g.stroke();
  }
  g.restore();

  g.restore();
}

// tin: brushed grain, a seam along the base, and rivets on it
function tinWork(g, r, { slab, baseY }) {
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = Math.max(0.5, r * 0.012);
  for (let i = 0; i < 9; i++) {
    const y = -r * 0.8 + i * r * 0.11;
    g.beginPath(); g.moveTo(-r, y); g.lineTo(r, y + r * 0.03); g.stroke();
  }
  // a riveted band along the base
  const y = baseY - r * 0.1;
  g.strokeStyle = "rgba(40,46,54,0.45)";
  g.lineWidth = Math.max(0.6, r * 0.018);
  g.beginPath(); g.moveTo(slab.x + slab.h * 0.35, y - r * 0.05); g.lineTo(slab.x + slab.w - slab.h * 0.35, y - r * 0.05); g.stroke();
  if (r < 12) return;
  const rv = r * 0.022;
  for (let i = 0; i < 9; i++) {
    const x = slab.x + slab.w * (0.1 + i * 0.1);
    g.fillStyle = "#535c66";
    g.beginPath(); g.arc(x, y, rv, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.arc(x - rv * 0.3, y - rv * 0.3, rv * 0.45, 0, Math.PI * 2); g.fill();
  }
}

// gold: a band of light sweeping slowly across
function sheen(g, r, t) {
  const p = ((t * 0.22 + 0.45) % 1.4) - 0.2;
  const m = g.createLinearGradient(-r, -r, r, r * 0.6);
  const at = (v) => Math.max(0, Math.min(1, v));
  m.addColorStop(at(p - 0.14), "rgba(255,250,220,0)");
  m.addColorStop(at(p), "rgba(255,250,220,0.6)");
  m.addColorStop(at(p + 0.14), "rgba(255,250,220,0)");
  g.fillStyle = m;
  g.fillRect(-r, -r, r * 2, r * 1.3);
}

// starlight: a few more stars deep inside, and one bright one that breathes
function night(g, r, t, seed) {
  const n = stream(seed + 31);
  for (let i = 0; i < 10; i++) {
    const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.6 + i * 2.1 + seed));
    g.fillStyle = `rgba(230,220,255,${a})`;
    g.beginPath();
    g.arc((n() - 0.5) * r * 1.4, -r * 0.7 + n() * r * 0.8, Math.max(0.5, r * 0.018), 0, Math.PI * 2);
    g.fill();
  }
  if (r < 9) return;
  g.fillStyle = "#fff";
  for (let i = 0; i < 3; i++) {
    const s = r * (0.05 + n() * 0.05) * (0.75 + 0.25 * Math.sin(t * 2.2 + i * 2 + seed));
    star(g, (n() - 0.5) * r * 1.1, -r * 0.6 + n() * r * 0.55, s);
  }
}
