import { fill, finish, glowing, stream, surface } from "./artifact-paint.js";

// a small door, ajar: the night behind it is the same seed every time
export function door(g, r, t, look, material, seed) {
  const n = stream(seed);
  const w = r, h = r * 1.5;
  glowing(g, look, r);
  g.fillStyle = "#12123a";
  g.fillRect(-w / 2, -h / 2, w, h);
  g.shadowBlur = 0;
  g.fillStyle = "#ffe7a6";
  const stars = 3 + Math.floor(n() * 5);
  for (let i = 0; i < stars; i++) {
    g.beginPath();
    g.arc((n() - 0.5) * w * 0.85, (n() - 0.5) * h * 0.85, Math.max(0.8, r * (0.03 + n() * 0.05)), 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = look.edge;
  g.lineWidth = Math.max(1.5, r * 0.12);
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(-w / 2 - w * 0.45, -h / 2 + h * 0.1);
  g.lineTo(-w / 2 - w * 0.45, h / 2 - h * 0.1);
  g.lineTo(-w / 2, h / 2);
  g.closePath();
  g.fill();
  finish(g, look);
  g.save();
  g.translate(-w * 0.72, 0);
  g.scale(0.5, 1);
  surface(g, r, t, look, material, seed);
  g.restore();
}
