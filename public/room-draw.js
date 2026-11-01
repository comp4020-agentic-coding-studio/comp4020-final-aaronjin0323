// The room, on a 2D canvas (ADR 31): wall and floor as materials, every stand
// under its own pool of light, soft contact shadows, and a vignette, so it
// reads like a photograph of a quiet gallery. Nothing here decides anything:
// geometry and tables are in room.js.
import { HORIZON, ITEMS, bounds, order, restOn } from "./room.js";
import { drawItem } from "./arena-draw.js";

const rngOf = (seed) => {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
};
const LIGHT = {
  warm: { tint: "rgba(255,214,160,.10)", dark: 0.16, pool: "255,226,180", wash: 0.5 },
  cool: { tint: "rgba(190,214,255,.08)", dark: 0.12, pool: "226,236,255", wash: 0.46 },
  dusk: { tint: "rgba(30,24,60,.18)", dark: 0.34, pool: "255,206,140", wash: 0.82 },
};

function wall(g, w, h, kind) {
  const H = h * HORIZON;
  const base = { plaster: ["#d9cfbf", "#c5b9a6"], sage: ["#a9b3a0", "#8f9a87"], walnut: ["#5c4030", "#46301f"], midnight: ["#1d2233", "#141827"] }[kind];
  const f = g.createLinearGradient(0, 0, 0, H);
  f.addColorStop(0, base[1]);
  f.addColorStop(0.55, base[0]);
  f.addColorStop(1, base[1]);
  g.fillStyle = f;
  g.fillRect(0, 0, w, H);
  const n = rngOf(11);
  if (kind === "plaster" || kind === "sage") {
    // limewash: broad, faint strokes
    g.filter = `blur(${w * 0.02}px)`;
    for (let i = 0; i < 46; i++) {
      g.fillStyle = `rgba(${n() > 0.5 ? "255,255,255" : "60,50,40"},${0.008 + n() * 0.01})`;
      g.beginPath();
      g.ellipse(n() * w, n() * H, w * (0.08 + n() * 0.14), h * (0.05 + n() * 0.08), 0, 0, Math.PI * 2);
      g.fill();
    }
    g.filter = "none";
  } else if (kind === "walnut") {
    const panels = 8;
    for (let i = 0; i < panels; i++) {
      const x = (i * w) / panels;
      g.strokeStyle = "rgba(20,10,4,.55)";
      g.lineWidth = Math.max(1, w * 0.0016);
      g.strokeRect(x + 1, -2, w / panels, H + 2);
      for (let j = 0; j < 14; j++) {
        const gx = x + n() * (w / panels);
        g.strokeStyle = `rgba(${n() > 0.5 ? "120,84,58" : "26,14,6"},${0.1 + n() * 0.14})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + n() * 14 - 7, H * 0.3, gx + n() * 14 - 7, H * 0.7, gx + n() * 10 - 5, H);
        g.stroke();
      }
    }
  } else {
    const s = g.createLinearGradient(0, 0, w, H);
    s.addColorStop(0.3, "rgba(255,255,255,0)");
    s.addColorStop(0.5, "rgba(170,190,255,.06)");
    s.addColorStop(0.7, "rgba(255,255,255,0)");
    g.fillStyle = s;
    g.fillRect(0, 0, w, H);
  }
  // the skirting
  g.fillStyle = "rgba(0,0,0,.28)";
  g.fillRect(0, H - h * 0.012, w, h * 0.012);
}

function floor(g, w, h, kind) {
  const H = h * HORIZON, D = h - H;
  const base = { oak: ["#b5946b", "#8d6f4c"], terrazzo: ["#cfc9bf", "#a7a196"], slate: ["#3c3e42", "#26282b"], wool: ["#7c6a58", "#5f5042"] }[kind];
  const f = g.createLinearGradient(0, H, 0, h);
  f.addColorStop(0, base[1]);
  f.addColorStop(1, base[0]);
  g.fillStyle = f;
  g.fillRect(0, H, w, D);
  const n = rngOf(29);
  if (kind === "oak") {
    // boards running to a vanishing point
    const vx = w / 2, vy = H - D * 1.1;
    for (let i = -14; i <= 14; i++) {
      const x = w / 2 + (i * w) / 9;
      g.strokeStyle = "rgba(50,30,14,.3)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(vx + (x - vx) * ((H - vy) / (h - vy)), H);
      g.lineTo(x, h);
      g.stroke();
    }
    // short butt joints between the boards, closer together towards the wall
    for (let i = -14; i < 14; i++) {
      for (let k = 0; k < 3; k++) {
        const u = n();
        const y = H + u * u * D;
        const at = (bx) => vx + (w / 2 + (bx * w) / 9 - vx) * ((y - vy) / (h - vy));
        g.strokeStyle = "rgba(50,30,14,.22)";
        g.beginPath();
        g.moveTo(at(i), y);
        g.lineTo(at(i + 1), y);
        g.stroke();
      }
    }
    // the boards' grain and tone
    for (let i = -14; i < 14; i++) {
      const x0 = vx + (w / 2 + (i * w) / 9 - vx) * ((H - vy) / (h - vy));
      const x1 = vx + (w / 2 + ((i + 1) * w) / 9 - vx) * ((H - vy) / (h - vy));
      g.fillStyle = `rgba(${n() > 0.5 ? "255,230,190" : "50,30,14"},${n() * 0.06})`;
      g.beginPath();
      g.moveTo(x0, H);
      g.lineTo(x1, H);
      g.lineTo(w / 2 + ((i + 1) * w) / 9, h);
      g.lineTo(w / 2 + (i * w) / 9, h);
      g.closePath();
      g.fill();
    }
  } else if (kind === "terrazzo") {
    for (let i = 0; i < 620; i++) {
      const d = n();
      g.fillStyle = ["rgba(90,80,70,.5)", "rgba(240,235,225,.7)", "rgba(150,110,80,.45)", "rgba(70,90,90,.4)"][Math.floor(n() * 4)];
      g.beginPath();
      g.ellipse(n() * w, H + d * D, (1 + n() * 3) * (0.5 + d), (0.6 + n() * 1.4) * (0.5 + d), n() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "slate") {
    for (let i = 0; i < 6; i++) {
      const y = H + (D * i * i) / 36;
      g.strokeStyle = "rgba(0,0,0,.4)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    for (let i = -8; i <= 8; i++) {
      g.strokeStyle = "rgba(0,0,0,.28)";
      g.beginPath();
      g.moveTo(w / 2 + (i * w) / 8, H);
      g.lineTo(w / 2 + (i * w) / 5, h);
      g.stroke();
    }
  } else {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${n() > 0.5 ? "255,240,220" : "30,20,10"},.05)`;
      g.fillRect(n() * w, H + n() * D, 2, 1);
    }
  }
  // the wall's reflection, fading into the floor
  const r = g.createLinearGradient(0, H, 0, H + D * 0.34);
  r.addColorStop(0, "rgba(255,245,230,.12)");
  r.addColorStop(1, "rgba(255,245,230,0)");
  g.fillStyle = r;
  g.fillRect(0, H, w, D * 0.34);
}

function shadow(g, cx, cy, rx, ry, a = 0.36) {
  const f = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  f.addColorStop(0, `rgba(0,0,0,${a})`);
  f.addColorStop(1, "rgba(0,0,0,0)");
  g.save();
  g.translate(cx, cy);
  g.scale(rx, ry);
  g.fillStyle = f;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
function box(g, x, y, bw, bh, face, side) {
  const f = g.createLinearGradient(x, 0, x + bw, 0);
  f.addColorStop(0, side);
  f.addColorStop(0.35, face);
  f.addColorStop(1, side);
  g.fillStyle = f;
  g.fillRect(x, y, bw, bh);
}

/** A thing, in pixels: box `l, t, bw, bh`. */
function piece(g, i, b, w, h, time) {
  const t = ITEMS[i.type];
  const l = b.left * w, r = b.right * w, top = b.top * h, bot = b.bottom * h;
  const bw = r - l, bh = bot - top, cx = (l + r) / 2;
  if (t.place === "floor" && !t.flat) shadow(g, cx, bot, bw * 0.62, Math.max(4, bw * 0.13));
  if (i.type === "plinth") {
    box(g, l, top, bw, bh, "#f1ece3", "#c8c0b2");
    g.fillStyle = "#faf7f1";
    g.fillRect(l, top, bw, Math.max(2, bh * 0.012));
  } else if (i.type === "column") {
    box(g, l, top, bw, bh, "#3a3632", "#191715");
    g.fillStyle = "#57514a";
    g.fillRect(l - 2, top, bw + 4, Math.max(2, bh * 0.015));
    g.fillRect(l - 3, bot - bh * 0.03, bw + 6, bh * 0.03);
  } else if (i.type === "case") {
    const base = top + bh * 0.74;
    box(g, l, base, bw, bot - base, "#2c2823", "#14120f");
    g.fillStyle = "rgba(220,235,240,.08)";
    g.fillRect(l, top, bw, base - top);
    g.strokeStyle = "rgba(235,245,250,.5)";
    g.lineWidth = 1;
    g.strokeRect(l + 0.5, top + 0.5, bw - 1, base - top);
  } else if (i.type === "shelf") {
    shadow(g, cx, bot + bh, bw * 0.55, bh * 1.6, 0.3);
    box(g, l, top, bw, bh, "#6e5236", "#3f2d1b");
  } else if (i.type === "bench") {
    box(g, l, top, bw, bh * 0.3, "#b08a5c", "#7f5e3a");
    g.fillStyle = "#3a2c1d";
    g.fillRect(l + bw * 0.06, top + bh * 0.3, bw * 0.04, bh * 0.7);
    g.fillRect(r - bw * 0.1, top + bh * 0.3, bw * 0.04, bh * 0.7);
  } else if (i.type === "chair") {
    g.fillStyle = "#6b4a33";
    g.beginPath();
    g.roundRect(l + bw * 0.08, top, bw * 0.84, bh * 0.55, bw * 0.1);
    g.fill();
    g.fillStyle = "#83604a";
    g.beginPath();
    g.roundRect(l, top + bh * 0.46, bw, bh * 0.26, bw * 0.07);
    g.fill();
    g.fillStyle = "#2a2018";
    g.fillRect(l + bw * 0.12, top + bh * 0.72, bw * 0.06, bh * 0.28);
    g.fillRect(r - bw * 0.18, top + bh * 0.72, bw * 0.06, bh * 0.28);
  } else if (i.type === "table") {
    g.fillStyle = "#2b2622";
    g.fillRect(cx - bw * 0.03, top + bh * 0.1, bw * 0.06, bh * 0.9);
    g.beginPath();
    g.ellipse(cx, bot, bw * 0.24, bw * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#cdb48c";
    g.beginPath();
    g.ellipse(cx, top + bh * 0.1, bw / 2, bw * 0.1, 0, 0, Math.PI * 2);
    g.fill();
  } else if (i.type === "rug") {
    const inset = bw * 0.1;
    const trap = (a, c) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(l + inset + a, bot - bh * 2.4 + a / 3);
      g.lineTo(r - inset - a, bot - bh * 2.4 + a / 3);
      g.lineTo(r - a, bot - a / 3);
      g.lineTo(l + a, bot - a / 3);
      g.closePath();
      g.fill();
    };
    trap(0, "#7b3b2e");
    trap(bw * 0.025, "#d2b98c");
    trap(bw * 0.04, "#5b2b23");
  } else if (i.type === "plant") {
    const n = rngOf(i.uid * 97 + 3);
    g.fillStyle = "#b5a58e";
    g.beginPath();
    g.moveTo(cx - bw * 0.22, bot - bh * 0.24);
    g.lineTo(cx + bw * 0.22, bot - bh * 0.24);
    g.lineTo(cx + bw * 0.16, bot);
    g.lineTo(cx - bw * 0.16, bot);
    g.closePath();
    g.fill();
    g.strokeStyle = "#54432f";
    g.lineWidth = Math.max(1.5, bw * 0.03);
    g.beginPath();
    g.moveTo(cx, bot - bh * 0.24);
    g.quadraticCurveTo(cx - bw * 0.08, top + bh * 0.5, cx, top + bh * 0.2);
    g.stroke();
    for (let k = 0; k < 44; k++) {
      const a = n() * Math.PI * 2, d = Math.sqrt(n());
      g.save();
      g.translate(cx + Math.cos(a) * d * bw * 0.48, top + bh * 0.3 + Math.sin(a) * d * bh * 0.28);
      g.rotate(n() * 3);
      g.fillStyle = ["#5d6e4a", "#74855c", "#46583a"][k % 3];
      g.beginPath();
      g.ellipse(0, 0, bw * 0.08, bw * 0.024, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  } else if (i.type === "vase") {
    const f = g.createLinearGradient(l, 0, r, 0);
    f.addColorStop(0, "#39485a");
    f.addColorStop(0.35, "#7e95ab");
    f.addColorStop(1, "#27333f");
    g.fillStyle = f;
    g.beginPath();
    g.moveTo(cx - bw * 0.16, top);
    g.bezierCurveTo(cx - bw * 0.6, top + bh * 0.45, cx - bw * 0.5, bot - bh * 0.1, cx - bw * 0.18, bot);
    g.lineTo(cx + bw * 0.18, bot);
    g.bezierCurveTo(cx + bw * 0.5, bot - bh * 0.1, cx + bw * 0.6, top + bh * 0.45, cx + bw * 0.16, top);
    g.closePath();
    g.fill();
  } else if (i.type === "painting") {
    shadow(g, cx + bw * 0.02, bot, bw * 0.6, bh * 0.1, 0.25);
    g.fillStyle = "#2a2118";
    g.fillRect(l, top, bw, bh);
    g.fillStyle = "#efe7d8";
    g.fillRect(l + bw * 0.05, top + bw * 0.05, bw * 0.9, bh - bw * 0.1);
    const n = rngOf(i.uid * 131 + 5);
    const px = l + bw * 0.14, py = top + bw * 0.14, pw = bw * 0.72, ph = bh - bw * 0.28;
    g.fillStyle = ["#b7664a", "#3f5a6e", "#c79a4a", "#5f6e4a"][i.uid % 4];
    g.fillRect(px, py, pw, ph);
    for (let k = 0; k < 4; k++) {
      g.fillStyle = `rgba(${n() > 0.5 ? "245,235,215" : "30,24,18"},.6)`;
      g.beginPath();
      g.ellipse(px + n() * pw, py + n() * ph, pw * (0.08 + n() * 0.2), ph * (0.06 + n() * 0.16), n() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (i.type === "sconce") {
    const glow = g.createRadialGradient(cx, top, 0, cx, top + bh, bh * 3.4);
    glow.addColorStop(0, "rgba(255,226,170,.5)");
    glow.addColorStop(1, "rgba(255,226,170,0)");
    g.fillStyle = glow;
    g.fillRect(cx - bh * 3.4, top - bh * 2.4, bh * 6.8, bh * 6.8);
    g.fillStyle = "#b08d57";
    g.fillRect(cx - bw * 0.25, top, bw * 0.5, bh);
  }
}

/** Draws a whole room at w by h pixels, `t` in seconds. `selected` is a uid. */
export function drawRoom(g, w, h, layout, artifacts, { t = 0, selected = null, editing = false } = {}) {
  const look = LIGHT[layout.light] ?? LIGHT.warm;
  wall(g, w, h, layout.wall);
  floor(g, w, h, layout.floor);
  g.fillStyle = look.tint;
  g.fillRect(0, 0, w, h);
  // ambient darkness, before the lights, so pools read as light on the room
  g.fillStyle = `rgba(10,8,12,${look.dark})`;
  g.fillRect(0, 0, w, h);
  const items = order(layout.items);
  // pools of light on the wall and the floor, behind every thing
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const i of items) {
    if (ITEMS[i.type].group !== "stand" || !artifacts[i.artifact ?? ""]) continue;
    const r = restOn(i);
    const cx = r.X * w, cy = r.Y * h, R = h * 0.36 * r.s;
    const f = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    f.addColorStop(0, `rgba(${look.pool},${look.wash * 0.5})`);
    f.addColorStop(1, `rgba(${look.pool},0)`);
    g.fillStyle = f;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    // the beam, faintly, from the ceiling
    const beam = g.createLinearGradient(0, 0, 0, cy);
    beam.addColorStop(0, `rgba(${look.pool},${look.wash * 0.12})`);
    beam.addColorStop(1, `rgba(${look.pool},0)`);
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(cx - R * 0.08, 0);
    g.lineTo(cx + R * 0.08, 0);
    g.lineTo(cx + R * 0.5, cy);
    g.lineTo(cx - R * 0.5, cy);
    g.closePath();
    g.fill();
  }
  g.restore();
  for (const i of items) {
    const b = bounds(i);
    piece(g, i, b, w, h, t);
    const a = artifacts[i.artifact ?? ""];
    if (a) {
      const r = restOn(i);
      const size = h * 0.05 * r.s;
      // a small contact shadow, so it sits on the stand rather than hovers
      shadow(g, r.X * w, r.Y * h, size * 0.8, size * 0.14, 0.4);
      drawItem(g, a, r.X * w + (a.kind === "door" ? size * 0.25 : 0), r.Y * h - size * 0.72, size, t);
      if (i.type === "case") {
        const left = b.left * w, width = (b.right - b.left) * w, top = b.top * h, ch = (b.bottom - b.top) * h * 0.74;
        const glare = g.createLinearGradient(left, top, left + width, top + ch);
        glare.addColorStop(0.2, "rgba(255,255,255,0)");
        glare.addColorStop(0.4, "rgba(255,255,255,.1)");
        glare.addColorStop(0.6, "rgba(255,255,255,0)");
        g.fillStyle = glare;
        g.fillRect(left, top, width, ch);
      }
    }
    if (editing && i.uid === selected) {
      g.strokeStyle = "#d8b878";
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeRect(b.left * w - 4, b.top * h - 4, (b.right - b.left) * w + 8, (b.bottom - b.top) * h + 8);
      g.setLineDash([]);
    }
  }
  // a vignette, as a lens would
  const v = g.createRadialGradient(w / 2, h * 0.48, h * 0.45, w / 2, h * 0.48, w * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,.42)");
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}
