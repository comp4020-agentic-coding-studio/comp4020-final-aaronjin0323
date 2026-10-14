import { type CityEvent, isActive, type Landmark, type Me, N, neighbourIds, type Tile, type Visit } from "./db.ts";
import { buildingName, HELP_GIFT, HELP_REWARD, LEASE_CAP_MS, LEVELS, rate, RENEWALS } from "./economy.ts";
import { escapeHtml, page } from "./html.ts";
// The page's own pure module (no DOM), so the goal line and the glowing
// tiles are worked out by one function whether the server or the page draws
// them. The expect-error: it's a plain browser module with no declarations.
// @ts-expect-error
import { dashParts, eventText, expiredText, goal, goalParts, leaseSoon, statusText, tileAria, tileWords, welcomeText } from "../public/diff.js";

// Notices are chosen from this fixed set by key; nothing from the query
// string is ever echoed into the page.
export const NOTICES = {
  claimed: "Land claimed! Your building is now generating income.",
  taken: "Someone got there first. Pick another tile.",
  label: "Names are 1 to 24 characters.",
  cell: "That tile doesn't exist.",
  // the economy's routes (docs/adr/0005), each answered by a key
  moved: "Moved. Your building, its level and its lease came with you.",
  renamed: "Renamed.",
  collected: "Collected your earnings.",
  "nothing-to-collect": "Nothing to collect yet.",
  upgraded: "Upgraded. Your building earns more now.",
  renewed: "Lease renewed.",
  helped: `You helped your neighbour: ${HELP_GIFT} coins to them, ${HELP_REWARD} to you.`,
  coins: "Not enough coins for that.",
  cooldown: "Not yet: that's still cooling down.",
  "max-level": `A ${LEVELS.at(-1)} is the top level.`,
  "max-lease": `A lease can't run past ${LEASE_CAP_MS / 3_600_000} hours from when you claimed the plot.`,
  "no-land": "Claim a plot first.",
  "not-neighbour": "You can only help a building right next to yours.",
  hours: `Renewals are ${RENEWALS.map((r) => r.hours).join(", ").replace(/, (\d+)$/, " or $1")} hours.`,
} as const;
export type Notice = keyof typeof NOTICES;

// Own keys only: `in` also finds what every object inherits, so
// ?notice=constructor would print a function's source as the notice.
export const isNotice = (s: string | null): s is Notice => s !== null && Object.hasOwn(NOTICES, s);

// Not in NOTICES, so no query string can show it: it only appears when the
// database says this visitor's lease ended since they were last here.
export const EXPIRED = "Your land lease has expired. Choose a new plot to continue building.";

export type TileState = "free" | "held" | "mine";

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
};

// Your own wallet (src/db.ts's Me), plus what this visit tells you once.
export type MeView = Me & { welcome?: number; expired?: true };

// The city log as the page shows it: no pid, ever.
export type EventView = { type: string; text: string; cellId: number | null; at: string };
export const EVENTS_SHOWN = 8;

// Every landmark the room has raised (docs/adr/0004): how many, and per cell
// the holder's label then and the nine who raised it. Labels only, never a
// pid. Keyed by cell id as a string, since it travels as JSON.
export type LandmarksView = { count: number; cells: Record<string, { label: string; raisers: string[] }> };

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
  for (const l of landmarks) cells[String(l.cellId)] = { label: l.label, raisers: l.raisers };
  return { count: landmarks.length, cells };
}

// Occupied neighbours of every plot (0 for a free one), counting only
// leases still running at `now`: an ended lease is free on read, whether or
// not a sweep has cleared it.
export function neighbourCounts(tiles: Tile[], now: Date): number[] {
  const active = tiles.map((t) => isActive(t, now));
  return tiles.map((t) => (active[t.id] ? neighbourIds(t.id).filter((n) => active[n]).length : 0));
}

// A building's height is its level plus its occupied neighbours (ADR 5); a
// free plot is 0. The same for every viewer, so all pages agree. Derived,
// never stored.
export function heights(tiles: Tile[], now: Date): number[] {
  const counts = neighbourCounts(tiles, now);
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
  }: { me?: Me | null; events?: CityEvent[]; visit?: Visit | null } = {},
): BoardView {
  const counts = neighbourCounts(tiles, now);
  const views = tiles.map((tile): TileView => {
    const where = place(tile.id).replace(/^r/, "R");
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
  };
  const once: { welcome?: number; expired?: true } = {};
  if (visit?.welcome) once.welcome = visit.welcome;
  if (visit?.expired) once.expired = true;

  return {
    tiles: views,
    claimed: views.filter((t) => t.state !== "free").length,
    status,
    landmarks: landmarksView(landmarks),
    events: events.slice(0, EVENTS_SHOWN).map((e) => ({ type: e.type, text: e.text, cellId: e.cellId, at: e.at })),
    me: { ...wallet, ...once },
  };
}

// --- the page's markup (owned with public/*: the board data above is the
// server's) ---

type LandmarkCell = { label: string; raisers: string[] };

// A plot's label for a screen reader: the same words app.js writes, so it
// can say a lease is ending soon without the server re-sending the board.
const ariaFor = (t: TileView, now: Date): string => tileWords(t, now) as string;

function tileButton(t: TileView, landmark: LandmarkCell | undefined, helps: boolean, now: Date): string {
  // A landmark ever raised on this cell: the label it was raised under, and
  // the nine raisers as a JSON array, so the page has them before the stream.
  // It wears a crown on its roof, and its label says who raised it.
  const crown = landmark
    ? ` data-landmark="${escapeHtml(landmark.label)}" data-landmark-raisers="${escapeHtml(JSON.stringify(landmark.raisers))}"`
    : "";
  // A free plot whose claim would bring a building closer to a landmark
  // glows (the same goal() the page recomputes on every board).
  const glow = helps ? " data-helps" : "";
  const style = t.hue === null ? `--h:${t.height}` : `--h:${t.height};--hue:${t.hue}`;
  const title = t.label === null ? "" : ` title="${escapeHtml(t.label)}"`;
  // The building's data, so the page has it before the stream connects;
  // data-level also picks the building type the stylesheet draws.
  const building =
    t.level === null
      ? ""
      : ` data-level="${t.level}" data-neighbours="${t.neighbours}" data-rate="${t.rate}"${t.leaseEndsAt ? ` data-lease-ends-at="${escapeHtml(t.leaseEndsAt)}"` : ""}`;
  const soon = leaseSoon(t, now) ? ` data-lease="soon"` : "";
  // .roof carries the building's roofline (a hip roof, a gable, a water
  // tank, a spire); .beacon floats over it: the player's pin on your own
  // plot, the ghost of a plot you're about to build on, the hourglass of a
  // lease ending. Which one shows is all in the stylesheet.
  const crownMark = landmark ? `<span class="crown" aria-hidden="true"></span>` : "";
  return `<button class="tile" name="cellId" value="${t.id}" data-state="${t.state}" data-height="${t.height}"${building}${soon}${crown}${glow} style="${style}" aria-label="${escapeHtml(tileAria(ariaFor(t, now), landmark ?? null))}"${title}><span class="sides" aria-hidden="true"></span><span class="roof" aria-hidden="true"><span class="gable"></span></span><span class="initials" aria-hidden="true">${escapeHtml(t.initials)}</span><span class="beacon" aria-hidden="true"></span>${crownMark}</button>`;
}

// JSON inside a <script> element: "<" is escaped so no string in it (a label
// in the city log) can close the element.
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// The goal line: landmarks raised, and the building closest to the next one.
// The name is its own element so a long one can be cut short on a phone
// without losing "6 of 8". app.js rewrites the same pieces on every board.
function goalLine(view: BoardView): string {
  const p = goalParts(goal(view)) as { count: string; noun: string; lead: string; who: string; tail: string; unit: string };
  return `<p class="landmarks" data-goal><span data-landmarks>${p.count}</span> <span data-goal-noun>${p.noun}</span><span class="goal-raised"> raised</span><span class="goal-sep" aria-hidden="true"> · </span><span class="goal-next"><span data-goal-lead>${escapeHtml(p.lead)}</span><span class="goal-who" data-goal-who>${escapeHtml(p.who)}</span><span data-goal-tail>${escapeHtml(p.tail)}</span><span class="goal-unit" data-goal-unit>${escapeHtml(p.unit)}</span></span></p>`;
}

// The map key: one sample roof per plot state, so the rules on the map can
// be read off the page before anyone plays.
const LEGEND: [string, string][] = [
  ["free", "Free plot"],
  ["held", "Someone's building"],
  ["mine", "Yours"],
  ["soon", "Lease ending within the hour"],
];

type Act = { ok: boolean; sub: string; why: string };
type Dash = {
  coins: string;
  building: string;
  rate: string;
  neighbours: string;
  pending: string;
  lease: string;
  leaseSoon: boolean;
  move: string;
  collect: Act;
  upgrade: Act;
  renew: Act;
  relocate: Act;
  renewOptions: { hours: number; cost: number; ok: boolean; why: string; label: string }[];
};

const off = (ok: boolean): string => (ok ? "" : " disabled");

// One action button: its name, and a short sub line under it (the cost, or
// why it's disabled, so a disabled button says why by words, not colour).
// The full reason is its description, also shown as text on wide screens.
function actButton(name: string, label: string, a: Act, attrs: string): string {
  return `<button class="act" data-act="${name}" ${attrs}${off(a.ok)} aria-describedby="why-${name}"><span class="act-name">${label}</span><span class="act-sub" data-act-sub="${name}">${escapeHtml(a.sub)}</span></button>`;
}

// Your city: the wallet and building at a glance, and the four actions.
// Every action is a submit button on the page's one form with its own
// `formaction`, so without script each is a plain POST to its route and a
// 303 back here; with script app.js sends the same POST with fetch.
// Relocating is choosing a free plot, which posts to /claim like any claim.
function dashboard(view: BoardView, myLabel: string, now: Date): string {
  const d = dashParts(view, now) as Dash;
  const fact = (term: string, key: string, value: string, extra = ""): string =>
    `<div class="fact"${extra}><dt>${term}</dt><dd data-dash-${key}>${escapeHtml(value)}</dd></div>`;
  const why = (name: string, a: Act): string =>
    `<p class="act-why" id="why-${name}" data-why="${name}"${name === "upgrade" ? " data-active" : ""}>${escapeHtml(a.why)}</p>`;
  const land = view.tiles.some((t) => t.state === "mine") ? " data-land" : "";
  return `<section class="dash" data-dash${land} aria-labelledby="dash-title">
          <div class="dash-head">
            <h2 class="dash-title" id="dash-title">Your city</h2>
            <p class="dash-coins"><span class="coin" aria-hidden="true"></span><span data-dash-coins>${d.coins}</span> <span class="dash-unit">coins</span></p>
          </div>
          <dl class="dash-stats">
            ${fact("Building", "building", d.building)}
            ${fact("Income", "rate", d.rate)}
            ${fact("Neighbours", "neighbours", d.neighbours)}
            ${fact("Uncollected", "pending", d.pending)}
            ${fact("Lease left", "lease", d.lease, d.leaseSoon ? ` data-lease="soon"` : "")}
            ${fact("Next move", "move", d.move)}
          </dl>
          <div class="dash-actions" data-actions>
            ${actButton("collect", "Collect", d.collect, `formaction="/collect" formnovalidate`)}
            ${actButton("upgrade", "Upgrade", d.upgrade, `formaction="/upgrade" formnovalidate`)}
            ${actButton("renew", "Renew", d.renew, `type="button" aria-expanded="false" aria-controls="renew-options"`)}
            ${actButton("relocate", "Relocate", d.relocate, `type="button" aria-pressed="false"`)}
          </div>
          <div class="act-whys">
            ${why("collect", d.collect)}${why("upgrade", d.upgrade)}${why("renew", d.renew)}${why("relocate", d.relocate)}
          </div>
          <fieldset class="renew-options" id="renew-options" data-renew>
            <legend>Renew your lease</legend>
            ${d.renewOptions.map((o) => `<div class="renew-option"><button class="act act-small" data-renew-hours="${o.hours}" formaction="/renew" formnovalidate name="hours" value="${o.hours}"${off(o.ok)}>${escapeHtml(o.label)}</button><span class="renew-why" data-renew-why="${o.hours}">${escapeHtml(o.why)}</span></div>`).join("\n            ")}
          </fieldset>
        </section>`;
}

// The city log, newest first: short, and below everything that matters more.
function cityLog(view: BoardView): string {
  const items = view.events.map((e) => `<li>${escapeHtml(eventText(e))}</li>`).join("");
  return `<section class="city-log" aria-labelledby="log-title">
          <h2 id="log-title">City activity</h2>
          <ol data-events>${items}</ol>
        </section>`;
}

// Only the script can make the connection line true, so without it the
// line isn't shown at all rather than saying "Connecting…" for ever. The
// Renew and Relocate toggles are the script's too: without it the renewal
// options are always open, and relocating is clicking a free plot.
const NO_SCRIPT = `<noscript><style>.conn, [data-act="renew"], [data-act="relocate"], #why-renew { display: none !important; }</style></noscript>`;

export function renderBoard(
  view: BoardView,
  myLabel: string,
  { notice = null, version = 0, now = new Date() }: { notice?: Notice | null; version?: number; now?: Date } = {},
): string {
  const welcome = welcomeText(view.me) as string | null;
  const expired = expiredText(view.me) as string | null;
  const notices = [
    expired ? `<p class="notice" data-notice="expired" role="status">${escapeHtml(expired)}</p>` : "",
    welcome ? `<p class="notice" data-notice="welcome" role="status">${escapeHtml(welcome)}</p>` : "",
    notice ? `<p class="notice" data-notice="${notice}" role="status">${escapeHtml(NOTICES[notice])}</p>` : "",
  ].join("");
  const helps = new Set<number>((goal(view) as { helps: number[] }).helps);
  const markOf = (id: number): LandmarkCell | undefined =>
    Object.hasOwn(view.landmarks.cells, String(id)) ? view.landmarks.cells[String(id)] : undefined;

  return page({
    title: "Skyline",
    script: "/app.js",
    head: NO_SCRIPT,
    body: `
    <header class="top">
      <h1>Skyline</h1>
      <p class="lede">Claim a plot and your building earns coins. Every neighbour adds a fifth to everyone's income. Leases run out, so upgrade, renew or move.</p>
      <p class="meta"><a href="/readme/">About</a></p>
    </header>
    <main>
      <form class="claim" method="post" action="/claim">
        <button type="submit" disabled hidden aria-hidden="true" tabindex="-1"></button>
        <div class="controls">
          <label for="label">Your name</label>
          <input id="label" name="label" maxlength="24" required autocomplete="nickname" value="${escapeHtml(myLabel)}">
          <p class="status" id="status">${escapeHtml(statusText(view) as string)}</p>
          <div class="notices" data-notices>${notices}</div>
        </div>
        ${dashboard(view, myLabel, now)}
        <section class="play" aria-label="The city map">
          <div class="hud">
            <p class="count"><span data-claimed>${view.claimed}</span> of ${view.tiles.length} plots built</p>
            <p class="conn" data-conn="connecting">Connecting…</p>
            ${goalLine(view)}
          </div>
          <div class="stage" data-stage>
            <div class="board" role="group" aria-label="City map, ${N} by ${N} plots" aria-describedby="status" data-version="${version}">
          ${view.tiles.map((t) => tileButton(t, markOf(t.id), helps.has(t.id), now)).join("\n          ")}
            </div>
          </div>
        </section>
        <aside class="inspect" id="inspect" data-inspect hidden aria-label="Plot details">
          <h2 data-inspect-title></h2>
          <dl data-inspect-facts></dl>
        </aside>
        <ul class="legend" aria-label="Map key">
          ${LEGEND.map(([state, text]) => `<li><span class="swatch" data-swatch="${state}" aria-hidden="true"></span>${text}</li>`).join("\n          ")}
        </ul>
        ${cityLog(view)}
        <div class="sr-only" aria-live="polite" data-announce></div>
        <script type="application/json" data-board-data>${jsonForScript({ me: view.me, events: view.events })}</script>
      </form>
    </main>`,
  });
}
