// The arena floor and its walls, drawn first each frame. `w` and `h` are the
// arena's size in CSS pixels, `m` pixels per metre, `now` server time (ms).
// With `reduced` (prefers-reduced-motion) nothing may move.
//
// A night-time toy board seen from above: an inlaid floor of one-metre tiles
// under a soft vignette, a compass inlay of rings and spokes around the vault,
// and a raised rim lit from the top left. Everything static is painted once to
// an offscreen canvas (keyed by size and pixel ratio); each frame is one
// drawImage plus, unless reduced, a faint slow sweep of light round the vault.

let cache = null; // { key, canvas }

const BASE = "#211f33", DEEP = "#16131f", LINE = "#57527a", RIM = "#3a3754";

function rimWidth(m) {
  return Math.max(6, m * 0.18);
}

function paint(c, w, h, m) {
  const cx = w / 2, cy = h / 2, rim = rimWidth(m);
  const ix = rim, iy = rim, iw = w - rim * 2, ih = h - rim * 2;

  // ---- the floor: base colour, a lift towards the centre, a vignette
  c.fillStyle = BASE;
  c.fillRect(0, 0, w, h);
  const lift = c.createRadialGradient(cx - m * 0.6, cy - m * 0.5, 0, cx, cy, Math.hypot(w, h) * 0.55);
  lift.addColorStop(0, "rgba(120,110,190,0.10)");
  lift.addColorStop(0.45, "rgba(120,110,190,0.035)");
  lift.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = lift;
  c.fillRect(0, 0, w, h);

  // ---- inlaid tiles, one metre each, laid out from the centre
  c.save();
  c.beginPath();
  c.rect(ix, iy, iw, ih);
  c.clip();
  const t = m, cols = Math.ceil(w / t / 2) + 1, rows = Math.ceil(h / t / 2) + 1;
  const gap = Math.max(1, m * 0.03);
  for (let j = -rows; j < rows; j++) {
    for (let i = -cols; i < cols; i++) {
      const x = cx + i * t, y = cy + j * t;
      // checker: alternate tiles a touch lighter, like two woods in a board
      c.fillStyle = (i + j) & 1 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.05)";
      c.fillRect(x, y, t, t);
      // each tile catches the light on its top-left edge
      const sheen = c.createLinearGradient(x, y, x + t, y + t);
      sheen.addColorStop(0, "rgba(190,180,255,0.045)");
      sheen.addColorStop(0.5, "rgba(190,180,255,0)");
      sheen.addColorStop(1, "rgba(0,0,0,0.06)");
      c.fillStyle = sheen;
      c.fillRect(x, y, t, t);
    }
  }
  // grout: dark seams, with a hairline highlight just below/right of each
  c.lineWidth = gap;
  c.strokeStyle = "rgba(14,11,22,0.42)";
  c.beginPath();
  for (let i = -cols; i <= cols; i++) { const x = cx + i * t; c.moveTo(x, 0); c.lineTo(x, h); }
  for (let j = -rows; j <= rows; j++) { const y = cy + j * t; c.moveTo(0, y); c.lineTo(w, y); }
  c.stroke();
  c.lineWidth = Math.max(0.5, gap * 0.5);
  c.strokeStyle = "rgba(170,160,230,0.05)";
  c.beginPath();
  for (let i = -cols; i <= cols; i++) { const x = cx + i * t + gap; c.moveTo(x, 0); c.lineTo(x, h); }
  for (let j = -rows; j <= rows; j++) { const y = cy + j * t + gap; c.moveTo(0, y); c.lineTo(w, y); }
  c.stroke();

  // ---- the compass inlay round the vault: a sunk disc, rings, spokes
  const vr = 1.1 * m;
  const well = c.createRadialGradient(cx, cy, vr * 0.9, cx, cy, vr * 3.2);
  well.addColorStop(0, "rgba(22,19,31,0.75)");
  well.addColorStop(0.55, "rgba(22,19,31,0.45)");
  well.addColorStop(1, "rgba(22,19,31,0)");
  c.fillStyle = well;
  c.beginPath();
  c.arc(cx, cy, vr * 3.2, 0, Math.PI * 2);
  c.fill();

  // spokes: sixteen, long on the compass points, fading outwards
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, major = k % 4 === 0, mid = k % 2 === 0;
    const r0 = vr * 1.55, r1 = vr * (major ? 4.4 : mid ? 3.4 : 2.6);
    const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
    const sg = c.createLinearGradient(x0, y0, x1, y1);
    const al = major ? 0.42 : mid ? 0.26 : 0.16;
    sg.addColorStop(0, `rgba(255,200,61,${al * 0.55})`);
    sg.addColorStop(0.35, `rgba(87,82,122,${al})`);
    sg.addColorStop(1, "rgba(87,82,122,0)");
    c.strokeStyle = sg;
    c.lineWidth = Math.max(1, m * (major ? 0.045 : 0.03));
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }
  // small diamonds at the end of the four compass points
  c.fillStyle = "rgba(87,82,122,0.35)";
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2, d = vr * 4.75, s = Math.max(2.5, m * 0.09);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * s * 1.6, y + Math.sin(a) * s * 1.6);
    c.lineTo(x + Math.cos(a + Math.PI / 2) * s, y + Math.sin(a + Math.PI / 2) * s);
    c.lineTo(x - Math.cos(a) * s * 1.6, y - Math.sin(a) * s * 1.6);
    c.lineTo(x - Math.cos(a + Math.PI / 2) * s, y - Math.sin(a + Math.PI / 2) * s);
    c.closePath();
    c.fill();
  }
  // inlaid rings: a dark groove with a lit lower-right lip (it is sunk)
  const ring = (r, width, alpha) => {
    c.lineWidth = width;
    c.strokeStyle = `rgba(10,8,16,${alpha})`;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    const lip = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    lip.addColorStop(0, "rgba(87,82,122,0)");
    lip.addColorStop(1, `rgba(120,113,168,${alpha * 0.8})`);
    c.lineWidth = Math.max(0.75, width * 0.45);
    c.strokeStyle = lip;
    c.beginPath(); c.arc(cx, cy, r + width * 0.6, 0, Math.PI * 2); c.stroke();
  };
  ring(vr * 1.4, Math.max(1.5, m * 0.06), 0.7);
  ring(vr * 2.3, Math.max(1, m * 0.035), 0.5);
  // a dotted ring between, like stitched leather
  c.fillStyle = "rgba(255,200,61,0.16)";
  const dots = 48, dr = vr * 1.85, ds = Math.max(0.9, m * 0.028);
  for (let k = 0; k < dots; k++) {
    const a = (k / dots) * Math.PI * 2;
    c.beginPath();
    c.arc(cx + Math.cos(a) * dr, cy + Math.sin(a) * dr, ds, 0, Math.PI * 2);
    c.fill();
  }

  // ---- corner inlays: quarter rings, one per start corner
  c.lineWidth = Math.max(1, m * 0.04);
  for (const [qx, qy, a0] of [[ix, iy, 0], [ix + iw, iy, Math.PI / 2], [ix + iw, iy + ih, Math.PI], [ix, iy + ih, Math.PI * 1.5]]) {
    for (const [r, al] of [[m * 1.1, 0.32], [m * 1.45, 0.18]]) {
      c.strokeStyle = `rgba(87,82,122,${al})`;
      c.beginPath(); c.arc(qx, qy, r, a0, a0 + Math.PI / 2); c.stroke();
    }
  }

  // ---- vignette: corners fall away into the deep colour
  const vig = c.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.hypot(w, h) * 0.56);
  vig.addColorStop(0, "rgba(22,19,31,0)");
  vig.addColorStop(1, "rgba(14,11,22,0.62)");
  c.fillStyle = vig;
  c.fillRect(0, 0, w, h);

  // the walls cast a shadow onto the floor below/right of them (top-left light)
  const sh = Math.max(4, m * 0.32);
  let sgr = c.createLinearGradient(0, iy, 0, iy + sh);
  sgr.addColorStop(0, "rgba(6,4,12,0.55)");
  sgr.addColorStop(1, "rgba(6,4,12,0)");
  c.fillStyle = sgr;
  c.fillRect(ix, iy, iw, sh);
  sgr = c.createLinearGradient(ix, 0, ix + sh, 0);
  sgr.addColorStop(0, "rgba(6,4,12,0.55)");
  sgr.addColorStop(1, "rgba(6,4,12,0)");
  c.fillStyle = sgr;
  c.fillRect(ix, iy, sh, ih);
  // and a thin contact shadow on the lit far walls
  const cs = Math.max(2, m * 0.1);
  sgr = c.createLinearGradient(0, iy + ih, 0, iy + ih - cs);
  sgr.addColorStop(0, "rgba(6,4,12,0.4)");
  sgr.addColorStop(1, "rgba(6,4,12,0)");
  c.fillStyle = sgr;
  c.fillRect(ix, iy + ih - cs, iw, cs);
  sgr = c.createLinearGradient(ix + iw, 0, ix + iw - cs, 0);
  sgr.addColorStop(0, "rgba(6,4,12,0.4)");
  sgr.addColorStop(1, "rgba(6,4,12,0)");
  c.fillStyle = sgr;
  c.fillRect(ix + iw - cs, iy, cs, ih);
  c.restore();

  // ---- the raised rim: a bevelled frame, lit from the top left
  const frame = (fill) => {
    c.fillStyle = fill;
    c.beginPath();
    c.rect(0, 0, w, h);
    c.rect(ix, iy, iw, ih);
    c.fill("evenodd");
  };
  frame(RIM);
  // top face shading: lighter top-left, darker bottom-right
  const face = c.createLinearGradient(0, 0, w * 0.35, h * 1.1);
  face.addColorStop(0, "rgba(140,132,200,0.30)");
  face.addColorStop(0.5, "rgba(87,82,122,0.08)");
  face.addColorStop(1, "rgba(10,8,18,0.35)");
  frame(face);
  // bevels: the four sides of the rim each catch the light differently
  const b = rim * 0.38;
  const quad = (pts, fill) => {
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
    c.closePath();
    c.fill();
  };
  // outer bevel: top/left lit, bottom/right in shade
  quad([0, 0, w, 0, w - b, b, b, b], "rgba(200,192,255,0.16)");
  quad([0, 0, b, b, b, h - b, 0, h], "rgba(200,192,255,0.10)");
  quad([w, 0, w, h, w - b, h - b, w - b, b], "rgba(8,6,14,0.30)");
  quad([0, h, b, h - b, w - b, h - b, w, h], "rgba(8,6,14,0.40)");
  // inner bevel (the wall face robots bounce off): top/left walls face away
  // from the light, so their inner faces are dark; bottom/right are lit
  quad([ix, iy, ix + iw, iy, ix + iw - b * -1, iy - b, ix - b, iy - b], "rgba(8,6,14,0.45)");
  quad([ix, iy, ix - b, iy - b, ix - b, iy + ih + b, ix, iy + ih], "rgba(8,6,14,0.35)");
  quad([ix + iw, iy, ix + iw + b, iy - b, ix + iw + b, iy + ih + b, ix + iw, iy + ih], "rgba(170,160,235,0.16)");
  quad([ix, iy + ih, ix - b, iy + ih + b, ix + iw + b, iy + ih + b, ix + iw, iy + ih], "rgba(170,160,235,0.22)");
  // a crisp rim line on the inner edge and a hairline highlight on top
  c.lineWidth = Math.max(1, m * 0.04);
  c.strokeStyle = LINE;
  c.strokeRect(ix, iy, iw, ih);
  c.lineWidth = 1;
  c.strokeStyle = "rgba(220,214,255,0.14)";
  c.strokeRect(b + 0.5, b + 0.5, w - b * 2 - 1, h - b * 2 - 1);
  c.strokeStyle = DEEP;
  c.strokeRect(0.5, 0.5, w - 1, h - 1);

  // brass studs at the corners and the wall midpoints
  const stud = (x, y) => {
    const r = Math.max(2, rim * 0.2);
    c.fillStyle = "rgba(6,4,12,0.5)";
    c.beginPath(); c.arc(x + r * 0.25, y + r * 0.3, r, 0, Math.PI * 2); c.fill();
    const sg = c.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
    sg.addColorStop(0, "#ffe39a");
    sg.addColorStop(0.45, "#c99a3a");
    sg.addColorStop(1, "#5e4620");
    c.fillStyle = sg;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  };
  const hr = rim / 2;
  for (const [x, y] of [[hr, hr], [w - hr, hr], [w - hr, h - hr], [hr, h - hr], [cx, hr], [cx, h - hr], [hr, cy], [w - hr, cy]]) stud(x, y);
}

export function drawFloor(g, { w, h, m, now, reduced }) {
  const t = g.getTransform ? g.getTransform() : null;
  const dpr = Math.max(1, Math.min(4, t ? Math.hypot(t.a, t.b) : devicePixelRatio || 1));
  const key = `${w}|${h}|${dpr}`;
  if (!cache || cache.key !== key) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const c = canvas.getContext("2d");
    c.scale(canvas.width / w, canvas.height / h);
    paint(c, w, h, m);
    cache = { key, canvas };
  }
  g.drawImage(cache.canvas, 0, 0, w, h);

  // a faint beam of lamplight turning slowly round the vault (about 40 s per
  // turn); off entirely when reduced
  if (reduced) return;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.48, a = ((now || 0) / 40000) * Math.PI * 2;
  g.save();
  g.globalCompositeOperation = "lighter";
  const beam = g.createRadialGradient(cx, cy, m * 1.2, cx, cy, r);
  beam.addColorStop(0, "rgba(255,200,61,0.05)");
  beam.addColorStop(1, "rgba(255,200,61,0)");
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(cx, cy);
  g.arc(cx, cy, r, a - 0.22, a + 0.22);
  g.closePath();
  g.fill();
  g.restore();
}
