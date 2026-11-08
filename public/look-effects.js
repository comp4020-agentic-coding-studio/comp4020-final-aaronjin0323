// Moments on the arena: a contact, an artifact settling, cargo on a tether.
// Amber and dashed means at risk (CLAUDE.md): cargo and scatters stay that.

/** A contact: a ring opening out, and a line to where each thing is landing.
 * `k` runs 0 to 1 over 700 ms; `r` is ARTIFACT_R in pixels; `lines` are
 * [fromX, fromY, toX, toY] in pixels. */
export function drawFlash(g, { x, y, r, k, lines, reduced }) {
  g.beginPath();
  g.arc(x, y, r + (reduced ? 10 : 30 * k), 0, Math.PI * 2);
  g.strokeStyle = `rgba(255,107,74,${1 - k})`;
  g.lineWidth = 3;
  g.stroke();
  g.setLineDash([5, 5]);
  g.strokeStyle = `rgba(255,182,72,${0.8 * (1 - k)})`;
  g.lineWidth = 2;
  for (const [x1, y1, x2, y2] of lines) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  g.setLineDash([]);
}

/** An artifact that can't be taken yet: a ring filling, `ready` 0 to 1. */
export function drawSettling(g, { x, y, r, ready }) {
  g.beginPath();
  g.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2.5;
  g.stroke();
}

/** The tether from a robot to its last piece of cargo. */
export function drawTether(g, { x1, y1, x2, y2 }) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = "rgba(255,182,72,.6)";
  g.lineWidth = 2;
  g.stroke();
}

/** The holder behind one piece of cargo; the artifact is drawn on top. */
export function drawCargoSlot(g, { x, y, r }) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = "#211f33";
  g.fill();
  g.setLineDash([4, 3]);
  g.strokeStyle = "#ffb648";
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);
}
