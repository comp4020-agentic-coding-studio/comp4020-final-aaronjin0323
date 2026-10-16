// The page's pure module: what changed between two boards, what an action
// would do, and the words for both. No DOM and no network: app.js feeds it
// boards (each the whole city as this visitor sees it) and acts on the
// result, src/board.ts renders with the same functions, and
// spec/diff.test.ts tests it directly.
//
// A board is { tiles, me, landmarks, events, version }. Each tile is
// { id, state: "free" | "held" | "mine" | "park", label, hue, level,
// neighbours, height, rate, leaseEndsAt } (docs/adr/0005); a park also has
// `endsAt` and `mine` (docs/adr/0007). Holders are never named by id,
// so "the same holder" means the same hue and label. `me` is this visitor's
// own wallet: { coins, pending, rate, cellId, level, leaseEndsAt, ownedSince,
// relocateAt, helpAt, parks, parkLimit, welcome?, expired? }. Money is in coins, except
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
  landmarkTiers: Object.freeze([
    Object.freeze({ tier: "bronze", neighbours: 3 }),
    Object.freeze({ tier: "silver", neighbours: 5 }),
    Object.freeze({ tier: "gold", neighbours: 8 }), // ADR 4's landmark
  ]),
  parkCost: 60, // docs/adr/0007
  parkHours: 2, // a park ends this long after it's placed, never renewed
  parkLimit: 2, // running at once, per player
  goldPeople: 3, // distinct people round a gold tower
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

// A building: someone's, or mine. A park is neither (docs/adr/0007).
const claimed = (t) => t !== undefined && t !== null && (t.state === "held" || t.state === "mine");
const isPark = (t) => t !== undefined && t !== null && t.state === "park";
const samePark = (a, b) => isPark(a) && isPark(b) && a.label === b.label && a.endsAt === b.endsAt;
const sameHolder = (a, b) => claimed(a) && claimed(b) && a.hue === b.hue && a.label === b.label;
export const place = (id) => `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;
const levelOf = (t) => (Number.isInteger(t?.level) && t.level >= 1 ? t.level : 1);
// The board says how many neighbours each building has, counting the parks
// that count for it (only the server knows who placed each); worked out from
// the tiles for a board that doesn't, counting every park but my own.
const counts = (board, t) => claimed(board.tiles[t]) || (isPark(board.tiles[t]) && !board.tiles[t].mine);
const neighboursOf = (board, t) =>
  Number.isInteger(t.neighbours) ? t.neighbours : neighbours(t.id).filter((n) => counts(board, n)).length;
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

// --- what each action would do ---
// Each returns `ok` and, when it isn't, a `reason` code. Nothing here says
// why in words: a control that can't be used isn't shown (CLAUDE.md, "Show,
// don't tell").

// Upgrading: from what level to what, its cost, and income before and after.
export function upgradeInfo(board) {
  const mine = mineOf(board);
  const coins = meOf(board)?.coins ?? 0;
  if (!mine) return { ok: false, reason: "no-land" };
  const level = levelOf(mine);
  const n = neighboursOf(board, mine);
  const base = { level, name: buildingName(level), rate: rateOf(level, n) };
  if (level >= MAX_LEVEL) return { ...base, ok: false, reason: "max-level" };
  const next = level + 1;
  const cost = ECONOMY.upgradeCosts[level - 1];
  const info = { ...base, next, nextName: buildingName(next), cost, nextRate: rateOf(next, n) };
  if (coins < cost) return { ...info, ok: false, reason: "coins" };
  return { ...info, ok: true, reason: null };
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
    if (!mine) return { ...option, ok: false, reason: "no-land" };
    if (Number.isFinite(cap) && ends + hours * HOUR > cap) return { ...option, ok: false, reason: "max-lease" };
    if (coins < cost) return { ...option, ok: false, reason: "coins" };
    return { ...option, ok: true, reason: null };
  });
}

// Moving your building to free plot `id`: where from and to, its cost, your
// income before and after, and whether it's possible now. Null unless you
// hold land and the plot is free.
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
  };
  if (wait > 0) return { ...info, ok: false, reason: "cooldown" };
  if (coins < cost) return { ...info, ok: false, reason: "coins" };
  return { ...info, ok: true, reason: null };
}

// Whether I can help the building on tile `id`: it's someone else's, right
// beside mine. `ok` is false while my hourly help is cooling down. The server
// checks the same (docs/adr/0005); this decides what the page offers.
export function canHelp(board, id, now) {
  const mine = mineOf(board);
  const t = board.tiles[id];
  if (!mine || !t || t.state !== "held" || !neighbours(mine.id).includes(id)) return null;
  const helpAt = meOf(board)?.helpAt ?? null;
  return { id, label: t.label, ok: msUntil(helpAt, now) <= 0 };
}

// Placing a park on free plot `id` (docs/adr/0007): possible while you hold
// land, have fewer than the limit running and can pay, and worth offering
// only beside someone else's building, since it never lifts your own. Null
// when it isn't offered; `lifts` are the buildings it would lift.
export function canPark(board, id) {
  const mine = mineOf(board);
  const t = board.tiles[id];
  if (!mine || !t || t.state !== "free") return null;
  const lifts = neighbours(id).filter((n) => board.tiles[n]?.state === "held");
  if (lifts.length === 0) return null;
  const me = meOf(board);
  const cost = ECONOMY.parkCost;
  const info = { id, cost, lifts, names: lifts.map((n) => board.tiles[n].label) };
  if ((me?.parks ?? 0) >= (me?.parkLimit ?? ECONOMY.parkLimit)) return { ...info, ok: false, reason: "park-limit" };
  if ((me?.coins ?? 0) < cost) return { ...info, ok: false, reason: "coins" };
  return { ...info, ok: true, reason: null };
}

// --- the placement preview ---

// What claiming (or moving to) free plot `id` would do, worked out from the
// board as shown: every building's neighbours, height (level + neighbours)
// and income afterwards; yours there; and whose income rises or falls. Null
// for a plot you can't build on (a building or a park stands there). Moving
// keeps your level and frees your old plot. Every other building keeps the
// neighbours the server counted for it, plus one beside the new plot and
// minus one beside the old: parks don't move, and only the server knows who
// placed each, so its count is the start. Your new building counts every
// building round it and every park that isn't yours. Never touches the board
// it's given; spec/diff.test.ts holds it equal to the server's rule on
// random boards.
export function preview(board, id) {
  const t = board.tiles[id];
  if (!t || t.state !== "free") return null;
  const mine = mineOf(board);
  const level = mine ? levelOf(mine) : 1;
  const occupied = board.tiles.map((x) => x.id === id || (claimed(x) && x !== mine));
  const near = (a, b) => b !== null && neighbours(a).includes(b);
  const from = mine ? mine.id : null;
  const counts = board.tiles.map((x) => {
    if (!occupied[x.id]) return 0;
    if (x.id === id) return neighbours(id).filter((n) => (occupied[n] && n !== id) || (isPark(board.tiles[n]) && !board.tiles[n].mine)).length;
    return neighboursOf(board, x) + (near(x.id, id) ? 1 : 0) - (near(x.id, from) ? 1 : 0);
  });
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

const MINUS = "−";
const PCT = Math.round(ECONOMY.neighbourBonus * 100); // 20: what one neighbour adds
const coinsAMinute = (cents) => `${perMinute(cents)} coin${cents === 100 ? "" : "s"} a minute`;

// --- narration: one short line, about your own building only ---
// Each message is { key, text, said }: `text` is the line shown on the
// board, a few words and numbers; `said` is the sentence the live region
// speaks, since "+14/min" read aloud means little.

export const EXPIRED_TEXT = "Your lease ended. Pick a new plot.";

export function welcomeText(me) {
  const w = me?.welcome;
  if (w === undefined || w === null || w === false) return null;
  const coins = typeof w === "number" ? w : typeof w === "object" ? Number(w.coins ?? collectable(w.cents ?? 0)) : NaN;
  if (!Number.isFinite(coins)) return null;
  return `Welcome back! +${coins} earned`;
}
export function welcomeSaid(me) {
  const text = welcomeText(me);
  return text === null ? null : `Welcome back! Your building earned ${text.match(/\d+/)[0]} coins while you were away.`;
}
export const expiredText = (me) => (me?.expired ? EXPIRED_TEXT : null);

// What claiming or moving says: "Your building is up! +14/min · Mia and
// Kai +20%".
export function builtMessage({ moved, rate, raised = [], where = null }) {
  const lift = raised.length ? ` · ${names(raised)} +${PCT}%` : "";
  const liftSaid = raised.length ? ` ${names(raised)} now earn${raised.length === 1 ? "s" : ""} more.` : "";
  return moved
    ? { key: "claimed", text: `Moved! +${perMinute(rate)}/min${lift}`, said: `Moved${where === null ? "" : ` to ${place(where)}`}. You earn ${coinsAMinute(rate)}.${liftSaid}` }
    : { key: "claimed", text: `Your building is up! +${perMinute(rate)}/min${lift}`, said: `Your building is up, earning ${coinsAMinute(rate)}.${liftSaid}` };
}

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
    // I just claimed, or moved: whose income my arrival raised (a
    // neighbour of both plots is neither).
    const counted = (b, t) => neighboursOf(b, t);
    const raised = neighbours(nextMine.id)
      .filter((id) => sameHolder(prev.tiles[id], next.tiles[id]) && counted(next, next.tiles[id]) > counted(prev, prev.tiles[id]))
      .map((id) => next.tiles[id].label);
    const rate = Number.isFinite(nextMine.rate) && nextMine.rate > 0 ? nextMine.rate : rateOf(levelOf(nextMine), counted(next, nextMine));
    messages.push(builtMessage({ moved: Boolean(prevMine), rate, raised, where: nextMine.id }));
  } else if (prevMine && !nextMine) {
    messages.push({ key: "expired", text: EXPIRED_TEXT, said: EXPIRED_TEXT });
  } else if (nextMine && prevMine) {
    // I stayed put: who built beside me, who left, and what it did to my
    // income. Someone gone from beside me who still holds land elsewhere
    // moved; otherwise their lease ended.
    const arrived = [];
    const moved = [];
    const ended = [];
    const parked = [];
    const closed = [];
    for (const id of neighbours(nextMine.id)) {
      const before = prev.tiles[id];
      const after = next.tiles[id];
      // a park someone else placed beside me, or one of theirs closing
      if (isPark(after) && !after.mine && !samePark(before, after)) parked.push(after.label);
      if (isPark(before) && !before.mine && !samePark(before, after)) closed.push(before.label);
      if (claimed(after) && !sameHolder(before, after)) arrived.push(after.label);
      if (claimed(before) && !sameHolder(before, after)) {
        if (next.tiles.some((t) => sameHolder(before, t))) moved.push(before.label);
        else ended.push(before.label);
      }
    }
    const change = (neighboursOf(next, nextMine) - neighboursOf(prev, prevMine)) * PCT;
    if (arrived.length || moved.length || ended.length || parked.length || closed.length) {
      const parts = [];
      const said = [];
      if (parked.length) {
        parts.push(`${names(parked)} opened a park beside you`);
        said.push(`${names(parked)} opened a park beside you.`);
      }
      if (closed.length) {
        parts.push(closed.length === 1 ? `${closed[0]}'s park closed` : `${closed.length} parks closed`);
        said.push(closed.length === 1 ? `${closed[0]}'s park beside you closed.` : `${closed.length} parks beside you closed.`);
      }
      if (arrived.length) {
        parts.push(`${names(arrived)} built beside you`);
        said.push(`${names(arrived)} built beside you.`);
      }
      if (moved.length) {
        parts.push(`${names(moved)} moved away`);
        said.push(`${names(moved)} moved away.`);
      }
      if (ended.length) {
        parts.push(ended.length === 1 ? `${ended[0]}'s lease ended` : `${ended.length} leases ended`);
        said.push(ended.length === 1 ? `${ended[0]}'s lease ended.` : `${ended.length} neighbours' leases ended.`);
      }
      if (change > 0) {
        parts.push(`+${change}%`);
        said.push(`Your income is up ${change}%.`);
      } else if (change < 0) {
        parts.push(`${MINUS}${-change}%`);
        said.push(`Your income is down ${-change}%.`);
      }
      const up = (arrived.length || parked.length) && !moved.length && !ended.length && !closed.length;
      messages.push({ key: up ? "arrived" : "left", text: parts.join(" · "), said: said.join(" ") });
    }
  }

  return { rises, messages };
}

// Plots someone else just built on: became claimed, or changed hands, and
// aren't mine. The page marks these briefly.
export function arrivals(prev, next) {
  return next.tiles
    .filter((t) =>
      isPark(t)
        ? !t.mine && !samePark(prev.tiles[t.id], t)
        : claimed(t) && t.state !== "mine" && !sameHolder(prev.tiles[t.id] ?? { state: "free" }, t),
    )
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

// --- the room's goal: landmarks in tiers (docs/adr/0004, 0005, 0006) ---
// A building earns a bronze crown at 3 occupied neighbours, silver at 5 and
// gold at 8, each once per cell, lower tiers with it. The board carries
// `landmarks: { count, cells: { [cellId]: { tier, label, raisers } } }`,
// each cell at its highest tier; a board without it counts as none raised.

export const TIERS = ECONOMY.landmarkTiers;
const rankOf = (tier) => TIERS.findIndex((t) => t.tier === tier);
// The goal line stays off the page until a crown stands or some building is
// this many neighbours short of its next tier: before then it's a target
// nobody is near.
export const GOAL_SHOWN_WITHIN = 1;
export const goalShown = (g) => g.count > 0 || (g.closest !== null && g.closest.target - g.closest.neighbours <= GOAL_SHOWN_WITHIN);

const landmarksOf = (board) => board.landmarks ?? { count: 0, cells: {} };
export const landmarkAt = (board, id) => {
  const cells = landmarksOf(board).cells ?? {};
  return Object.hasOwn(cells, String(id)) ? cells[String(id)] : null;
};
// The next tier the cell can still earn: the one after its crown, if the
// cell has room for that many neighbours (a corner has 3, an edge 5), or
// null when there's none left.
export function nextTier(board, id) {
  const mark = landmarkAt(board, id);
  const room = neighbours(id).length;
  const next = TIERS[mark ? rankOf(mark.tier) + 1 : 0];
  return next && next.neighbours <= room ? next : null;
}
const contender = (board, t) => claimed(t) && nextTier(board, t.id) !== null;
const buildingOf = (t) => (t.state === "mine" ? "your building" : `${t.label}'s building`);
// Nearer first: fewer neighbours still needed, then the higher tier, then
// more neighbours already, then the lower cell.
const nearer = (a, b) =>
  a.target - a.neighbours - (b.target - b.neighbours) || rankOf(b.tier) - rankOf(a.tier) || b.neighbours - a.neighbours || a.id - b.id;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Every name, for the one message that names all nine raisers.
export function allNames(list) {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// What building on `id` would do for the goal: the building it brings
// nearest its next tier (fewest still needed after, then the higher tier),
// which may be the new building itself if it would earn a crown at once.
// `landmark` is true when that completes the tier. Null if it moves no
// contender closer: moving between two gaps round one building helps it
// not at all.
export function helpsWith(board, id) {
  const p = preview(board, id);
  if (!p) return null;
  let best = null;
  const consider = (h) => {
    if (!best || nearer(h, best) < 0) best = h;
  };
  const own = nextTier(board, id);
  if (own && p.neighbours >= own.neighbours) {
    consider({ id, label: null, neighbours: p.neighbours, tier: own.tier, target: own.neighbours, landmark: true, name: "your building" });
  }
  for (const x of board.tiles) {
    if (x.id === id || !contender(board, x)) continue;
    const after = p.counts[x.id];
    if (after <= neighboursOf(board, x)) continue;
    const next = nextTier(board, x.id);
    consider({ id: x.id, label: x.label, neighbours: after, tier: next.tier, target: next.neighbours, landmark: after >= next.neighbours, name: buildingOf(x) });
  }
  return best;
}

// The goal line and the glowing plots. `closest` is the contender nearest
// its next tier (see `nearer`), or null when nobody has a neighbour. `helps`
// are the free plots whose claim would leave a building at most as far from
// its next tier as the leader is now (or complete one): the gaps round the
// front-runners, not every plot beside anyone. With no neighbours anywhere,
// any plot beside someone helps, which is how a block starts.
export function goal(board) {
  const count = landmarksOf(board).count ?? 0;
  let top = null;
  for (const t of board.tiles) {
    if (!contender(board, t)) continue;
    const next = nextTier(board, t.id);
    const c = { id: t.id, label: t.label, neighbours: neighboursOf(board, t), tier: next.tier, target: next.neighbours, mine: t.state === "mine", name: buildingOf(t) };
    if (!top || nearer(c, top) < 0) top = c;
  }
  const anyNeighbours = board.tiles.some((t) => contender(board, t) && neighboursOf(board, t) > 0);
  const closest = top && anyNeighbours ? top : null;
  const peak = top ? top.target - top.neighbours : Infinity;
  const helps = [];
  for (const t of board.tiles) {
    const h = helpsWith(board, t.id);
    if (h && (h.landmark || h.target - h.neighbours <= peak)) helps.push(t.id);
  }
  return { count, closest, helps };
}

// The goal line's words, in pieces so a long name can be cut short on a
// phone without losing "4 of 5". src/board.ts renders the same line.
// "1 landmark raised · Closest: Mia's building, 4 of 5 neighbours for silver".
export function goalParts(g) {
  const noun = g.count === 1 ? "landmark" : "landmarks";
  if (!g.closest) return { count: String(g.count), noun, lead: "Start one: build beside someone", who: "", tail: "", unit: "", tier: "" };
  const tail = `${g.closest.mine ? " building" : "'s building"}, ${g.closest.neighbours} of ${g.closest.target}`;
  // " neighbours" is its own piece, so a phone can tuck it away first; the
  // tier stays, since "4 of 5" means nothing without it
  return { count: String(g.count), noun, lead: "Closest: ", who: g.closest.mine ? "your" : g.closest.label, tail, unit: " neighbours", tier: ` for ${g.closest.tier}` };
}

// A tile's aria-label: its words, plus the highest crown ever raised on
// that cell. src/board.ts renders it the same way.
export const tileAria = (aria, mark) => (mark ? `${aria}. ${capital(mark.tier ?? "gold")} landmark raised by ${allNames(mark.raisers)}` : aria);

// The one message every page shows when a crown is raised. Gold, the
// celebration, names all nine; bronze and silver are a lighter line.
export const isGold = (raised) => (raised.tier ?? "gold") === TIERS[TIERS.length - 1].tier;
export function raisedText(raised) {
  if (isGold(raised)) return `Gold landmark raised at ${place(raised.cellId)} by ${allNames(raised.raisers)}!`;
  return `${capital(raised.tier)} crown at ${place(raised.cellId)}: ${names(raised.raisers)}`;
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
    case "park":
      return `${who} opened a park${where}`;
    case "park-end":
      return `${who}'s park ended${where}`;
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
  if (isPark(t)) return `${where}, ${parkName(t)}`;
  const kind = buildingName(levelOf(t));
  const who = t.state === "mine" ? `your ${kind}, ${t.label}` : `${t.label}'s ${kind}`;
  const soon = leaseSoon(t, now) ? ", lease ending soon" : "";
  return `${where}, ${who}, height ${t.height}${soon}`;
}

// The status line: never on screen, but it describes the board to a screen
// reader (the board's aria-describedby), so it stays a sentence.
export function statusText(board) {
  const mine = mineOf(board);
  if (!mine) return "You have no land. Type a name, then pick a free plot to build on.";
  return `You own a ${buildingName(levelOf(mine))} at ${place(mine.id)}. Pick a free plot to move there.`;
}

// Renewal shows once the lease has less than this left.
export const RENEW_SHOWN_MS = 6 * HOUR;

// The wallet: everything it shows, and only what you can act on now. Null
// without land, since there is then no wallet to show. `pending` is the
// uncollected income in hundredths, already counted up to `now`. Collect,
// Upgrade and the renewal options are each null (or empty) when they can't
// be used: the page leaves them out rather than drawing them disabled.
export function hudParts(board, now, pending = meOf(board)?.pending ?? 0) {
  const mine = mineOf(board);
  if (!mine) return null;
  const me = meOf(board);
  const coins = me?.coins ?? 0;
  const owed = collectable(pending);
  const n = neighboursOf(board, mine);
  const rate = Number.isFinite(mine.rate) && mine.rate > 0 ? mine.rate : rateOf(levelOf(mine), n);
  const leaseIso = me?.leaseEndsAt ?? mine.leaseEndsAt ?? null;
  const left = Math.max(0, msUntil(leaseIso, now));
  const since = me?.ownedSince ? new Date(me.ownedSince).getTime() : NaN;
  const total = Number.isFinite(since) && leaseIso ? new Date(leaseIso).getTime() - since : ECONOMY.leaseHours * HOUR;
  const leaseText = timeLeft(leaseIso, now) ?? "unknown";
  const up = upgradeInfo(board);
  return {
    coins: String(coins),
    coinsSaid: `${coins} coins`,
    rate: `+${perMinute(rate)}/min`,
    rateSaid: `Income ${coinsAMinute(rate)}`,
    level: levelOf(mine),
    collect: owed >= 1 ? { owed, text: `+${owed}`, said: `Collect ${owed} coins` } : null,
    upgrade: up.ok
      ? { next: up.next, name: up.nextName, cost: up.cost, said: `Upgrade to ${up.nextName} for ${up.cost} coins` }
      : null,
    lease: {
      left: leaseText,
      frac: total > 0 ? Math.min(1, left / total) : 0,
      soon: left > 0 && left < SOON_MS,
      said: leaseText === "ended" ? "Lease ended" : `Lease: ${leaseText} left`,
    },
    renew:
      left > 0 && left < RENEW_SHOWN_MS
        ? renewOptions(board, now)
            .filter((o) => o.ok)
            .map((o) => ({ ...o, text: `+${o.hours} h`, said: `Renew lease ${o.hours} hours for ${o.cost} coins` }))
        : [],
  };
}

// --- the picked plot: the confirm bar and the inspector ---

const parkName = (t) => (t.mine ? "your park" : `${t.label}'s park`);
// The buildings a park lifts: every one round it but its placer's own (the
// page knows only that "mine" is mine).
const parkLifts = (board, t) => neighbours(t.id).filter((n) => board.tiles[n]?.state === "held" || (board.tiles[n]?.state === "mine" && !t.mine));

// The bar for a selected plot: a claim (no land yet), a move (you hold
// land), or someone's building. `title` is a short line of numbers;
// `action` the button's words, or null when there's nothing to do there.
export function describeTile(board, id, now = new Date()) {
  const t = board.tiles[id];
  const where = place(id);
  if (t.state === "mine") return { title: `Your ${buildingName(levelOf(t))}`, action: null, open: false, kind: "mine" };
  if (t.state === "held") return { title: `${t.label}'s ${buildingName(levelOf(t))}`, action: null, open: false, kind: "held" };
  if (isPark(t)) return { title: `${capital(parkName(t))} · ${timeLeft(t.endsAt, now) ?? "open"}`, action: null, open: false, kind: "park" };
  const p = preview(board, id);
  const gain = `+${perMinute(p.rate)}/min`;
  const lift = p.lifted.length ? ` · ${names(p.lifted.map((i) => board.tiles[i].label))} +${PCT}%` : "";
  const move = relocateInfo(board, id, now);
  if (move) {
    const wait = move.reason === "cooldown" ? ` · move in ${timeLeft(meOf(board).relocateAt, now)}` : move.reason === "coins" ? ` · moving costs ${move.cost}` : "";
    return { title: `${gain}${lift}${wait}`, action: move.ok ? `Move here · ${move.cost}` : null, open: move.ok, kind: "move", move };
  }
  return { title: `${gain}${lift}`, action: "Build here", open: true, kind: "claim", where };
}

// What the inspector shows about one plot: a heading and a few short
// term/value pairs, numbers first.
export function inspect(board, id, now) {
  const t = board.tiles[id];
  if (!t) return null;
  const facts = [];
  let title;
  if (isPark(t)) {
    title = capital(parkName(t));
    const lifts = parkLifts(board, t).map((n) => board.tiles[n].label);
    facts.push(["Lifts", lifts.length ? `${names(lifts)} +${PCT}%` : "nobody yet"]);
    const left = timeLeft(t.endsAt, now);
    if (left) facts.push(["Closes", left === "ended" ? "now" : `in ${left}`]);
  } else if (t.state === "free") {
    const p = preview(board, id);
    title = "Free plot";
    facts.push(["Earns", `+${perMinute(p.rate)}/min`]);
    if (p.lifted.length) facts.push(["Lifts", `${names(p.lifted.map((i) => board.tiles[i].label))} +${PCT}%`]);
    if (p.dropped.length) facts.push(["Drops", `${names(p.dropped.map((i) => board.tiles[i].label))} ${MINUS}${PCT}%`]);
    const h = goalShown(goal(board)) ? helpsWith(board, id) : null;
    if (h) facts.push(["Landmark", h.landmark ? `completes ${h.tier}!` : `${h.name} → ${h.neighbours} of ${h.target} for ${h.tier}`]);
  } else {
    const level = levelOf(t);
    const around = neighboursOf(board, t);
    title = t.state === "mine" ? `Your ${buildingName(level)}` : `${t.label}'s ${buildingName(level)}`;
    facts.push(["Earns", `+${perMinute(Number.isFinite(t.rate) && t.rate > 0 ? t.rate : rateOf(level, around))}/min`]);
    facts.push(["Neighbours", `${around} of ${neighbours(id).length}`]);
    const lease = timeLeft(t.leaseEndsAt, now);
    if (lease) facts.push(["Lease", lease === "ended" ? "ended" : `${lease} left`]);
  }
  const mark = landmarkAt(board, id);
  if (mark) facts.unshift(["Landmark", `${capital(mark.tier ?? "gold")}, raised by ${allNames(mark.raisers)}`]);
  return { title, facts };
}

// --- what an action's answer says: one short line, and a sentence to speak ---

// A successful action, by the server's notice key. `body` is the JSON reply,
// `view` the board that came with it.
export function doneText(notice, body = {}, view = { tiles: [], me: null }, now = new Date()) {
  const me = view?.me ?? null;
  switch (notice) {
    case "collected": {
      const paid = Number(body.paid) || 0;
      return { text: `+${paid} collected`, said: `Collected ${paid} coins.` };
    }
    case "nothing-to-collect":
      return { text: "Nothing to collect yet", said: "Nothing to collect yet." };
    case "upgraded": {
      const name = buildingName(body.level ?? me?.level ?? 1);
      const rate = me?.rate ?? 0;
      return { text: `${name}! +${perMinute(rate)}/min`, said: `Upgraded to a ${name}, earning ${coinsAMinute(rate)}.` };
    }
    case "renewed": {
      const left = timeLeft(body.leaseEndsAt ?? me?.leaseEndsAt, now) ?? "extended";
      return { text: `Lease renewed · ${left.replace(/ \d+ m$/, "")} left`, said: `Lease renewed: ${left} left.` };
    }
    case "parked":
      return {
        text: `Park open! ${ECONOMY.parkHours} h`,
        said: `Park placed for ${ECONOMY.parkHours} hours. It lifts the buildings round it, never your own.`,
      };
    case "helped":
      return {
        text: `Helped! +${ECONOMY.helpGift} to them, +${ECONOMY.helpReward} to you`,
        said: `You helped your neighbour: ${ECONOMY.helpGift} coins to them, ${ECONOMY.helpReward} to you.`,
      };
    case "renamed": {
      const label = String(body.label ?? "");
      return { text: `You're ${label}`, said: `Name saved: you're ${label}.` };
    }
    default:
      return { text: "Done", said: "Done." };
  }
}

// A refusal, by the server's error key, else its status, else a network
// failure. `claim` is true for a claim, which says nothing was claimed.
const REFUSALS = Object.freeze({
  taken: "Someone got there first",
  coins: "Not enough coins",
  cooldown: "Not yet: cooling down",
  "max-level": "Already a Skyscraper",
  "max-lease": `Lease is at the ${ECONOMY.leaseCapHours} h limit`,
  "not-neighbour": "Only buildings next to yours",
  "no-land": "Pick a plot first",
  "park-limit": `${ECONOMY.parkLimit} parks at most`,
  hours: `Renew ${ECONOMY.renewals.map((r) => r.hours).join(", ").replace(/, (\d+)$/, " or $1")} h`,
  label: "Name: 1 to 24 characters",
  cell: "No such plot",
});
const BY_STATUS = Object.freeze({ 403: "Refused: reload and try again", 409: REFUSALS.taken, 402: REFUSALS.coins, 429: REFUSALS.cooldown, 413: "Too large to send" });
export function refusalText({ network = false, status = 0, error = null } = {}, { claim = false } = {}) {
  const text = network
    ? `Can't reach the server: nothing ${claim ? "claimed" : "changed"}`
    : ((error !== null && Object.hasOwn(REFUSALS, error) ? REFUSALS[error] : null) ?? BY_STATUS[status] ?? `That didn't work (error ${status})`);
  return { text, said: `${text}.` };
}

// Clicking a building that isn't yours: whose it is.
export function heldText(board, id) {
  const t = board.tiles[id];
  if (isPark(t)) {
    const name = capital(parkName(t));
    return { text: name, said: `${name}, ${place(id)}. Pick a free plot.` };
  }
  const name = `${t.label}'s ${buildingName(levelOf(t))}`;
  return { text: name, said: `${name}, ${place(id)}. Pick a free plot.` };
}
