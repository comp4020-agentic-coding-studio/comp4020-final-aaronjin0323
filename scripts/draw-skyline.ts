#!/usr/bin/env node
// Draws public/art/city.svg: a downtown skyline with palms, as one silhouette
// path. style.css uses it as a mask, so its colour lives in the stylesheet.
// Seeded, so running it again draws the same city.
//
//   node scripts/draw-skyline.ts
import { writeFileSync } from "node:fs";

const W = 4800; // 16:1, so one copy spans a desktop screen before it repeats
const H = 300;

// mulberry32: a small seeded generator, so the drawing is reproducible
let seed = 8020;
const random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
const r = Math.round;

// The highest point drawn, so the viewBox can start above it: a mast or a
// frond that pokes past the top would otherwise be cut flat.
let highest = H;
const reach = (...ys: number[]): void => {
  highest = Math.min(highest, ...ys);
};

// Every shape is wound clockwise. The path fills by the nonzero rule, where
// overlapping shapes wound opposite ways cancel and leave a hole.
const d: string[] = [`M0 ${H - 10}H${W}V${H}H0z`]; // the street along the bottom

for (let x = 0; x < W; ) {
  const w = between(50, 140);
  let h = between(50, 165);
  if (random() < 0.16) h = between(200, 272); // the odd tower
  let top = H - h;
  const roof = random();
  if (h > 150 && roof < 0.22) {
    const cut = between(18, 40); // a slanted crown
    d.push(random() < 0.5 ? `M${x} ${H}V${top + cut}L${x + w} ${top}V${H}z` : `M${x} ${H}V${top}L${x + w} ${top + cut}V${H}z`);
  } else {
    d.push(`M${x} ${H}V${top}h${w}V${H}z`);
    if (h > 110 && roof < 0.7) {
      const inset = between(8, Math.max(9, Math.floor(w / 4)));
      const crown = between(12, 32);
      d.push(`M${x + inset} ${top}v${-crown}h${w - 2 * inset}v${crown}z`);
      top -= crown;
      if (random() < 0.55) {
        const mast = between(16, 42);
        d.push(`M${x + Math.floor(w / 2) - 2} ${top}v${-mast}h4v${mast}z`);
        top -= mast;
      }
    }
  }
  reach(top);
  x += w + [0, 0, 0, 3, 8, 14][between(0, 5)];
}

// A curved, tapering trunk and a crown of drooping fronds.
function palm(cx: number, height: number, lean: number): string {
  const base = H - 6;
  const [tx, ty] = [cx + lean, base - height];
  const [mx, my] = [cx + lean * 0.25, base - height * 0.5];
  const parts = [
    `M${cx - 7} ${base}Q${r(mx - 6)} ${r(my)} ${r(tx - 3)} ${r(ty)}L${r(tx + 3)} ${r(ty)}Q${r(mx + 6)} ${r(my)} ${cx + 7} ${base}z`,
  ];
  for (const deg of [-172, -142, -112, -84, -58, -28, 2, 24]) {
    const a = ((deg + random() * 12 - 6) * Math.PI) / 180;
    const length = 62 + random() * 26;
    const droop = length * 0.45 * (1 - Math.abs(Math.sin(a)) * 0.6);
    const [ex, ey] = [tx + length * Math.cos(a), ty + length * Math.sin(a) + droop];
    // a lens: out along an arc that bows upward, back along a flatter one
    let [nx, ny] = [-Math.sin(a), Math.cos(a)];
    if (ny > 0) [nx, ny] = [-nx, -ny];
    const [hx, hy] = [(tx + ex) / 2, (ty + ey) / 2];
    const bow = `${r(hx + nx * 22)} ${r(hy + ny * 22 - 8)}`;
    const flat = `${r(hx + nx * 6)} ${r(hy + ny * 6)}`;
    // a curve stays inside its control points, so these bound the frond
    reach(ty, ey, hy + ny * 22 - 8, hy + ny * 6);
    // fronds pointing left would wind anticlockwise: go round the other way
    const clockwise = (hx + nx * 22 - tx) * (ey - ty) - (hy + ny * 22 - 8 - ty) * (ex - tx) > 0;
    const [out, back] = clockwise ? [bow, flat] : [flat, bow];
    parts.push(`M${r(tx)} ${r(ty)}Q${out} ${r(ex)} ${r(ey)}Q${back} ${r(tx)} ${r(ty)}z`);
  }
  return parts.join("");
}

for (const [cx, height, lean] of [
  [170, 236, 26], [232, 194, -18], [930, 250, -24], [1580, 226, 30], [1642, 182, -14],
  [2350, 244, 20], [3060, 214, -26], [3118, 250, 16], [3900, 232, -20], [4560, 220, 24],
]) {
  d.push(palm(cx, height, lean));
}

const top = Math.floor(highest) - 4;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${W} ${H - top}">
<!-- Drawn by scripts/draw-skyline.ts. style.css uses it as a mask, so its
     colour comes from the stylesheet. -->
<path d="${d.join("")}"/>
</svg>
`;
writeFileSync("public/art/city.svg", svg);
console.log(`wrote public/art/city.svg (${svg.length} bytes)`);
