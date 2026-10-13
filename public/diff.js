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
  if (t.state === "dormant") {
    return { title: `${t.label} has been away over a day. ${lift}`, action: `Settle on ${where}`, open: true };
  }
  return { title: lift, action: `Claim ${where}`, open: true };
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
  return { title, facts };
}
