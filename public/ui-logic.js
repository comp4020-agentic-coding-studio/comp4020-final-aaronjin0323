// The page's decisions, as small pure functions: the clock, the
// connection, which publish flow a choice means, and the words the page
// uses for a gesture or a performance. No DOM and no fetch, so
// spec/ui-logic.test.ts can hold them without a browser or a server.

/**
 * The page's clock offset from the server's, from the `serverTime` of an
 * event and the local time it arrived.
 * @param {string} serverTime ISO
 * @param {number} receivedAt local ms
 */
export function clockOffset(serverTime, receivedAt) {
  const server = Date.parse(serverTime);
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/** Shared animation time in seconds: the same on every screen. */
export function sharedSeconds(localNow, offset) {
  return (localNow + offset) / 1000;
}

/**
 * The connection, as a small state machine. Editing is allowed only once the
 * first `state` event of the current connection has arrived; a drop takes it
 * away at once and keeps it away until the next connection's first state.
 * @typedef {{ status: "connecting" | "live" | "reconnecting", hasState: boolean, everLive: boolean }} Conn
 * @param {Conn} conn
 * @param {"open" | "state" | "error"} event
 * @returns {Conn}
 */
export function connection(conn, event) {
  switch (event) {
    case "open":
      // A stream is open but its first state hasn't replaced our copy yet.
      return { ...conn, hasState: false };
    case "state":
      return { status: "live", hasState: true, everLive: true };
    case "error":
      return { status: conn.everLive ? "reconnecting" : "connecting", hasState: false, everLive: conn.everLive };
    default:
      return conn;
  }
}

export const INITIAL_CONN = /** @type {Conn} */ ({ status: "connecting", hasState: false, everLive: false });

/** @param {Conn} conn */
export const canEdit = (conn) => conn.status === "live" && conn.hasState;

/** The line the page shows for a connection state, or "" when live. */
export function connectionMessage(conn) {
  if (canEdit(conn)) return "";
  if (conn.status === "reconnecting") return "Reconnecting… look, don't touch";
  return "Connecting…";
}

/**
 * What publishing to a target means, before anything is sent. The target is
 * a slot number (a new exhibit there) or an exhibit id (its next version).
 * A taken slot needs an explicit yes that names the exhibit going to the
 * storeroom (CLAUDE.md, "Six slots, never silent eviction").
 * @param {{ slots: Array<{slot: number, exhibit: null | {id: number, latest: {title: string, n: number}, versionCount: number}}>, storeroom: Array<{id: number, latest: {title: string, n: number}, versionCount: number}> }} state
 * @param {{ slot: number } | { exhibitId: number }} target
 * @param {string} title
 */
export function publishPlan(state, target, title) {
  if ("exhibitId" in target) {
    const all = [...state.slots.map((s) => s.exhibit).filter(Boolean), ...state.storeroom];
    const exhibit = all.find((e) => e && e.id === target.exhibitId);
    if (!exhibit) return { kind: "invalid", reason: "That exhibit isn't here any more." };
    return {
      kind: "add-version",
      body: { title, exhibitId: exhibit.id },
      confirm: null,
      summary: `Adds version ${exhibit.versionCount + 1} to "${exhibit.latest.title}". Earlier versions stay in its history.`,
    };
  }
  const entry = state.slots.find((s) => s.slot === target.slot);
  if (!entry) return { kind: "invalid", reason: "There's no such slot." };
  if (!entry.exhibit) {
    return { kind: "new-slot", body: { title, slot: target.slot }, confirm: null, summary: `A new exhibit on plinth ${target.slot}.` };
  }
  const moving = entry.exhibit;
  return {
    kind: "replace-slot",
    body: { title, slot: target.slot, replace: true },
    confirm: `"${moving.latest.title}" (${plural(moving.versionCount, "version")}) moves to the storeroom, and can be put back later. Publish on plinth ${target.slot}?`,
    summary: `Replaces "${moving.latest.title}" on plinth ${target.slot}.`,
  };
}

/** Titles are 1-40 characters after trimming, as the server checks. */
export function titleProblem(title) {
  const t = title.trim();
  if (t.length === 0) return "Give it a title.";
  if (t.length > 40) return `Titles are at most 40 characters (this is ${t.length}).`;
  return null;
}

/** Names are 1-24 characters after trimming. */
export function nameProblem(name) {
  const t = name.trim();
  if (t.length === 0) return "A name needs at least one character.";
  if (t.length > 24) return `Names are at most 24 characters (this is ${t.length}).`;
  return null;
}

const PAST = { throw: "thrown", pluck: "plucked", tap: "rung" };

/** A gesture in at most four words, for a toast: "Undid: teal thrown". */
export function gestureLine(g, verb) {
  return `${verb}: ${g.object} ${PAST[g.kind] ?? "played"}`;
}

const NOUN = { bell: "Bell", ribbon: "Ribbon", chrome: "Chrome", teal: "Teal", gold: "Gold", dusk: "Dusk" };
const MOOD = ["Panic", "Waltz", "Rodeo", "Quarrel", "Lullaby", "Fanfare", "Tantrum", "Picnic", "Shuffle", "Duet"];
const CROWD = ["", "", " for Two", " for Three", " for Four", " for a Crowd"];

/**
 * A playful title suggested for a performance, from what was played most
 * and how many played it: "Bell Panic for Three". The same loop always
 * suggests the same title, and it's always a valid one. The visitor can
 * change it.
 * @param {{ set?: string, gestures: Array<{ object: string, by: string, at: number }> }} p
 */
export function playfulTitle(p) {
  const count = new Map();
  for (const g of p.gestures) count.set(g.object, (count.get(g.object) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "bell";
  const players = new Set(p.gestures.map((g) => g.by)).size;
  // a small stable hash of the loop picks the mood
  let h = 7;
  for (const g of p.gestures) h = (h * 31 + Math.round(g.at * 1000) + g.object.length) % 9973;
  const name = `${NOUN[top] ?? "Sphere"} ${MOOD[h % MOOD.length]}${CROWD[Math.min(players, CROWD.length - 1)]}`;
  return name.slice(0, 40);
}

/** The empty slots, in order. */
export const emptySlots = (slots) => slots.filter((s) => !s.exhibit).map((s) => s.slot);

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A refusal's message for a person, from the server's `{ error, message }`. */
export function refusalText(status, body) {
  if (body && typeof body.message === "string" && body.message) return body.message;
  if (status === 0) return "Couldn't reach the museum.";
  return `That didn't work (${status}).`;
}

/** The usual plinth close-up distance, for a sculpture of ordinary height. */
export const CLOSE_UP = 5.4;

/**
 * Where a plinth close-up looks and how far back it stands, so a sculpture
 * from `lo` to `hi` (world heights) fits with a margin. A sculpture's sliders
 * can lift a part well above the plinth, so a fixed framing cut tall ones
 * off. On a portrait screen the narrower horizontal view decides instead.
 * @returns {{ focusY: number, dist: number }}
 */
export function frameHeight(lo, hi, fovDeg, aspect, margin = 1.25, nearest = CLOSE_UP) {
  const half = (Math.max(hi - lo, 0.5) * margin) / 2;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tan = Math.min(tanV, tanV * aspect);
  return { focusY: (lo + hi) / 2, dist: Math.max(nearest, half / tan) };
}

/**
 * The part of the scene a fitted picture may use: the canvas minus whatever
 * lies over it (the side panel, the header pills, the plinth row). Each
 * cover that overlaps trims the side of the clear rectangle that costs the
 * least area. Rects are `{ x, y, w, h }` in the same coordinates; the
 * answer is relative to the canvas.
 */
export function clearFrame(canvas, covers) {
  let l = canvas.x, t = canvas.y, r = canvas.x + canvas.w, b = canvas.y + canvas.h;
  for (const c of covers) {
    const cl = c.x, ct = c.y, cr = c.x + c.w, cb = c.y + c.h;
    if (cr <= l || cl >= r || cb <= t || ct >= b) continue;
    const width = r - l, height = b - t;
    const options = [
      { cost: (cb - t) * width, apply: () => (t = cb) },
      { cost: (b - ct) * width, apply: () => (b = ct) },
      { cost: (cr - l) * height, apply: () => (l = cr) },
      { cost: (r - cl) * height, apply: () => (r = cl) },
    ];
    options.sort((x, y) => x.cost - y.cost)[0].apply();
  }
  return { x: l - canvas.x, y: t - canvas.y, w: Math.max(0, r - l), h: Math.max(0, b - t) };
}

/**
 * A camera view offset that puts the clear rectangle's centre at the centre
 * of the picture: the canvas becomes a window onto a larger virtual frame.
 * Feed it to `PerspectiveCamera.setViewOffset(fullW, fullH, offX, offY, w, h)`.
 */
export function viewOffsetFor(w, h, clear) {
  const cx = clear.x + clear.w / 2;
  const cy = clear.y + clear.h / 2;
  const fullW = 2 * Math.max(cx, w - cx);
  const fullH = 2 * Math.max(cy, h - cy);
  return { fullW, fullH, offX: fullW / 2 - cx, offY: fullH / 2 - cy };
}
