// The vault at the centre: where cargo is kept for good. Gold is "kept"
// everywhere (CLAUDE.md), amber and dashed is "at risk". `r` is its radius in
// pixels (VAULT_R, the rule's own size: draw the edge there). `lit` while
// your robot carries something. With `reduced` nothing may move.
export function drawVault(g, { x, y, r, lit, now, reduced }) {
  const pulse = reduced ? 0 : Math.sin(now / 500) * 0.06;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = `rgba(255, 200, 61, ${(lit ? 0.32 : 0.14) + pulse})`;
  g.fill();
  g.strokeStyle = "#ffc83d";
  g.lineWidth = lit ? 5 : 3;
  g.setLineDash([10, 6]);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = "#ffc83d";
  g.font = "700 13px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("VAULT", x, y);
}

/** A delivery, seen by everyone: solid gold rings out of the vault. `k` runs
 * 0 to 1 over 900 ms. */
export function drawBurst(g, { x, y, r, k, reduced }) {
  for (const lag of [0, 0.22]) {
    const f = reduced ? 1 : Math.max(0, k - lag);
    g.beginPath();
    g.arc(x, y, r * (1 + f * 0.9), 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,215,102,${1 - k})`;
    g.lineWidth = 5;
    g.stroke();
  }
}
