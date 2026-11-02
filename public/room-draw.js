// The room, on a 2D canvas (ADR 33): an isometric space of two walls and a
// floor in real materials, things built from lit boxes, each artifact in a pool
// of light, and a small robot that's drawn in depth order with everything else.
// Nothing here decides anything: geometry and tables are in room.js.
import { ITEMS, WALL_H, bounds, footOf, iso, order, project, restOn } from "./room.js";
import { drawItem } from "./arena-draw.js";

const rngOf = (seed) => {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
};
const LIGHT = {
  warm: { tint: "rgba(255,214,160,.08)", dark: 0.12, pool: "255,226,180", wash: 0.5 },
  cool: { tint: "rgba(190,214,255,.07)", dark: 0.1, pool: "226,236,255", wash: 0.46 },
  dusk: { tint: "rgba(30,24,60,.12)", dark: 0.2, pool: "255,206,140", wash: 0.82 },
};

function wallTexture(g, w, H, kind) {
  const h = H;
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
}

function floorTexture(g, W, H, kind) {
  const base = { oak: ["#b5946b", "#a2835c"], terrazzo: ["#cfc9bf", "#bdb7ac"], slate: ["#3c3e42", "#303236"], wool: ["#7c6a58", "#6e5e4e"] }[kind];
  g.fillStyle = base[0];
  g.fillRect(0, 0, W, H);
  const n = rngOf(29);
  if (kind === "oak") {
    const boards = 11;
    for (let i = 0; i < boards; i++) {
      const y = (i * H) / boards;
      g.fillStyle = `rgba(${n() > 0.5 ? "255,232,196" : "54,32,14"},${n() * 0.07})`;
      g.fillRect(0, y, W, H / boards);
      g.fillStyle = "rgba(50,30,14,.32)";
      g.fillRect(0, y, W, Math.max(1, H * 0.002));
      for (let x = n() * W * 0.4; x < W; x += W * (0.25 + n() * 0.3)) g.fillRect(x, y, Math.max(1, W * 0.002), H / boards);
    }
  } else if (kind === "terrazzo") {
    for (let i = 0; i < 700; i++) {
      g.fillStyle = ["rgba(90,80,70,.55)", "rgba(240,235,225,.75)", "rgba(150,110,80,.5)", "rgba(70,90,90,.45)"][Math.floor(n() * 4)];
      g.beginPath();
      g.ellipse(n() * W, n() * H, W * (0.002 + n() * 0.005), H * (0.002 + n() * 0.004), n() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "slate") {
    for (let i = 0; i <= 5; i++) {
      g.fillStyle = "rgba(0,0,0,.42)";
      g.fillRect((i * W) / 5, 0, Math.max(1, W * 0.003), H);
      g.fillRect(0, (i * H) / 5, W, Math.max(1, H * 0.003));
    }
    for (let i = 0; i < 25; i++) {
      g.fillStyle = `rgba(255,255,255,${n() * 0.05})`;
      g.fillRect((Math.floor(n() * 5) * W) / 5, (Math.floor(n() * 5) * H) / 5, W / 5, H / 5);
    }
  } else {
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${n() > 0.5 ? "255,240,220" : "30,20,10"},.06)`;
      g.fillRect(n() * W, n() * H, W * 0.006, H * 0.003);
    }
  }
}

/** Draws `paint(g, W, H)` onto the parallelogram from `o` along `u` and `v`. */
function surface(g, o, u, v, W, H, paint) {
  g.save();
  g.transform(u[0] / W, u[1] / W, v[0] / H, v[1] / H, o[0], o[1]);
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();
  paint(g, W, H);
  g.restore();
}
const at = (w, h, x, y, up = 0) => {
  const p = iso(x, y, up);
  return [p.X * w, p.Y * h];
};
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]];

// what never moves is painted once: materials are too costly for every frame
let backdrop = null, backKey = "";
function shell(w, h, dpr, layout) {
  const key = `${w}|${h}|${dpr}|${layout.wall}|${layout.floor}|${layout.light}`;
  if (key === backKey) return backdrop;
  backKey = key;
  backdrop = document.createElement("canvas");
  backdrop.width = Math.round(w * dpr);
  backdrop.height = Math.round(h * dpr);
  const g = backdrop.getContext("2d");
  g.scale(dpr, dpr);
  const look = LIGHT[layout.light] ?? LIGHT.warm;
  const bg = g.createRadialGradient(w / 2, h * 0.5, h * 0.1, w / 2, h * 0.5, w * 0.7);
  bg.addColorStop(0, "#2b2620");
  bg.addColorStop(1, "#14110d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const P = (x, y, up) => at(w, h, x, y, up);
  const W = 1000, T = 420;
  const back = P(0, 0, WALL_H), left = P(0, 1, WALL_H), right = P(1, 0, WALL_H), down = minus(P(0, 0), back);
  surface(g, left, minus(back, left), down, W, T, (c, a, b) => wallTexture(c, a, b, layout.wall));
  surface(g, back, minus(right, back), down, W, T, (c, a, b) => wallTexture(c, a, b, layout.wall));
  // the walls take the light differently, which is what makes it a corner
  surface(g, left, minus(back, left), down, 10, 10, (c, a, b) => {
    c.fillStyle = "rgba(10,8,8,.26)";
    c.fillRect(0, 0, a, b);
  });
  surface(g, P(0, 0), minus(P(1, 0), P(0, 0)), minus(P(0, 1), P(0, 0)), 1000, 1000, (c, a, b) => {
    floorTexture(c, a, b, layout.floor);
    const fade = c.createRadialGradient(a * 0.1, b * 0.1, 0, a * 0.2, b * 0.2, a * 1.1);
    fade.addColorStop(0, "rgba(255,245,230,.14)");
    fade.addColorStop(1, "rgba(0,0,0,.2)");
    c.fillStyle = fade;
    c.fillRect(0, 0, a, b);
  });
  // skirting, and the corner's shadow
  g.lineCap = "round";
  g.strokeStyle = "rgba(0,0,0,.38)";
  g.lineWidth = Math.max(2, h * 0.007);
  g.beginPath();
  g.moveTo(...P(0, 1));
  g.lineTo(...P(0, 0));
  g.lineTo(...P(1, 0));
  g.stroke();
  g.strokeStyle = "rgba(0,0,0,.28)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(...P(0, 0));
  g.lineTo(...P(0, 0, WALL_H));
  g.stroke();
  // the floor's edge, a slab it stands on
  g.fillStyle = "#0e0c09";
  const lip = h * 0.018;
  g.beginPath();
  g.moveTo(...P(0, 1));
  g.lineTo(...P(1, 1));
  g.lineTo(...P(1, 0));
  g.lineTo(P(1, 0)[0], P(1, 0)[1] + lip);
  g.lineTo(P(1, 1)[0], P(1, 1)[1] + lip);
  g.lineTo(P(0, 1)[0], P(0, 1)[1] + lip);
  g.closePath();
  g.fill();
  g.fillStyle = look.tint;
  g.fillRect(0, 0, w, h);
  g.fillStyle = `rgba(10,8,12,${look.dark})`;
  g.fillRect(0, 0, w, h);
  return backdrop;
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
function quad(g, pts, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (const p of pts.slice(1)) g.lineTo(...p);
  g.closePath();
  g.fill();
}
/** A lit box: centred at x, y on the floor, half-sizes fx, fy, from `up` to `up + tall`. */
function box(g, w, h, x, y, fx, fy, up, tall, [top, lit, dim]) {
  const P = (a, b, c) => at(w, h, a, b, c);
  const t = up + tall;
  quad(g, [P(x - fx, y + fy, up), P(x + fx, y + fy, up), P(x + fx, y + fy, t), P(x - fx, y + fy, t)], dim);
  quad(g, [P(x + fx, y + fy, up), P(x + fx, y - fy, up), P(x + fx, y - fy, t), P(x + fx, y + fy, t)], lit);
  quad(g, [P(x - fx, y - fy, t), P(x + fx, y - fy, t), P(x + fx, y + fy, t), P(x - fx, y + fy, t)], top);
}
const WHITE = ["#fbf8f2", "#e9e3d8", "#c9c1b3"];
const DARK = ["#5b554e", "#35312c", "#1e1b18"];
const OAK = ["#c9a473", "#a67f53", "#7f5e3a"];
const IRON = ["#3a2c1d", "#2c2115", "#1f170e"];

/** Along whichever wall an item is on: the view's vector for its own width. */
function wallRun(i, w, h, width) {
  const a = at(w, h, 0, 0), b = i.x < 0.5 ? at(w, h, 0, 1) : at(w, h, 1, 0);
  const u = minus(b, a);
  const len = Math.hypot(u[0], u[1]);
  const run = [(u[0] / len) * width, (u[1] / len) * width];
  return i.x < 0.5 ? [-run[0], -run[1]] : run;
}
function piece(g, i, w, h) {
  const t = ITEMS[i.type], s = project(i, t.place).s;
  const tall = t.h * s;
  const [fx, fy] = footOf(i.type);
  const { x, y } = i;
  const P = (a, b, c = 0) => at(w, h, a, b, c);
  if (t.place === "wall") return onTheWall(g, i, w, h);
  const [cx, cy] = P(x, y);
  const spread = (fx + fy) * w * 0.4;
  if (!t.flat) shadow(g, cx, cy + spread * 0.12, spread * 1.25, spread * 0.62);
  if (i.type === "plinth") box(g, w, h, x, y, fx, fy, 0, tall, WHITE);
  else if (i.type === "column") box(g, w, h, x, y, fx, fy, 0, tall, DARK);
  else if (i.type === "case") box(g, w, h, x, y, fx, fy, 0, tall * t.top, DARK);
  else if (i.type === "bench") {
    for (const [dx, dy] of [[-0.8, 0], [0.8, 0]]) box(g, w, h, x + dx * fx, y + dy * fy, fy * 0.3, fy * 0.8, 0, tall * 0.62, IRON);
    box(g, w, h, x, y, fx, fy, tall * 0.62, tall * 0.38, OAK);
  } else if (i.type === "chair") {
    box(g, w, h, x, y - fy * 0.85, fx * 0.85, fy * 0.18, tall * 0.45, tall * 0.55, ["#7c5a44", "#6b4a33", "#54392a"]);
    box(g, w, h, x, y, fx * 0.85, fy * 0.85, tall * 0.3, tall * 0.2, ["#a07f66", "#83604a", "#6b4a33"]);
    for (const [dx, dy] of [[-0.7, 0.7], [0.7, 0.7]]) box(g, w, h, x + dx * fx, y + dy * fy, fx * 0.1, fy * 0.1, 0, tall * 0.3, IRON);
  } else if (i.type === "table") {
    box(g, w, h, x, y, fx * 0.14, fy * 0.14, 0, tall * 0.9, DARK);
    const [tx, ty] = P(x, y, tall * 0.9);
    const rx = spread * 0.72, ry = rx * 0.5;
    g.fillStyle = "#8f7857";
    g.beginPath();
    g.ellipse(tx, ty + h * 0.008, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d4bc95";
    g.beginPath();
    g.ellipse(tx, ty, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  } else if (i.type === "rug") {
    surface(g, P(x - fx, y - fy), minus(P(x + fx, y - fy), P(x - fx, y - fy)), minus(P(x - fx, y + fy), P(x - fx, y - fy)), 100, 100, (c) => {
      c.fillStyle = "#7b3b2e";
      c.fillRect(0, 0, 100, 100);
      c.fillStyle = "#d2b98c";
      c.fillRect(6, 6, 88, 88);
      c.fillStyle = "#5b2b23";
      c.fillRect(10, 10, 80, 80);
      c.fillStyle = "#94503c";
      c.fillRect(34, 34, 32, 32);
    });
  } else if (i.type === "plant") {
    const pot = tall * 0.24, px = spread * 0.55;
    const bw = spread * 2, bot = cy, top = cy - tall * h, bh = bot - top;
    quad(g, [[cx - px, bot - pot * h], [cx + px, bot - pot * h], [cx + px * 0.74, bot], [cx - px * 0.74, bot]], "#b5a58e");
    g.strokeStyle = "#54432f";
    g.lineWidth = Math.max(1.5, bw * 0.03);
    g.beginPath();
    g.moveTo(cx, bot - pot * h);
    g.quadraticCurveTo(cx - bw * 0.08, top + bh * 0.5, cx, top + bh * 0.2);
    g.stroke();
    const n = rngOf(i.uid * 97 + 3);
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
    const bw = spread * 2, top = cy - tall * h, bot = cy;
    const f = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    f.addColorStop(0, "#39485a");
    f.addColorStop(0.35, "#7e95ab");
    f.addColorStop(1, "#27333f");
    g.fillStyle = f;
    g.beginPath();
    g.moveTo(cx - bw * 0.16, top);
    g.bezierCurveTo(cx - bw * 0.6, top + (bot - top) * 0.45, cx - bw * 0.5, bot - (bot - top) * 0.1, cx - bw * 0.18, bot);
    g.lineTo(cx + bw * 0.18, bot);
    g.bezierCurveTo(cx + bw * 0.5, bot - (bot - top) * 0.1, cx + bw * 0.6, top + (bot - top) * 0.45, cx + bw * 0.16, top);
    g.closePath();
    g.fill();
  }
}
function glass(g, i, w, h) {
  const t = ITEMS.case, tall = t.h * project(i, "floor").s;
  const [fx, fy] = footOf("case");
  box(g, w, h, i.x, i.y, fx, fy, tall * t.top, tall * (1 - t.top), ["rgba(235,245,250,.08)", "rgba(235,245,250,.1)", "rgba(235,245,250,.05)"]);
  g.strokeStyle = "rgba(235,245,250,.5)";
  g.lineWidth = 1;
  const P = (a, b, c) => at(w, h, a, b, c);
  const T = tall, B = tall * t.top, { x, y } = i;
  g.beginPath();
  for (const [a, b] of [[x - fx, y + fy], [x + fx, y + fy], [x + fx, y - fy]]) {
    g.moveTo(...P(a, b, B));
    g.lineTo(...P(a, b, T));
  }
  g.moveTo(...P(x - fx, y + fy, T));
  g.lineTo(...P(x + fx, y + fy, T));
  g.lineTo(...P(x + fx, y - fy, T));
  g.lineTo(...P(x - fx, y - fy, T));
  g.closePath();
  g.stroke();
}
function onTheWall(g, i, w, h) {
  const t = ITEMS[i.type], p = project(i, "wall");
  const width = (t.w * p.s * h), tall = t.h * p.s * h;
  const run = wallRun(i, w, h, width);
  const c = [p.X * w, p.Y * h];
  const o = [c[0] - run[0] / 2, c[1] - run[1] / 2 - tall / 2];
  if (i.type === "painting") {
    surface(g, [o[0] + 4, o[1] + 6], run, [0, tall], 10, 10, (x) => {
      x.fillStyle = "rgba(0,0,0,.3)";
      x.fillRect(0, 0, 10, 10);
    });
    surface(g, o, run, [0, tall], 100, 130, (x, W, H) => {
      x.fillStyle = "#2a2118";
      x.fillRect(0, 0, W, H);
      x.fillStyle = "#efe7d8";
      x.fillRect(5, 5, W - 10, H - 10);
      x.fillStyle = ["#b7664a", "#3f5a6e", "#c79a4a", "#5f6e4a"][i.uid % 4];
      x.fillRect(15, 15, W - 30, H - 30);
      const n = rngOf(i.uid * 131 + 5);
      for (let k = 0; k < 4; k++) {
        x.fillStyle = `rgba(${n() > 0.5 ? "245,235,215" : "30,24,18"},.6)`;
        x.beginPath();
        x.ellipse(15 + n() * 70, 15 + n() * 100, 6 + n() * 16, 6 + n() * 18, n() * 3, 0, Math.PI * 2);
        x.fill();
      }
    });
  } else if (i.type === "shelf") {
    const thick = Math.max(3, tall);
    quad(g, [o, [o[0] + run[0], o[1] + run[1]], [o[0] + run[0], o[1] + run[1] + thick], [o[0], o[1] + thick]], "#6e5236");
    shadow(g, c[0], c[1] + thick * 2.4, Math.abs(run[0]) * 0.6, thick * 1.8, 0.3);
  } else if (i.type === "sconce") {
    const glow = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], tall * 3.2);
    glow.addColorStop(0, "rgba(255,226,170,.5)");
    glow.addColorStop(1, "rgba(255,226,170,0)");
    g.fillStyle = glow;
    g.fillRect(c[0] - tall * 3.2, c[1] - tall * 3.2, tall * 6.4, tall * 6.4);
    g.fillStyle = "#b08d57";
    g.fillRect(c[0] - tall * 0.16, c[1] - tall / 2, tall * 0.32, tall);
  }
}

// your robot: the arena's, on a visit. It bobs as it walks and settles to sit.
function robot(g, w, h, r, t) {
  const [cx, cy] = at(w, h, r.x, r.y);
  const size = h * 0.024;
  const bob = r.moving ? Math.abs(Math.sin(t * 16)) * size * 0.22 : 0;
  const lift = r.sitting ? ITEMS[r.seat].h * project({ x: 0, y: 0 }, "floor").s * h * 0.62 + size * 0.7 : size * 1.05 + bob;
  shadow(g, cx, cy, size * 1.2, size * 0.5, 0.5);
  const y = cy - lift;
  const f = g.createRadialGradient(cx - size * 0.35, y - size * 0.4, size * 0.1, cx, y, size);
  f.addColorStop(0, "#ffa98f");
  f.addColorStop(1, "#d94f30");
  g.fillStyle = f;
  g.beginPath();
  g.arc(cx, y, size, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(2, size * 0.16);
  g.strokeStyle = "#fff";
  g.stroke();
  const look = r.face ?? [0.7, 0.7];
  const dx = (look[0] - look[1]) * size * 0.32, dy = (look[0] + look[1]) * size * 0.16;
  g.fillStyle = "rgba(0,0,0,.65)";
  g.beginPath();
  g.arc(cx + dx, y + dy, size * 0.42, 0, Math.PI * 2);
  g.fill();
}

/** Draws a whole room at w by h pixels, `t` in seconds. */
export function drawRoom(g, w, h, dpr, layout, artifacts, { t = 0, stir = 0, selected = null, editing = false, walker = null, near = null } = {}) {
  g.drawImage(shell(w, h, dpr, layout), 0, 0, w, h);
  const look = LIGHT[layout.light] ?? LIGHT.warm;
  const items = order(layout.items);
  // rugs first, then pools of light on top of them, then everything upright
  for (const i of items) if (ITEMS[i.type].flat) piece(g, i, w, h);
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const i of items) {
    if (ITEMS[i.type].group !== "stand" || !artifacts[i.artifact ?? ""]) continue;
    const r = restOn(i), on = i.uid === near;
    const cx = r.X * w, cy = r.Y * h;
    const [fx, fy] = ITEMS[i.type].place === "wall" ? [cx, cy + h * 0.1] : at(w, h, i.x, i.y);
    const R = h * (on ? 0.25 : 0.19);
    const pool = g.createRadialGradient(fx, fy, 0, fx, fy, R);
    pool.addColorStop(0, `rgba(${look.pool},${look.wash * (on ? 0.62 : 0.4)})`);
    pool.addColorStop(1, `rgba(${look.pool},0)`);
    g.save();
    g.translate(0, fy * 0.5);
    g.scale(1, 0.5);
    g.fillStyle = pool;
    g.fillRect(fx - R, fy - R, R * 2, R * 2);
    g.restore();
    const beam = g.createLinearGradient(0, cy - h * 0.34, 0, cy);
    beam.addColorStop(0, `rgba(${look.pool},0)`);
    beam.addColorStop(1, `rgba(${look.pool},${look.wash * 0.2})`);
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(cx - h * 0.012, cy - h * 0.34);
    g.lineTo(cx + h * 0.012, cy - h * 0.34);
    g.lineTo(cx + h * 0.075, cy);
    g.lineTo(cx - h * 0.075, cy);
    g.closePath();
    g.fill();
  }
  g.restore();
  let walked = !walker;
  const walkerDepth = walker ? walker.x + walker.y : 0;
  for (const i of items) {
    const t0 = ITEMS[i.type];
    if (t0.flat) continue;
    if (!walked && t0.place === "floor" && i.x + i.y > walkerDepth) {
      robot(g, w, h, walker, t);
      walked = true;
    }
    piece(g, i, w, h);
    const a = artifacts[i.artifact ?? ""];
    if (a) {
      const r = restOn(i), size = h * 0.042;
      shadow(g, r.X * w, r.Y * h, size * 0.8, size * 0.2, 0.4);
      drawItem(g, a, r.X * w + (a.kind === "door" ? size * 0.25 : 0), r.Y * h - size * (i.uid === near ? 1.05 : 0.75), size, i.uid === near ? stir : t * 0.25);
    }
    if (i.type === "case") glass(g, i, w, h);
    if (editing && i.uid === selected) {
      const b = bounds(i);
      g.strokeStyle = "#d8b878";
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeRect(b.left * w - 3, b.top * h - 3, (b.right - b.left) * w + 6, (b.bottom - b.top) * h + 6);
      g.setLineDash([]);
    }
  }
  if (!walked) robot(g, w, h, walker, t);
  if (editing && selected !== null) {
    const i = items.find((x) => x.uid === selected && ITEMS[x.type].flat);
    if (i) {
      const b = bounds(i);
      g.strokeStyle = "#d8b878";
      g.setLineDash([6, 4]);
      g.lineWidth = 2;
      g.strokeRect(b.left * w, b.top * h, (b.right - b.left) * w, (b.bottom - b.top) * h);
      g.setLineDash([]);
    }
  }
}
