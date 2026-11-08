// A robot: its slot's colour AND its slot's mark (0 circle, 1 square,
// 2 triangle, 3 diamond), so nobody depends on colour alone (CLAUDE.md). `r`
// is ROBOT_R in pixels: the body must stay that size, as contacts use it.
// `isMe` marks your own robot. `vel` is its velocity in metres per second.
// With `reduced` nothing may move.
export function drawRobot(g, { x, y, r, slot, colour, isMe, vel, now, reduced }) {
  if (!(r > 0.5)) return; // no size yet: nothing to draw
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = colour;
  g.fill();
  g.lineWidth = isMe ? 4 : 1.5;
  g.strokeStyle = isMe ? "#ffffff" : "rgba(0,0,0,.5)";
  g.stroke();
  g.fillStyle = "rgba(0,0,0,.65)";
  const m = r * 0.42;
  g.beginPath();
  if (slot === 0) g.arc(x, y, m, 0, Math.PI * 2);
  else if (slot === 1) g.rect(x - m, y - m, m * 2, m * 2);
  else if (slot === 2) { g.moveTo(x, y - m * 1.2); g.lineTo(x + m * 1.1, y + m); g.lineTo(x - m * 1.1, y + m); g.closePath(); }
  else { g.moveTo(x, y - m * 1.3); g.lineTo(x + m * 1.3, y); g.lineTo(x, y + m * 1.3); g.lineTo(x - m * 1.3, y); g.closePath(); }
  g.fill();
}

/** Motion behind a fast robot (only drawn when motion is allowed). `back` is
 * where it was 0.09 s ago, in pixels. */
export function drawTrail(g, { x, y, back, r, colour }) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(back[0], back[1]);
  g.strokeStyle = `${colour}66`;
  g.lineWidth = r * 1.5;
  g.lineCap = "round";
  g.stroke();
  g.lineCap = "butt";
}
