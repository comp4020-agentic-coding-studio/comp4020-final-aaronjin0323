import { fill, finish, glowing, star, stream } from "./artifact-paint.js";

// A small arched door standing ajar onto a starry night. The frame is
// about r wide and 1.5r tall, centred on 0,0; the leaf swings open to the
// left on its hinges. The night behind it is the same seed every time.
const TAU = Math.PI * 2;

export function door(g, r, t, look, material, seed) {
  const n = stream(seed);
  const shade = material === "starlight" ? "#0d0730" : look.dark;
  const fine = r >= 14; // small details only where they can be seen
  const line = Math.max(0.8, r * 0.025);

  // the frame: an arch r wide, with an arched opening inside it
  const fw = r * 0.5, fTop = -r * 0.75, fBot = r * 0.66;
  const ow = r * 0.36, oTop = -r * 0.6, oBot = r * 0.62;
  const outer = (p) => arch(p, -fw, fw, fTop, fBot);
  const opening = (p) => arch(p, -ow, ow, oTop, oBot);

  // light spilling out across the floor in front of the door
  g.save();
  const spill = g.createLinearGradient(0, oBot, 0, r * 0.9);
  spill.addColorStop(0, "rgba(190,200,255,0.35)");
  spill.addColorStop(1, "rgba(190,200,255,0)");
  g.fillStyle = spill;
  g.beginPath();
  g.moveTo(-ow, oBot);
  g.lineTo(ow, oBot);
  g.lineTo(ow + r * 0.3, r * 0.9);
  g.lineTo(-ow + r * 0.05, r * 0.9);
  g.closePath();
  g.fill();
  g.restore();

  // the frame, with the material's glow behind it
  g.save();
  glowing(g, look, r);
  g.beginPath();
  outer(g);
  opening(g);
  g.fillStyle = fill(g, look, r, material, t);
  g.fill("evenodd");
  g.shadowBlur = 0;
  finish(g, look);
  // top-left light, bottom-right shade, over the frame only
  g.beginPath();
  outer(g);
  opening(g);
  g.clip("evenodd");
  g.fillStyle = light(g, r);
  g.fillRect(-r, -r, r * 2, r * 2);
  if (fine) {
    // a moulding just inside the outer edge, and a keystone
    g.strokeStyle = shade;
    g.globalAlpha = 0.35;
    g.lineWidth = line;
    g.beginPath();
    arch(g, -fw + r * 0.07, fw - r * 0.07, fTop + r * 0.07, fBot);
    g.stroke();
    g.globalAlpha = 1;
    frameDetail(g, r, t, look, material, seed, fw, fTop, fBot, ow, oTop, shade, line);
  }
  g.restore();
  keystone(g, r, t, look, material, fTop, oTop, shade);

  // the night through the doorway
  g.save();
  g.beginPath();
  opening(g);
  g.clip();
  night(g, r, t, n, ow, oTop, oBot, fine);
  // the jamb's depth on the far side, and a soft shadow under the arch
  const jamb = g.createLinearGradient(ow - r * 0.09, 0, ow, 0);
  jamb.addColorStop(0, "rgba(0,0,0,0)");
  jamb.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = jamb;
  g.fillRect(ow - r * 0.09, oTop, r * 0.09, oBot - oTop);
  g.restore();
  g.lineWidth = line;
  g.strokeStyle = shade;
  g.globalAlpha = 0.6;
  g.beginPath();
  opening(g);
  g.stroke();
  g.globalAlpha = 1;

  // threshold step
  g.save();
  g.beginPath();
  rounded(g, -fw - r * 0.05, fBot - r * 0.02, fw * 2 + r * 0.1, r * 0.1, r * 0.03);
  g.fillStyle = fill(g, look, r, material, t);
  g.fill();
  finish(g, look);
  g.clip();
  const step = g.createLinearGradient(0, fBot - r * 0.02, 0, fBot + r * 0.08);
  step.addColorStop(0, "rgba(255,255,255,0.45)");
  step.addColorStop(0.4, "rgba(255,255,255,0)");
  step.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = step;
  g.fillRect(-r, fBot - r * 0.05, r * 2, r * 0.2);
  g.restore();

  leaf(g, r, t, look, material, seed, shade, fine, line, ow, oTop, oBot, fw);
}

// an arched outline: straight sides, a round top, a flat foot
function arch(p, x0, x1, top, bot) {
  const cx = (x0 + x1) / 2, rr = (x1 - x0) / 2;
  p.moveTo(x0, bot);
  p.lineTo(x0, top + rr);
  p.arc(cx, top + rr, rr, Math.PI, TAU);
  p.lineTo(x1, bot);
  p.closePath();
}

function rounded(p, x, y, w, h, k) {
  p.moveTo(x + k, y);
  p.arcTo(x + w, y, x + w, y + h, k);
  p.arcTo(x + w, y + h, x, y + h, k);
  p.arcTo(x, y + h, x, y, k);
  p.arcTo(x, y, x + w, y, k);
  p.closePath();
}

// a wash that lights whatever is clipped from the top-left
function light(g, r) {
  const l = g.createLinearGradient(-r * 0.6, -r * 0.8, r * 0.6, r * 0.8);
  l.addColorStop(0, "rgba(255,255,255,0.28)");
  l.addColorStop(0.4, "rgba(255,255,255,0.05)");
  l.addColorStop(0.7, "rgba(0,0,0,0.05)");
  l.addColorStop(1, "rgba(0,0,0,0.32)");
  return l;
}

function keystone(g, r, t, look, material, fTop, oTop, shade) {
  const kw = r * 0.09, kt = fTop - r * 0.02, kb = oTop + r * 0.06;
  g.save();
  g.beginPath();
  g.moveTo(-kw, kt);
  g.lineTo(kw, kt);
  g.lineTo(kw * 0.6, kb);
  g.lineTo(-kw * 0.6, kb);
  g.closePath();
  g.fillStyle = fill(g, look, r, material, t);
  g.fill();
  finish(g, look);
  g.clip();
  g.fillStyle = light(g, r * 0.25);
  g.fillRect(-kw, kt, kw * 2, kb - kt);
  if (material === "starlight" || material === "gold") {
    g.fillStyle = material === "gold" ? "#fffbe6" : "#ffffff";
    const s = 0.75 + 0.25 * Math.sin(t * 2.2);
    star(g, 0, (kt + kb) / 2, r * 0.07 * s);
  } else if (material === "glass") {
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(-kw * 0.5, kt + r * 0.02, kw * 0.25, (kb - kt) * 0.6);
  } else {
    g.fillStyle = shade;
    g.beginPath();
    g.arc(0, (kt + kb) / 2, Math.max(0.6, r * 0.022), 0, TAU);
    g.fill();
  }
  g.restore();
}

// what each material adds to the frame (already clipped to it)
function frameDetail(g, r, t, look, material, seed, fw, fTop, fBot, ow, oTop, shade, line) {
  if (material === "tin") {
    // brushed lines and a row of rivets down each post
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = Math.max(0.5, r * 0.008);
    for (let y = fTop; y < fBot; y += r * 0.045) {
      g.beginPath();
      g.moveTo(-fw, y);
      g.lineTo(fw, y + r * 0.02);
      g.stroke();
    }
    const mid = (fw + ow) / 2;
    for (const x of [-mid, mid]) for (let i = 0; i < 5; i++) rivet(g, x, oTop + r * 0.35 + i * r * 0.2, Math.max(0.8, r * 0.028), look);
    const ar = (fw + ow) / 2, cy = oTop + ow;
    for (let i = 1; i < 4; i++) {
      const a = Math.PI + (i * Math.PI) / 4;
      rivet(g, Math.cos(a) * ar, cy + Math.sin(a) * ar * 1.02, Math.max(0.8, r * 0.028), look);
    }
  } else if (material === "glass") {
    // a cold refractive streak down the left post and round the arch
    g.strokeStyle = "rgba(255,255,255,0.75)";
    g.lineCap = "round";
    g.lineWidth = Math.max(1, r * 0.035);
    const x = -(fw + ow) / 2 - r * 0.03;
    g.beginPath();
    g.moveTo(x, fBot - r * 0.25);
    g.lineTo(x, oTop + ow);
    g.arc(0, oTop + ow, -x, Math.PI, Math.PI * 1.35);
    g.stroke();
    g.strokeStyle = "rgba(143,246,255,0.5)";
    g.lineWidth = line;
    g.beginPath();
    arch(g, -ow - r * 0.025, ow + r * 0.025, oTop - r * 0.025, fBot);
    g.stroke();
  } else if (material === "gold") {
    // an engraved vine of little diamonds round the arch
    g.fillStyle = "rgba(90,58,0,0.45)";
    const ar = (fw + ow) / 2, cy = oTop + ow;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i * Math.PI) / 8;
      diamond(g, Math.cos(a) * ar, cy + Math.sin(a) * ar, r * 0.028);
    }
    for (const x of [-ar, ar]) for (let i = 1; i < 5; i++) diamond(g, x, cy + i * r * 0.2, r * 0.028);
    g.fillStyle = "#fffbe6";
    const s = (Math.sin(t * 3 + seed) + 1) / 2;
    star(g, -ar, cy + r * 0.05, r * (0.05 + 0.06 * s));
  } else if (material === "starlight") {
    const s = stream(seed + 9);
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1, y = fTop + r * 0.3 + s() * (fBot - fTop - r * 0.35);
      const x = side * (ow + s() * (fw - ow));
      g.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i * 1.3))})`;
      g.beginPath();
      g.arc(x, y, Math.max(0.5, r * 0.012), 0, TAU);
      g.fill();
    }
    g.strokeStyle = "rgba(214,198,255,0.55)";
    g.lineWidth = line;
    g.beginPath();
    arch(g, -ow - r * 0.03, ow + r * 0.03, oTop - r * 0.03, fBot);
    g.stroke();
  }
}

function rivet(g, x, y, s, look) {
  g.fillStyle = look.dark;
  g.beginPath();
  g.arc(x + s * 0.3, y + s * 0.3, s, 0, TAU);
  g.fill();
  g.fillStyle = look.light;
  g.beginPath();
  g.arc(x, y, s, 0, TAU);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(x - s * 0.35, y - s * 0.35, s * 0.4, 0, TAU);
  g.fill();
}

function diamond(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.lineTo(x + s * 0.7, y);
  g.lineTo(x, y + s);
  g.lineTo(x - s * 0.7, y);
  g.closePath();
  g.fill();
}

// the sky beyond: deep blue to a violet horizon, a nebula, a moon, stars
function night(g, r, t, n, ow, oTop, oBot, fine) {
  const sky = g.createLinearGradient(0, oTop, 0, oBot);
  sky.addColorStop(0, "#060824");
  sky.addColorStop(0.55, "#16125a");
  sky.addColorStop(0.85, "#3b2486");
  sky.addColorStop(1, "#7a56c8");
  g.fillStyle = sky;
  g.fillRect(-ow, oTop, ow * 2, oBot - oTop);
  const h = oBot - oTop;
  // two nebula clouds, placed and tinted by the seed
  const tints = [["rgba(255,110,200,0.35)", "rgba(255,110,200,0)"], ["rgba(90,200,255,0.3)", "rgba(90,200,255,0)"], ["rgba(170,120,255,0.4)", "rgba(170,120,255,0)"]];
  for (let i = 0; i < 2; i++) {
    const [a, b] = tints[Math.floor(n() * 3)];
    const x = (n() - 0.5) * ow * 1.6, y = oTop + h * (0.25 + n() * 0.5), rr = r * (0.25 + n() * 0.2);
    const neb = g.createRadialGradient(x, y, 0, x, y, rr);
    neb.addColorStop(0, a);
    neb.addColorStop(1, b);
    g.fillStyle = neb;
    g.fillRect(-ow, oTop, ow * 2, h);
  }
  // a crescent moon, or sometimes a full one
  const mx = (n() - 0.5) * ow * 1.0, my = oTop + h * (0.18 + n() * 0.15), mr = r * (0.09 + n() * 0.04);
  const full = n() < 0.25;
  g.save();
  const halo = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 2.4);
  halo.addColorStop(0, "rgba(255,240,200,0.35)");
  halo.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = halo;
  g.fillRect(mx - mr * 2.4, my - mr * 2.4, mr * 4.8, mr * 4.8);
  g.beginPath();
  g.arc(mx, my, mr, 0, TAU);
  g.clip();
  g.fillStyle = "#fff4cf";
  g.beginPath();
  g.arc(mx, my, mr, 0, TAU);
  if (!full) {
    g.moveTo(mx + mr * 1.35, my - mr * 0.25);
    g.arc(mx + mr * 0.45, my - mr * 0.25, mr * 0.9, 0, TAU);
  }
  g.fill("evenodd");
  g.restore();
  // stars of different sizes, twinkling
  const count = 6 + Math.min(34, Math.floor(r * 0.18));
  for (let i = 0; i < count; i++) {
    const x = (n() - 0.5) * ow * 2, y = oTop + n() * h * 0.92, big = n(), ph = n() * TAU;
    if (Math.hypot(x - mx, y - my) < mr * 1.5) continue;
    const tw = 0.55 + 0.45 * Math.sin(t * (1.5 + big * 2) + ph);
    if (big > 0.82 && fine) {
      g.fillStyle = `rgba(255,248,220,${0.6 + 0.4 * tw})`;
      star(g, x, y, r * (0.035 + big * 0.03) * (0.8 + 0.2 * tw));
    } else {
      g.fillStyle = `rgba(255,255,255,${0.35 + 0.6 * tw})`;
      g.beginPath();
      g.arc(x, y, Math.max(0.5, r * (0.008 + big * 0.014)), 0, TAU);
      g.fill();
    }
  }
  // a shooting star every few seconds
  const period = 5 + (n() * 3);
  const k = ((t + n() * period) % period) / 0.7;
  if (t > 0 && k < 1) {
    const sx = ow * (0.6 - k * 1.4), sy = oTop + h * (0.1 + k * 0.3), len = r * 0.25;
    const tail = g.createLinearGradient(sx, sy, sx + len, sy - len * 0.4);
    tail.addColorStop(0, `rgba(255,255,255,${1 - k})`);
    tail.addColorStop(1, "rgba(255,255,255,0)");
    g.strokeStyle = tail;
    g.lineWidth = Math.max(0.8, r * 0.015);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + len, sy - len * 0.4);
    g.stroke();
  }
  // the night's glow rising from the horizon
  const glow = g.createRadialGradient(0, oBot, 0, 0, oBot, h * 0.45);
  glow.addColorStop(0, "rgba(200,190,255,0.45)");
  glow.addColorStop(1, "rgba(200,190,255,0)");
  g.fillStyle = glow;
  g.fillRect(-ow, oTop, ow * 2, h);
}

// the open leaf: an arched door in the material, seen at an angle, hinged
// on the left side of the opening and swung out towards us
function leaf(g, r, t, look, material, seed, shade, fine, line, ow, oTop, oBot, fw) {
  // hinged just outside the left post, with a sliver of air between, so
  // even a solid silhouette reads as a door standing ajar
  const D = ow * 2, H = oBot - oTop, k = 0.58, hx = -fw - r * 0.06, cy = (oTop + oBot) / 2;
  // door coords (a across from the hinge, b down from the apex) to screen
  const P = (a, b) => {
    const s = 1 + (a / D) * 0.12;
    return [hx - a * k, cy + (b - H / 2) * s + (a / D) * r * 0.02];
  };
  const top = (a) => ow - Math.sqrt(Math.max(0, ow * ow - (a - ow) * (a - ow)));
  const outline = (a0, a1, b0, b1, arched) => {
    const steps = 10;
    g.moveTo(...P(a0, b1));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      // inset arches follow the door's own arch
      const b = arched ? Math.max(b0, b0 + top(a) * ((a1 - a0) / D) - top(a0) * ((a1 - a0) / D)) : b0;
      if (i === 0) g.lineTo(...P(a, b));
      else g.lineTo(...P(a, b));
    }
    g.lineTo(...P(a1, b1));
    g.closePath();
  };
  const shape = () => {
    g.moveTo(...P(0, H));
    for (let i = 0; i <= 16; i++) g.lineTo(...P((D * i) / 16, top((D * i) / 16)));
    g.lineTo(...P(D, H));
    g.closePath();
  };

  // the leaf's edge, a sliver of thickness on the outer side
  g.save();
  const th = r * 0.05;
  g.beginPath();
  const [ex0, ey0] = P(D, ow), [ex1, ey1] = P(D, H);
  g.moveTo(ex0, ey0);
  g.lineTo(ex1, ey1);
  g.lineTo(ex1 + th, ey1 - th * 0.3);
  g.lineTo(ex0 + th, ey0 - th * 0.3);
  g.closePath();
  g.fillStyle = fill(g, look, r, material, t);
  g.fill();
  g.globalAlpha /= look.alpha;
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fill();
  g.restore();

  g.save();
  g.beginPath();
  shape();
  g.fillStyle = fill(g, look, r, material, t);
  g.fill();
  finish(g, look);
  g.clip();
  // lit from the top-left, and from the doorway on its hinge side
  g.fillStyle = light(g, r);
  g.fillRect(-r * 1.2, -r, r * 1.4, r * 2);
  const spill = g.createLinearGradient(hx, 0, hx - D * k, 0);
  spill.addColorStop(0, "rgba(190,190,255,0.35)");
  spill.addColorStop(0.5, "rgba(190,190,255,0)");
  g.fillStyle = spill;
  g.fillRect(-r * 1.2, -r, r * 1.4, r * 2);
  if (material === "starlight") {
    const s = stream(seed + 3);
    for (let i = 0; i < 9; i++) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i * 1.7));
      g.fillStyle = `rgba(255,255,255,${a})`;
      const [x, y] = P(D * (0.1 + s() * 0.8), ow * 0.6 + s() * (H - ow * 0.7));
      if (i < 2) star(g, x, y, r * 0.05);
      else { g.beginPath(); g.arc(x, y, Math.max(0.5, r * 0.012), 0, TAU); g.fill(); }
    }
  }
  if (fine) {
    // two recessed panels: an arched one above, a square one below
    const m = D * 0.17;
    const panels = [[m, D - m, ow * 0.55, H * 0.47, true], [m, D - m, H * 0.55, H * 0.9, false]];
    for (const [a0, a1, b0, b1, arched] of panels) {
      g.beginPath();
      outline(a0, a1, b0, b1, arched);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fill();
      g.lineWidth = line;
      g.strokeStyle = material === "glass" ? "rgba(255,255,255,0.6)" : shade;
      g.globalAlpha = 0.5;
      g.stroke();
      g.save();
      g.translate(line * 0.9, line * 0.9);
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.globalAlpha = 0.45;
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
    }
    if (material === "tin") {
      for (const b of [H * 0.51, H * 0.95]) for (const a of [D * 0.25, D * 0.5, D * 0.75]) rivet(g, ...P(a, b), Math.max(0.7, r * 0.022), look);
    } else if (material === "glass") {
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.lineWidth = Math.max(1, r * 0.03);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(...P(D * 0.12, H * 0.85));
      g.lineTo(...P(D * 0.12, ow * 0.7));
      g.stroke();
    } else if (material === "gold") {
      g.fillStyle = "#fffbe6";
      const s = (Math.sin(t * 3 + seed + 2) + 1) / 2;
      star(g, ...P(D * 0.3, H * 0.3), r * (0.04 + 0.06 * s));
    }
  }
  g.restore();

  // hinges on the frame side
  if (fine) {
    for (const b of [H * 0.25, H * 0.8]) {
      const [x, y] = P(0, b);
      g.fillStyle = shade;
      g.fillRect(x - r * 0.05, y - r * 0.045, r * 0.09, r * 0.09);
      g.fillStyle = look.light;
      g.globalAlpha = 0.8;
      g.fillRect(x - r * 0.05, y - r * 0.045, r * 0.09, r * 0.025);
      g.globalAlpha = 1;
      g.fillStyle = look.edge;
      g.fillRect(x - r * 0.012, y - r * 0.06, r * 0.024, r * 0.12);
    }
  }

  // the knob: a little sphere on a plate, with a keyhole below
  const [kx, ky] = P(D * 0.82, H * 0.6);
  const kr = Math.max(1.2, r * 0.045);
  if (fine) {
    g.fillStyle = shade;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.ellipse(kx, ky + kr * 0.4, kr * 1.1, kr * 2.2, 0, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }
  const knob = g.createRadialGradient(kx - kr * 0.4, ky - kr * 0.4, 0, kx, ky, kr * 1.1);
  const brass = material === "glass" ? ["#ffffff", "#8fe9ff", "#0b4a63"] : material === "starlight" ? ["#ffffff", "#d6c6ff", "#4a2fa0"] : material === "tin" ? ["#ffffff", "#c9ced4", "#4a525b"] : ["#fffbe6", "#f0b93a", "#7a4e00"];
  knob.addColorStop(0, brass[0]);
  knob.addColorStop(0.45, brass[1]);
  knob.addColorStop(1, brass[2]);
  g.fillStyle = knob;
  g.beginPath();
  g.arc(kx, ky, kr, 0, TAU);
  g.fill();
  if (fine) {
    g.fillStyle = shade;
    g.beginPath();
    g.arc(kx, ky + kr * 2, kr * 0.35, 0, TAU);
    g.moveTo(kx - kr * 0.15, ky + kr * 2);
    g.lineTo(kx + kr * 0.15, ky + kr * 2);
    g.lineTo(kx + kr * 0.25, ky + kr * 2.8);
    g.lineTo(kx - kr * 0.25, ky + kr * 2.8);
    g.fill();
  }
}
