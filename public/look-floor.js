// The arena floor and its walls, drawn first each frame. `w` and `h` are the
// arena's size in CSS pixels, `m` pixels per metre, `now` server time (ms).
// With `reduced` (prefers-reduced-motion) nothing may move.
export function drawFloor(g, { w, h, m, now, reduced }) {
  g.fillStyle = "#211f33";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#57527a";
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
}
