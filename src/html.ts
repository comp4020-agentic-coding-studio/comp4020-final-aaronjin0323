// The museum as HTML the server sends, so it reads without a script: what
// is on each plinth, and who played it.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Slot = { slot: number; exhibit: { latest: { title: string; n: number; credits: { name: string }[] } } | null };

export function renderListing(state: { slots: Slot[] }): string {
  const items = state.slots.map((s) =>
    s.exhibit
      ? `<li><strong>Plinth ${s.slot}:</strong> ${esc(s.exhibit.latest.title)} <span class="by">(version ${s.exhibit.latest.n}, played by ${esc(s.exhibit.latest.credits.map((c) => c.name).join(", ") || "nobody")})</span></li>`
      : `<li><strong>Plinth ${s.slot}:</strong> empty</li>`,
  );
  return `<ul class="listing" data-listing>${items.join("")}</ul>`;
}
