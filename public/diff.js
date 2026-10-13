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
    const rose = new Map(rises.map((r) => [r.id, r.delta]));
    const lifted = neighbours(nextMine.id)
      .filter((id) => (rose.get(id) ?? 0) > 0)
      .map((id) => next.tiles[id].label);
    const dropped = prevMine
      ? neighbours(prevMine.id)
          .filter((id) => (rose.get(id) ?? 0) < 0)
          .map((id) => next.tiles[id].label)
      : [];
    let text = `${prevMine ? "Moved to" : "Claimed"} ${place(nextMine.id)}.`;
    if (lifted.length) text += ` You lifted ${names(lifted)}.`;
    else if (nextMine.height === 0) text += " Nobody beside you yet: you'll rise when someone settles next to you.";
    if (dropped.length) text += ` ${names(dropped)} dropped a floor when you left.`;
    messages.push({ key: "claimed", text });
  } else if (nextMine && prevMine) {
    // I stayed put: tell me who arrived beside me or left.
    const arrived = [];
    const left = [];
    for (const id of neighbours(nextMine.id)) {
      const before = prev.tiles[id];
      const after = next.tiles[id];
      if (claimed(after) && !sameHolder(before, after)) arrived.push(after.label);
      if (claimed(before) && !sameHolder(before, after)) left.push(before.label);
    }
    const h = nextMine.height;
    const at = h > prevMine.height ? `You're up to height ${h}.` : h < prevMine.height ? `You're down to height ${h}.` : "";
    if (arrived.length) messages.push({ key: "arrived", text: `${names(arrived)} settled beside you. ${at}`.trim() });
    if (left.length) {
      // Replaced on the same tile reads as one arrival plus one departure.
      const after = arrived.length ? "" : ` ${at}`;
      messages.push({ key: "left", text: `${names(left)} moved away from beside you.${after}`.trim() });
    }
  }

  return { rises, messages };
}

// The phone confirm bar's wording for a tapped tile.
export function describeTile(board, id) {
  const t = board.tiles[id];
  const where = place(id);
  const around = neighbours(id).filter((n) => claimed(board.tiles[n]) && board.tiles[n].state !== "mine").length;
  const lift = around === 0 ? "No neighbours yet" : `Would lift ${around} neighbour${around === 1 ? "" : "s"}`;
  if (t.state === "mine") return { title: `Your tile, ${where}`, action: "Rename here", open: true };
  if (t.state === "held") return { title: `${t.label} holds ${where}`, action: null, open: false };
  if (t.state === "dormant") {
    return { title: `${t.label} has been away over a day. ${lift}.`, action: `Settle on ${where}`, open: true };
  }
  return { title: `${lift}.`, action: `Claim ${where}`, open: true };
}
