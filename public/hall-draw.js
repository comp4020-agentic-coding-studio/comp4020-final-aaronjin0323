// The three kinds of artifact, drawn on a 2D canvas (ADR 25): simple, but
// told apart by shape and colour as well as by name. One function draws
// them on the hall's floor, behind robots and in the panel's icons.

/**
 * Draws `kind` centred at x, y, about r pixels round. `t` (seconds) lets
 * the fish fly and the rain fall; pass 0 for a still picture.
 */
export function drawKind(g, kind, x, y, r, t = 0) {
  g.save();
  g.translate(x, y);
  if (kind === "fish") fish(g, r, t);
  else if (kind === "cloud") cloud(g, r, t);
  else if (kind === "door") door(g, r);
  g.restore();
}

// a luminous fish, flying: a glowing teal body, a tail, an eye; it bobs
function fish(g, r, t) {
  g.translate(0, Math.sin(t * 3) * r * 0.12);
  g.rotate(Math.sin(t * 3 + 1) * 0.12);
  g.shadowColor = "#8ff6ff";
  g.shadowBlur = r * 0.9;
  g.fillStyle = "#5fe0ec";
  g.beginPath();
  g.ellipse(r * 0.12, 0, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-r * 0.5, 0);
  g.lineTo(-r * 0.98, -r * 0.42);
  g.lineTo(-r * 0.98, r * 0.42);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "#1d2147";
  g.beginPath();
  g.arc(r * 0.5, -r * 0.1, r * 0.09, 0, Math.PI * 2);
  g.fill();
}

// a cloud full of rain: three grey-white puffs, blue drops falling under
function cloud(g, r, t) {
  g.strokeStyle = "#4f86c6";
  g.lineWidth = Math.max(1.5, r * 0.1);
  g.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * r * 0.45;
    const fall = ((t * 1.6 + i * 0.37) % 1) * r * 0.35;
    g.beginPath();
    g.moveTo(x, r * 0.2 + fall);
    g.lineTo(x - r * 0.08, r * 0.45 + fall);
    g.stroke();
  }
  g.fillStyle = "#e9eef5";
  g.strokeStyle = "#8a9bb0";
  g.lineWidth = Math.max(1, r * 0.06);
  for (const [cx, cy, cr] of [[-r * 0.45, 0, r * 0.38], [r * 0.45, 0, r * 0.38], [0, -r * 0.22, r * 0.5]]) {
    g.beginPath();
    g.arc(cx, cy - r * 0.15, cr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

// a small door, opened onto stars: a frame, the night inside, a leaf ajar
function door(g, r) {
  const w = r * 1.0, h = r * 1.5;
  g.fillStyle = "#1d2147";
  g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = "#ffe7a6";
  for (const [sx, sy, sr] of [[-0.18, -0.4, 0.07], [0.2, -0.1, 0.05], [-0.1, 0.25, 0.06], [0.15, 0.45, 0.04]]) {
    g.beginPath();
    g.arc(sx * w, sy * h * 0.9, sr * r * 1.4, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "#8a5a3c";
  g.lineWidth = Math.max(1.5, r * 0.12);
  g.strokeRect(-w / 2, -h / 2, w, h);
  // the leaf, swung open to the left
  g.fillStyle = "#b07a4f";
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(-w / 2 - w * 0.45, -h / 2 + h * 0.1);
  g.lineTo(-w / 2 - w * 0.45, h / 2 - h * 0.1);
  g.lineTo(-w / 2, h / 2);
  g.closePath();
  g.fill();
}

/** A small still picture of `kind`, as a canvas for the panel. */
export function kindIcon(kind, size = 36) {
  const c = document.createElement("canvas");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  c.className = "icon";
  c.setAttribute("aria-hidden", "true");
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  drawKind(g, kind, size / 2 + (kind === "door" ? size * 0.08 : 0), size / 2, size * 0.36, 0);
  return c;
}
