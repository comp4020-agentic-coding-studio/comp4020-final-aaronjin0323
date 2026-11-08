// The door to your room (ADR 39), in the middle of the arena's top wall: an
// opening in the skirting with lamplight falling through it onto the boards,
// and a small arch where the light lands. Open (you carry nothing) it glows
// warm and breathes slowly; aimed at (your path would stop in it) it brightens
// and its edge shows; shut (you carry something) it is a dark gap. `x` is its
// centre, `half` half its width and `depth` how far it reaches in, all in
// pixels, `m` pixels per metre. With `reduced` nothing moves.

const LAMP = "255,222,170", CREAM = "239,232,219", DUSK = "22,18,14";

export function drawDoor(g, { x, half, depth, m, open, aimed, now, reduced }) {
  if (!(half > 0 && depth > 0)) return;
  const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((now / 3200) * Math.PI * 2);
  const a = !open ? 0 : aimed ? 1 : 0.55 + 0.15 * breath;
  const bw = Math.max(2, 0.15 * m);
  g.save();

  // the opening in the skirting
  g.fillStyle = open ? `rgba(${LAMP},${0.55 + 0.4 * a})` : `rgba(${DUSK},1)`;
  g.fillRect(x - half, 0, half * 2, bw);

  if (open) {
    // the light it lets in, widening a little as it falls on the floor
    g.beginPath();
    g.moveTo(x - half, bw);
    g.lineTo(x + half, bw);
    g.lineTo(x + half * 1.18, depth);
    g.lineTo(x - half * 1.18, depth);
    g.closePath();
    const spill = g.createLinearGradient(0, bw, 0, depth);
    spill.addColorStop(0, `rgba(${LAMP},${0.34 * a})`);
    spill.addColorStop(1, `rgba(${LAMP},0)`);
    g.fillStyle = spill;
    g.fill();
  }

  // a small arch where the light lands: this is a way through
  const ah = Math.max(10, 0.42 * m), aw = ah * 0.62, ax = x, ay = bw + (depth - bw) * 0.62;
  g.beginPath();
  g.moveTo(ax - aw / 2, ay);
  g.lineTo(ax - aw / 2, ay - ah + aw / 2);
  g.arc(ax, ay - ah + aw / 2, aw / 2, Math.PI, 0);
  g.lineTo(ax + aw / 2, ay);
  g.strokeStyle = open ? `rgba(${CREAM},${0.35 + 0.5 * a})` : `rgba(${CREAM},0.14)`;
  g.lineWidth = Math.max(1.2, m * 0.04);
  g.lineJoin = "round";
  g.stroke();

  if (aimed && open) {
    // its edge, so you see exactly where you'd stop to go through
    g.setLineDash([]);
    g.strokeStyle = `rgba(${CREAM},0.85)`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - half, bw);
    g.lineTo(x - half, depth);
    g.lineTo(x + half, depth);
    g.lineTo(x + half, bw);
    g.stroke();
  }
  g.restore();
}
