import { fill, finish, glowing, stream, surface } from "./artifact-paint.js";

// a flying fish, side on and facing right, lit from the top left: a
// streamlined body with a forked tail, two long wing-fins swept back, an eye
// with a catch-light, scales and markings the seed varies. It bobs, and its
// near wing flutters.

// each material's extra colours, beyond LOOK: a lit side, a shadow side, a
// darker back, a pale belly, the wing membrane and its rays, the eye
const TONE = {
  tin: { hi: "#f1f4f7", lo: "#4b535c", back: "#66707b", belly: "#e6eaee", wing: "#c9d0d7", wingLo: "#7d8792", rib: "#5d6670", scale: "255,255,255", shade: "30,35,42", mark: "#4f5964", iris: "#55616e", pupil: "#14181d" },
  glass: { hi: "#f4feff", lo: "#2b93b8", back: "#3fb7dc", belly: "#effdff", wing: "#d4f8ff", wingLo: "#59c6e4", rib: "#ffffff", scale: "255,255,255", shade: "8,70,100", mark: "#1f8fb8", iris: "#0e6a8c", pupil: "#05293a" },
  gold: { hi: "#fff7d1", lo: "#7a4f05", back: "#a86f0a", belly: "#ffeaa3", wing: "#f7d264", wingLo: "#b07a12", rib: "#8f5c06", scale: "255,246,200", shade: "90,52,0", mark: "#8c5a05", iris: "#7a4a00", pupil: "#241400" },
  starlight: { hi: "#6b56d6", lo: "#0d072c", back: "#170f4a", belly: "#4b3aa8", wing: "#3b2b92", wingLo: "#1a1050", rib: "#c9b8ff", scale: "214,198,255", shade: "5,2,25", mark: "#d6c6ff", iris: "#ffd98a", pupil: "#0b0620" },
};

export function fish(g, r, t, look, material, seed) {
  const tone = TONE[material] ?? TONE.tin;
  const n = stream(seed);
  const wing = 0.92 + n() * 0.16; // how long the wings reach
  const fork = 0.74 + n() * 0.1; // how deep the tail's notch cuts
  const marks = Math.floor(n() * 3); // spots, bands or a stripe
  const lean = (n() - 0.5) * 0.12; // the far wing's angle
  const line = Math.max(0.6, r * 0.028);
  g.save();
  g.translate(0, Math.sin(t * 3 + seed) * r * 0.1);
  g.rotate(Math.sin(t * 3 + 1 + seed) * 0.1);
  g.lineJoin = "round";
  g.lineCap = "round";

  // behind the body: the far wing, a little dorsal fin, the pelvic fin
  g.save();
  g.translate(r * 0.2, -r * 0.1);
  g.rotate(lean + 0.32 - Math.sin(t * 6 + seed) * 0.05);
  wingPath(g, r, wing * 0.85, 0);
  g.fillStyle = membrane(g, r, tone, tone.wingLo, tone.wingLo);
  g.globalAlpha *= material === "glass" ? 0.55 : 1;
  g.fill();
  g.globalAlpha /= material === "glass" ? 0.55 : 1;
  g.strokeStyle = look.edge;
  g.lineWidth = line;
  g.stroke();
  g.restore();
  g.fillStyle = tone.wingLo;
  g.beginPath();
  g.moveTo(-r * 0.22, -r * 0.24);
  g.quadraticCurveTo(-r * 0.34, -r * 0.42, -r * 0.5, -r * 0.4);
  g.quadraticCurveTo(-r * 0.46, -r * 0.24, -r * 0.48, -r * 0.12);
  g.closePath();
  g.moveTo(-r * 0.06, r * 0.26);
  g.quadraticCurveTo(-r * 0.2, r * 0.4, -r * 0.38, r * 0.4);
  g.quadraticCurveTo(-r * 0.3, r * 0.28, -r * 0.32, r * 0.18);
  g.closePath();
  g.fill();
  g.strokeStyle = look.edge;
  g.lineWidth = line;
  g.stroke();

  // the body and tail, one outline
  glowing(g, look, r);
  const body = fill(g, look, r, material, t);
  if (material === "gold") {
    // deeper than the shared gold, with its sheen as a band that sweeps by
    const m = g.createLinearGradient(-r * 0.3, -r * 0.45, r * 0.25, r * 0.4);
    m.addColorStop(0, "#ffe48f");
    m.addColorStop(0.45, "#eaa824");
    m.addColorStop(1, "#8a5806");
    g.fillStyle = body && m;
  } else {
    const m = g.createLinearGradient(-r * 0.3, -r * 0.45, r * 0.25, r * 0.4);
    m.addColorStop(0, tone.hi);
    m.addColorStop(0.45, look.body);
    m.addColorStop(1, tone.lo);
    g.fillStyle = m;
  }
  bodyPath(g, r, fork);
  g.fill();
  g.shadowBlur = 0;
  finish(g, look);

  // everything on the skin stays on the skin
  g.save();
  bodyPath(g, r, fork);
  g.clip();
  // a darker back and a pale belly, so it reads as round
  const back = g.createLinearGradient(0, -r * 0.34, 0, r * 0.3);
  back.addColorStop(0, tone.back);
  back.addColorStop(0.32, `${tone.back}00`);
  back.addColorStop(0.62, `${tone.belly}00`);
  back.addColorStop(1, tone.belly);
  g.fillStyle = back;
  g.globalAlpha = material === "glass" ? 0.5 : 0.85;
  g.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
  g.globalAlpha = 1;
  // the shadow side, bottom right
  const shade = g.createRadialGradient(-r * 0.15, -r * 0.3, r * 0.2, r * 0.1, r * 0.1, r * 1.05);
  shade.addColorStop(0, `rgba(${tone.shade},0)`);
  shade.addColorStop(1, `rgba(${tone.shade},0.55)`);
  g.fillStyle = shade;
  g.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
  if (material === "gold") {
    const p = ((t * 0.5) % 1) * 3 - 1;
    const sh = g.createLinearGradient(r * (p - 0.5), -r * 0.5, r * (p + 0.1), r * 0.5);
    sh.addColorStop(0, "rgba(255,250,220,0)");
    sh.addColorStop(0.5, "rgba(255,250,220,0.55)");
    sh.addColorStop(1, "rgba(255,250,220,0)");
    g.fillStyle = sh;
    g.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
  } else if (material === "tin" && r >= 13) {
    // brushed: fine streaks along the length
    g.strokeStyle = "rgba(255,255,255,0.16)";
    g.lineWidth = Math.max(0.5, r * 0.008);
    g.beginPath();
    const b = stream(seed + 3);
    for (let y = -r * 0.3; y < r * 0.3; y += r * 0.035) {
      const x = (b() - 0.5) * r * 0.6;
      g.moveTo(x - r * (0.3 + b() * 0.4), y);
      g.lineTo(x + r * (0.3 + b() * 0.4), y + r * 0.01);
    }
    g.stroke();
  } else if (material === "starlight") {
    // a faint nebula through the body
    const nb = g.createRadialGradient(-r * 0.05, r * 0.02, 0, -r * 0.05, r * 0.02, r * 0.5);
    nb.addColorStop(0, "rgba(255,140,220,0.28)");
    nb.addColorStop(1, "rgba(255,140,220,0)");
    g.fillStyle = nb;
    g.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
  }
  markings(g, r, tone, marks, n);
  if (r >= 13) scales(g, r, t, tone, material, seed);
  // the gill's curve and the lateral line
  g.strokeStyle = `rgba(${tone.shade},0.5)`;
  g.lineWidth = line * 1.1;
  g.beginPath();
  g.moveTo(r * 0.44, -r * 0.2);
  g.quadraticCurveTo(r * 0.34, r * 0.02, r * 0.44, r * 0.2);
  g.stroke();
  if (r >= 13) {
    g.strokeStyle = `rgba(${tone.scale},0.45)`;
    g.lineWidth = line * 0.8;
    g.beginPath();
    g.moveTo(r * 0.36, -r * 0.02);
    g.quadraticCurveTo(-r * 0.1, r * 0.04, -r * 0.62, 0);
    g.stroke();
  }
  surface(g, r, t, look, material, seed);
  if (material === "starlight") sparkles(g, r, t, seed);
  // a rim of light along the top edge
  g.strokeStyle = `rgba(${tone.scale},0.75)`;
  g.lineWidth = Math.max(0.8, r * 0.05);
  g.beginPath();
  g.moveTo(r * 0.68, -r * 0.16);
  g.bezierCurveTo(r * 0.5, -r * 0.29, r * 0.15, -r * 0.31, -r * 0.18, -r * 0.23);
  g.stroke();
  g.restore();

  eye(g, r, tone, look);
  // the mouth
  g.strokeStyle = `rgba(${tone.shade},0.7)`;
  g.lineWidth = line;
  g.beginPath();
  g.moveTo(r * 0.79, r * 0.04);
  g.quadraticCurveTo(r * 0.72, r * 0.08, r * 0.66, r * 0.06);
  g.stroke();

  // the near wing, over the body, fluttering on its root
  g.save();
  g.translate(r * 0.3, r * 0.02);
  g.rotate(0.24 + Math.sin(t * 6 + seed) * 0.09);
  wingPath(g, r, wing, 0);
  g.fillStyle = membrane(g, r, tone, tone.wing, tone.wingLo);
  const see = material === "glass" ? 0.6 : material === "starlight" ? 0.95 : 0.92;
  g.globalAlpha *= see;
  g.fill();
  g.globalAlpha /= see;
  g.strokeStyle = look.edge;
  g.lineWidth = line * 1.2;
  g.stroke();
  if (r >= 9) wingDetail(g, r, t, wing, tone, material, seed, line);
  g.restore();
  g.restore();
}

// nose at the right, tail fork at the left, belly below; one closed outline
function bodyPath(g, r, fork) {
  g.beginPath();
  g.moveTo(r * 0.8, r * 0.02);
  g.bezierCurveTo(r * 0.72, -r * 0.24, r * 0.3, -r * 0.33, -r * 0.08, -r * 0.27);
  g.bezierCurveTo(-r * 0.32, -r * 0.22, -r * 0.48, -r * 0.12, -r * 0.6, -r * 0.07);
  g.quadraticCurveTo(-r * 0.78, -r * 0.22, -r * 0.99, -r * 0.47);
  g.quadraticCurveTo(-r * 0.86, -r * 0.18, -r * fork, r * 0.02);
  g.quadraticCurveTo(-r * 0.86, r * 0.24, -r * 1.0, r * 0.54);
  g.quadraticCurveTo(-r * 0.76, r * 0.24, -r * 0.6, r * 0.08);
  g.bezierCurveTo(-r * 0.42, r * 0.16, -r * 0.05, r * 0.3, r * 0.26, r * 0.26);
  g.bezierCurveTo(r * 0.56, r * 0.23, r * 0.75, r * 0.15, r * 0.8, r * 0.02);
  g.closePath();
}

// a long wing swept up and back from its root at 0,0, its trailing edge
// scalloped between the rays
function wingPath(g, r, k, lift) {
  const tip = [-r * 0.98 * k, -r * (0.5 + lift) * k];
  g.beginPath();
  g.moveTo(r * 0.04, -r * 0.02);
  g.bezierCurveTo(-r * 0.12, -r * 0.34 * k, tip[0] * 0.55, tip[1] * 1.02, tip[0], tip[1]);
  // back along the trailing edge, four scallops
  const end = [-r * 0.36, r * 0.02];
  for (let i = 1; i <= 4; i++) {
    const a = i / 4, b = (i - 0.5) / 4;
    const x = tip[0] + (end[0] - tip[0]) * a, y = tip[1] + (end[1] - tip[1]) * a;
    const cx = tip[0] + (end[0] - tip[0]) * b + r * 0.05, cy = tip[1] + (end[1] - tip[1]) * b + r * 0.02;
    g.quadraticCurveTo(cx, cy, x, y);
  }
  g.quadraticCurveTo(-r * 0.12, r * 0.04, r * 0.04, -r * 0.02);
  g.closePath();
}

function membrane(g, r, tone, from, to) {
  const m = g.createLinearGradient(0, 0, -r * 0.6, -r * 0.7);
  m.addColorStop(0, to);
  m.addColorStop(0.35, from);
  m.addColorStop(1, tone.hi);
  return m;
}

function wingDetail(g, r, t, k, tone, material, seed, line) {
  // rays from the root out to each scallop
  const tip = [-r * 0.98 * k, -r * 0.5 * k], end = [-r * 0.36, r * 0.02];
  g.strokeStyle = tone.rib;
  g.globalAlpha *= 0.7;
  g.lineWidth = line * 0.9;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = i / 4;
    const x = tip[0] + (end[0] - tip[0]) * a, y = tip[1] + (end[1] - tip[1]) * a;
    g.moveTo(r * 0.02, -r * 0.01);
    g.quadraticCurveTo(x * 0.4, y * 0.6, x * 0.97, y * 0.97);
  }
  g.stroke();
  g.globalAlpha /= 0.7;
  // a sheen along the leading edge
  g.strokeStyle = `rgba(${tone.scale},0.8)`;
  g.lineWidth = Math.max(0.8, r * 0.035);
  g.beginPath();
  g.moveTo(-r * 0.02, -r * 0.1);
  g.bezierCurveTo(-r * 0.1, -r * 0.36 * k, tip[0] * 0.5, tip[1] * 0.92, tip[0] * 0.8, tip[1] * 0.9);
  g.stroke();
  if (material === "starlight") {
    // the wing is a scrap of night sky
    const s = stream(seed + 31);
    for (let i = 0; i < 6; i++) {
      const a = s(), b = s() * 0.7;
      const x = tip[0] * (0.3 + a * 0.6) + end[0] * b * 0.3, y = tip[1] * (0.25 + a * 0.55) * (1 - b * 0.4);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + i * 1.7 + seed));
      g.fillStyle = `rgba(255,255,255,${tw})`;
      g.beginPath();
      g.arc(x, y, Math.max(0.6, r * (0.018 + s() * 0.022)), 0, Math.PI * 2);
      g.fill();
    }
  } else if (material === "gold") {
    // a glint that travels out along the wing
    const p = (t * 0.5) % 1;
    g.fillStyle = `rgba(255,251,230,${0.9 * Math.sin(p * Math.PI)})`;
    g.beginPath();
    g.arc(tip[0] * (0.2 + p * 0.6), tip[1] * (0.2 + p * 0.6) + r * 0.04, Math.max(0.8, r * 0.04), 0, Math.PI * 2);
    g.fill();
  }
}

function markings(g, r, tone, marks, n) {
  g.fillStyle = tone.mark;
  g.globalAlpha = 0.55;
  g.beginPath();
  if (marks === 0) {
    // a row of spots along the back
    for (let i = 0; i < 5; i++) {
      const x = r * (0.3 - i * 0.18), y = -r * (0.17 - i * 0.015) + (n() - 0.5) * r * 0.04;
      const s = r * (0.045 + n() * 0.03);
      g.moveTo(x + s, y);
      g.arc(x, y, s, 0, Math.PI * 2);
    }
  } else if (marks === 1) {
    // soft bands across the back
    for (let i = 0; i < 3; i++) {
      const x = r * (0.18 - i * 0.24);
      g.moveTo(x + r * 0.05, -r * 0.4);
      g.quadraticCurveTo(x + r * 0.09, -r * 0.1, x - r * 0.01, r * 0.04);
      g.lineTo(x - r * 0.07, r * 0.04);
      g.quadraticCurveTo(x + r * 0.01, -r * 0.1, x - r * 0.03, -r * 0.4);
      g.closePath();
    }
  } else {
    // one bright stripe nose to tail
    g.moveTo(r * 0.5, -r * 0.1);
    g.quadraticCurveTo(0, -r * 0.16, -r * 0.62, -r * 0.03);
    g.quadraticCurveTo(0, -r * 0.06, r * 0.5, -r * 0.05);
    g.closePath();
    g.fillStyle = `rgba(${tone.scale},0.9)`;
  }
  g.fill();
  g.globalAlpha = 1;
}

// staggered rows of scale edges, opening towards the tail; in gold a few
// catch the light in turn
function scales(g, r, t, tone, material, seed) {
  const s = r * 0.1;
  const lw = Math.max(0.5, r * 0.014);
  g.lineWidth = lw;
  g.strokeStyle = `rgba(${tone.shade},0.28)`;
  g.beginPath();
  const at = [];
  for (let row = 0; row < 5; row++) {
    const y = -r * 0.22 + row * s * 0.95;
    for (let col = 0; col < 9; col++) {
      const x = r * 0.34 - col * s * 1.05 - (row % 2) * s * 0.5;
      if (x < -r * 0.58) continue;
      g.moveTo(x, y - s * 0.6);
      g.arc(x - s * 0.15, y, s * 0.62, -Math.PI / 2.4, Math.PI / 2.4);
      at.push([x, y]);
    }
  }
  g.stroke();
  // the light catches the upper rim of each scale
  g.strokeStyle = `rgba(${tone.scale},0.3)`;
  g.beginPath();
  for (const [x, y] of at) {
    g.moveTo(x - s * 0.15 + s * 0.62 * Math.cos(-Math.PI / 2.4), y + s * 0.62 * Math.sin(-Math.PI / 2.4));
    g.arc(x - s * 0.15, y, s * 0.62, -Math.PI / 2.4, -Math.PI / 12);
  }
  g.stroke();
  if (material === "gold" || material === "glass") {
    for (let i = 0; i < at.length; i += 3) {
      const a = Math.sin(t * 2.5 - at[i][0] / r * 4 + seed);
      if (a < 0.6 && t !== 0) continue;
      const k = t === 0 ? 0.35 : (a - 0.6) / 0.4;
      g.fillStyle = `rgba(255,252,235,${0.6 * k})`;
      g.beginPath();
      g.arc(at[i][0] + s * 0.2, at[i][1] - s * 0.15, s * 0.22, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function eye(g, r, tone, look) {
  const x = r * 0.56, y = -r * 0.06, e = Math.max(1.4, r * 0.095);
  g.fillStyle = tone.belly;
  g.beginPath();
  g.arc(x, y, e * 1.2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = look.edge;
  g.lineWidth = Math.max(0.5, r * 0.015);
  g.stroke();
  g.fillStyle = tone.iris;
  g.beginPath();
  g.arc(x, y, e, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = tone.pupil;
  g.beginPath();
  g.arc(x + e * 0.12, y + e * 0.05, e * 0.66, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(x - e * 0.25, y - e * 0.3, Math.max(0.5, e * 0.3), 0, Math.PI * 2);
  g.fill();
}

// four-pointed stars that swell and fade in turn
function sparkles(g, r, t, seed) {
  const s = stream(seed + 53);
  for (let i = 0; i < 4; i++) {
    const x = r * (0.35 - s() * 0.9), y = r * (s() - 0.5) * 0.36;
    const k = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 2.1 + seed);
    const d = Math.max(1, r * (0.05 + 0.05 * k));
    g.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * k})`;
    g.beginPath();
    g.moveTo(x, y - d);
    g.quadraticCurveTo(x, y, x + d * 0.7, y);
    g.quadraticCurveTo(x, y, x, y + d);
    g.quadraticCurveTo(x, y, x - d * 0.7, y);
    g.quadraticCurveTo(x, y, x, y - d);
    g.fill();
  }
}
