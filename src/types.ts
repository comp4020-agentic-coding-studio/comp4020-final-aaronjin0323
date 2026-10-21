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

/** Parameter values by part id, then parameter id (public/recipes.js). */
export type Parts = Record<string, Record<string, number>>;

export type LeaseView = {
  part: string;
  holder: VisitorView;
  /** ISO time; the lease is free after it unless renewed */
  expiresAt: string;
  mine: boolean;
};

export type DraftView = {
  id: number;
  /** null when the workbench is empty */
  recipe: string | null;
  parts: Parts | null;
  /** bumps on every accepted change to this draft */
  revision: number;
  /** who last shaped each part, by part id */
  partAuthors: Record<string, VisitorView>;
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
  recipe: string;
  parts: Parts;
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
  archivedAt: string;
  reason: "replaced" | "cleared";
  archivedBy: VisitorView | null;
  contributors: Credit[];
};

/** The whole museum, sent on connect and after every change. Each stream
 * gets its own copy because `you` and `lease.mine` depend on who's asking. */
export type StateEvent = {
  /** server clock at send, ISO; the page derives its animation time base */
  serverTime: string;
  /** bumps on every broadcast; seeded from the clock at boot */
  seq: number;
  you: VisitorView;
  /** visitors with at least one open stream, you included */
  present: (VisitorView & { editing: string[] })[];
  draft: DraftView;
  leases: LeaseView[];
  /** always six entries, slot 1..6 in order */
  slots: { slot: number; exhibit: ExhibitView | null }[];
  storeroom: ExhibitView[];
  archivedDrafts: ArchivedDraftView[];
};

/** GET /exhibits/:id */
export type ExhibitHistory = { exhibit: ExhibitView; versions: VersionView[] };

/** What every POST answers with on success: the museum as you now see it
 * (the same shape as a `state` event, `seq` included, so the page keeps
 * whichever of this and the stream's event is newer), plus any fields the
 * route adds (e.g. publish's `exhibitId`, `versionId`, `n`). */
export type ActionOk = { ok: true; state: StateEvent } & Record<string, unknown>;

/** Every refusal. `lease-held` also names the holder and when the lease
 * ends; `slot-taken` also carries what's in the slot, so the page can ask. */
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
  | "lease-held"
  | "no-lease"
  | "draft-not-empty"
  | "draft-empty"
  | "slot-taken"
  | "slot-empty";
