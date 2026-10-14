import { DORMANT_AFTER_MS, isDormant, type Landmark, N, type Tile } from "./db.ts";
import { escapeHtml, page } from "./html.ts";
// The page's own pure module (no DOM), so the goal line and the glowing
// tiles are worked out by one function whether the server or the page draws
// them. The expect-error: it's a plain browser module with no declarations.
// @ts-expect-error
import { goal, goalParts, tileAria } from "../public/diff.js";

// Notices are chosen from this fixed set by key; nothing from the query
// string is ever echoed into the page.
export const NOTICES = {
  claimed: "Claimed. Your tile rises for every neighbour who settles next to you.",
  taken: "Someone got there first. Pick another tile.",
  label: "Names are 1 to 24 characters.",
  cell: "That tile doesn't exist.",
} as const;
export type Notice = keyof typeof NOTICES;

// Own keys only: `in` also finds what every object inherits, so
// ?notice=constructor would print a function's source as the notice.
export const isNotice = (s: string | null): s is Notice => s !== null && Object.hasOwn(NOTICES, s);

// Not in NOTICES, so no query string can show it: it only appears when the
// database says this visitor's tile was settled while they were away.
export const DISPLACED = "Your tile went quiet after a day away, and someone else settled there.";

export type TileState = "free" | "held" | "mine" | "dormant";

// One tile as anyone but its holder's id: everything the page needs to draw
// it, and nothing that identifies a person. The server renders these into
// HTML, and the live stream sends the same objects for the page to patch in,
// so the two can't disagree.
export type TileView = {
  id: number;
  state: TileState;
  height: number;
  hue: number | null;
  label: string | null;
  initials: string;
  aria: string;
  // When a held tile stops being safe (ISO, server time): its holder's last
  // visit plus a day. Null for a free tile, your own (you're here, so it's
  // always safe) and a dormant one (already open). A time, not a countdown,
  // so the page can count down without the server sending every second.
  safeUntil: string | null;
};

// Every landmark the room has raised (docs/adr/0004): how many, and per cell
// the holder's label then and the nine who raised it. Labels only, never a
// pid. Keyed by cell id as a string, since it travels as JSON.
export type LandmarksView = { count: number; cells: Record<string, { label: string; raisers: string[] }> };

export type BoardView = { tiles: TileView[]; claimed: number; status: string; landmarks: LandmarksView };

export function landmarksView(landmarks: Landmark[]): LandmarksView {
  const cells: LandmarksView["cells"] = {};
  for (const l of landmarks) cells[String(l.cellId)] = { label: l.label, raisers: l.raisers };
  return { count: landmarks.length, cells };
}

// A claimed tile's height is how many of its 8 neighbours are claimed and
// not dormant at `now`: someone away over a day stops lifting anyone. A
// dormant tile keeps its own height, from its active neighbours. The same for
// every viewer, so all pages agree. Derived, never stored.
export function heights(tiles: Tile[], now: Date): number[] {
  const active = tiles.map((t) => t.claimerId !== null && !isDormant(t, now));
  return tiles.map((tile) => {
    if (tile.claimerId === null) return 0;
    const row = Math.floor(tile.id / N);
    const col = tile.id % N;
    let h = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const c = col + dc;
        if ((dr || dc) && r >= 0 && r < N && c >= 0 && c < N && active[r * N + c]) h++;
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
const place = (id: number): string => `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;

// The board as one visitor sees it: their own tile is "mine" (never dormant:
// they're here), anyone else's is held or dormant.
export function boardView(tiles: Tile[], me: string, now: Date, landmarks: Landmark[] = []): BoardView {
  const hs = heights(tiles, now);
  const views = tiles.map((tile): TileView => {
    const where = place(tile.id).replace(/^r/, "R");
    if (tile.claimerId === null) {
      return {
        id: tile.id,
        state: "free",
        height: 0,
        hue: null,
        label: null,
        initials: "",
        aria: `${where}, free`,
        safeUntil: null,
      };
    }
    const label = tile.label ?? "";
    const h = hs[tile.id];
    const state: TileState = tile.claimerId === me ? "mine" : isDormant(tile, now) ? "dormant" : "held";
    const who =
      state === "mine"
        ? `your tile, ${label}`
        : state === "dormant"
          ? `held by ${label}, away over a day, open to settle`
          : `held by ${label}`;
    return {
      id: tile.id,
      state,
      height: h,
      hue: hue(tile.claimerId),
      label,
      initials: initials(label),
      aria: `${where}, ${who}, height ${h}`,
      safeUntil:
        state === "held" && tile.lastSeenAt !== null
          ? new Date(new Date(tile.lastSeenAt).getTime() + DORMANT_AFTER_MS).toISOString()
          : null,
    };
  });

  const mine = views.find((t) => t.state === "mine");
  const status = mine
    ? `You hold ${place(mine.id)}, at height ${mine.height}. Pick another tile to move.`
    : "You don't hold a tile yet. Type a name, then pick a free or faded tile.";

  return {
    tiles: views,
    claimed: views.filter((t) => t.state !== "free").length,
    status,
    landmarks: landmarksView(landmarks),
  };
}

function tileButton(t: TileView, landmark: { label: string; raisers: string[] } | undefined, helps: boolean): string {
  // A landmark ever raised on this cell: the label it was raised under, and
  // the nine raisers as a JSON array, so the page has them before the stream.
  // It wears a crown on its roof, and its label says who raised it.
  const crown = landmark
    ? ` data-landmark="${escapeHtml(landmark.label)}" data-landmark-raisers="${escapeHtml(JSON.stringify(landmark.raisers))}"`
    : "";
  // A free or faded tile whose claim would bring a tower closer to a
  // landmark glows (the same goal() the page recomputes on every board).
  const glow = helps ? " data-helps" : "";
  const style = t.hue === null ? `--h:${t.height}` : `--h:${t.height};--hue:${t.hue}`;
  const title = t.label === null ? "" : ` title="${escapeHtml(t.label)}"`;
  const safe = t.safeUntil === null ? "" : ` data-safe-until="${t.safeUntil}"`;
  // .beacon is the marker that floats over the roof: the player's pin on
  // your own tile, the ghost height of a tile you're about to claim, the +1
  // over a neighbour you'd lift. Which one shows is all in the stylesheet.
  const crownMark = landmark ? `<span class="crown" aria-hidden="true"></span>` : "";
  return `<button class="tile" name="cellId" value="${t.id}" data-state="${t.state}" data-height="${t.height}"${safe}${crown}${glow} style="${style}" aria-label="${escapeHtml(tileAria(t.aria, landmark ?? null))}"${title}><span class="sides" aria-hidden="true"></span><span class="initials" aria-hidden="true">${escapeHtml(t.initials)}</span><span class="beacon" aria-hidden="true"></span>${crownMark}</button>`;
}

// The goal line: landmarks raised, and the tower closest to the next one.
// The name is its own element so a long one can be cut short on a phone
// without losing "6 of 8". app.js rewrites the same pieces on every board.
function goalLine(view: BoardView): string {
  const p = goalParts(goal(view)) as { count: string; noun: string; lead: string; who: string; tail: string };
  return `<p class="landmarks" data-goal><span data-landmarks>${p.count}</span> <span data-goal-noun>${p.noun}</span><span class="goal-raised"> raised</span><span class="goal-sep" aria-hidden="true"> · </span><span class="goal-next"><span data-goal-lead>${escapeHtml(p.lead)}</span><span class="goal-who" data-goal-who>${escapeHtml(p.who)}</span><span data-goal-tail>${escapeHtml(p.tail)}</span></span></p>`;
}

// The map key: one sample roof per tile state, so the rules on the tiles can
// be read off the page before anyone plays.
const LEGEND: [TileState, string][] = [
  ["free", "Free"],
  ["held", "Taken"],
  ["mine", "Yours"],
  ["dormant", "Faded: open to claim"],
];

// Only the script can make the connection line true, so without it the
// line isn't shown at all rather than saying "Connecting…" for ever.
const NO_SCRIPT = `<noscript><style>.conn { display: none !important; }</style></noscript>`;

export function renderBoard(
  view: BoardView,
  myLabel: string,
  {
    notice = null,
    displaced = false,
    version = 0,
  }: { notice?: Notice | null; displaced?: boolean; version?: number } = {},
): string {
  const notices = [
    displaced ? `<p class="notice" data-notice="displaced" role="status">${DISPLACED}</p>` : "",
    notice ? `<p class="notice" data-notice="${notice}" role="status">${NOTICES[notice]}</p>` : "",
  ].join("");
  const helps = new Set<number>((goal(view) as { helps: number[] }).helps);

  return page({
    title: "Skyline",
    script: "/app.js",
    head: NO_SCRIPT,
    body: `
    <header class="top">
      <h1>Skyline</h1>
      <p class="lede">Hold one tile. It rises a floor for every neighbour, and you lift theirs too. Stay away a day and it fades, open to someone new.</p>
      <p class="meta"><a href="/readme/">About</a></p>
    </header>
    <main>
      <form class="claim" method="post" action="/claim">
        <button type="submit" disabled hidden aria-hidden="true" tabindex="-1"></button>
        <div class="controls">
          <label for="label">Your name</label>
          <input id="label" name="label" maxlength="24" required autocomplete="nickname" value="${escapeHtml(myLabel)}">
          <p class="status" id="status">${escapeHtml(view.status)}</p>
          <div class="notices" data-notices>${notices}</div>
        </div>
        <ul class="legend" aria-label="Map key">
          ${LEGEND.map(([state, text]) => `<li><span class="swatch" data-swatch="${state}" aria-hidden="true"></span>${text}</li>`).join("\n          ")}
        </ul>
        <section class="play" aria-label="The board">
          <div class="hud">
            <p class="count"><span data-claimed>${view.claimed}</span> of ${view.tiles.length} tiles claimed</p>
            <p class="conn" data-conn="connecting">Connecting…</p>
            ${goalLine(view)}
          </div>
          <div class="stage" data-stage>
            <div class="board" role="group" aria-label="Board, ${N} by ${N}" aria-describedby="status" data-version="${version}">
          ${view.tiles.map((t) => tileButton(t, Object.hasOwn(view.landmarks.cells, String(t.id)) ? view.landmarks.cells[String(t.id)] : undefined, helps.has(t.id))).join("\n          ")}
            </div>
          </div>
        </section>
        <aside class="inspect" id="inspect" data-inspect hidden aria-label="Tile details">
          <h2 data-inspect-title></h2>
          <dl data-inspect-facts></dl>
        </aside>
        <div class="sr-only" aria-live="polite" data-announce></div>
      </form>
    </main>`,
  });
}
