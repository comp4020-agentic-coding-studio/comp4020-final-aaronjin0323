import { fill, finish, glowing, stream, surface } from "./artifact-paint.js";

// a flying fish: it bobs; the seed sets its fin and its markings
export function fish(g, r, t, look, material, seed) {
  const n = stream(seed);
  const fin = 0.3 + n() * 0.3;
  g.translate(0, Math.sin(t * 3 + seed) * r * 0.12);
  g.rotate(Math.sin(t * 3 + 1 + seed) * 0.12);
  glowing(g, look, r);
  g.fillStyle = fill(g, look, r, material, t);
  g.beginPath();
  g.ellipse(r * 0.12, 0, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
  // all wound the same way, or their overlaps would cancel out to holes
  g.moveTo(-r * 0.5, 0);
  g.lineTo(-r * 0.98, r * 0.42);
  g.lineTo(-r * 0.98, -r * 0.42);
  g.closePath();
  g.moveTo(r * 0.15, -r * 0.34);
  g.lineTo(-r * 0.25, -r * 0.3);
  g.lineTo(-r * 0.2, -r * (0.42 + fin));
  g.closePath();
  g.fill();
  finish(g, look);
  g.shadowBlur = 0;
  surface(g, r, t, look, material, seed);
  g.fillStyle = look.dark;
  g.beginPath();
  g.arc(r * 0.5, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  g.fill();
}
