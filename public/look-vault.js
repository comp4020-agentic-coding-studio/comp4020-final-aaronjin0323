// The vault at the centre: where cargo is kept for good. Gold is "kept"
// everywhere (CLAUDE.md), amber and dashed is "at risk", so the vault is all
// solid gold: a round vault door seen from above, gold rim with rivets,
// engraved rings, a handle wheel with a dial, and a name plate. `r` is its
// radius in pixels (VAULT_R, the rule's own size): the rim's outer edge sits
// exactly at r. `lit` while your robot carries something: the floor glows
// warmer, the door seam shines and the wheel turns, as if unlocking. With
// `reduced` nothing moves or pulses. The static parts are painted once into
// offscreen canvases keyed by r and devicePixelRatio.

const TAU = Math.PI * 2;
const GOLD = "#ffc83d";
const GOLD_HI = "#ffd766";

let cache = null; // { key, base, wheel, plate, ... }

function layer(size, dpr) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(size * dpr));
  c.height = c.width;
  const cg = c.getContext("2d");
  cg.scale(dpr, dpr);
  cg.translate(size / 2, size / 2); // draw around the centre
  return { c, g: cg, size };
}

function rivet(cg, x, y, s) {
  cg.fillStyle = "rgba(40, 22, 0, 0.55)";
  cg.beginPath(); cg.arc(x + s * 0.35, y + s * 0.35, s, 0, TAU); cg.fill();
  const rg = cg.createRadialGradient(x - s * 0.4, y - s * 0.4, 0, x, y, s);
  rg.addColorStop(0, "#fff6d0");
  rg.addColorStop(0.45, GOLD_HI);
  rg.addColorStop(1, "#a8701a");
  cg.fillStyle = rg;
  cg.beginPath(); cg.arc(x, y, s, 0, TAU); cg.fill();
}

// an engraved ring: dark cut on the top-left side, light lip bottom-right
function engrave(cg, rad, w) {
  const o = Math.max(0.5, w * 0.6);
  cg.lineWidth = w;
  cg.strokeStyle = "rgba(255, 244, 200, 0.5)";
  cg.beginPath(); cg.arc(o, o, rad, 0, TAU); cg.stroke();
  cg.strokeStyle = "rgba(70, 40, 4, 0.7)";
  cg.beginPath(); cg.arc(0, 0, rad, 0, TAU); cg.stroke();
}

function build(r, dpr) {
  const small = r < 48;
  const half = r * 1.7;

  // 1. base: floor glow, shadow, rim, door face, engraved rings, rivets
  const base = layer(half * 2, dpr);
  const b = base.g;
  const glow = b.createRadialGradient(0, 0, r * 0.9, 0, 0, half);
  glow.addColorStop(0, "rgba(255, 200, 61, 0.22)");
  glow.addColorStop(0.45, "rgba(255, 182, 72, 0.08)");
  glow.addColorStop(1, "rgba(255, 182, 72, 0)");
  b.fillStyle = glow;
  b.fillRect(-half, -half, half * 2, half * 2);
  // drop shadow falling bottom-right
  const sh = r * 0.12;
  const shg = b.createRadialGradient(sh, sh, r * 0.85, sh, sh, r * 1.12);
  shg.addColorStop(0, "rgba(10, 6, 18, 0.6)");
  shg.addColorStop(1, "rgba(10, 6, 18, 0)");
  b.fillStyle = shg;
  b.beginPath(); b.arc(sh, sh, r * 1.12, 0, TAU); b.fill();
  // outer rim: polished gold lit from the top-left
  const rim = b.createLinearGradient(-r, -r, r, r);
  rim.addColorStop(0, "#fff1b8");
  rim.addColorStop(0.3, GOLD_HI);
  rim.addColorStop(0.6, GOLD);
  rim.addColorStop(1, "#9c6614");
  b.fillStyle = rim;
  b.beginPath(); b.arc(0, 0, r, 0, TAU); b.fill();
  // crisp outer line so the boundary reads exactly at r
  b.lineWidth = Math.max(1, r * 0.025);
  b.strokeStyle = "#7a4c0c";
  b.beginPath(); b.arc(0, 0, r - b.lineWidth / 2, 0, TAU); b.stroke();
  b.lineWidth = Math.max(0.75, r * 0.015);
  b.strokeStyle = "rgba(255, 248, 220, 0.85)";
  b.beginPath(); b.arc(0, 0, r * 0.955, Math.PI * 0.95, Math.PI * 1.75); b.stroke();
  // seam groove between rim and door
  const rd = r * 0.8;
  b.fillStyle = "#3b2508";
  b.beginPath(); b.arc(0, 0, rd + Math.max(1, r * 0.03), 0, TAU); b.fill();
  // door face: deeper bronze-gold, a soft dome
  const face = b.createRadialGradient(-rd * 0.35, -rd * 0.35, rd * 0.05, 0, 0, rd);
  face.addColorStop(0, "#ffe28f");
  face.addColorStop(0.45, "#e9a93a");
  face.addColorStop(1, "#8a5a14");
  b.fillStyle = face;
  b.beginPath(); b.arc(0, 0, rd, 0, TAU); b.fill();
  // engraved rings
  const ew = Math.max(0.8, r * 0.018);
  engrave(b, rd * 0.86, ew);
  if (!small) engrave(b, rd * 0.6, ew);
  // locking bolts between the rings (desktop only, too fine on a phone)
  if (!small) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      b.save();
      b.rotate(a);
      b.fillStyle = "rgba(60, 34, 4, 0.55)";
      b.fillRect(rd * 0.64 + 1, -r * 0.035 + 1, rd * 0.18, r * 0.07);
      const bg = b.createLinearGradient(0, -r * 0.035, 0, r * 0.035);
      bg.addColorStop(0, "#fff0b0");
      bg.addColorStop(1, "#b37a1c");
      b.fillStyle = bg;
      b.fillRect(rd * 0.64, -r * 0.035, rd * 0.18, r * 0.07);
      b.restore();
    }
  }
  // rivets round the rim
  const n = small ? 10 : 18;
  const rs = Math.max(1.1, r * 0.032);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    rivet(b, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, rs);
  }

  // 2. wheel: three-spoke handle and the dial; turned each frame when lit
  const wr = rd * (small ? 0.78 : 0.5);
  const wheel = layer(wr * 2.6, dpr);
  const w = wheel.g;
  const sw = Math.max(1.6, r * 0.06);
  w.lineCap = "round";
  for (const [dx, colour] of [[sw * 0.5, "rgba(50, 28, 2, 0.55)"], [0, null]]) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU - Math.PI / 2;
      const ex = Math.cos(a) * wr, ey = Math.sin(a) * wr;
      w.lineWidth = sw;
      w.strokeStyle = colour ?? "#c88a22";
      w.beginPath(); w.moveTo(dx, dx); w.lineTo(ex + dx, ey + dx); w.stroke();
      if (!colour) {
        w.lineWidth = sw * 0.35;
        w.strokeStyle = "rgba(255, 244, 200, 0.75)";
        w.beginPath(); w.moveTo(-sw * 0.15, -sw * 0.15); w.lineTo(ex - sw * 0.15, ey - sw * 0.15); w.stroke();
        rivet(w, ex, ey, sw * 0.95);
      }
    }
  }
  if (!small) {
    const dr = rd * 0.3;
    w.fillStyle = "rgba(50, 28, 2, 0.5)";
    w.beginPath(); w.arc(dr * 0.12, dr * 0.12, dr, 0, TAU); w.fill();
    const dg = w.createRadialGradient(-dr * 0.4, -dr * 0.4, 0, 0, 0, dr);
    dg.addColorStop(0, "#fff3c4");
    dg.addColorStop(0.5, GOLD_HI);
    dg.addColorStop(1, "#a06a16");
    w.fillStyle = dg;
    w.beginPath(); w.arc(0, 0, dr, 0, TAU); w.fill();
    w.strokeStyle = "#6e440a";
    w.lineWidth = Math.max(0.8, r * 0.012);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, t = i % 6 === 0 ? 0.62 : 0.78;
      w.beginPath();
      w.moveTo(Math.cos(a) * dr * t, Math.sin(a) * dr * t);
      w.lineTo(Math.cos(a) * dr * 0.92, Math.sin(a) * dr * 0.92);
      w.stroke();
    }
    w.fillStyle = "#3b2508"; // pointer
    w.beginPath(); w.moveTo(0, -dr * 0.55); w.lineTo(dr * 0.12, 0); w.lineTo(-dr * 0.12, 0); w.closePath(); w.fill();
    rivet(w, 0, 0, dr * 0.2);
  }

  // 3. plate: the word VAULT, dark enamel on gold, always level
  const fs = Math.round(Math.min(15, Math.max(11, r * 0.19)));
  const font = `800 ${fs}px system-ui, sans-serif`;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = font;
  const tw = meas.measureText("VAULT").width + fs * 0.25;
  const pw = tw + fs * 0.9, ph = fs * 1.5;
  const plate = layer(Math.max(pw, ph) * 1.25, dpr);
  const p = plate.g;
  const pr = ph * 0.3;
  p.fillStyle = "rgba(10, 6, 18, 0.5)";
  p.beginPath(); p.roundRect(-pw / 2 + ph * 0.1, -ph / 2 + ph * 0.12, pw, ph, pr); p.fill();
  const pg = p.createLinearGradient(0, -ph / 2, 0, ph / 2);
  pg.addColorStop(0, "#fff0b0");
  pg.addColorStop(1, "#b57b1c");
  p.fillStyle = pg;
  p.beginPath(); p.roundRect(-pw / 2, -ph / 2, pw, ph, pr); p.fill();
  const inset = Math.max(1.2, fs * 0.12);
  p.fillStyle = "#211f33";
  p.beginPath(); p.roundRect(-pw / 2 + inset, -ph / 2 + inset, pw - inset * 2, ph - inset * 2, pr * 0.7); p.fill();
  p.font = font;
  p.textAlign = "center";
  p.textBaseline = "middle";
  if ("letterSpacing" in p) p.letterSpacing = `${(fs * 0.06).toFixed(1)}px`;
  p.fillStyle = GOLD_HI;
  p.fillText("VAULT", fs * 0.03, fs * 0.06);

  const plateY = small ? 0 : rd * 0.62;
  return { base, wheel, plate, plateY, rd, half };
}

function blit(g, l, x, y) {
  g.drawImage(l.c, x - l.size / 2, y - l.size / 2, l.size, l.size);
}

export function drawVault(g, { x, y, r, lit, now, reduced }) {
  if (!(r > 0)) return;
  const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  const key = `${r.toFixed(2)}@${dpr}`;
  if (!cache || cache.key !== key) cache = { key, ...build(r, dpr) };
  const { base, wheel, plate, plateY, rd } = cache;
  const wave = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);

  g.save();
  if (lit) {
    // a stronger warm pool of light inviting delivery
    const R = r * (reduced ? 1.9 : 1.8 + wave * 0.15);
    const lg = g.createRadialGradient(x, y, r * 0.95, x, y, R);
    lg.addColorStop(0, `rgba(255, 215, 102, ${0.42 + wave * 0.18})`);
    lg.addColorStop(0.35, "rgba(255, 200, 61, 0.14)");
    lg.addColorStop(1, "rgba(255, 200, 61, 0)");
    g.fillStyle = lg;
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
  }
  blit(g, base, x, y);
  if (lit) {
    // the door seam shines, as if the door were easing open
    g.strokeStyle = `rgba(255, 246, 205, ${0.55 + wave * 0.4})`;
    g.lineWidth = Math.max(1.5, r * 0.04);
    g.beginPath(); g.arc(x, y, rd + Math.max(0.5, r * 0.015), 0, TAU); g.stroke();
  }
  const turn = lit && !reduced ? now / 1600 : 0;
  g.save();
  g.translate(x, y);
  g.rotate(turn - 0.18);
  blit(g, wheel, 0, 0);
  g.restore();
  blit(g, plate, x, y + plateY);
  g.restore();
}

/** A delivery, seen by everyone: solid gold rings out of the vault and gold
 * coins and sparkles thrown outward. `k` runs 0 to 1 over 900 ms. With
 * `reduced` it is a still ring of sparkles that only fades. */
export function drawBurst(g, { x, y, r, k, reduced }) {
  if (!(k >= 0) || k >= 1 || !(r > 0)) return;
  const fade = 1 - k;
  const ease = reduced ? 0.45 : 1 - Math.pow(1 - k, 3);
  g.save();
  g.translate(x, y);

  // a warm flash over the vault at the start
  const fa = reduced ? 0.35 * fade : Math.max(0, 1 - k * 2.5) * 0.7;
  if (fa > 0) {
    const fg = g.createRadialGradient(0, 0, 0, 0, 0, r * 1.3);
    fg.addColorStop(0, `rgba(255, 248, 215, ${fa})`);
    fg.addColorStop(0.6, `rgba(255, 215, 102, ${fa * 0.5})`);
    fg.addColorStop(1, "rgba(255, 200, 61, 0)");
    g.fillStyle = fg;
    g.beginPath(); g.arc(0, 0, r * 1.3, 0, TAU); g.fill();
  }

  // two solid gold rings, the second lagging
  for (const lag of [0, 0.18]) {
    const f = reduced ? (lag ? 0.25 : 0.5) : Math.max(0, (k - lag) / (1 - lag));
    if (!reduced && k < lag) continue;
    const e = 1 - Math.pow(1 - f, 2);
    const a = reduced ? fade : (1 - f) * fade * 1.4;
    g.strokeStyle = `rgba(255, 215, 102, ${Math.min(1, a)})`;
    g.lineWidth = Math.max(1.5, r * (lag ? 0.05 : 0.09) * (1 - f * 0.6));
    g.beginPath(); g.arc(0, 0, r * (1 + e * 0.95), 0, TAU); g.stroke();
  }

  // coins and four-point sparkles flying out
  const N = 14;
  const cs = Math.max(2.4, r * 0.075);
  const ss = Math.max(4, r * 0.15);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + (i % 3) * 0.17;
    const reach = 1.15 + ((i * 37) % 10) / 22;
    const d = r * (0.55 + ease * reach);
    const px = Math.cos(a) * d, py = Math.sin(a) * d;
    const al = Math.min(1, fade * 1.6);
    if (i % 2 === 0) {
      // a gold coin, spinning on its edge as it flies
      const sx = reduced ? 0.8 : Math.abs(Math.cos(k * 9 + i)) * 0.85 + 0.15;
      g.save();
      g.globalAlpha = al;
      g.translate(px, py);
      g.scale(sx, 1);
      g.fillStyle = "#a8701a";
      g.beginPath(); g.arc(cs * 0.2, cs * 0.25, cs, 0, TAU); g.fill();
      g.fillStyle = GOLD;
      g.beginPath(); g.arc(0, 0, cs, 0, TAU); g.fill();
      g.fillStyle = "#fff3c4";
      g.beginPath(); g.arc(-cs * 0.35, -cs * 0.35, cs * 0.35, 0, TAU); g.fill();
      g.restore();
    } else {
      // a sparkle glint
      const s = ss * (reduced ? 0.8 : 0.6 + 0.4 * Math.sin(k * Math.PI));
      g.save();
      g.globalAlpha = al;
      g.translate(px, py);
      g.fillStyle = "#fff3c4";
      g.beginPath();
      for (let j = 0; j < 4; j++) {
        const b = (j / 4) * TAU;
        g.lineTo(Math.cos(b) * s, Math.sin(b) * s);
        g.lineTo(Math.cos(b + TAU / 8) * s * 0.22, Math.sin(b + TAU / 8) * s * 0.22);
      }
      g.closePath();
      g.fill();
      g.fillStyle = GOLD;
      g.beginPath(); g.arc(0, 0, s * 0.18, 0, TAU); g.fill();
      g.restore();
    }
  }
  g.restore();
}
