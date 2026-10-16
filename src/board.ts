import { type CityEvent, isActive, type Landmark, type Me, N, occupiedAround, type Park, parkActive, type Tile, type Visit } from "./db.ts";
import { buildingName, HELP_GIFT, HELP_REWARD, LEASE_CAP_MS, PARK_LIMIT, rate, RENEWALS, type Tier, tierRank } from "./economy.ts";
import { escapeHtml, page } from "./html.ts";
// The page's own pure module (no DOM), so the goal line and the glowing
// tiles are worked out by one function whether the server or the page draws
// them. The expect-error: it's a plain browser module with no declarations.
// @ts-expect-error
import { eventText, expiredText, goal, goalParts, goalShown, hudParts, leaseSoon, statusText, tileAria, tileWords, welcomeText } from "../public/diff.js";

// Notices are chosen from this fixed set by key; nothing from the query
// string is ever echoed into the page. One short line each (CLAUDE.md,
// "Show, don't tell"): a page loaded after a no-script post shows one.
export const NOTICES = {
  claimed: "Your building is up!",
  taken: "Someone got there first.",
  label: "Name: 1 to 24 characters.",
  cell: "No such plot.",
  // the economy's routes (docs/adr/0005), each answered by a key
  moved: "Moved!",
  renamed: "Renamed.",
  collected: "Collected!",
  "nothing-to-collect": "Nothing to collect yet.",
  upgraded: "Upgraded!",
  renewed: "Lease renewed!",
  helped: `Helped! +${HELP_GIFT} to them, +${HELP_REWARD} to you`,
  parked: "Park open!",
  "park-limit": `${PARK_LIMIT} parks at most.`,
  coins: "Not enough coins.",
  cooldown: "Not yet: cooling down.",
  "max-level": "Already a Skyscraper.",
  "max-lease": `Lease is at the ${LEASE_CAP_MS / 3_600_000} h limit.`,
  "no-land": "Pick a plot first.",
  "not-neighbour": "Only buildings next to yours.",
  hours: `Renew ${RENEWALS.map((r) => r.hours).join(", ").replace(/, (\d+)$/, " or $1")} h.`,
} as const;
export type Notice = keyof typeof NOTICES;

// Own keys only: `in` also finds what every object inherits, so
// ?notice=constructor would print a function's source as the notice.
export const isNotice = (s: string | null): s is Notice => s !== null && Object.hasOwn(NOTICES, s);

// Not in NOTICES, so no query string can show it: it only appears when the
// database says this visitor's lease ended since they were last here.
export const EXPIRED = "Your lease ended. Pick a new plot.";

// A park (docs/adr/0007) is its own state: nobody holds it, it has no
// building, and it lifts the buildings round it.
export type TileState = "free" | "held" | "mine" | "park";

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
  // The building (docs/adr/0005): its level (null when free), its occupied
  // neighbours, its income in hundredths of a coin a minute, and when its
  // lease ends (ISO, server time; a time, not a countdown, so the page counts
  // down without the server sending every second). Height is level plus
  // neighbours.
  level: number | null;
  neighbours: number;
  rate: number;
  leaseEndsAt: string | null;
  // A park only: when it ends, and whether it's yours (never who placed it
  // otherwise, beyond the label).
  endsAt?: string;
  mine?: boolean;
};

// Your own wallet (src/db.ts's Me), plus what this visit tells you once.
export type MeView = Me & { welcome?: number; expired?: true };

// The city log as the page shows it: no pid, ever.
export type EventView = { type: string; text: string; cellId: number | null; at: string };
export const EVENTS_SHOWN = 8;

// Every crown the room has raised (docs/adr/0004, 0006): how many cells
// wear one, and per cell its highest tier, with the holder's label and the
// raisers of that tier. Labels only, never a pid. Keyed by cell id as a
// string, since it travels as JSON.
export type LandmarksView = { count: number; cells: Record<string, { tier: Tier; label: string; raisers: string[] }> };

export type BoardView = {
  tiles: TileView[];
  claimed: number;
  status: string;
  landmarks: LandmarksView;
  events: EventView[];
  me: MeView;
};

export function landmarksView(landmarks: Landmark[]): LandmarksView {
  const cells: LandmarksView["cells"] = {};
  for (const l of landmarks) {
    const key = String(l.cellId);
    if (Object.hasOwn(cells, key) && tierRank(cells[key].tier) >= tierRank(l.tier)) continue;
    cells[key] = { tier: l.tier, label: l.label, raisers: l.raisers };
  }
  return { count: Object.keys(cells).length, cells };
}

// Occupied neighbours of every building (0 for a free plot or a park),
// counting only leases and parks still running at `now`: either ended is
// gone on read, whether or not a sweep has cleared it. A park counts for
// every building but its placer's own (docs/adr/0007).
export function neighbourCounts(tiles: Tile[], now: Date, parks: Park[] = []): number[] {
  const active = tiles.map((t) => isActive(t, now));
  const parkBy = new Map(parks.filter((p) => parkActive(p, now)).map((p) => [p.cellId, p.placedBy]));
  return tiles.map((t) =>
    active[t.id] ? occupiedAround(t.id, t.claimerId!, (n) => active[n], (n) => parkBy.get(n) ?? null).length : 0,
  );
}

// A building's height is its level plus its occupied neighbours (ADR 5); a
// free plot or a park is 0. The same for every viewer, so all pages agree.
// Derived, never stored.
export function heights(tiles: Tile[], now: Date, parks: Park[] = []): number[] {
  const counts = neighbourCounts(tiles, now, parks);
  return tiles.map((t) => (isActive(t, now) ? (t.level ?? 1) + counts[t.id] : 0));
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

// The board as one visitor sees it: their own building is "mine", anyone
// else's "held", and an ended lease is free. `me` is this visitor's wallet
// (only ever their own); `visit` the once-only notices, if this is the
// board a visit gets.
export function boardView(
  tiles: Tile[],
  pid: string,
  now: Date,
  landmarks: Landmark[] = [],
  {
    me = null,
    events = [],
    visit = null,
    parks = [],
  }: { me?: Me | null; events?: CityEvent[]; visit?: Visit | null; parks?: Park[] } = {},
): BoardView {
  const counts = neighbourCounts(tiles, now, parks);
  const parkAt = new Map(parks.filter((p) => parkActive(p, now)).map((p) => [p.cellId, p]));
  const views = tiles.map((tile): TileView => {
    const where = place(tile.id).replace(/^r/, "R");
    const park = isActive(tile, now) ? undefined : parkAt.get(tile.id);
    if (park) {
      const label = park.label ?? "";
      const yours = park.placedBy === pid;
      return {
        id: tile.id,
        state: "park",
        height: 0,
        hue: null,
        label,
        initials: "",
        aria: `${where}, ${yours ? "your park" : `park by ${label}`}`,
        level: null,
        neighbours: 0,
        rate: 0,
        leaseEndsAt: null,
        endsAt: park.endsAt,
        mine: yours,
      };
    }
    if (!isActive(tile, now)) {
      return {
        id: tile.id,
        state: "free",
        height: 0,
        hue: null,
        label: null,
        initials: "",
        aria: `${where}, free`,
        level: null,
        neighbours: 0,
        rate: 0,
        leaseEndsAt: null,
      };
    }
    const label = tile.label ?? "";
    const level = tile.level ?? 1;
    const n = counts[tile.id];
    const h = level + n;
    const state: TileState = tile.claimerId === pid ? "mine" : "held";
    const who = state === "mine" ? `your tile, ${label}` : `held by ${label}`;
    return {
      id: tile.id,
      state,
      height: h,
      hue: hue(tile.claimerId!),
      label,
      initials: initials(label),
      aria: `${where}, ${who}, ${buildingName(level)}, height ${h}`,
      level,
      neighbours: n,
      rate: rate(level, n),
      leaseEndsAt: tile.leaseEndsAt,
    };
  });

  const mine = views.find((t) => t.state === "mine");
  const status = mine
    ? `You hold ${place(mine.id)}: a ${buildingName(mine.level ?? 1)} at height ${mine.height}, earning ${mine.rate / 100} coins a minute.`
    : "You don't hold a plot yet. Type a name, then pick a free plot.";

  const wallet: MeView = me ?? {
    coins: 0,
    pending: 0,
    rate: 0,
    cellId: null,
    level: null,
    leaseEndsAt: null,
    ownedSince: null,
    relocateAt: null,
    helpAt: null,
    parks: 0,
    parkLimit: PARK_LIMIT,
  };
  const once: { welcome?: number; expired?: true } = {};
  if (visit?.welcome) once.welcome = visit.welcome;
  if (visit?.expired) once.expired = true;

  return {
    tiles: views,
    claimed: views.filter((t) => t.state === "held" || t.state === "mine").length,
    status,
    landmarks: landmarksView(landmarks),
    events: events.slice(0, EVENTS_SHOWN).map((e) => ({ type: e.type, text: e.text, cellId: e.cellId, at: e.at })),
    me: { ...wallet, ...once },
  };
}

// --- the page's markup (owned with public/*: the board data above is the
// server's) ---
//
// Show, don't tell (CLAUDE.md): the first screen is the logo, one line, the
// name field and the board. Everything else appears when it can be used
// (the wallet once you hold land, Collect once income waits, Upgrade once
// you can afford it, Renew once the lease is under 6 h), or sits behind a
// small icon button (the key, the city's activity, the camera, the keys).
// Hidden things use the `hidden` attribute, so the no-script page hides
// them too, and app.js shows each one as it becomes possible.

type LandmarkCell = { tier: Tier; label: string; raisers: string[] };

// A plot's label for a screen reader: the same words app.js writes, so it
// can say a lease is ending soon without the server re-sending the board.
const ariaFor = (t: TileView, now: Date): string => tileWords(t, now) as string;

const hiddenIf = (hide: boolean): string => (hide ? " hidden" : "");

function tileButton(t: TileView, landmark: LandmarkCell | undefined, helps: boolean, now: Date, leaseFrac: number | null): string {
  // A landmark ever raised on this cell: the label it was raised under, and
  // the nine raisers as a JSON array, so the page has them before the stream.
  // It wears a crown on its roof, and its label says who raised it.
  const crown = landmark
    ? ` data-landmark="${escapeHtml(landmark.label)}" data-tier="${landmark.tier}" data-landmark-raisers="${escapeHtml(JSON.stringify(landmark.raisers))}"`
    : "";
  // A free plot whose claim would bring a building closer to a landmark
  // glows (the same goal() the page recomputes on every board).
  const glow = helps ? " data-helps" : "";
  // Your own plot carries what's left of its lease (0 to 1), which the
  // stylesheet draws as a ring draining round the building's foot.
  const lease = leaseFrac === null ? "" : `;--lease:${leaseFrac.toFixed(3)}`;
  const style = t.hue === null ? `--h:${t.height}` : `--h:${t.height};--hue:${t.hue}${lease}`;
  const title = t.label === null ? "" : ` title="${escapeHtml(t.label)}"`;
  // A park: when it ends, and whether it's yours, so the page has both
  // before the stream connects.
  const park = t.state === "park" ? ` data-ends-at="${escapeHtml(t.endsAt ?? "")}"${t.mine ? " data-yours" : ""}` : "";
  // The building's data, so the page has it before the stream connects;
  // data-level also picks the building type the stylesheet draws.
  const building =
    t.level === null
      ? ""
      : ` data-level="${t.level}" data-neighbours="${t.neighbours}" data-rate="${t.rate}"${t.leaseEndsAt ? ` data-lease-ends-at="${escapeHtml(t.leaseEndsAt)}"` : ""}`;
  const soon = leaseSoon(t, now) ? ` data-lease="soon"` : "";
  // .roof carries the building's roofline; .beacon floats over it: your
  // marker, the ghost of a plot you're about to build on (with its income on
  // it), the hourglass of a lease ending. .ring is the lease ring, drawn only
  // round your own building.
  const crownMark = landmark ? `<span class="crown" aria-hidden="true"></span>` : "";
  return `<button class="tile" name="cellId" value="${t.id}" data-state="${t.state}" data-height="${t.height}"${building}${park}${soon}${crown}${glow} style="${style}" aria-label="${escapeHtml(tileAria(ariaFor(t, now), landmark ?? null))}"${title}><span class="sides" aria-hidden="true"></span><span class="ring" aria-hidden="true"></span><span class="roof" aria-hidden="true"><span class="gable"></span></span><span class="initials" aria-hidden="true">${escapeHtml(t.initials)}</span><span class="beacon" aria-hidden="true"></span>${crownMark}</button>`;
}

// JSON inside a <script> element: "<" is escaped so no string in it (a label
// in the city log) can close the element.
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// The goal line: landmarks raised, and the building closest to the next one.
// Shown only once a crown stands or a building is one short of its next
// tier (goalShown). The name is its own element so a long one can be cut
// short on a phone without losing "4 of 5 for silver". app.js rewrites the
// same pieces on every board.
function goalLine(view: BoardView): string {
  const g = goal(view);
  const p = goalParts(g) as { count: string; noun: string; lead: string; who: string; tail: string; unit: string; tier: string };
  return `<p class="landmarks" data-goal${hiddenIf(!goalShown(g))}><span class="crown-icon" aria-hidden="true"></span><span data-landmarks>${p.count}</span> <span data-goal-noun>${p.noun}</span><span class="goal-raised"> raised</span><span class="goal-sep" aria-hidden="true"> · </span><span class="goal-next"><span data-goal-lead>${escapeHtml(p.lead)}</span><span class="goal-who" data-goal-who>${escapeHtml(p.who)}</span><span data-goal-tail>${escapeHtml(p.tail)}</span><span class="goal-unit" data-goal-unit>${escapeHtml(p.unit)}</span><span data-goal-tier>${escapeHtml(p.tier)}</span></span></p>`;
}

// Small line icons, drawn in the page's ink. Each sits inside a control that
// carries its own words for a screen reader, so the drawing is aria-hidden.
const ICONS: Record<string, string> = {
  key: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7" fill="currentColor"/>`,
  log: `<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor"/>`,
  camera: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3v4.5h-4.5"/>`,
  keys: `<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>`,
  about: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>`,
};
export const icon = (name: string): string =>
  `<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// One tucked-away panel: a small icon button that opens it. A <details>, so
// it opens and closes without script too; app.js remembers which are open.
export function tool(name: string, label: string, body: string, extra = ""): string {
  return `<details class="tool" data-tool="${name}"${extra}><summary title="${label}">${icon(name === "board-keys" ? "keys" : name)}<span class="sr-only">${label}</span></summary><div class="tool-body">${body}</div></details>`;
}

// The map key: one sample roof per plot state.
const LEGEND: [string, string][] = [
  ["free", "Free plot"],
  ["held", "Someone's building"],
  ["mine", "Yours"],
  ["park", "Park: lifts the buildings round it"],
  ["soon", "Lease ending within the hour"],
];

type Hud = {
  coins: string;
  coinsSaid: string;
  rate: string;
  rateSaid: string;
  level: number;
  collect: { owed: number; text: string; said: string } | null;
  upgrade: { next: number; name: string; cost: number; said: string } | null;
  lease: { left: string; frac: number; soon: boolean; said: string };
  renew: { hours: number; cost: number; text: string; said: string }[];
};

// The wallet: a coin and your balance, your income, Collect when something
// waits, Upgrade when you can afford it, and a lease ring with Renew under
// 6 h. Rendered only while you hold land; each action is a submit button on
// the page's one form with its own `formaction`, so without script it's a
// plain POST and a 303 back here, and with script app.js sends it by fetch.
// Every option is rendered and the ones you can't use are `hidden`, so the
// page can show each the moment it becomes possible.
function wallet(view: BoardView, now: Date): string {
  const h = hudParts(view, now) as Hud | null;
  const d: Hud = h ?? {
    coins: String(view.me.coins),
    coinsSaid: `${view.me.coins} coins`,
    rate: "+0/min",
    rateSaid: "No income",
    level: 0,
    collect: null,
    upgrade: null,
    lease: { left: "", frac: 0, soon: false, said: "" },
    renew: [],
  };
  const renewable = new Set(d.renew.map((r) => r.hours));
  const renew = RENEWALS.map(
    (r) =>
      `<button class="act act-renew" data-renew-hours="${r.hours}" formaction="/renew" formnovalidate name="hours" value="${r.hours}" aria-label="Renew lease ${r.hours} hours for ${r.cost} coins"${hiddenIf(!renewable.has(r.hours))}><span class="act-name">+${r.hours} h</span><span class="act-cost"><span class="coin" aria-hidden="true"></span>${r.cost}</span></button>`,
  ).join("");
  const up = d.upgrade;
  return `<section class="wallet" data-wallet aria-label="Your city"${hiddenIf(h === null)}>
          <p class="purse" title="Coins"><span class="coin coin-big" data-coin aria-hidden="true"></span><span data-hud-coins aria-hidden="true">${d.coins}</span><span class="sr-only" data-hud-coins-said>${escapeHtml(d.coinsSaid)}</span></p>
          <p class="income" title="Income"><span data-hud-rate aria-hidden="true">${escapeHtml(d.rate)}</span><span class="sr-only" data-hud-rate-said>${escapeHtml(d.rateSaid)}</span></p>
          <span class="lease-ring" data-hud-lease role="img" aria-label="${escapeHtml(d.lease.said)}" title="${escapeHtml(d.lease.said)}" style="--lease:${d.lease.frac.toFixed(3)}"${d.lease.soon ? ` data-lease="soon"` : ""}></span>
          <div class="acts">
            <button class="act act-collect" data-act="collect" formaction="/collect" formnovalidate aria-label="${escapeHtml(d.collect?.said ?? "Collect")}"${hiddenIf(!d.collect)}><span class="act-name">Collect</span><span class="act-cost" data-hud-owed>${escapeHtml(d.collect?.text ?? "")}</span></button>
            <button class="act act-upgrade" data-act="upgrade" formaction="/upgrade" formnovalidate aria-label="${escapeHtml(up?.said ?? "Upgrade")}"${hiddenIf(!up)}><span class="act-up" aria-hidden="true"></span><span class="act-name" data-hud-next>${escapeHtml(up?.name ?? "")}</span><span class="act-cost"><span class="coin" aria-hidden="true"></span><span data-hud-cost>${up?.cost ?? ""}</span></span></button>
            ${renew}
          </div>
        </section>`;
}

// The city log, newest first, behind its icon.
function cityLog(view: BoardView): string {
  const items = view.events.map((e) => `<li>${escapeHtml(eventText(e))}</li>`).join("");
  return `<p class="count"><span data-claimed>${view.claimed}</span> of ${view.tiles.length} plots built</p><ol class="city-log" data-events>${items}</ol>`;
}

// Only the script can make the connection line true, so without it the
// line isn't shown at all rather than saying "Connecting…" for ever.
const NO_SCRIPT = `<noscript><style>.conn { display: none !important; }</style></noscript>`;

export function renderBoard(
  view: BoardView,
  myLabel: string,
  { notice = null, version = 0, now = new Date() }: { notice?: Notice | null; version?: number; now?: Date } = {},
): string {
  const welcome = welcomeText(view.me) as string | null;
  const expired = expiredText(view.me) as string | null;
  // One line at a time: the most recent thing that happened wins.
  const line: [string, string] | null = notice ? [notice, NOTICES[notice]] : expired ? ["expired", expired] : welcome ? ["welcome", welcome] : null;
  const notices = line ? `<p class="notice" data-notice="${line[0]}" role="status">${escapeHtml(line[1])}</p>` : "";
  const helps = new Set<number>((goal(view) as { helps: number[] }).helps);
  const markOf = (id: number): LandmarkCell | undefined =>
    Object.hasOwn(view.landmarks.cells, String(id)) ? view.landmarks.cells[String(id)] : undefined;
  const hud = hudParts(view, now) as Hud | null;
  const land = hud !== null;

  return page({
    title: "Skyline",
    script: "/app.js",
    head: NO_SCRIPT,
    body: `
    <header class="top">
      <h1>Skyline</h1>
      <p class="lede">Build next to people. Earn more together.</p>
      <a class="about" href="/readme/" title="About Skyline">${icon("about")}<span class="sr-only">About Skyline</span></a>
    </header>
    <main>
      <form class="claim" method="post" action="/claim"${land ? " data-land" : ""}>
        <button type="submit" disabled hidden aria-hidden="true" tabindex="-1"></button>
        <div class="controls">
          <label class="sr-only" for="label">Your name</label>
          <input id="label" name="label" maxlength="24" required autocomplete="nickname" placeholder="Your name" value="${escapeHtml(myLabel)}">
          <p class="sr-only" id="status">${escapeHtml(statusText(view) as string)}</p>
        </div>
        ${wallet(view, now)}
        <section class="play" aria-label="The city map">
          <div class="hud">
            ${goalLine(view)}
            <p class="conn" data-conn="connecting"><span class="conn-text">Connecting…</span></p>
            <div class="tools" data-tools>
              ${tool("key", "Map key", `<ul class="legend" aria-label="Map key">${LEGEND.map(([state, text]) => `<li><span class="swatch" data-swatch="${state}" aria-hidden="true"></span>${text}</li>`).join("")}</ul>`)}
              ${tool("log", "City activity", cityLog(view))}
              ${tool("camera", "Camera", `<div class="camera" role="group" aria-label="Camera" data-camera></div>`, " hidden")}
              ${tool("board-keys", "Keyboard keys", `<p class="keys-hint" id="board-keys">Arrows or WASD move · Enter builds · Q/E turn · drag to turn</p>`, " hidden")}
            </div>
          </div>
          <div class="notices" data-notices>${notices}</div>
          <div class="stage" data-stage>
            <div class="board" role="group" aria-label="City map, ${N} by ${N} plots" aria-describedby="status" data-version="${version}"${land ? "" : " data-invite"}>
          ${view.tiles.map((t) => tileButton(t, markOf(t.id), helps.has(t.id), now, t.state === "mine" && hud ? hud.lease.frac : null)).join("\n          ")}
            </div>
          </div>
        </section>
        <aside class="inspect" id="inspect" data-inspect hidden aria-label="Plot details">
          <h2 data-inspect-title></h2>
          <dl data-inspect-facts></dl>
        </aside>
        <div class="sr-only" aria-live="polite" data-announce></div>
        <script type="application/json" data-board-data>${jsonForScript({ me: view.me, events: view.events })}</script>
      </form>
    </main>`,
  });
}
