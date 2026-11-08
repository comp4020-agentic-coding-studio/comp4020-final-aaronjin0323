// The vault at the centre: a lit brass inlay in the gallery floor (ADR 38),
// where cargo is kept for good.
// Gold is "kept" everywhere (CLAUDE.md), amber and dashed is "at risk", so the
// pool is solid soft gold with no dashes. `r` is its radius in pixels
// (VAULT_R, the rule's own size): the pool's edge sits at r, only its glow
// spills past. `lit` while your robot carries something: brighter, breathing
// more. With `reduced` nothing moves or pulses.

const TAU = Math.PI * 2;
const HALO = 2.1; // the floor halo reaches this many radii
const cache = new Map();

const dprNow = () => Math.min(Math.max((typeof devicePixelRatio === "number" && devicePixelRatio) || 1, 1), 3);

function canvas(size) {
  const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  return c;
}

function labelSize(r) {
  return Math.max(11, Math.min(15, r * 0.3));
}

// The static layers of one pool size: the floor halo, the brass inlay
// and rim, and the label. Each is a square canvas centred on the pool.
function layers(r) {
  const dpr = dprNow();
  const key = `${Math.round(r * 4)}:${dpr}`;
  let hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 8) cache.clear();
  const half = Math.ceil(r * HALO + 2);
  const size = Math.max(1, Math.ceil(half * 2 * dpr));
  const make = (paint) => {
    const c = canvas(size);
    const q = c.getContext("2d");
    q.scale(dpr, dpr);
    q.translate(half, half);
    paint(q);
    return c;
  };

  // a soft halo of gold light on the floor around the pool
  const halo = make((q) => {
    const h = q.createRadialGradient(0, 0, r * 0.7, 0, 0, r * HALO);
    h.addColorStop(0, "rgba(243, 223, 162, 0.34)");
    h.addColorStop(0.3, "rgba(232, 201, 122, 0.17)");
    h.addColorStop(0.62, "rgba(232, 201, 122, 0.06)");
    h.addColorStop(1, "rgba(232, 201, 122, 0)");
    q.fillStyle = h;
    q.beginPath();
    q.arc(0, 0, r * HALO, 0, TAU);
    q.fill();
  });

  const pool = make((q) => {
    // the brass: pale gold, lightest towards the lamp (top-left)
    const body = q.createRadialGradient(-r * 0.28, -r * 0.3, r * 0.05, 0, 0, r);
    body.addColorStop(0, "#f8ecc4");
    body.addColorStop(0.45, "#f3dfa2");
    body.addColorStop(0.85, "#ebcf88");
    body.addColorStop(1, "#e8c97a");
    q.fillStyle = body;
    q.beginPath();
    q.arc(0, 0, r, 0, TAU);
    q.fill();
    q.save();
    q.beginPath();
    q.arc(0, 0, r, 0, TAU);
    q.clip();
    // a faint depth: the far (lower-right) side of the pool a touch deeper
    const deep = q.createRadialGradient(r * 0.35, r * 0.4, 0, r * 0.35, r * 0.4, r * 1.1);
    deep.addColorStop(0, "rgba(196, 158, 92, 0.22)");
    deep.addColorStop(1, "rgba(196, 158, 92, 0)");
    q.fillStyle = deep;
    q.fillRect(-r, -r, r * 2, r * 2);
    // a brass inlay: two engraved rings and a quiet eight-point star,
    // a lamp's light catching it from above-left
    q.lineCap = "round";
    for (const [k, alpha] of [[0.82, 0.42], [0.66, 0.3]]) {
      q.beginPath();
      q.arc(0, 0, r * k, 0, TAU);
      q.strokeStyle = `rgba(150, 112, 52, ${alpha})`;
      q.lineWidth = Math.max(1, r * 0.03);
      q.stroke();
      q.beginPath();
      q.arc(-0.6, -0.6, r * k, Math.PI * 0.9, Math.PI * 1.6);
      q.strokeStyle = "rgba(255, 246, 220, 0.45)";
      q.lineWidth = Math.max(0.8, r * 0.018);
      q.stroke();
    }
    q.beginPath();
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.13 : i % 4 ? r * 0.36 : r * 0.52;
      const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr - r * 0.12;
      i ? q.lineTo(px, py) : q.moveTo(px, py);
    }
    q.closePath();
    q.fillStyle = "rgba(200, 160, 90, 0.35)";
    q.fill();
    q.strokeStyle = "rgba(150, 112, 52, 0.45)";
    q.lineWidth = Math.max(0.8, r * 0.02);
    q.stroke();
    const shine = q.createRadialGradient(-r * 0.35, -r * 0.4, 0, -r * 0.35, -r * 0.4, r * 0.7);
    shine.addColorStop(0, "rgba(255, 250, 232, 0.5)");
    shine.addColorStop(1, "rgba(255, 250, 232, 0)");
    q.fillStyle = shine;
    q.fillRect(-r, -r, r * 2, r * 2);
    // the inner shade of the rim, so the edge reads as a soft lip
    const lip = q.createRadialGradient(0, 0, r * 0.78, 0, 0, r);
    lip.addColorStop(0, "rgba(201, 160, 88, 0)");
    lip.addColorStop(1, "rgba(201, 160, 88, 0.2)");
    q.fillStyle = lip;
    q.fillRect(-r, -r, r * 2, r * 2);
    q.restore();
    // a soft luminous rim exactly at r: a wide faint glow, a fine pale line
    q.beginPath();
    q.arc(0, 0, r, 0, TAU);
    q.strokeStyle = "rgba(243, 223, 162, 0.28)";
    q.lineWidth = Math.max(3, r * 0.16);
    q.stroke();
    q.strokeStyle = "rgba(250, 240, 212, 0.75)";
    q.lineWidth = Math.max(1.2, r * 0.045);
    q.stroke();
  });

  // the label: quiet spaced small caps in dark umber on the gold
  const fs = labelSize(r);
  const label = make((q) => {
    q.font = `600 ${fs}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
    if ("letterSpacing" in q) q.letterSpacing = `${(fs * 0.14).toFixed(1)}px`;
    q.textAlign = "center";
    q.textBaseline = "middle";
    const ly = r * 0.2;
    q.fillStyle = "rgba(255, 249, 230, 0.55)";
    q.fillText("VAULT", 0.5, ly + 0.8);
    q.fillStyle = "#3a2a14";
    q.fillText("VAULT", 0, ly);
  });

  hit = { halo, pool, label, half };
  cache.set(key, hit);
  return hit;
}

function blit(g, c, x, y, half) {
  g.drawImage(c, x - half, y - half, half * 2, half * 2);
}

export function drawVault(g, { x, y, r, lit, now, reduced }) {
  if (!(r >= 1)) return;
  const L = layers(r);
  const t = (now || 0) / 1000;
  // breathing: slow (6 s) and faint when calm, fuller (4 s) when lit
  const breath = reduced ? 0 : Math.sin(t * TAU / (lit ? 4 : 6));
  g.save();
  g.globalAlpha = lit ? 0.95 + breath * 0.05 : 0.6 + breath * 0.06;
  blit(g, L.halo, x, y, L.half);
  if (lit) {
    // a wider second halo that invites delivery, breathing with the first
    g.globalAlpha = 0.45 + breath * 0.2;
    blit(g, L.halo, x, y, L.half * 1.35);
  }
  g.restore();

  g.save();
  g.globalAlpha = lit ? 1 : 0.9;
  blit(g, L.pool, x, y, L.half);
  g.globalAlpha = 1;

  // ripples moving slowly outwards from the middle (8 s each); still when reduced
  g.beginPath();
  g.arc(x, y, r * 0.97, 0, TAU);
  g.clip();
  const n = 3;
  for (let i = 0; i < n; i++) {
    const p = reduced ? 0.25 + i * 0.28 : (t / 8 + i / n) % 1;
    const rr = r * (0.16 + p * 0.8);
    const a = Math.sin(Math.PI * p) * (lit ? 0.5 : 0.38);
    g.lineWidth = Math.max(1, r * 0.04);
    g.strokeStyle = `rgba(196, 156, 86, ${a * 0.55})`;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.stroke();
    g.strokeStyle = `rgba(255, 250, 236, ${a * 0.8})`;
    g.beginPath();
    g.arc(x, y, rr + Math.max(1, r * 0.04), 0, TAU);
    g.stroke();
  }
  if (lit) {
    // the pool itself glows a little brighter, breathing
    const glow = g.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(255, 250, 235, ${0.2 + breath * 0.08})`);
    glow.addColorStop(1, "rgba(255, 250, 235, 0)");
    g.fillStyle = glow;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();

  g.save();
  blit(g, L.label, x, y, L.half);
  g.restore();
}

// one soft mote of lamplight: a faint wide glow with a small bright core
function mote(g, x, y, s, a) {
  g.globalAlpha = a * 0.3;
  g.beginPath();
  g.arc(x, y, s * 2.6, 0, TAU);
  g.fill();
  g.globalAlpha = a * 0.9;
  g.beginPath();
  g.arc(x, y, s, 0, TAU);
  g.fill();
}

const MOTES = [
  [-0.55, 0.2, 1.0, 0.0], [0.4, 0.35, 1.25, 0.08], [-0.15, -0.1, 0.85, 0.15],
  [0.62, -0.18, 1.1, 0.04], [-0.38, -0.45, 0.95, 0.12], [0.12, 0.55, 1.3, 0.2],
  [0.25, -0.5, 0.8, 0.1],
];

/** A delivery, seen by everyone: a soft bloom of lamplight rises from the
 * pool, gentle ripples spread out, a few pale-gold motes drift up. `k` runs
 * 0 to 1 over 900 ms; everything has faded by k = 1. */
export function drawBurst(g, { x, y, r, k, reduced }) {
  if (!(r >= 1) || !(k < 1)) return;
  k = Math.max(0, k);
  g.save();
  if (reduced) {
    const a = 0.5 * (1 - k);
    const glow = g.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
    glow.addColorStop(0, `rgba(255, 246, 228, ${a})`);
    glow.addColorStop(0.5, `rgba(243, 223, 162, ${a * 0.45})`);
    glow.addColorStop(1, "rgba(243, 223, 162, 0)");
    g.fillStyle = glow;
    g.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
    g.restore();
    return;
  }
  const ease = 1 - (1 - k) ** 2; // fast start, settling out
  const fade = (1 - k) ** 1.4;
  const rise = Math.min(1, k * 5); // a gentle swell in over the first ~180 ms

  // the bloom: lamplight lifting softly off the brass
  const by = y - r * 0.35 * ease, br = r * (1.1 + 0.7 * ease);
  const bloom = g.createRadialGradient(x, by, 0, x, by, br);
  bloom.addColorStop(0, `rgba(255, 246, 228, ${0.55 * fade * rise})`);
  bloom.addColorStop(0.45, `rgba(243, 223, 162, ${0.28 * fade * rise})`);
  bloom.addColorStop(1, "rgba(243, 223, 162, 0)");
  g.fillStyle = bloom;
  g.fillRect(x - br, by - br, br * 2, br * 2);

  // two ripples spreading out over the floor from the pool's edge
  for (const lag of [0, 0.25]) {
    const f = Math.max(0, (k - lag) / (1 - lag));
    if (f <= 0) continue;
    const fe = 1 - (1 - f) ** 2;
    const a = (1 - f) * 0.55 * Math.min(1, f * 6);
    g.beginPath();
    g.arc(x, y, r * (1 + fe * 0.85), 0, TAU);
    g.strokeStyle = `rgba(243, 223, 162, ${a * 0.5})`;
    g.lineWidth = Math.max(3, r * 0.14) * (1 - fe * 0.5);
    g.stroke();
    g.strokeStyle = `rgba(250, 242, 220, ${a})`;
    g.lineWidth = Math.max(1, r * 0.04);
    g.stroke();
  }

  // a few motes drifting up out of the pool, swaying a little
  g.fillStyle = "#f6ecc8";
  const s = Math.max(1.1, r * 0.055);
  for (const [mx, my, sp, delay] of MOTES) {
    const f = Math.max(0, (k - delay) / (1 - delay));
    if (f <= 0) continue;
    const up = r * 1.3 * sp * (1 - (1 - f) ** 1.6);
    const sway = Math.sin(f * Math.PI * 1.5 + mx * 5) * r * 0.08;
    const a = Math.sin(Math.PI * Math.min(1, f * 1.15)) * (1 - k);
    mote(g, x + mx * r + sway, y + my * r - up, s * (0.8 + sp * 0.25), a);
  }
  g.restore();
}
