// The shapes that cross the wire: what the server sends in every `state`
// event and what each POST takes. The server builds them; the page reads
// them. CLAUDE.md, "The contract", is the prose for these. Change a shape
// there first, then here, then both sides.

/** A visitor as anyone may see them: never the cookie. `tag` is the first
 * 6 hex of a SHA-256 of the pid, stable for as long as the cookie is. */
export type VisitorView = {
  tag: string;
  name: string;
  /** an index into VISITOR_COLOURS */
  colour: number;
};

/** Someone credited on a draft or a version. Name and colour as they were
 * when the work was done, so a later rename doesn't rewrite history. */
export type Credit = VisitorView & { edits: number };

/** One gesture in a loop (public/stage.js): when in the loop it happened,
 * what was done to which object, and who did it (their tag). The kinds,
 * objects and any further number fields are the set's (public/sets/<id>.js,
 * `gestures`); checkGesture refuses anything else. */
export type Gesture = {
  /** a kind the set declares; `throw` is the shared one for holdables */
  kind: string;
  object: string;
  /** seconds into the loop, 0 to under LOOP */
  at: number;
  /** a throw: where it was let go, and its speed */
  from?: number[];
  v?: number[];
  /** e.g. Orbit's pluck: where round the ribbon, 0 to under 1 */
  u?: number;
  by: string;
  /** a set's own fields: numbers, or lists of numbers */
  [field: string]: string | number | number[] | undefined;
};

/** A performance: a set of objects and the loop of gestures played on it. */
export type Performance = { set: string; gestures: Gesture[] };

/** Someone holding an object (CLAUDE.md, "Grabbing takes it"). */
export type ClaimView = {
  /** the held object's id: one of the live set's `holdable` */
  part: string;
  holder: VisitorView;
  /** ISO time; the claim ends then unless they throw or drop first */
  expiresAt: string;
  mine: boolean;
};

/** The live loop on the stage. Its name is from the workbench it replaced:
 * one live row, archived when replaced or cleared. */
export type DraftView = {
  id: number;
  /** "stage" for a performance; null only before the first migration ran */
  recipe: string | null;
  parts: Performance | null;
  /** bumps on every accepted change to the loop */
  revision: number;
  /** everyone with a gesture in the loop, counted per gesture */
  contributors: Credit[];
  /** the exhibit version this draft was remixed from, if any */
  basedOn: { exhibitId: number; versionId: number; title: string; n: number } | null;
};

export type VersionView = {
  id: number;
  exhibitId: number;
  /** 1, 2, 3... within its exhibit */
  n: number;
  title: string;
  /** "stage", or an old sculpture recipe (kept in the storeroom) */
  recipe: string;
  /** a Performance when recipe is "stage"; the old numbers otherwise */
  parts: Performance;
  contributors: Credit[];
  publishedBy: VisitorView | null; // null: the museum's own starter
  publishedAt: string;
  /** set when this version was made by restoring an earlier one */
  restoredFrom: number | null;
  basedOn: { exhibitId: number; versionId: number; title: string; n: number } | null;
};

export type ExhibitView = {
  id: number;
  /** 1..6 while on display, null in the storeroom */
  slot: number | null;
  latest: VersionView;
  versionCount: number;
};

export type ArchivedDraftView = {
  id: number;
  recipe: string;
  /** the set a loop was played on; null for an old sculpture */
  set: string | null;
  archivedAt: string;
  reason: "replaced" | "cleared";
  archivedBy: VisitorView | null;
  contributors: Credit[];
};

/** The whole museum, sent on connect and after every change. Each stream
 * gets its own copy because `you` and `claim.mine` depend on who's asking. */
export type StateEvent = {
  /** server clock at send, ISO; the page derives its animation time base */
  serverTime: string;
  /** bumps on every broadcast; seeded from the clock at boot */
  seq: number;
  you: VisitorView;
  /** visitors with at least one open stream, you included, and what each holds */
  present: (VisitorView & { holding: string[] })[];
  draft: DraftView;
  claims: ClaimView[];
  /** always six entries, slot 1..6 in order */
  slots: { slot: number; exhibit: ExhibitView | null }[];
  storeroom: ExhibitView[];
  /** the newest few; GET /archive pages back through the rest */
  archivedDrafts: ArchivedDraftView[];
  archivedTotal: number;
};

/** POST /pose: where you stand and look, in metres and radians from the
 * stage centre (y up). In memory only; never stored, never in `state`. */
export type PoseBody = {
  /** [x, z] on the floor, each within -9..9 */
  at: [number, number];
  /** [yaw, pitch]: yaw within -1000..1000, pitch within -1.5..1.5 */
  look: [number, number];
  /** where your hand or reticle points, world space, each within -10..10 */
  reach?: [number, number, number] | null;
  /** an id some set lets you hold (HOLDABLE in public/stage.js); display
   * only, the claim in `state` is the authority */
  holding?: string | null;
};

/** Someone's newest pose as everyone sees it: never the pid. */
export type PoseView = VisitorView & {
  at: [number, number];
  look: [number, number];
  reach: [number, number, number] | null;
  holding: string | null;
  /** ms since the server received it */
  age: number;
};

/** The SSE `poses` event: everyone present with a pose newer than 5 s, you
 * included (the page skips itself by tag). At most every 100 ms, and only
 * after something changed. */
export type PosesEvent = { t: number; poses: PoseView[] };

/** GET /archive?before=<id> */
export type ArchivePage = { drafts: ArchivedDraftView[]; more: boolean };

/** GET /exhibits/:id */
export type ExhibitHistory = { exhibit: ExhibitView; versions: VersionView[] };

/** What every POST answers with on success: the museum as you now see it
 * (the same shape as a `state` event, `seq` included, so the page keeps
 * whichever of this and the stream's event is newer), plus any fields the
 * route adds (e.g. publish's `exhibitId`, `versionId`, `n`). */
export type ActionOk = { ok: true; state: StateEvent } & Record<string, unknown>;

/** Every refusal. `taken` also names who holds the sphere now;
 * `slot-taken` also carries what's in the slot, so the page can ask. */
export type Refusal = {
  error: ErrorCode;
  message: string;
  holder?: VisitorView;
  expiresAt?: string;
  exhibit?: ExhibitView;
};

/** Every refusal is { error, message } with one of these codes. */
export type ErrorCode =
  | "bad-request"
  | "cross-origin"
  | "not-found"
  | "taken"
  | "nothing-to-undo"
  | "stage-busy"
  | "stage-empty"
  | "slot-taken"
  | "slot-empty";
