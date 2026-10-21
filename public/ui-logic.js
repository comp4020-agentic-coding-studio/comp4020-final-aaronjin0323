// The page's decisions, as small pure functions: when to send a slider's
// value, what a part's lease looks like from here, which publish flow a
// choice means, and whether the page may edit. No DOM and no fetch, so
// spec/ui-logic.test.ts can hold them without a browser or a server.

/** The page sends a dragged slider's latest value at most this often (ms),
 * and always on release (CLAUDE.md, "The workbench"). */
export const SEND_INTERVAL = 100;
/** Renew a held lease this often while the slider is held (ms). The lease
 * itself is 15 s; renewing at a third of that leaves room for a slow reply. */
export const RENEW_INTERVAL = 5000;
/** Let go of a part this long after the last touch (ms). */
export const RELEASE_IDLE = 1500;
/** After an edit is sent, keep showing the local value over the server's for
 * this long (ms), so an older broadcast doesn't make the slider jump back. */
export const LOCAL_HOLD = 800;

/**
 * Whether to send a throttled edit now, or how long to wait. `lastSent` is
 * when the last edit for this part went out (or null), `final` is true on
 * release, which always sends at once.
 * @param {{ lastSent: number | null, now: number, final?: boolean, interval?: number }} o
 * @returns {{ send: true } | { send: false, wait: number }}
 */
export function throttle({ lastSent, now, final = false, interval = SEND_INTERVAL }) {
  if (final || lastSent === null) return { send: true };
  const since = now - lastSent;
  if (since >= interval) return { send: true };
  return { send: false, wait: interval - since };
}

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
 * What a part's lease looks like from this page. An expired lease is free,
 * whether or not the server has swept it (CLAUDE.md, "Leases end on the
 * clock"). `serverNow` is the server's clock as the page estimates it.
 * @param {Array<{part: string, holder: {tag: string, name: string, colour: number}, expiresAt: string, mine: boolean}>} leases
 * @param {string} part
 * @param {number} serverNow ms
 * @returns {{ kind: "free" } | { kind: "mine", expiresAt: number } | { kind: "held", holder: {tag: string, name: string, colour: number}, expiresAt: number }}
 */
export function leaseState(leases, part, serverNow) {
  const lease = leases.find((l) => l.part === part);
  if (!lease) return { kind: "free" };
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= serverNow) return { kind: "free" };
  if (lease.mine) return { kind: "mine", expiresAt };
  return { kind: "held", holder: lease.holder, expiresAt };
}

/**
 * The numbers to show for a part: the server's, with any value this page is
 * still sending laid over them.
 * @param {Record<string, number>} server
 * @param {{ values: Record<string, number>, until: number } | undefined} local
 * @param {number} now local ms
 */
export function shownValues(server, local, now) {
  if (!local || local.until < now) return { ...server };
  return { ...server, ...local.values };
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

/**
 * Bringing something onto the bench: a plain remix when the bench is empty,
 * otherwise only the separately labelled "Replace the workbench", which
 * archives what's there first and is confirmed.
 * @param {{ recipe: string | null }} draft
 */
export function benchAction(draft) {
  return draft.recipe === null ? { kind: "remix", replace: false } : { kind: "replace", replace: true };
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
export function frameHeight(lo, hi, fovDeg, aspect, margin = 1.25) {
  const half = (Math.max(hi - lo, 0.5) * margin) / 2;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tan = Math.min(tanV, tanV * aspect);
  return { focusY: (lo + hi) / 2, dist: Math.max(CLOSE_UP, half / tan) };
}
