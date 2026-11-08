import { fill, finish, glowing, stream, surface } from "./artifact-paint.js";

// a cloud full of rain: the seed sets its puffs and how many drops fall
export function cloud(g, r, t, look, material, seed) {
  const n = stream(seed);
  const drops = 2 + Math.floor(n() * 3);
  g.strokeStyle = material === "tin" ? look.edge : look.glow;
  g.lineWidth = Math.max(1.5, r * 0.1);
  g.lineCap = "round";
  for (let i = 0; i < drops; i++) {
    const x = (i - (drops - 1) / 2) * r * 0.4;
    const fall = ((t * 1.6 + i * 0.37) % 1) * r * 0.35;
    g.beginPath();
    g.moveTo(x, r * 0.2 + fall);
    g.lineTo(x - r * 0.08, r * 0.45 + fall);
    g.stroke();
  }
  glowing(g, look, r);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  const puffs = [[-r * 0.45, -r * 0.1, r * (0.3 + n() * 0.12)], [r * 0.45, -r * 0.1, r * (0.3 + n() * 0.12)], [0, -r * 0.34, r * (0.42 + n() * 0.14)]];
  for (const [cx, cy, cr] of puffs) {
    g.moveTo(cx + cr, cy);
    g.arc(cx, cy, cr, 0, Math.PI * 2);
  }
  g.fill();
  finish(g, look);
  g.shadowBlur = 0;
  surface(g, r, t, look, material, seed);
}
