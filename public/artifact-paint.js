// What every artifact is painted with (ADR 30): each material's look, and
// the helpers the kinds share. Kinds live in artifact-<kind>.js.
export const LOOK = {
  tin: { body: "#a3acb6", edge: "#5d6670", dark: "#2a2f36", light: "#d5dbe1", glow: "", alpha: 1 },
  glass: { body: "#8fe9ff", edge: "#eafcff", dark: "#0b4a63", light: "#ffffff", glow: "#8ff6ff", alpha: 0.6 },
  gold: { body: "#f0b93a", edge: "#fff0b3", dark: "#5a3a00", light: "#fff7d1", glow: "#ffd766", alpha: 1 },
  starlight: { body: "#2a1d6e", edge: "#d6c6ff", dark: "#ffffff", light: "#ffffff", glow: "#b48cff", alpha: 1 },
};
export /** A small repeatable stream of numbers from a seed. */
const stream = (seed) => {
  let s = (seed % 2147483647) + 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
};

export function fill(g, look, r, material, t) {
  g.globalAlpha *= look.alpha;
  if (material === "gold") {
    const sheen = ((t * 0.5) % 1) * 3 - 1.5;
    const m = g.createLinearGradient(-r, -r, r, r);
    m.addColorStop(0, look.dark === "#5a3a00" ? "#a9740f" : look.body);
    m.addColorStop(Math.max(0, Math.min(1, 0.5 + sheen * 0.33)), look.light);
    m.addColorStop(1, "#c48a16");
    return m;
  }
  return look.body;
}
export const finish = (g, look) => {
  g.globalAlpha /= look.alpha;
  g.strokeStyle = look.edge;
  g.lineWidth = 1.2;
  g.stroke();
};
// what each material adds over a shape already drawn
export function surface(g, r, t, look, material, seed) {
  const n = stream(seed + 7);
  if (material === "tin") {
    g.fillStyle = look.edge;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc((n() - 0.5) * r * 1, (n() - 0.5) * r * 0.5, Math.max(1, r * 0.05), 0, Math.PI * 2);
      g.fill();
    }
  } else if (material === "glass") {
    g.strokeStyle = "#ffffffcc";
    g.lineWidth = Math.max(1.2, r * 0.08);
    g.lineCap = "round";
    g.beginPath();
    g.arc(-r * 0.05, -r * 0.05, r * 0.42, Math.PI * 1.1, Math.PI * 1.55);
    g.stroke();
  } else if (material === "gold") {
    g.fillStyle = "#fffbe6";
    const s = (Math.sin(t * 3 + seed) + 1) / 2;
    for (const [dx, dy] of [[n() - 0.5, n() - 0.5]]) star(g, dx * r, dy * r * 0.6, r * (0.12 + 0.14 * s));
  } else if (material === "starlight") {
    for (let i = 0; i < 7; i++) {
      const a = 0.45 + 0.55 * Math.abs(Math.sin(t * 2 + i + seed));
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc((n() - 0.5) * r * 1.1, (n() - 0.5) * r * 0.6, Math.max(0.8, r * (0.03 + n() * 0.04)), 0, Math.PI * 2);
      g.fill();
    }
  }
}
export function star(g, x, y, s) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, d = i % 2 ? s * 0.25 : s;
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.closePath();
  g.fill();
}
export const glowing = (g, look, r) => {
  g.shadowColor = look.glow || "transparent";
  g.shadowBlur = look.glow ? r * 0.8 : 0;
};
