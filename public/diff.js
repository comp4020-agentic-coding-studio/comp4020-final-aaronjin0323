// The page's pure module: what changed between two boards, what an action
// would do, and the words for both. No DOM and no network: app.js feeds it
// boards (each the whole city as this visitor sees it) and acts on the
// result, src/board.ts renders with the same functions, and
// spec/diff.test.ts tests it directly.
//
// A board is { tiles, me, landmarks, events, version }. Each tile is
// { id, state: "free" | "held" | "mine", label, hue, level, neighbours,
// height, rate, leaseEndsAt } (docs/adr/0005). Holders are never named by id,
// so "the same holder" means the same hue and label. `me` is this visitor's
// own wallet: { coins, pending, rate, cellId, level, leaseEndsAt, ownedSince,
// relocateAt, helpAt, welcome?, expired? }. Money is in coins, except
// `pending` and every `rate`, which are hundredths of a coin (a minute).

const N = 12;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// The game's numbers, as src/economy.ts holds them. A browser module can't
// import a .ts file, so they're mirrored here once, and spec/diff.test.ts
// fails if the two ever differ.
export const ECONOMY = Object.freeze({
  startingCoins: 100,
  baseIncome: 10, // coins a minute, level 1, no neighbours
  neighbourBonus: 0.2, // +20% per occupied neighbour
  capHours: 4, // uncollected income stops piling up after this long
  levels: Object.freeze(["Small House", "Townhouse", "Apartment", "Office Building", "Skyscraper"]),
  upgradeCosts: Object.freeze([150, 400, 900, 1800]), // to level 2, 3, 4, 5
  relocateCost: 50,
  relocateCooldownMinutes: 30,
  leaseHours: 24,
  renewals: Object.freeze([
    Object.freeze({ hours: 6, cost: 100 }),
    Object.freeze({ hours: 12, cost: 180 }),
    Object.freeze({ hours: 24, cost: 300 }),
  ]),
  leaseCapHours: 48, // a lease never runs past this long from the claim
  helpGift: 50, // to the neighbour helped
  helpReward: 20, // to the helper
  helpCooldownMinutes: 60,
});
export const MAX_LEVEL = ECONOMY.levels.length;
export const SOON_MS = HOUR; // a lease ending within this is shown as ending

export function neighbours(id) {
  const row = Math.floor(id / N);
  const col = id % N;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if ((dr || dc) && r >= 0 && r < N && c >= 0 && c < N) out.push(r * N + c);
    }
  }
  return out;
}

const claimed = (t) => t !== undefined && t !== null && t.state !== "free";
const sameHolder = (a, b) => claimed(a) && claimed(b) && a.hue === b.hue && a.label === b.label;
export const place = (id) => `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;
const levelOf = (t) => (Number.isInteger(t?.level) && t.level >= 1 ? t.level : 1);
// The board says how many neighbours each tile has; worked out from the
// tiles for a board that doesn't.
const neighboursOf = (board, t) =>
  Number.isInteger(t.neighbours) ? t.neighbours : neighbours(t.id).filter((n) => claimed(board.tiles[n])).length;
const mineOf = (board) => board.tiles.find((t) => t.state === "mine") ?? null;
const meOf = (board) => board.me ?? null;

// --- money ---

export const buildingName = (level) => ECONOMY.levels[Math.min(Math.max(level, 1), MAX_LEVEL) - 1];

// Hundredths of a coin a minute: 10 × level × (1 + 0.2 × neighbours) coins.
export const rateOf = (level, n) => Math.round(level * ECONOMY.baseIncome * 100 * (1 + ECONOMY.neighbourBonus * n));

// "16", "14.4": a rate (hundredths a minute) as coins a minute.
export function perMinute(cents) {
  const coins = cents / 100;
  return Number.isInteger(coins) ? String(coins) : coins.toFixed(1).replace(/\.0$/, "");
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "23 h 12 m", "12 m", "under a minute"; "ended" once past; null for no time.
export function timeLeft(iso, now) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MINUTE);
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m`;
  return "under a minute";
}
const msUntil = (iso, now) => {
  const ms = iso ? new Date(iso).getTime() - now.getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

// A lease ending within the hour: shown on the tile and in the inspector.
export const leaseSoon = (t, now) => {
  if (!claimed(t) || !t.leaseEndsAt) return false;
  const ms = msUntil(t.leaseEndsAt, now);
  return ms > 0 && ms < SOON_MS;
};

// Uncollected income as of `now`, counted up from what the server said at
// `since`, for display only: the server settles the real number. It stops at
// the lease end and at 4 hours' worth, as the server's does.
export function pendingNow(me, since, now) {
  if (!me) return 0;
  const pending = Number(me.pending) || 0;
  const rate = Number(me.rate) || 0;
  if (rate <= 0) return pending;
  const end = me.leaseEndsAt ? Math.min(now.getTime(), new Date(me.leaseEndsAt).getTime()) : now.getTime();
  const minutes = Math.max(0, end - since.getTime()) / MINUTE;
  const cap = Math.max(pending, rate * ECONOMY.capHours * 60);
  return Math.min(cap, pending + rate * minutes);
}

// Whole coins a collect would pay.
export const collectable = (cents) => Math.floor(cents / 100);

// --- what each action would do, and why it can't ---

// The Upgrade button: from what level to what, its cost, income before and
// after, and the one reason it's refused, in words, when it is.
export function upgradeInfo(board, { busy = false } = {}) {
  const mine = mineOf(board);
  const coins = meOf(board)?.coins ?? 0;
  if (!mine) return { ok: false, reason: "no-land", why: "Claim a plot first, then upgrade its building." };
  const level = levelOf(mine);
  const n = neighboursOf(board, mine);
  const base = { level, name: buildingName(level), rate: rateOf(level, n) };
  if (level >= MAX_LEVEL) return { ...base, ok: false, reason: "max-level", why: "A Skyscraper is the top level." };
  const next = level + 1;
  const cost = ECONOMY.upgradeCosts[level - 1];
  const info = { ...base, next, nextName: buildingName(next), cost, nextRate: rateOf(next, n) };
  if (busy) return { ...info, ok: false, reason: "busy", why: "Upgrading…" };
  if (coins < cost) return { ...info, ok: false, reason: "coins", why: `You need ${cost - coins} more coins.` };
  return { ...info, ok: true, reason: null, why: "" };
}

// The renewal options: each one's cost, and whether it would take the lease
// past 48 hours from the claim, or cost more than you have.
export function renewOptions(board, now) {
  const mine = mineOf(board);
  const me = meOf(board);
  const coins = me?.coins ?? 0;
  const ends = new Date(me?.leaseEndsAt ?? mine?.leaseEndsAt ?? now).getTime();
  const since = me?.ownedSince ? new Date(me.ownedSince).getTime() : NaN;
  const cap = since + ECONOMY.leaseCapHours * HOUR;
  return ECONOMY.renewals.map(({ hours, cost }) => {
    const option = { hours, cost };
    if (!mine) return { ...option, ok: false, reason: "no-land", why: "Claim a plot first." };
    if (Number.isFinite(cap) && ends + hours * HOUR > cap) {
      return { ...option, ok: false, reason: "max-lease", why: `Past the ${ECONOMY.leaseCapHours} h limit` };
    }
    if (coins < cost) return { ...option, ok: false, reason: "coins", why: `Need ${cost - coins} more` };
    return { ...option, ok: true, reason: null, why: "" };
  });
}

// Moving your building to free plot `id`: where from and to, its cost, your
// income before and after, the lease you keep, and the reason it's refused.
// Null unless you hold land and the plot is free.
export function relocateInfo(board, id, now) {
  const mine = mineOf(board);
  const t = board.tiles[id];
  if (!mine || !t || t.state !== "free") return null;
  const me = meOf(board);
  const p = preview(board, id);
  const wait = msUntil(me?.relocateAt, now);
  const coins = me?.coins ?? 0;
  const cost = ECONOMY.relocateCost;
  const info = {
    from: mine.id,
    to: id,
    cost,
    rate: rateOf(levelOf(mine), neighboursOf(board, mine)),
    nextRate: p.rate,
    neighbours: p.neighbours,
    lease: timeLeft(me?.leaseEndsAt ?? mine.leaseEndsAt, now),
  };
  if (wait > 0) return { ...info, ok: false, reason: "cooldown", why: `You can move again in ${timeLeft(me.relocateAt, now)}.` };
  if (coins < cost) return { ...info, ok: false, reason: "coins", why: `Moving costs ${cost} coins; you need ${cost - coins} more.` };
  return { ...info, ok: true, reason: null, why: "" };
}

// "Move from row 4, column 5 to row 7, column 2 for 50 coins. Income 14 →
// 18 coins/min. Your lease keeps its 5 h 12 m."
export function relocateText(r) {
  const lease = r.lease && r.lease !== "ended" ? ` Lease left: ${r.lease}.` : "";
  return `Move from ${place(r.from)} to ${place(r.to)} for ${r.cost} coins. Income ${perMinute(r.rate)} → ${perMinute(r.nextRate)} coins/min.${lease}`;
}

// Whether I can help the building on tile `id`: it's someone else's, right
// beside mine. `ok` is false while my hourly help is cooling down. The server
// checks the same (docs/adr/0005); this decides what the page offers.
export function canHelp(board, id, now) {
  const mine = mineOf(board);
  const t = board.tiles[id];
  if (!mine || !t || t.state !== "held" || !neighbours(mine.id).includes(id)) return null;
  const helpAt = meOf(board)?.helpAt ?? null;
  const wait = msUntil(helpAt, now);
  return { id, label: t.label, ok: wait <= 0, wait: wait > 0 ? timeLeft(helpAt, now) : null };
}

// --- the placement preview ---

// What claiming (or moving to) free plot `id` would do, worked out from the
// board as shown: every building's neighbours, height (level + neighbours)
// and income afterwards; yours there; and whose income rises or falls. Null
// for a plot you can't build on. Moving keeps your level and frees your old
// plot. Never touches the board it's given; spec/diff.test.ts holds it equal
// to the server's rule on random boards.
export function preview(board, id) {
  const t = board.tiles[id];
  if (!t || t.state !== "free") return null;
  const mine = mineOf(board);
  const level = mine ? levelOf(mine) : 1;
  const occupied = board.tiles.map((x) => x.id === id || (claimed(x) && x !== mine));
  const counts = board.tiles.map((x) => (occupied[x.id] ? neighbours(x.id).filter((n) => occupied[n]).length : 0));
  const levels = board.tiles.map((x) => (x.id === id ? level : occupied[x.id] ? levelOf(x) : 0));
  const heights = board.tiles.map((x) => (occupied[x.id] ? levels[x.id] + counts[x.id] : 0));
  const rates = board.tiles.map((x) => (occupied[x.id] ? rateOf(levels[x.id], counts[x.id]) : 0));
  const lifted = [];
  const dropped = [];
  for (const x of board.tiles) {
    if (x.id === id || !claimed(x) || x === mine) continue;
    const delta = counts[x.id] - neighboursOf(board, x);
    if (delta > 0) lifted.push(x.id);
    else if (delta < 0) dropped.push(x.id);
  }
  return {
    id,
    level,
    neighbours: counts[id],
    height: heights[id],
    rate: rates[id],
    counts,
    heights,
    rates,
    lifted,
    dropped,
    from: mine ? mine.id : null,
  };
}

// "Mia", "Mia and Kai", "Mia, Kai and Zoe", "Mia, Kai and 2 others"
function names(list) {
  if (list.length <= 2) return list.join(" and ");
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}

// "Earns 14 coins/min here, with 2 neighbours. Raises Mia's and Kai's income."
function effect(board, p) {
  let text = `Earns ${perMinute(p.rate)} coins/min here, with ${plural(p.neighbours, "neighbour")}.`;
  if (p.lifted.length) text += ` Raises ${names(p.lifted.map((i) => board.tiles[i].label))}'s income.`;
  if (p.dropped.length) text += ` ${names(p.dropped.map((i) => board.tiles[i].label))} would earn less.`;
  return text;
}

// --- narration: what changed, said only about your own building ---

export const CLAIMED_TEXT = "Land claimed! Your building is now generating income.";
export const EXPIRED_TEXT = "Your land lease has expired. Choose a new plot to continue building.";

export function welcomeText(me) {
  const w = me?.welcome;
  if (w === undefined || w === null || w === false) return null;
  const coins = typeof w === "number" ? w : typeof w === "object" ? Number(w.coins ?? collectable(w.cents ?? 0)) : NaN;
  if (!Number.isFinite(coins)) return null;
  return `Welcome back! Your building earned ${coins} coins while you were away.`;
}
export const expiredText = (me) => (me?.expired ? EXPIRED_TEXT : null);

export function diffBoards(prev, next) {
  // Buildings whose height changed while keeping the same holder: everyone
  // sees these float a +1 or −1. A plot that changed hands is an arrival.
  const rises = [];
  for (const t of next.tiles) {
    const before = prev.tiles[t.id];
    if (before && sameHolder(before, t) && before.height !== t.height) {
      rises.push({ id: t.id, delta: t.height - before.height });
    }
  }

  const prevMine = mineOf(prev);
  const nextMine = mineOf(next);
  const messages = [];

  if (nextMine && (!prevMine || prevMine.id !== nextMine.id)) {
    // I just claimed, or moved: whose income my arrival raised and my
    // leaving lowered (a neighbour of both plots is neither).
    const counted = (b, t) => neighboursOf(b, t);
    const raised = neighbours(nextMine.id)
      .filter((id) => sameHolder(prev.tiles[id], next.tiles[id]) && counted(next, next.tiles[id]) > counted(prev, prev.tiles[id]))
      .map((id) => next.tiles[id].label);
    let text = prevMine
      ? `Moved to ${place(nextMine.id)}. Your income is now ${perMinute(nextMine.rate ?? rateOf(levelOf(nextMine), counted(next, nextMine)))} coins/min.`
      : CLAIMED_TEXT;
    if (raised.length) text += ` ${names(raised)} now earn${raised.length === 1 ? "s" : ""} more.`;
    messages.push({ key: "claimed", text });
  } else if (prevMine && !nextMine) {
    messages.push({ key: "expired", text: EXPIRED_TEXT });
  } else if (nextMine && prevMine) {
    // I stayed put: who built beside me, who left, and what it did to me.
    // Someone gone from beside me who still holds land elsewhere relocated;
    // otherwise their lease ended.
    const arrived = [];
    let relocated = 0;
    let ended = 0;
    for (const id of neighbours(nextMine.id)) {
      const before = prev.tiles[id];
      const after = next.tiles[id];
      if (claimed(after) && !sameHolder(before, after)) arrived.push(after.label);
      if (claimed(before) && !sameHolder(before, after)) {
        if (next.tiles.some((t) => sameHolder(before, t))) relocated++;
        else ended++;
      }
    }
    const nBefore = neighboursOf(prev, prevMine);
    const nAfter = neighboursOf(next, nextMine);
    if (arrived.length || relocated || ended) {
      const said = [];
      if (arrived.length) said.push(`${names(arrived)} built next to you.`);
      if (relocated) said.push(relocated === 1 ? "Your neighbour relocated." : `${relocated} neighbours relocated.`);
      if (ended) said.push(ended === 1 ? "Your neighbour's lease ended." : `${ended} neighbours' leases ended.`);
      if (nAfter > nBefore) said.push("Your income increased!");
      else if (nAfter < nBefore) said.push("Your income has changed.");
      if (nAfter !== nBefore) said.push(`Your building now has ${plural(nAfter, "neighbour")}.`);
      messages.push({ key: arrived.length && !relocated && !ended ? "arrived" : "left", text: said.join(" ") });
    }
  }

  return { rises, messages };
}

// Plots someone else just built on: became claimed, or changed hands, and
// aren't mine. The page marks these briefly.
export function arrivals(prev, next) {
  return next.tiles
    .filter((t) => claimed(t) && t.state !== "mine" && !sameHolder(prev.tiles[t.id] ?? { state: "free" }, t))
    .map((t) => t.id);
}

// Buildings that went up a level while keeping their holder: the page plays
// the construction once on each.
export function upgrades(prev, next) {
  return next.tiles
    .filter((t) => sameHolder(prev.tiles[t.id], t) && levelOf(t) > levelOf(prev.tiles[t.id]))
    .map((t) => t.id);
}

// Whether to show a board that just arrived. Boards carry a version that only
// rises within one server process, so an older or repeated one is dropped.
// The exception is the first board on a reopened stream (`streamVersion` is
// then the last version that stream delivered before it dropped, else null):
// a lower one means a new server process, whose versions start again from its
// own clock, and refusing it would freeze the page. A first board merely
// older than an action's own response is still dropped.
export function accepts(shownVersion, nextVersion, streamVersion = null) {
  if (nextVersion > shownVersion) return true;
  return streamVersion !== null && nextVersion < streamVersion;
}

// --- the room's goal: landmarks (docs/adr/0004, amended by 0005) ---
// A building becomes a landmark when all 8 of its neighbours are occupied.
// The board carries `landmarks: { count, cells: { [cellId]: { label,
// raisers } } }`; a board without it counts as none raised.

export const LANDMARK_AT = 8;

const landmarksOf = (board) => board.landmarks ?? { count: 0, cells: {} };
export const landmarkAt = (board, id) => {
  const cells = landmarksOf(board).cells ?? {};
  return Object.hasOwn(cells, String(id)) ? cells[String(id)] : null;
};
// An edge plot has at most 5 neighbours, so it can never be one.
const interior = (id) => {
  const r = Math.floor(id / N);
  const c = id % N;
  return r > 0 && r < N - 1 && c > 0 && c < N - 1;
};
const contender = (board, t) => claimed(t) && interior(t.id) && !landmarkAt(board, t.id);
const buildingOf = (t) => (t.state === "mine" ? "your building" : `${t.label}'s building`);

// Every name, for the one message that names all nine raisers.
export function allNames(list) {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// What building on `id` would do for the goal: the building it brings
// closest to 8 neighbours (most neighbours after, ties to the lower cell id),
// or that settling there completes a landmark of your own. Null if it moves
// no contender closer: moving between two gaps round one building helps it
// not at all.
export function helpsWith(board, id) {
  const p = preview(board, id);
  if (!p) return null;
  if (p.neighbours >= LANDMARK_AT && interior(id) && !landmarkAt(board, id)) {
    return { id, label: null, neighbours: p.neighbours, landmark: true, name: "your building" };
  }
  let best = null;
  for (const x of board.tiles) {
    if (x.id === id || !contender(board, x)) continue;
    const after = p.counts[x.id];
    if (after <= neighboursOf(board, x)) continue;
    if (!best || after > best.neighbours) best = { id: x.id, label: x.label, neighbours: after, landmark: after >= LANDMARK_AT, name: buildingOf(x) };
  }
  return best;
}

// "brings Mia's building to 7 of 8 neighbours", "completes a landmark!"
export function helpText(h) {
  if (!h) return null;
  return h.landmark ? "completes a landmark!" : `brings ${h.name} to ${h.neighbours} of ${LANDMARK_AT} neighbours`;
}

// The goal line and the glowing plots. `closest` is the contender with the
// most occupied neighbours (ties to the lower cell id), or null when none has
// any. `helps` are the free plots whose claim would bring a building to at
// least that many (or complete a landmark): the gaps round the front-runners,
// not every plot beside anyone. With no neighbours anywhere, any plot beside
// someone helps, which is how a block starts.
export function goal(board) {
  const count = landmarksOf(board).count ?? 0;
  let top = null;
  let topN = -1;
  for (const t of board.tiles) {
    if (!contender(board, t)) continue;
    const n = neighboursOf(board, t);
    if (n > topN) {
      top = t;
      topN = n;
    }
  }
  const closest = top && topN > 0 ? { id: top.id, label: top.label, neighbours: topN, mine: top.state === "mine", name: buildingOf(top) } : null;
  const peak = top ? topN : Infinity;
  const helps = [];
  for (const t of board.tiles) {
    const h = helpsWith(board, t.id);
    if (h && (h.landmark || h.neighbours >= peak)) helps.push(t.id);
  }
  return { count, closest, helps };
}

// The goal line's words, in pieces so a long name can be cut short on a
// phone without losing "6 of 8 neighbours". src/board.ts renders the same
// line. "1 landmark raised · Closest: Mia's building, 6 of 8 neighbours".
export function goalParts(g) {
  const noun = g.count === 1 ? "landmark" : "landmarks";
  if (!g.closest) return { count: String(g.count), noun, lead: "Start one: build beside someone", who: "", tail: "", unit: "" };
  const tail = `${g.closest.mine ? " building" : "'s building"}, ${g.closest.neighbours} of ${LANDMARK_AT}`;
  // " neighbours" is its own piece, so a phone can tuck it away first
  return { count: String(g.count), noun, lead: "Closest: ", who: g.closest.mine ? "your" : g.closest.label, tail, unit: " neighbours" };
}

// A tile's aria-label: its words, plus the landmark ever raised on that
// cell. src/board.ts renders it the same way.
export const tileAria = (aria, mark) => (mark ? `${aria}. Landmark raised by ${allNames(mark.raisers)}` : aria);

// The one message every page shows when a landmark is raised, naming all nine.
export function raisedText(raised) {
  return `Landmark raised at ${place(raised.cellId)} by ${allNames(raised.raisers)}!`;
}

// --- the city log ---

// One public event as a short line. Events carry a type, the names involved
// and a plot, never a pid; a server-written `text` wins over these words.
export function eventText(e) {
  if (!e || typeof e !== "object") return "";
  if (typeof e.text === "string" && e.text) return e.text;
  const who = e.label ?? e.who ?? "Someone";
  const cell = Number.isInteger(e.cellId) ? e.cellId : Number.isInteger(e.cell) ? e.cell : null;
  const where = cell === null ? "" : ` at ${place(cell)}`;
  const to = e.target ?? e.to ?? e.other ?? "a neighbour";
  switch (e.type) {
    case "claim":
      return `${who} built a Small House${where}`;
    case "upgrade":
      return `${who} upgraded to ${Number.isInteger(e.level) ? buildingName(e.level) : "a bigger building"}${where}`;
    case "relocate":
    case "move":
      return `${who} moved to ${cell === null ? "a new plot" : place(cell)}`;
    case "renew":
      return `${who} renewed their lease${Number.isInteger(e.hours) ? ` by ${e.hours} h` : ""}`;
    case "expire":
    case "expired":
      return `${who}'s lease ended${where}`;
    case "help":
      return `${who} helped ${to}`;
    case "landmark":
      return `Landmark raised${where}`;
    default:
      return `${who}${where}`;
  }
}

// --- what the page says about a plot and about you ---

export const initialsOf = (label) => Array.from(String(label ?? "").trim()).slice(0, 2).join("");

// A plot's aria-label, from the tile alone (the board sends no words).
export function tileWords(t, now = new Date()) {
  const where = place(t.id).replace(/^r/, "R");
  if (t.state === "free") return `${where}, free plot`;
  const kind = buildingName(levelOf(t));
  const who = t.state === "mine" ? `your ${kind}, ${t.label}` : `${t.label}'s ${kind}`;
  const soon = leaseSoon(t, now) ? ", lease ending soon" : "";
  return `${where}, ${who}, height ${t.height}${soon}`;
}

// The status line under the name.
export function statusText(board) {
  const mine = mineOf(board);
  if (!mine) return "You have no land. Type a name, then pick a free plot to build on.";
  return `You own a ${buildingName(levelOf(mine))} at ${place(mine.id)}. Pick a free plot to move there.`;
}

// Every slot of the dashboard as text, so src/board.ts (no script) and
// app.js (live) say the same words. `pending` is the uncollected income to
// show, in hundredths, already counted up to `now`. Each action has a main
// line, a short sub line (on a phone it's the only detail under the thumb)
// and `why`: the reason it's disabled, or what it would do.
export function dashParts(board, now, pending = meOf(board)?.pending ?? 0, { busy = null } = {}) {
  const mine = mineOf(board);
  const me = meOf(board);
  const coins = me?.coins ?? 0;
  const owed = collectable(pending);
  const n = mine ? neighboursOf(board, mine) : 0;
  const rate = mine ? (Number.isFinite(mine.rate) ? mine.rate : rateOf(levelOf(mine), n)) : 0;
  const leaseIso = me?.leaseEndsAt ?? mine?.leaseEndsAt ?? null;
  const lease = mine ? timeLeft(leaseIso, now) : null;
  const wait = msUntil(me?.relocateAt, now);
  const up = upgradeInfo(board, { busy: busy === "upgrade" });
  const renew = renewOptions(board, now).map((o) => ({ ...o, label: `+${o.hours} h · ${o.cost} coins` }));

  const collect =
    busy === "collect"
      ? { ok: false, sub: "…", why: "Collecting…" }
      : owed >= 1
        ? { ok: true, sub: `+${owed}`, why: `Adds ${owed} coins to your ${coins}.` }
        : { ok: false, sub: "none yet", why: mine ? "Nothing to collect yet: income arrives every minute." : "Claim a plot to start earning." };

  const upgrade = up.next
    ? {
        ok: up.ok,
        sub: up.ok ? `${up.cost} · Lv ${up.next}` : up.reason === "coins" ? `need ${up.cost - coins}` : "…",
        why: `${up.name} → ${up.nextName} (level ${up.level} → ${up.next}) for ${up.cost} coins. Income ${perMinute(up.rate)} → ${perMinute(up.nextRate)} coins/min.${up.ok ? "" : ` ${up.why}`}`,
      }
    : { ok: false, sub: up.reason === "max-level" ? "top level" : "no land", why: up.why };

  const anyRenew = renew.some((o) => o.ok);
  const renewAct = !mine
    ? { ok: false, sub: "no land", why: "Claim a plot first." }
    : { ok: anyRenew, sub: lease && lease !== "ended" ? lease : "—", why: anyRenew ? "Extend your lease." : renew.every((o) => o.reason === "max-lease") ? `Your lease is at the ${ECONOMY.leaseCapHours} h limit.` : "Not enough coins to renew." };

  const relocate = !mine
    ? { ok: false, sub: "no land", why: "Claim a plot first." }
    : busy === "relocate"
      ? { ok: false, sub: "…", why: "Moving…" }
      : wait > 0
        ? { ok: false, sub: `in ${timeLeft(me.relocateAt, now)}`, why: `You can move again in ${timeLeft(me.relocateAt, now)}.` }
        : coins < ECONOMY.relocateCost
          ? { ok: false, sub: `need ${ECONOMY.relocateCost - coins}`, why: `Moving costs ${ECONOMY.relocateCost} coins; you have ${coins}.` }
          : { ok: true, sub: `${ECONOMY.relocateCost} coins`, why: `Pick a free plot on the map to move there for ${ECONOMY.relocateCost} coins.` };

  return {
    coins: String(coins),
    building: mine ? `${buildingName(levelOf(mine))} · Lv ${levelOf(mine)}` : "No building yet",
    level: mine ? levelOf(mine) : 0,
    rate: mine ? `${perMinute(rate)} coins/min` : "—",
    neighbours: mine ? `${n} of ${neighbours(mine.id).length}` : "—",
    pending: String(owed),
    lease: lease ?? "—",
    leaseSoon: mine ? msUntil(leaseIso, now) < SOON_MS : false,
    move: !mine ? "—" : wait > 0 ? `in ${timeLeft(me.relocateAt, now)}` : "ready",
    collect,
    upgrade,
    renew: renewAct,
    renewOptions: renew,
    relocate,
  };
}

// --- the confirm bar and the inspector ---

// The confirm bar's wording for a selected plot: a claim (no land yet), a
// move (you hold land), or someone's building, with what it would do.
export function describeTile(board, id, now = new Date()) {
  const t = board.tiles[id];
  const where = place(id);
  if (t.state === "mine") return { title: `Your ${buildingName(levelOf(t))}, ${where}`, action: null, open: false, kind: "mine" };
  if (t.state === "held") {
    const lease = timeLeft(t.leaseEndsAt, now);
    return {
      title: `${t.label}'s ${buildingName(levelOf(t))}, ${where}${lease && lease !== "ended" ? `. Lease ${lease} left.` : ""}`,
      action: null,
      open: false,
      kind: "held",
    };
  }
  const help = helpText(helpsWith(board, id));
  const goalPart = help ? ` Building here ${help}` : "";
  const end = goalPart && !goalPart.endsWith("!") ? "." : "";
  const move = relocateInfo(board, id, now);
  if (move) {
    return {
      title: `${relocateText(move)}${move.ok ? "" : ` ${move.why}`}${goalPart}${end}`,
      action: `Move here · ${move.cost} coins`,
      open: move.ok,
      kind: "move",
      move,
    };
  }
  return { title: `${effect(board, preview(board, id))}${goalPart}${end}`, action: `Claim ${where}`, open: true, kind: "claim" };
}

// Everything the inspector shows about one plot: a heading and term/value
// pairs. A free plot also says what building there would do.
export function inspect(board, id, now) {
  const t = board.tiles[id];
  if (!t) return null;
  const where = place(id);
  const around = neighboursOf(board, t.state === "free" ? { ...t, neighbours: undefined } : t);
  const facts = [];
  let title;
  if (t.state === "free") {
    title = `Free plot: ${where}`;
    facts.push(["Occupied neighbours", `${around} of ${neighbours(id).length}`]);
  } else {
    const level = levelOf(t);
    title = `${t.state === "mine" ? "You" : t.label}: ${where}`;
    facts.push(["Owner", t.state === "mine" ? `${t.label} (you)` : t.label]);
    facts.push(["Building", `${buildingName(level)}, level ${level}`]);
    facts.push(["Neighbours", `${around} of ${neighbours(id).length}`]);
    facts.push(["Income", `${perMinute(Number.isFinite(t.rate) ? t.rate : rateOf(level, around))} coins/min`]);
    const lease = timeLeft(t.leaseEndsAt, now);
    if (lease) facts.push(["Lease", lease === "ended" ? "ended" : `${lease} left${leaseSoon(t, now) ? ", ending soon" : ""}`]);
  }
  const p = preview(board, id);
  if (p) facts.push([p.from === null ? "If you build here" : "If you move here", effect(board, p)]);
  const help = helpText(helpsWith(board, id));
  if (help) facts.push(["Goal", `Building here ${help}`]);
  const mark = landmarkAt(board, id);
  if (mark) facts.unshift(["Landmark", `raised by ${allNames(mark.raisers)}`]);
  return { title, facts };
}
