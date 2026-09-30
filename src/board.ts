import { N, type Tile } from "./db.ts";
import { escapeHtml, page } from "./html.ts";

// Notices are chosen from this fixed set by key; nothing from the query
// string is ever echoed into the page.
export const NOTICES = {
  claimed: "Claimed. Your tile rises for every neighbour who settles next to you.",
  taken: "Someone got there first. Pick another tile.",
  label: "Names are 1 to 24 characters.",
  cell: "That tile doesn't exist.",
} as const;
export type Notice = keyof typeof NOTICES;

export const isNotice = (s: string | null): s is Notice => s !== null && s in NOTICES;

// A claimed tile's height is how many of its 8 neighbours are claimed too.
// Derived on every render, never stored.
export function heights(tiles: Tile[]): number[] {
  return tiles.map((tile) => {
    if (tile.claimerId === null) return 0;
    const row = Math.floor(tile.id / N);
    const col = tile.id % N;
    let h = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if ((dr || dc) && r >= 0 && r < N && c >= 0 && c < N && tiles[r * N + c].claimerId !== null) h++;
      }
    }
    return h;
  });
}

// Each person gets a stable colour from their id, so a tile reads as "theirs"
// without showing the id.
function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const initials = (label: string): string => Array.from(label.trim()).slice(0, 2).join("");

export function renderBoard(tiles: Tile[], me: string, notice: Notice | null): string {
  const hs = heights(tiles);
  const mine = tiles.find((t) => t.claimerId === me) ?? null;
  const claimedCount = tiles.filter((t) => t.claimerId !== null).length;

  const cells = tiles
    .map((tile) => {
      const row = Math.floor(tile.id / N) + 1;
      const col = (tile.id % N) + 1;
      const h = hs[tile.id];
      const where = `Row ${row}, column ${col}`;
      if (tile.claimerId === null) {
        return `<button class="tile" name="cellId" value="${tile.id}" data-state="free" data-height="0" style="--h:0" aria-label="${where}, free"></button>`;
      }
      const isMine = tile.claimerId === me;
      const label = escapeHtml(tile.label ?? "");
      const state = isMine ? "mine" : "held";
      const who = isMine ? `your tile, ${label}` : `held by ${label}`;
      return `<button class="tile" name="cellId" value="${tile.id}" data-state="${state}" data-height="${h}" style="--h:${h};--hue:${hue(tile.claimerId)}" aria-label="${where}, ${who}, height ${h}" title="${label}"><span class="initials" aria-hidden="true">${escapeHtml(initials(tile.label ?? ""))}</span></button>`;
    })
    .join("\n        ");

  const status = mine
    ? `You hold row ${Math.floor(mine.id / N) + 1}, column ${(mine.id % N) + 1}, at height ${hs[mine.id]}. Pick a free tile to move.`
    : "You don't hold a tile yet. Type a name, then pick a free tile.";

  const noticeHtml = notice
    ? `<p class="notice" data-notice="${notice}" role="status">${NOTICES[notice]}</p>`
    : "";

  return page({
    title: "Skyline",
    body: `
    <header class="top">
      <h1>Skyline</h1>
      <p class="lede">Everyone here holds one tile. A tile rises for every claimed neighbour, so standing alone keeps you flat and settling beside strangers builds a skyline.</p>
      <p class="meta">${claimedCount} of ${tiles.length} tiles claimed · <a href="/readme/">About</a></p>
    </header>
    <main>
      <form class="claim" method="post" action="/claim">
        <div class="controls">
          <label for="label">Your name</label>
          <input id="label" name="label" maxlength="24" required autocomplete="nickname" value="${escapeHtml(mine?.label ?? "")}">
          <p class="status" id="status">${status}</p>
          ${noticeHtml}
        </div>
        <div class="stage">
          <div class="board" role="group" aria-label="Board, ${N} by ${N}" aria-describedby="status">
        ${cells}
          </div>
        </div>
      </form>
    </main>`,
  });
}
