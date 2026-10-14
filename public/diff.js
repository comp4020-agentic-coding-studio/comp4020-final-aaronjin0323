// What changed between two boards, and what to tell this visitor about it.
// No DOM and no network: app.js feeds it consecutive boards (each one is the
// whole board as this visitor sees it) and acts on the result, and
// spec/diff.test.ts tests it directly.
//
// A board is { tiles: [{ id, state, height, label, hue }], ... } with
// state one of "free" | "held" | "mine" | "dormant". Holders are never named
// by id, so "the same holder" means the same hue and label.

const N = 12;

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

const claimed = (t) => t.state !== "free";
// Counts toward its neighbours' heights: a dormant tile stands but lifts nobody.
const active = (t) => t.state === "held" || t.state === "mine";
const sameHolder = (a, b) => claimed(a) && claimed(b) && a.hue === b.hue && a.label === b.label;
const place = (id) => `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;

// "Mia", "Mia and Kai", "Mia, Kai and Zoe", "Mia, Kai and 2 others"
function names(list) {
  if (list.length <= 2) return list.join(" and ");
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}

export function diffBoards(prev, next) {
  // Tiles whose height changed while keeping the same holder: everyone sees
  // these float a +1 or -1. A tile that changed hands is an arrival, not a rise.
  const rises = [];
  for (const t of next.tiles) {
    const before = prev.tiles[t.id];
    if (before && sameHolder(before, t) && before.height !== t.height) {
      rises.push({ id: t.id, delta: t.height - before.height });
    }
  }

  const prevMine = prev.tiles.find((t) => t.state === "mine");
  const nextMine = next.tiles.find((t) => t.state === "mine");
  const messages = [];

  if (nextMine && (!prevMine || prevMine.id !== nextMine.id)) {
    // I just claimed, or moved. I lifted exactly the neighbours whose height
    // went up, and dropped exactly the ones whose height went down: a
    // neighbour of both my old and new tile is unchanged, so it's neither.
    // Only people who are here are named: a faded neighbour's height moves
    // too (it floats), but nobody is standing on it to be lifted.
    const rose = new Map(rises.map((r) => [r.id, r.delta]));
    const lifted = neighbours(nextMine.id)
      .filter((id) => active(next.tiles[id]) && (rose.get(id) ?? 0) > 0)
      .map((id) => next.tiles[id].label);
    const dropped = prevMine
      ? neighbours(prevMine.id)
          .filter((id) => active(next.tiles[id]) && (rose.get(id) ?? 0) < 0)
          .map((id) => next.tiles[id].label)
      : [];
    let text = `${prevMine ? "Moved to" : "Claimed"} ${place(nextMine.id)}.`;
    if (lifted.length) text += ` You lifted ${names(lifted)}.`;
    else if (nextMine.height === 0) text += " Nobody beside you yet: you'll rise when someone settles next to you.";
    if (dropped.length) text += ` ${names(dropped)} dropped a floor when you left.`;
    messages.push({ key: "claimed", text });
  } else if (nextMine && prevMine) {
    // I stayed put: tell me who arrived beside me or left.
    // A neighbour fading (a day away) or coming back keeps their tile but
    // stops, or starts, counting toward mine, so it moves my height too.
    const arrived = [];
    const left = [];
    const faded = [];
    const back = [];
    for (const id of neighbours(nextMine.id)) {
      const before = prev.tiles[id];
      const after = next.tiles[id];
      if (claimed(after) && !sameHolder(before, after)) arrived.push(after.label);
      if (claimed(before) && !sameHolder(before, after)) left.push(before.label);
      if (sameHolder(before, after) && active(before) && after.state === "dormant") faded.push(after.label);
      if (sameHolder(before, after) && before.state === "dormant" && active(after)) back.push(after.label);
    }
    const h = nextMine.height;
    const at = h > prevMine.height ? `You're up to height ${h}.` : h < prevMine.height ? `You're down to height ${h}.` : "";
    // The height goes on the first message only, so it's said once.
    const said = [];
    if (arrived.length) said.push(["arrived", `${names(arrived)} settled beside you.`]);
    if (left.length) said.push(["left", `${names(left)} moved away from beside you.`]);
    if (back.length) said.push(["back", `${names(back)} ${back.length === 1 ? "is" : "are"} back beside you.`]);
    if (faded.length) {
      const whose = faded.length === 1 ? `${faded[0]}'s tile` : `${names(faded)}'s tiles`;
      said.push(["faded", `${whose} faded after a day away.`]);
    }
    said.forEach(([key, text], i) => {
      messages.push({ key, text: i === 0 && at ? `${text} ${at}` : text });
    });
  }

  return { rises, messages };
}

// Tiles someone else just claimed: became claimed, or changed hands, and
// aren't mine. The page marks these briefly.
export function arrivals(prev, next) {
  return next.tiles
    .filter((t) => claimed(t) && t.state !== "mine" && !sameHolder(prev.tiles[t.id] ?? { state: "free" }, t))
    .map((t) => t.id);
}

// Whether to show a board that just arrived. Boards carry a version that only
// rises within one server process, so an older or repeated one is dropped.
// The exception is the first board on a reopened stream (`streamVersion` is
// then the last version that stream delivered before it dropped, else null).
// One server never sends a stream a version below one it already sent it, so
// a lower one means a new server process: its versions start again from its
// own clock, which can be behind (clock skew between machines, or a burst of
// claims that ran the old count past the clock), and refusing it would leave
// the page frozen on a board that no longer exists. A first board that is
// merely older than a claim's own response is still dropped: that's the same
// server, and the claim is already shown.
export function accepts(shownVersion, nextVersion, streamVersion = null) {
  if (nextVersion > shownVersion) return true;
  return streamVersion !== null && nextVersion < streamVersion;
}

// What claiming tile `id` would do, worked out from the board as shown: the
// height you'd stand at, the neighbours you'd lift, and, if you're moving,
// the ones beside your old tile you'd drop. Null for a tile you can't claim
// (someone else's) or your own. Never touches the board it's given; the
// server's heights() is the rule it has to agree with (spec/diff.test.ts).
//
// Only active tiles (held or mine) count toward a neighbour's height; a
// dormant one has a height of its own but lifts nobody. Claiming makes the
// target active, and moving frees your old tile.
export function preview(board, id) {
  const t = board.tiles[id];
  if (!t || t.state === "held" || t.state === "mine") return null;
  const mine = board.tiles.find((x) => x.state === "mine") ?? null;
  const after = board.tiles.map((x) => x.id === id || (active(x) && x !== mine));
  const heightAfter = (i) => neighbours(i).filter((n) => after[n]).length;
  // Every tile's height after the claim (0 for a free one), so the test can
  // hold the whole board to the server's rule, not just the named tiles.
  const heights = board.tiles.map((x) => (x.id === id || (claimed(x) && x !== mine) ? heightAfter(x.id) : 0));
  // Lifted and dropped name people who are here: a faded neighbour's own
  // height moves too, but nobody is standing on it to notice.
  const lifted = [];
  const dropped = [];
  for (const x of board.tiles) {
    if (x.id === id || !active(x) || x === mine) continue;
    const delta = heights[x.id] - x.height;
    if (delta > 0) lifted.push(x.id);
    else if (delta < 0) dropped.push(x.id);
  }
  return { id, height: heights[id], heights, lifted, dropped, from: mine ? mine.id : null };
}

// --- the room's goal: landmarks (docs/adr/0004) ---
// A tower becomes a landmark at height 8. The board carries
// `landmarks: { count, cells: { [cellId]: { label, raisers } } }`; a board
// from before landmarks existed counts as none raised.

export const LANDMARK_AT = 8;

const landmarksOf = (board) => board.landmarks ?? { count: 0, cells: {} };
export const landmarkAt = (board, id) => {
  const cells = landmarksOf(board).cells ?? {};
  return Object.hasOwn(cells, String(id)) ? cells[String(id)] : null;
};
// An edge tile has at most 5 neighbours, so it can never reach 8.
const interior = (id) => {
  const r = Math.floor(id / N);
  const c = id % N;
  return r > 0 && r < N - 1 && c > 0 && c < N - 1;
};
// A tower that can still become a landmark: someone around holds it, it isn't
// one already, and it isn't on an edge.
const contender = (board, t) => active(t) && interior(t.id) && !landmarkAt(board, t.id);
const towerName = (t) => (t.state === "mine" ? "your tower" : `${t.label}'s tower`);

// Every name, for the one message that names all nine raisers.
export function allNames(list) {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// What claiming `id` would do for the goal, worked out from preview(): the
// tower it brings closest to 8 (highest resulting height, ties to the lower
// cell id), or that settling there completes a landmark of your own. Null if
// it raises no contender. Only a tower that really rises counts, so moving
// between two gaps round the same tower helps nobody.
export function helpsWith(board, id) {
  const p = preview(board, id);
  if (!p) return null;
  if (p.height >= LANDMARK_AT && interior(id) && !landmarkAt(board, id)) {
    return { id, label: null, height: p.height, landmark: true, name: "your tower" };
  }
  let best = null;
  for (const x of board.tiles) {
    if (x.id === id || !contender(board, x)) continue;
    const after = p.heights[x.id];
    if (after <= x.height) continue;
    if (!best || after > best.height) best = { id: x.id, label: x.label, height: after, landmark: after >= LANDMARK_AT, name: towerName(x) };
  }
  return best;
}

// "brings Mia's tower to 7 of 8", "raises a landmark!"
export function helpText(h) {
  if (!h) return null;
  return h.landmark ? "raises a landmark!" : `brings ${h.name} to ${h.height} of ${LANDMARK_AT}`;
}

// The goal line and the glowing tiles. `closest` is the contender standing
// highest (ties to the lower cell id), or null when no tower is above 0.
// `helps` are the free or faded tiles whose claim, by this visitor, would
// lift a tower to at least that top height (or complete a landmark on the
// spot): the gaps round the front-runners, not every tile beside anyone,
// which on a busy board would be most of it. With no tower above 0 yet, any
// tile beside someone helps, which is how a tower starts. The preview and
// inspector still say what a non-glowing tile would do.
export function goal(board) {
  const count = landmarksOf(board).count ?? 0;
  let top = null;
  for (const t of board.tiles) if (contender(board, t) && (!top || t.height > top.height)) top = t;
  const closest =
    top && top.height > 0 ? { id: top.id, label: top.label, height: top.height, mine: top.state === "mine", name: towerName(top) } : null;
  const peak = top ? top.height : Infinity;
  const helps = [];
  for (const t of board.tiles) {
    const h = helpsWith(board, t.id);
    if (h && (h.landmark || h.height >= peak)) helps.push(t.id);
  }
  return { count, closest, helps };
}

// The goal line's words, in pieces so a long name can be cut short on a
// phone without losing "6 of 8". src/board.ts renders the same line, so the
// page says it before (and without) any script; spec/diff.test.ts holds the
// two equal. "1 landmark raised · Closest: Mia's tower, 6 of 8".
export function goalParts(g) {
  // "raised" is its own fixed word in the markup, so a phone can tuck it away.
  const noun = g.count === 1 ? "landmark" : "landmarks";
  if (!g.closest) return { count: String(g.count), noun, lead: "Start a tower by someone", who: "", tail: "" };
  const tail = `${g.closest.mine ? " tower" : "'s tower"}, ${g.closest.height} of ${LANDMARK_AT}`;
  return { count: String(g.count), noun, lead: "Closest: ", who: g.closest.mine ? "your" : g.closest.label, tail };
}

// A tile's aria-label: the server's words for it, plus the landmark ever
// raised on that cell. src/board.ts renders it the same way.
export const tileAria = (aria, mark) => (mark ? `${aria}. Landmark raised by ${allNames(mark.raisers)}` : aria);

// Whether I can wave at tile `id`: I hold a tile, and it's someone else's
// held tile right beside mine. The server checks the same (docs/adr/0004);
// this only decides whether the page offers the button.
export function canWave(board, id) {
  const mine = board.tiles.find((t) => t.state === "mine");
  const t = board.tiles[id];
  if (!mine || !t || t.state !== "held" || !neighbours(mine.id).includes(id)) return null;
  return { id, label: t.label };
}

// The one message every page shows when a landmark is raised, naming all nine.
export function raisedText(raised) {
  return `Landmark raised at ${place(raised.cellId)} by ${allNames(raised.raisers)}!`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "Would lift 2 neighbours. Moving drops 1." from a preview.
function effect(p) {
  let text = p.lifted.length
    ? `Would lift ${plural(p.lifted.length, "neighbour")}`
    : p.height === 0
      ? "No neighbours yet"
      : `You'd stand at height ${p.height}`;
  text += ".";
  if (p.dropped.length) text += ` Moving drops ${p.dropped.length}.`;
  return text;
}

// The phone confirm bar's wording for a tapped tile.
export function describeTile(board, id) {
  const t = board.tiles[id];
  const where = place(id);
  if (t.state === "mine") return { title: `Your tile, ${where}`, action: "Rename here", open: true };
  if (t.state === "held") return { title: `${t.label} holds ${where}`, action: null, open: false };
  const lift = effect(preview(board, id));
  const help = helpText(helpsWith(board, id));
  const goalPart = help ? ` Settling here ${help}` : "";
  const end = goalPart && !goalPart.endsWith("!") ? "." : "";
  if (t.state === "dormant") {
    return { title: `${t.label} has been away over a day. ${lift}${goalPart}${end}`, action: `Settle on ${where}`, open: true };
  }
  return { title: `${lift}${goalPart}${end}`, action: `Claim ${where}`, open: true };
}

// "safe for 23 h 12 m": how long until a held tile fades, from its
// safeUntil (server time) and the page's clock.
export function safeFor(safeUntil, now) {
  const ms = new Date(safeUntil).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "safe";
  if (ms <= 0) return "fading now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `safe for ${h} h ${m} m`;
  if (m > 0) return `safe for ${m} m`;
  return "safe for under a minute";
}

// Everything the inspector shows about one tile: a heading and term/value
// pairs. Any tile can be inspected; a claimable one also says what claiming
// it would do.
export function inspect(board, id, now) {
  const t = board.tiles[id];
  if (!t) return null;
  const where = place(id);
  // Only active neighbours lift a tile; faded ones are listed apart.
  const around = neighbours(id).filter((n) => active(board.tiles[n])).length;
  const faded = neighbours(id).filter((n) => board.tiles[n].state === "dormant").length;
  const facts = [];
  let title;
  if (t.state === "free") {
    title = `Open: ${where}`;
  } else {
    title = `${t.state === "mine" ? "You" : t.label}: ${where}`;
    facts.push(["Holder", t.state === "mine" ? `${t.label} (you)` : t.label]);
    facts.push(["Height", `${t.height}`]);
  }
  facts.push(["Claimed neighbours", `${around} of ${neighbours(id).length}${faded ? `, plus ${faded} faded` : ""}`]);
  facts.push([
    "Protection",
    t.state === "mine"
      ? "yours"
      : t.state === "dormant"
        ? "faded — open to settle"
        : t.state === "held"
          ? t.safeUntil
            ? safeFor(t.safeUntil, now)
            : "safe"
          : "open",
  ]);
  const p = preview(board, id);
  if (p) facts.push(["If you settle here", `height ${p.height}. ${effect(p)}`]);
  const help = helpText(helpsWith(board, id));
  if (help) facts.push(["Goal", `Settling here ${help}`]);
  const mark = landmarkAt(board, id);
  if (mark) facts.unshift(["Landmark", `raised by ${allNames(mark.raisers)}`]);
  return { title, facts };
}
