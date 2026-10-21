// The museum page: the stream, the DOM controls and the 3D scene.
//
// The DOM holds every control (CLAUDE.md, "Phone and keyboard"); the canvas
// is decoration over it, loaded on its own so the page still works when
// WebGL or the CDN isn't there. Names and titles only ever reach the page as
// textContent. The decisions (throttle, lease display, publish flow,
// connection) live in ui-logic.js, where a test can hold them.
import { PALETTE, RECIPES, VISITOR_COLOURS, defaultParts } from "./recipes.js";
import { SPHERES, dropOn, ribbonPoint, sphereAt } from "./orbit.js";
import {
  INITIAL_CONN,
  LOCAL_HOLD,
  RELEASE_IDLE,
  RENEW_INTERVAL,
  benchAction,
  canEdit,
  clockOffset,
  connection,
  connectionMessage,
  emptySlots,
  leaseState,
  nameProblem,
  plural,
  publishPlan,
  refusalText,
  sharedSeconds,
  shownValues,
  throttle,
  titleProblem,
} from "./ui-logic.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** Builds an element. Strings among the children become text nodes, so a
 * name or a title can never become markup. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style") for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

const colourOf = (v) => VISITOR_COLOURS[v.colour] ?? VISITOR_COLOURS[0];

/** A visitor as a coloured chip: a dot and their name. */
function chip(v, extra = "") {
  return el("span", { class: "chip", style: { "--who": colourOf(v) }, title: `#${v.tag}` }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "chip-name" }, v.name), extra ? el("span", { class: "chip-extra" }, extra) : null);
}

/** A visitor as a coloured dot only: the name is its accessible name and
 * tooltip (ADR 13). `ring` marks you. */
function dot(v, { you = false, note = "" } = {}) {
  const label = `${v.name}${you ? " (you)" : ""}${note ? `, ${note}` : ""}`;
  return el("span", { class: `who${you ? " is-you" : ""}`, style: { "--who": colourOf(v) }, title: label, role: "img", "aria-label": label });
}

/** A sculpture's own colours (each part's colour), as a small conic swatch. */
function swatchOf(recipe, parts) {
  const r = RECIPES[recipe];
  if (!r || !parts) return el("span", { class: "thumb is-empty", "aria-hidden": "true" });
  const cols = Object.keys(r.parts).map((p) => PALETTE[parts[p]?.colour ?? 0]?.hex ?? PALETTE[0].hex);
  const stops = cols.map((c, i) => `${c} ${Math.round((i / cols.length) * 360)}deg ${Math.round(((i + 1) / cols.length) * 360)}deg`).join(", ");
  return el("span", { class: "thumb", style: { "--thumb": `conic-gradient(${stops})` }, "aria-hidden": "true" });
}

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------- state

let state = /** @type {any} */ (null);
let conn = INITIAL_CONN;
let offset = 0;
/** what's being looked at: the bench, a plinth, or a storeroom exhibit */
let selected = /** @type {{kind: "bench"} | {kind: "slot", slot: number} | {kind: "exhibit", id: number}} */ ({ kind: "bench" });
const historyCache = new Map();
let scene = null;
let cameraMoved = false; // the visitor turned, dragged or zoomed the camera
/** create mode: the workbench editor is open (ADR 14); explore otherwise */
let creating = false;

const serverNow = () => Date.now() + offset;
// the time the scene draws sculptures at: the shared clock, or 0 when still
const drawSeconds = () => (reducedMotion.matches ? 0 : sharedSeconds(Date.now(), offset));
const editable = () => canEdit(conn);

// Per-part sending state for the slider currently being worked.
/** @type {Map<string, {values: Record<string, number>, until: number}>} */
const local = new Map();
/** @type {Map<string, {lastSent: number | null, timer: any, pending: Record<string, number>, held: boolean, renew: any, release: any, refused: boolean}>} */
const sending = new Map();
let draftKey = null; // which draft the part controls were built for

// ---------------------------------------------------------------- network

async function post(path, body = {}) {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body: json };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** Posts, and on a refusal says why. */
async function act(path, body, done) {
  if (!editable()) return null;
  const r = await post(path, body);
  if (!r.ok) toast(refusalText(r.status, r.body));
  else if (done) toast(done, "ok");
  return r;
}

let es = null;
let retry = null;
function connect() {
  clearTimeout(retry);
  es = new EventSource("/events");
  es.addEventListener("open", () => {
    conn = connection(conn, "open");
    renderConnection();
  });
  es.addEventListener("state", (e) => {
    const next = JSON.parse(e.data);
    offset = clockOffset(next.serverTime, Date.now());
    state = next;
    conn = connection(conn, "state");
    render();
  });
  es.addEventListener("error", () => dropped(es.readyState === EventSource.CLOSED));
}

function dropped(closed) {
  conn = connection(conn, "error");
  for (const part of sending.keys()) stopHolding(part);
  renderConnection();
  // EventSource retries by itself unless the server answered with an
  // error; then it gives up, so start a fresh one.
  if (closed && navigator.onLine !== false) retry = setTimeout(connect, 2000);
}

// An open stream can outlive the network going away without an error for a
// long while; the browser saying it's offline is a drop now.
window.addEventListener("offline", () => {
  es?.close();
  clearTimeout(retry);
  dropped(false);
});
window.addEventListener("online", () => {
  es?.close();
  connect();
});

// ---------------------------------------------------------------- toast and ask

let toastTimer = null;
function toast(text, tone = "warn") {
  const t = $("[data-toast]");
  t.textContent = text;
  t.dataset.tone = tone;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), tone === "ok" ? 3000 : 6000);
}

/** A yes/no question in a modal dialog; resolves true only on yes. */
function ask(text, yes = "Yes") {
  const dialog = $("[data-ask]");
  $("[data-ask-text]").textContent = text;
  $("[data-ask-yes]").textContent = yes;
  if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(text));
  return new Promise((resolve) => {
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
    dialog.showModal();
  });
}

// ---------------------------------------------------------------- render

function render() {
  if (!state) return;
  $("[data-static]").hidden = true;
  $("[data-people]").hidden = false;
  $("[data-nav]").hidden = false;
  // history and archives stay out of the way while making an Orbit (ADR 15)
  $("[data-drawers]").hidden = creating && state.draft.recipe === "orbit";
  if (selected.kind === "exhibit" && !findExhibit(selected.id)) selected = { kind: "bench" };
  if (selected.kind === "exhibit") {
    const e = findExhibit(selected.id);
    if (e.slot !== null) selected = { kind: "slot", slot: e.slot };
  }
  renderPeople();
  renderNav();
  renderBench();
  renderExhibit();
  renderDrawers();
  renderConnection();
  renderHome();
  // the panel's size follows the mode; the scene re-composes for it
  document.body.dataset.mode = creating ? "create" : "explore";
  scene?.update(state, { ...selected, mode: creating ? "create" : "explore" }, currentDraftParts(), [...sending.values()].some((x) => x.held));
}

function renderConnection() {
  const msg = connectionMessage(conn);
  const status = $("[data-status]");
  status.textContent = msg;
  status.hidden = !msg;
  document.body.dataset.conn = conn.status;
  applyEnabled();
}

/** One place decides whether each control is usable: the connection, and
 * whether its part is someone else's. */
function applyEnabled() {
  const on = editable();
  for (const c of $$("[data-edit]")) c.disabled = !on || c.dataset.blocked === "1";
}

function renderPeople() {
  const you = $("[data-you]");
  you.replaceChildren(chip(state.you));
  const here = $("[data-here]");
  here.replaceChildren(
    ...state.present.map((p) => {
      const editing = p.editing.map((part) => partName(part)).filter(Boolean);
      const you = p.tag === state.you.tag;
      return el("li", { class: editing.length ? "is-editing" : "" }, dot(p, { you, note: editing.length ? `shaping the ${editing.join(", ")}` : "" }));
    }),
  );
}

function partName(part) {
  const recipe = state?.draft.recipe && RECIPES[state.draft.recipe];
  return recipe && Object.hasOwn(recipe.parts, part) ? recipe.parts[part].name.toLowerCase() : "";
}

function renderNav() {
  const list = $("[data-plinths]");
  const bench = state.draft.recipe ? RECIPES[state.draft.recipe].name : "empty";
  const items = [
    { key: "bench", label: "★", name: `Workbench: ${bench}`, recipe: state.draft.recipe, parts: state.draft.parts, pressed: selected.kind === "bench" },
    ...state.slots.map((s) => ({ key: `slot:${s.slot}`, label: String(s.slot), name: `Plinth ${s.slot}: ${s.exhibit ? s.exhibit.latest.title : "empty"}`, recipe: s.exhibit?.latest.recipe ?? null, parts: s.exhibit?.latest.parts ?? null, empty: !s.exhibit, pressed: selected.kind === "slot" && selected.slot === s.slot })),
  ];
  // Rebuild only when the labels change, so focus stays on the button.
  const sig = JSON.stringify(items);
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  const focused = document.activeElement?.closest?.("[data-go]")?.dataset.go;
  list.replaceChildren(
    ...items.map((it) =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", class: `plinth-btn${it.key === "bench" ? " is-bench" : ""}${it.empty ? " is-empty" : ""}`, "aria-pressed": String(it.pressed), "aria-label": it.name, title: it.name, dataset: { go: it.key } },
          swatchOf(it.recipe, it.parts),
          el("span", { class: "plinth-label", "aria-hidden": "true" }, it.label),
        ),
      ),
    ),
  );
  if (focused) $(`[data-go="${focused}"]`)?.focus();
}

function select(next, { focusHeading = false, create = false } = {}) {
  selected = next;
  creating = create && next.kind === "bench";
  closePublish();
  render();
  if (focusHeading) $(selected.kind === "bench" ? "#bench-h" : "#exhibit-h")?.focus({ preventScroll: true });
  const panel = $(".panel");
  if (getComputedStyle(panel).overflowY === "auto") panel.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  // on the phone the plinth row scrolls sideways: bring the chosen one into it
  $("[data-plinths] [aria-pressed='true']")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

// Back to the gallery: shown whenever the view isn't the opening one.
function renderHome() {
  $("[data-home]").hidden = !creating && (!scene || (selected.kind === "bench" && !cameraMoved));
}
function goHome() {
  const wasCreating = creating;
  const wasBench = selected.kind === "bench";
  select({ kind: "bench" });
  if (wasBench) scene?.home();
  // out of the editor, back to the button that opened it
  if (wasCreating && !$("[data-shape]").hidden) $("[data-shape]").focus();
  else $("[data-scene]").focus({ preventScroll: true });
}
$("[data-home]").addEventListener("click", goHome);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || $("[data-ask]").open) return;
  if (e.target.closest?.("input:not([type=range]):not([type=radio]), select, textarea, form")) return;
  e.preventDefault();
  if (creating) return leaveEditor();
  if ($("[data-home]").hidden) return;
  goHome();
});

$("[data-plinths]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  const go = b.dataset.go;
  select(go === "bench" ? { kind: "bench" } : { kind: "slot", slot: Number(go.split(":")[1]) });
});

// ---------------------------------------------------------------- the bench

function renderBench() {
  const view = $('[data-view="bench"]');
  view.hidden = selected.kind !== "bench";
  const d = state.draft;
  const empty = d.recipe === null;
  $("[data-bench-empty]").hidden = !empty;
  $("[data-bench-full]").hidden = empty;
  // explore shows the card; create shows the editor under it (ADR 14)
  view.dataset.mode = creating ? "create" : "explore";
  $("[data-editor]").hidden = !creating;
  $("[data-shape]").hidden = empty || creating;
  $("[data-play]").hidden = creating || d.recipe === "orbit";
  $("[data-done]").hidden = !creating;
  // an Orbit draft is pieces, Undo and Exhibit; the sliders wait under
  // Fine-tune (ADR 15). Every other recipe keeps its sliders open.
  const orbit = d.recipe === "orbit";
  document.body.dataset.recipe = d.recipe ?? "";
  $("[data-pieces]").hidden = !orbit;
  $("[data-undo]").hidden = !orbit;
  const fine = $("[data-fine-tune]");
  if (fine.dataset.for !== String(orbit)) {
    fine.dataset.for = String(orbit);
    fine.open = !orbit;
  }
  $("[data-bench-thumb]").replaceChildren(swatchOf(d.recipe, d.parts));
  if (empty) {
    $("[data-bench-title]").textContent = "Workbench";
    $("[data-bench-credits]").replaceChildren();
    draftKey = null;
    local.clear();
    renderStarters();
    closePublish();
    return;
  }
  const recipe = RECIPES[d.recipe];
  $("[data-bench-title]").textContent = recipe.name;
  $("[data-bench-recipe]").textContent = recipe.name;
  const based = $("[data-bench-based]");
  based.textContent = d.basedOn ? `, remixed from "${d.basedOn.title}", version ${d.basedOn.n}` : "";
  const key = `${d.id}:${d.recipe}`;
  if (draftKey !== key) {
    draftKey = key;
    local.clear();
    buildParts(d.recipe);
  }
  updateParts();
  if (orbit) renderPieces();
  $("[data-bench-credits]").replaceChildren(...d.contributors.map((c) => el("li", {}, dot(c, { you: c.tag === state.you.tag, note: plural(c.edits, "edit") }))));
  if (!$("[data-publish]").hidden) renderTargets();
}

function renderStarters() {
  const list = $("[data-starters]");
  if (list.childElementCount) return;
  list.replaceChildren(
    ...Object.entries(RECIPES).sort(([a], [b]) => (b === "orbit") - (a === "orbit")).map(([id, r]) =>
      el("li", {}, el("button", { type: "button", class: "starter", "data-edit": true, title: r.blurb, "aria-label": `Start ${/^[AEIOU]/.test(r.name) ? "an" : "a"} ${r.name}: ${r.blurb}`, onclick: () => startDraft(id) }, swatchOf(id, defaultParts(id)), el("span", { class: "starter-name", "aria-hidden": "true" }, r.name))),
    ),
  );
}

// ---- create mode: in on a creative action, out by Done, Gallery or Escape

function openEditor() {
  select({ kind: "bench" }, { create: true });
  $("#bench-h").focus({ preventScroll: true });
}
function leaveEditor() {
  if (!creating) return;
  creating = false;
  closePublish();
  render();
  $("[data-shape]").focus();
}
async function startDraft(recipe) {
  const r = await act("/draft/start", { recipe });
  if (r?.ok) openEditor();
}
$("[data-shape]").addEventListener("click", openEditor);
$("[data-done]").addEventListener("click", leaveEditor);

// ---- Orbit (ADR 15): Play, the pieces, Undo

$("[data-play]").addEventListener("click", async () => {
  if (state.draft.recipe) {
    const name = RECIPES[state.draft.recipe].name;
    if (!(await ask(`Start an Orbit? The ${name} on the bench is kept in Archived drafts.`, "Start an Orbit"))) return;
    const c = await act("/draft/clear", {});
    if (!c?.ok) return;
  }
  undo.length = 0;
  startDraft("orbit");
});

/** Your own edits on this draft, newest last: each the part and the numbers
 * it had before. Undo sends those numbers back as an ordinary edit. */
const undo = [];
let undoDraft = null;
function remember(part, keys) {
  const d = state.draft;
  if (undoDraft !== d.id) {
    undo.length = 0;
    undoDraft = d.id;
  }
  const before = {};
  for (const k of keys) before[k] = d.parts[part][k];
  undo.push({ part, before });
  if (undo.length > 30) undo.shift();
}
async function undoLast() {
  const last = undo.pop();
  if (!last || state.draft.id !== undoDraft) return toast("Nothing to undo");
  const r = await post("/draft/edit", { part: last.part, values: last.before });
  if (!r.ok) {
    toast(refusalText(r.status, r.body));
    return;
  }
  local.delete(last.part);
  toast("Undone", "ok");
  renderUndo();
}
function renderUndo() {
  $("[data-undo]").dataset.blocked = undo.length && undoDraft === state?.draft.id ? "0" : "1";
  applyEnabled();
}
$("[data-undo]").addEventListener("click", undoLast);

/** One whole change to a part from a piece (a drop, a button): remembered
 * for Undo, drawn at once, sent once with the part's lease. */
async function pieceEdit(part, values) {
  if (!editable() || !state.draft.recipe) return;
  const lease = leaseState(state.leases, part, serverNow());
  if (lease.kind === "held") return toast(`${lease.holder.name} has it`);
  remember(part, Object.keys(values));
  local.set(part, { values: { ...(local.get(part)?.values ?? {}), ...values }, until: Date.now() + LOCAL_HOLD + 400 });
  scene?.setDraftOverride(currentDraftParts());
  const r = await post("/draft/edit", { part, values });
  if (!r.ok) {
    undo.pop();
    local.delete(part);
    scene?.setDraftOverride(null);
    toast(refusalText(r.status, r.body));
  }
  renderUndo();
  if (state.draft.recipe) updateParts();
  renderPieces();
  // let go soon after, so the part is free for the next person
  const s = sendState(part);
  clearTimeout(s.release);
  s.release = setTimeout(() => {
    if (leaseState(state.leases, part, serverNow()).kind === "mine") post("/draft/release", { part });
  }, RELEASE_IDLE);
}

// A ribbon drag: steps from where the drag began, sent throttled like a
// slider, so others see the ribbon bend while it's held.
let ribbonStart = null;
function onPiece(ev) {
  if (state?.draft.recipe !== "orbit" || !creating) return;
  const d = state.draft;
  if (ev.kind === "grab") {
    if (ev.id === "ribbon") {
      ribbonStart = { ...d.parts.ribbon };
      remember("ribbon", ["turns", "radius"]);
      holdPart("ribbon");
    }
    return;
  }
  if (ev.kind === "reshape" && ribbonStart) {
    const p = RECIPES.orbit.parts.ribbon.params;
    const turns = Math.min(p.turns.max, Math.max(p.turns.min, ribbonStart.turns + ev.loops));
    const radius = Math.min(p.radius.max, Math.max(p.radius.min, Number((ribbonStart.radius + ev.reach).toFixed(2))));
    edit("ribbon", "turns", turns, false);
    edit("ribbon", "radius", radius, false);
    return;
  }
  if (ev.kind === "release") {
    if (ev.id === "ribbon") {
      if (ribbonStart) {
        const now = currentDraftParts().ribbon;
        // nothing changed: forget the Undo step
        if (now.turns === ribbonStart.turns && now.radius === ribbonStart.radius) undo.pop();
        else edit("ribbon", "radius", now.radius, true);
      }
      ribbonStart = null;
      letGo("ribbon");
      renderUndo();
      return;
    }
    if (ev.values) pieceEdit(ev.id, ev.values);
  }
}

// The pieces as buttons: the keyboard's way to do what a drag does.
function renderPieces() {
  const d = state.draft;
  const t = drawSeconds();
  const list = $("[data-piece-list]");
  const rows = SPHERES.map((id) => {
    const s = shownValues(d.parts[id], local.get(id), Date.now());
    const at = sphereAt(d.parts.ribbon, s, t);
    const name = RECIPES.orbit.parts[id].name;
    const lease = leaseState(state.leases, id, serverNow());
    return { id, s, at, name, lease };
  });
  const sig = JSON.stringify(rows.map((r) => [r.id, r.s.placed, r.at.caught, r.s.colour, r.lease.kind]));
  if (list.dataset.sig === sig) return renderUndo();
  list.dataset.sig = sig;
  const focused = document.activeElement?.closest?.("[data-piece]")?.dataset.piece;
  list.replaceChildren(
    ...rows.map(({ id, s, at, name, lease }) =>
      el(
        "li",
        { class: `piece${at.caught ? " is-caught" : ""}${s.placed ? " is-placed" : ""}`, dataset: { pieceRow: id, caught: String(at.caught) }, style: { "--piece": PALETTE[s.colour]?.hex ?? "#ccc" } },
        el("span", { class: "piece-ball", "aria-hidden": "true" }),
        el("span", { class: "sr-only" }, `${name}: ${s.placed ? (at.caught ? "riding the ribbon" : "resting on the sculpture") : "on the shelf"}. `),
        el(
          "button",
          { type: "button", class: "icon", "data-edit": true, dataset: { piece: `${id}:${s.placed ? "return" : "place"}`, blocked: lease.kind === "held" ? "1" : "0" }, "aria-label": s.placed ? `Return the ${name.toLowerCase()} to the shelf` : `Place the ${name.toLowerCase()} on the ribbon`, title: s.placed ? "Return to the shelf" : "Place on the ribbon" },
          s.placed ? "↩" : "＋",
        ),
        s.placed
          ? el("button", { type: "button", class: "icon", "data-edit": true, dataset: { piece: `${id}:along`, blocked: lease.kind === "held" ? "1" : "0" }, "aria-label": `Move the ${name.toLowerCase()} along the ribbon`, title: "Move along" }, "↻")
          : null,
      ),
    ),
  );
  if (focused) $(`[data-piece^="${focused.split(":")[0]}:"]`)?.focus();
  renderUndo();
}
$("[data-piece-list]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-piece]");
  if (!b || b.disabled) return;
  const [id, what] = b.dataset.piece.split(":");
  const s = state.draft.parts[id];
  if (what === "return") return pieceEdit(id, { placed: 0, ride: 0 });
  // onto the ribbon at its own place round the path, or an eighth further
  // along from where it is now: a point of the path, so the ribbon catches it
  const ribbon = state.draft.parts.ribbon;
  const t = drawSeconds();
  const now = sphereAt(ribbon, { ...defaultParts("orbit")[id], ...s }, t);
  const u = what === "along" && now.caught ? (now.u + 0.125) % 1 : SPHERES.indexOf(id) / SPHERES.length;
  pieceEdit(id, dropOn(ribbon, ribbonPoint(ribbon, u), t));
});
$$("[data-ribbon]").forEach((b) =>
  b.addEventListener("click", () => {
    const [key, step] = b.dataset.ribbon.split(":");
    const p = RECIPES.orbit.parts.ribbon.params[key];
    const v = Number((state.draft.parts.ribbon[key] + Number(step)).toFixed(2));
    if (v < p.min || v > p.max) return toast(step > 0 ? "As far as it goes" : "As small as it goes");
    pieceEdit("ribbon", { [key]: v });
  }),
);

// caught or not changes as spheres ride; keep the buttons' words true
setInterval(() => {
  if (state?.draft.recipe === "orbit" && creating) renderPieces();
}, 1000);

const TRANSFORM = new Set(["lift", "turn", "scale"]);
const openParts = new Set();

function buildParts(recipeId) {
  const recipe = RECIPES[recipeId];
  const box = $("[data-parts]");
  if (openParts.size === 0 || ![...openParts].some((p) => Object.hasOwn(recipe.parts, p))) {
    openParts.clear();
    openParts.add(Object.keys(recipe.parts)[0]);
  }
  box.replaceChildren(
    ...Object.entries(recipe.parts).map(([partId, part]) => {
      const bodyId = `part-${partId}`;
      const params = Object.entries(part.params);
      const own = params.filter(([k]) => !TRANSFORM.has(k));
      const place = params.filter(([k]) => TRANSFORM.has(k));
      return el(
        "section",
        { class: "part", dataset: { part: partId, lease: "free" } },
        el(
          "h3",
          { class: "part-head" },
          el("button", { type: "button", class: "part-toggle", "aria-expanded": String(openParts.has(partId)), "aria-controls": bodyId, dataset: { toggle: partId } }, el("span", { class: "part-name" }, part.name), el("span", { class: "chev", "aria-hidden": "true" })),
          el("span", { class: "lease", dataset: { leaseText: "" } }),
          el("span", { class: "author", dataset: { author: "" } }),
        ),
        el(
          "div",
          { class: "part-body", id: bodyId, hidden: !openParts.has(partId) },
          ...own.map(([k, p]) => control(partId, k, p)),
          el("hr", { class: "placement-h", "aria-hidden": "true" }),
          ...place.map(([k, p]) => control(partId, k, p)),
        ),
      );
    }),
  );
}

function control(partId, key, p) {
  const id = `${partId}-${key}`;
  if (p.kind === "colour") {
    return el(
      "div",
      { class: "param param-colour", role: "radiogroup", "aria-labelledby": `${id}-l` },
      el("span", { class: "param-label", id: `${id}-l` }, p.label),
      el(
        "div",
        { class: "swatches" },
        ...PALETTE.map((c, i) =>
          el(
            "label",
            { class: "swatch", style: { "--swatch": c.hex }, title: c.name },
            el("input", { type: "radio", name: id, value: i, "aria-label": c.name, "data-edit": true, dataset: { part: partId, key } }),
            el("span", { class: "swatch-face", "aria-hidden": "true" }),
          ),
        ),
      ),
    );
  }
  return el(
    "div",
    { class: "param" },
    el("label", { class: "param-label", for: id }, p.label),
    el("input", { type: "range", id, min: p.min, max: p.max, step: p.step, "data-edit": true, dataset: { part: partId, key } }),
    el("output", { for: id, class: "param-value" }),
  );
}

const fmt = (p, v) => (p.step >= 1 ? String(Math.round(v)) : String(Number(v.toFixed(2)))) + (p.label === "Turn" || p.label === "Tilt" ? "°" : "");

function updateParts() {
  const d = state.draft;
  const recipe = RECIPES[d.recipe];
  const now = Date.now();
  for (const section of $$("[data-parts] .part")) {
    const partId = section.dataset.part;
    const part = recipe.parts[partId];
    const lease = leaseState(state.leases, partId, serverNow());
    section.dataset.lease = lease.kind;
    const label = section.querySelector("[data-lease-text]");
    label.replaceChildren();
    section.style.removeProperty("--holder");
    // a held part shows only its holder's dot and name; free and yours say
    // nothing on screen (the ring in your colour is the sign)
    if (lease.kind === "mine") {
      section.style.setProperty("--holder", colourOf(state.you));
      label.append(el("span", { class: "sr-only" }, "You're shaping this"));
    } else if (lease.kind === "held") {
      section.style.setProperty("--holder", colourOf(lease.holder));
      label.append(chip(lease.holder), el("span", { class: "sr-only" }, " is shaping this"));
    } else {
      label.append(el("span", { class: "sr-only" }, "Free"));
    }
    const author = d.partAuthors[partId];
    section.querySelector("[data-author]").replaceChildren(...(author && lease.kind !== "held" ? [dot(author, { note: "shaped it last" })] : []));
    // any number a newer recipe added shows at its default
    const values = shownValues({ ...defaultParts(d.recipe)[partId], ...d.parts[partId] }, local.get(partId), now);
    const blocked = lease.kind === "held" || sending.get(partId)?.refused;
    for (const input of $$("input", section)) {
      input.dataset.blocked = blocked ? "1" : "0";
      const key = input.dataset.key;
      const p = part.params[key];
      const v = values[key];
      if (input.type === "radio") input.checked = Number(input.value) === v;
      else {
        if (document.activeElement !== input || !sending.get(partId)?.held) input.value = String(v);
        const out = input.nextElementSibling;
        out.textContent = fmt(p, v);
      }
    }
  }
  applyEnabled();
}

// Opening and closing a part's controls.
$("[data-parts]").addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]");
  if (!t) return;
  const part = t.dataset.toggle;
  const open = t.getAttribute("aria-expanded") !== "true";
  t.setAttribute("aria-expanded", String(open));
  $(`#part-${part}`).hidden = !open;
  if (open) openParts.add(part);
  else openParts.delete(part);
  scene?.focusPart(part);
});

// ---- sending edits: draw every frame, send at most every 100 ms, always on release

function sendState(part) {
  let s = sending.get(part);
  if (!s) {
    s = { lastSent: null, timer: null, pending: {}, held: false, renew: null, release: null, refused: false };
    sending.set(part, s);
  }
  return s;
}

function holdPart(part) {
  if (!editable()) return;
  const s = sendState(part);
  if (!s.held && state.draft.recipe === "orbit" && part !== "ribbon") remember(part, Object.keys(state.draft.parts[part]));
  s.held = true;
  clearTimeout(s.release);
  const lease = leaseState(state.leases, part, serverNow());
  if (lease.kind === "free") {
    post("/draft/lease", { part }).then((r) => {
      if (!r.ok) refuse(part, r);
    });
  }
  clearInterval(s.renew);
  s.renew = setInterval(() => {
    if (s.held && editable() && (s.lastSent === null || Date.now() - s.lastSent > RENEW_INTERVAL / 2)) post("/draft/lease", { part });
  }, RENEW_INTERVAL);
}

function letGo(part) {
  const s = sending.get(part);
  if (!s) return;
  s.held = false;
  clearInterval(s.renew);
  clearTimeout(s.release);
  const l = local.get(part);
  if (l) l.until = Date.now() + LOCAL_HOLD + 300;
  s.release = setTimeout(() => {
    if (s.held || Object.keys(s.pending).length) return;
    if (leaseState(state.leases, part, serverNow()).kind === "mine") post("/draft/release", { part });
  }, RELEASE_IDLE);
}

function stopHolding(part) {
  const s = sending.get(part);
  if (!s) return;
  s.held = false;
  clearInterval(s.renew);
  clearTimeout(s.timer);
  clearTimeout(s.release);
  s.pending = {};
  local.delete(part);
}

function refuse(part, r) {
  const s = sendState(part);
  stopHolding(part);
  s.refused = true;
  toast(refusalText(r.status, r.body));
  // The next state says who has it; until then the part stays blocked.
  setTimeout(() => {
    s.refused = false;
    if (state?.draft.recipe) updateParts();
  }, 1500);
  scene?.setDraftOverride(null);
  if (state?.draft.recipe) updateParts();
}

function edit(part, key, value, final) {
  if (!editable() || !state.draft.recipe) return;
  const s = sendState(part);
  if (s.refused) return;
  s.pending[key] = value;
  const prev = local.get(part);
  local.set(part, { values: { ...(prev?.values ?? {}), [key]: value }, until: Infinity });
  // drawn this frame, from local numbers
  scene?.setDraftOverride(currentDraftParts());
  const out = $(`#${part}-${key}`)?.nextElementSibling;
  if (out) out.textContent = fmt(RECIPES[state.draft.recipe].parts[part].params[key], value);
  clearTimeout(s.release);
  const decision = throttle({ lastSent: s.lastSent, now: Date.now(), final });
  clearTimeout(s.timer);
  if (decision.send) flush(part);
  else s.timer = setTimeout(() => flush(part), decision.wait);
  if (final && !s.held) letGo(part);
}

async function flush(part) {
  const s = sendState(part);
  const values = s.pending;
  if (!Object.keys(values).length) return;
  s.pending = {};
  s.lastSent = Date.now();
  const r = await post("/draft/edit", { part, values });
  if (!r.ok) return refuse(part, r);
  const l = local.get(part);
  if (l && !s.held && !Object.keys(s.pending).length) l.until = Date.now() + LOCAL_HOLD;
}

function currentDraftParts() {
  const d = state.draft;
  if (!d.recipe) return null;
  const out = {};
  const now = Date.now();
  const defaults = defaultParts(d.recipe);
  for (const [part, values] of Object.entries(d.parts)) out[part] = shownValues({ ...defaults[part], ...values }, local.get(part), now);
  return out;
}

const partsBox = $("[data-parts]");
partsBox.addEventListener("pointerdown", (e) => {
  const input = e.target.closest("input[data-part]");
  if (input && !input.disabled) holdPart(input.dataset.part);
});
partsBox.addEventListener("keydown", (e) => {
  const input = e.target.closest("input[data-part]");
  if (input && /^Arrow|^Page|^Home$|^End$/.test(e.key) && !input.disabled) {
    const s = sendState(input.dataset.part);
    if (!s.held) holdPart(input.dataset.part);
  }
});
partsBox.addEventListener("keyup", (e) => {
  const input = e.target.closest("input[data-part]");
  if (input) letGo(input.dataset.part);
});
partsBox.addEventListener("input", (e) => {
  const input = e.target;
  if (input.type === "range") edit(input.dataset.part, input.dataset.key, Number(input.value), false);
});
partsBox.addEventListener("change", (e) => {
  const input = e.target;
  if (input.type === "range" || (input.type === "radio" && input.checked)) edit(input.dataset.part, input.dataset.key, Number(input.value), true);
});
partsBox.addEventListener("focusout", (e) => {
  const input = e.target.closest("input[data-part]");
  if (input && !partsBox.contains(e.relatedTarget)) letGo(input.dataset.part);
});
window.addEventListener("pointerup", () => {
  for (const [part, s] of sending) if (s.held) letGo(part);
});
window.addEventListener("blur", () => {
  for (const [part, s] of sending) if (s.held) letGo(part);
});
window.addEventListener("pagehide", () => {
  for (const l of state?.leases ?? []) if (l.mine) fetch("/draft/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ part: l.part }), keepalive: true });
});

$("[data-clear]").addEventListener("click", async () => {
  const name = RECIPES[state.draft.recipe].name;
  if (await ask(`Clear the ${name} off the bench? It's kept in Archived drafts, and anyone can bring it back.`, "Clear the bench")) act("/draft/clear", {}, "Archived");
});

// ---- publishing

function closePublish() {
  $("[data-publish]").hidden = true;
  $("[data-publish-open]").hidden = false;
}

function openPublish(preferred) {
  if (!state.draft.recipe) return;
  select({ kind: "bench" }, { create: true });
  const form = $("[data-publish]");
  form.hidden = false;
  $("[data-publish-open]").hidden = true;
  const title = $("#publish-title");
  if (!title.value) title.value = state.draft.basedOn ? state.draft.basedOn.title : RECIPES[state.draft.recipe].name;
  renderTargets(preferred);
  $("[data-publish-error]").textContent = "";
  title.focus();
  form.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

function targetValue() {
  return $('input[name="target"]:checked')?.value ?? null;
}

const parseTarget = (v) => (v?.startsWith("slot:") ? { slot: Number(v.slice(5)) } : v?.startsWith("ex:") ? { exhibitId: Number(v.slice(3)) } : null);

function renderTargets(preferred) {
  const box = $("[data-targets]");
  const keep = preferred ?? targetValue();
  const opts = [];
  for (const slot of emptySlots(state.slots)) opts.push({ value: `slot:${slot}`, group: "new", text: `New exhibit on plinth ${slot}`, sub: "empty" });
  const based = state.draft.basedOn?.exhibitId;
  const onShow = state.slots.filter((s) => s.exhibit).map((s) => s.exhibit);
  const all = [...onShow, ...state.storeroom].sort((a, b) => (a.id === based ? -1 : b.id === based ? 1 : 0));
  for (const e of all) opts.push({ value: `ex:${e.id}`, group: "version", text: `Version ${e.versionCount + 1} of "${e.latest.title}"`, sub: e.slot ? `plinth ${e.slot}` : "storeroom" });
  for (const s of state.slots.filter((x) => x.exhibit)) opts.push({ value: `slot:${s.slot}`, group: "replace", text: `Replace plinth ${s.slot}`, sub: `"${s.exhibit.latest.title}" goes to the storeroom` });
  const heads = { new: "A new exhibit", version: "A new version of an exhibit", replace: "A new exhibit, replacing one" };
  let chosen = opts.find((o) => o.value === keep && (o.group !== "replace" || keep === preferred)) ?? opts.find((o) => o.group === "version" && based && o.value === `ex:${based}`) ?? opts.find((o) => o.group === "new");
  // a replace target is only chosen when asked for by name
  const seen = new Set();
  const nodes = [];
  for (const o of opts) {
    if (!seen.has(o.group)) {
      seen.add(o.group);
      nodes.push(el("p", { class: "target-head" }, heads[o.group]));
    }
    const id = `t-${o.group}-${o.value.replace(":", "-")}`;
    nodes.push(
      el(
        "label",
        { class: `target is-${o.group}`, for: id },
        el("input", { type: "radio", name: "target", id, value: o.value, checked: chosen === o, "data-edit": true, dataset: { group: o.group } }),
        el("span", { class: "target-text" }, o.text),
        el("span", { class: "target-sub" }, o.sub),
      ),
    );
  }
  box.replaceChildren(...nodes);
  applyEnabled();
  renderPlan();
}

function renderPlan() {
  const target = parseTarget(targetValue());
  const plan = target ? publishPlan(state, target, $("#publish-title").value.trim()) : null;
  $("[data-plan]").textContent = plan ? (plan.kind === "invalid" ? plan.reason : plan.summary) : "Choose where it goes.";
  $("[data-plan]").dataset.kind = plan?.kind ?? "";
}

$("[data-targets]").addEventListener("change", renderPlan);
$("[data-publish-open]").addEventListener("click", () => openPublish());
$("[data-publish-cancel]").addEventListener("click", closePublish);
$("[data-publish]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("[data-publish-error]");
  const title = $("#publish-title").value;
  const problem = titleProblem(title);
  if (problem) return (error.textContent = problem);
  const target = parseTarget(targetValue());
  if (!target) return (error.textContent = "Choose where it goes.");
  const plan = publishPlan(state, target, title.trim());
  if (plan.kind === "invalid") return (error.textContent = plan.reason);
  if (plan.confirm && !(await ask(plan.confirm, "Publish and move it"))) return;
  error.textContent = "";
  const r = await act("/publish", plan.body);
  if (!r) return;
  if (!r.ok) {
    error.textContent = refusalText(r.status, r.body);
    return;
  }
  $("#publish-title").value = "";
  closePublish();
  toast(plan.kind === "add-version" ? "New version on show" : "On display", "ok");
  if ("slot" in target) select({ kind: "slot", slot: target.slot });
  else select({ kind: "exhibit", id: target.exhibitId });
});

// ---------------------------------------------------------------- exhibits

function findExhibit(id) {
  for (const s of state.slots) if (s.exhibit?.id === id) return s.exhibit;
  return state.storeroom.find((e) => e.id === id) ?? null;
}

function selectedExhibit() {
  if (selected.kind === "slot") return state.slots.find((s) => s.slot === selected.slot)?.exhibit ?? null;
  if (selected.kind === "exhibit") return findExhibit(selected.id);
  return null;
}

function renderExhibit() {
  const view = $('[data-view="exhibit"]');
  view.hidden = selected.kind === "bench";
  if (selected.kind === "bench") return;
  const e = selectedExhibit();
  const benchEmpty = state.draft.recipe === null;
  $("[data-ex-empty]").hidden = !!e;
  $("[data-ex-full]").hidden = !e;
  if (!e) {
    $("[data-ex-where]").textContent = String(selected.slot);
    $("[data-ex-title]").textContent = "Empty";
    $("[data-ex-credits]").replaceChildren();
    $("[data-ex-empty-text]").textContent = benchEmpty ? "Nothing here yet. Start something on the workbench, then exhibit it here." : "Nothing here yet. Exhibit what's on the workbench here.";
    const btn = $("[data-ex-publish-here]");
    btn.hidden = benchEmpty;
    btn.onclick = () => openPublish(`slot:${selected.slot}`);
    return;
  }
  const v = e.latest;
  $("[data-ex-where]").textContent = e.slot ? String(e.slot) : "";
  $("[data-ex-title]").textContent = v.title;
  const meta = $("[data-ex-meta]");
  meta.replaceChildren(`${RECIPES[v.recipe]?.name ?? v.recipe} · version ${v.n} of ${e.versionCount} · `, v.publishedBy ? el("span", {}, "published by ", chip(v.publishedBy)) : "one of the museum's starters", v.publishedAt ? ` · ${when(v.publishedAt)}` : "");
  $("[data-ex-credits]").replaceChildren(...v.contributors.map((c) => el("li", {}, dot(c, { you: c.tag === state.you.tag, note: plural(c.edits, "edit") }))));
  const action = benchAction(state.draft);
  const remix = $("[data-ex-remix]");
  const replace = $("[data-ex-replace]");
  remix.hidden = action.kind !== "remix";
  replace.hidden = action.kind !== "replace";
  remix.onclick = () => remixVersion(v);
  replace.onclick = () => remixVersion(v);
  const store = $("[data-ex-store]");
  store.hidden = e.slot === null;
  store.onclick = async () => {
    if (await ask(`Move "${v.title}" off plinth ${e.slot} into the storeroom? All ${plural(e.versionCount, "version")} go with it, and it can be put back later.`, "Move to the storeroom")) {
      const r = await act(`/exhibits/${e.id}/store`, {}, "In the storeroom");
      if (r?.ok) select({ kind: "exhibit", id: e.id });
    }
  };
  renderDisplay(e);
  renderHistory(e);
}

/** Copies a version onto the bench: a plain remix onto an empty bench,
 * otherwise "Replace the workbench", confirmed, which archives what's there. */
async function remixVersion(v) {
  const action = benchAction(state.draft);
  if (action.replace) {
    const now = RECIPES[state.draft.recipe].name;
    const who = state.draft.contributors.length ? `, shaped by ${state.draft.contributors.map((c) => c.name).join(", ")},` : "";
    if (!(await ask(`Replace the workbench? The ${now}${who} moves to Archived drafts, and "${v.title}" version ${v.n} takes its place.`, "Replace the workbench"))) return;
  }
  const r = await act("/draft/remix", { versionId: v.id, replace: action.replace }, "On the bench");
  if (r?.ok) openEditor();
}

function renderDisplay(e) {
  const box = $("[data-ex-display]");
  box.hidden = e.slot !== null;
  if (e.slot !== null) return;
  const sel = $("[data-display-slot]");
  const was = sel.value;
  sel.replaceChildren(...state.slots.map((s) => el("option", { value: s.slot }, s.exhibit ? `Plinth ${s.slot} (replaces "${s.exhibit.latest.title}")` : `Plinth ${s.slot} (empty)`)));
  const free = emptySlots(state.slots);
  sel.value = was && state.slots.some((s) => String(s.slot) === was) ? was : String(free[0] ?? 1);
  $("[data-display]").onclick = async () => {
    const slot = Number(sel.value);
    const there = state.slots.find((s) => s.slot === slot)?.exhibit;
    if (there && !(await ask(`"${there.latest.title}" (${plural(there.versionCount, "version")}) moves to the storeroom, and "${e.latest.title}" goes on plinth ${slot}. Go ahead?`, "Swap them"))) return;
    const r = await act(`/exhibits/${e.id}/display`, { slot, replace: !!there }, `On plinth ${slot}`);
    if (r?.ok) select({ kind: "slot", slot });
  };
}

async function renderHistory(e) {
  const list = $("[data-history]");
  const cached = historyCache.get(e.id);
  if (cached && cached.count === e.versionCount) return drawHistory(list, e, cached.data);
  if (!cached) list.replaceChildren(el("li", { class: "hint", "aria-label": "Loading its history" }, "…"));
  try {
    const r = await fetch(`/exhibits/${e.id}`);
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    historyCache.set(e.id, { count: data.versions.length, data });
    const still = selectedExhibit();
    if (still && still.id === e.id) drawHistory(list, still, data);
  } catch {
    list.replaceChildren(el("li", { class: "hint" }, "History unavailable"));
  }
}

// History is a strip of version chips in each publisher's colour (ADR 13);
// the open one shows its credits and its actions as icons. Every word that
// left the screen is still in an accessible name.
let openVersion = null;
function drawHistory(list, e, data) {
  const latestN = Math.max(...data.versions.map((v) => v.n));
  if (!data.versions.some((v) => v.id === openVersion)) openVersion = data.versions[0]?.id ?? null;
  list.replaceChildren(
    ...data.versions.map((v) => {
      const notes = [];
      if (v.restoredFrom) {
        const from = data.versions.find((x) => x.id === v.restoredFrom);
        notes.push(`restored from version ${from ? from.n : "?"}`);
      }
      if (v.basedOn && v.basedOn.exhibitId !== e.id) notes.push(`remixed from "${v.basedOn.title}" v${v.basedOn.n}`);
      else if (v.basedOn) notes.push(`remixed from v${v.basedOn.n}`);
      const by = v.publishedBy ? `published by ${v.publishedBy.name}` : "the museum's starter";
      const about = `Version ${v.n}, "${v.title}", ${by}, ${when(v.publishedAt)}${notes.length ? `, ${notes.join(", ")}` : ""}${v.n === latestN ? ", on show" : ""}`;
      const open = v.id === openVersion;
      const restore = `Restore as version ${latestN + 1}`;
      return el(
        "li",
        { class: `version${v.n === latestN ? " is-latest" : ""}${open ? " is-open" : ""}`, style: { "--who": v.publishedBy ? colourOf(v.publishedBy) : "var(--teal-ink)" } },
        el("button", { type: "button", class: "version-chip", "aria-expanded": String(open), "aria-label": about, title: about, onclick: () => { openVersion = v.id; drawHistory(list, e, data); } }, swatchOf(v.recipe, v.parts), el("span", { class: "version-n" }, `v${v.n}`)),
        // the latest version's remix is the button above; its box shows only
        // when it has credits or it's an older version to restore
        open && (v.n !== latestN || v.contributors.length)
          ? el(
              "div",
              { class: "version-detail" },
              el("p", { class: "sr-only" }, about),
              v.contributors.length ? el("ul", { class: "dots" }, ...v.contributors.map((c) => el("li", {}, dot(c, { note: plural(c.edits, "edit") })))) : null,
              v.n !== latestN
                ? el("button", { type: "button", class: "icon", "data-edit": true, "aria-label": restore, title: restore, onclick: () => act(`/exhibits/${e.id}/restore`, { versionId: v.id }, `Restored as v${latestN + 1}`) }, el("svg", { "aria-hidden": "true" }), )
                : null,
              v.n !== latestN
                ? el("button", { type: "button", class: "icon", "data-edit": true, "aria-label": state.draft.recipe ? "Replace the workbench with this version" : "Remix this version", title: state.draft.recipe ? "Replace the workbench with this version" : "Remix this version", onclick: () => remixVersion(v) }, el("svg", { "aria-hidden": "true" }))
                : null,
            )
          : null,
      );
    }),
  );
  // <use> inside an SVG made by createElement needs the SVG namespace
  for (const b of list.querySelectorAll(".version-detail button.icon")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", /^Restore/.test(b.getAttribute("aria-label")) ? "#i-restore" : "#i-remix");
    svg.append(use);
    b.replaceChildren(svg);
  }
  applyEnabled();
}

// ---------------------------------------------------------------- storeroom and archive

function renderDrawers() {
  const store = $("[data-storeroom]");
  $("[data-storeroom-count]").textContent = String(state.storeroom.length);
  store.replaceChildren(
    ...(state.storeroom.length
      ? state.storeroom.map((e) =>
          el(
            "li",
            { class: "shelf-item" },
            el(
              "button",
              { type: "button", class: "shelf-open", "aria-label": `Open "${e.latest.title}", ${plural(e.versionCount, "version")}`, title: e.latest.title, onclick: () => select({ kind: "exhibit", id: e.id }, { focusHeading: true }) },
              swatchOf(e.latest.recipe, e.latest.parts),
              el("span", { class: "shelf-title" }, e.latest.title),
            ),
          ),
        )
      : [el("li", { class: "hint" }, "Empty")]),
  );
  const archive = $("[data-archive]");
  $("[data-archive-count]").textContent = String(state.archivedTotal);
  // Older pages fetched with "Show older" stay only while the newest ones
  // they followed are unchanged; otherwise they'd sit out of order.
  const newestIds = state.archivedDrafts.map((a) => a.id).join();
  if (newestIds !== olderFor) {
    older = [];
    olderMore = state.archivedTotal > state.archivedDrafts.length;
    olderFor = newestIds;
  }
  const all = [...state.archivedDrafts, ...older];
  archive.replaceChildren(
    ...(all.length
      ? all.map((a) =>
          el(
            "li",
            { class: "shelf-item" },
            el("span", { class: "sr-only" }, `${RECIPES[a.recipe]?.name ?? a.recipe}, ${a.reason === "replaced" ? "replaced" : "cleared"} ${when(a.archivedAt)}${a.archivedBy ? ` by ${a.archivedBy.name}` : ""}`),
            el("span", { class: "shelf-meta", "aria-hidden": "true", title: `${a.reason} ${when(a.archivedAt)}` }, `${a.reason} ${when(a.archivedAt)}`),
            a.contributors.length ? el("ul", { class: "dots" }, ...a.contributors.map((c) => el("li", {}, dot(c)))) : null,
            el(
              "button",
              { type: "button", class: "icon", "data-edit": true, "aria-label": state.draft.recipe ? "Replace the workbench with this draft" : "Bring this draft back to the bench", title: state.draft.recipe ? "Replace the workbench with this draft" : "Back to the bench", onclick: () => restoreArchived(a) },
              swatchOf(a.recipe, defaultParts(a.recipe)),
            ),
          ),
        )
      : [el("li", { class: "hint" }, "Empty")]),
    ...(olderMore && all.length
      ? [el("li", { class: "shelf-more" }, el("button", { type: "button", class: "small", "data-archive-older": true, "aria-label": `Show ${state.archivedTotal - all.length} older drafts`, onclick: showOlder }, `+${state.archivedTotal - all.length}`))]
      : []),
  );
  applyEnabled();
}

let older = [];
let olderMore = false;
let olderFor = "";

// Reading only: it works while disconnected too, like the history.
async function showOlder() {
  const last = [...state.archivedDrafts, ...older].at(-1);
  const res = await fetch(`/archive?before=${last.id}`).catch(() => null);
  if (!res?.ok) return toast("Couldn't load those");
  const page = await res.json();
  older = [...older, ...page.drafts];
  olderMore = page.more;
  renderDrawers();
  $("[data-archive] .shelf-item:nth-last-child(" + (olderMore ? page.drafts.length + 1 : page.drafts.length) + ") button")?.focus();
}

async function restoreArchived(a) {
  const action = benchAction(state.draft);
  if (action.replace && !(await ask(`Replace the workbench? The ${RECIPES[state.draft.recipe].name} on it now moves to Archived drafts, and this ${RECIPES[a.recipe]?.name ?? "draft"} comes back.`, "Replace the workbench"))) return;
  const r = await act("/draft/restore-archived", { archivedId: a.id, replace: action.replace }, "Back on the bench");
  if (r?.ok) openEditor();
}

// ---------------------------------------------------------------- rename

$("[data-rename-open]").addEventListener("click", () => {
  const form = $("[data-rename]");
  form.hidden = false;
  const input = $("#rename-input");
  input.value = state.you.name;
  input.select();
  input.focus();
});
$("[data-rename-cancel]").addEventListener("click", () => ($("[data-rename]").hidden = true));
$("[data-rename]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#rename-input").value;
  const problem = nameProblem(name);
  const error = $("[data-rename-error]");
  if (problem) return (error.textContent = problem);
  const r = await act("/me", { name: name.trim() });
  if (!r) return;
  if (!r.ok) return (error.textContent = refusalText(r.status, r.body));
  error.textContent = "";
  $("[data-rename]").hidden = true;
  $("[data-rename-open]").focus();
});

// ---------------------------------------------------------------- the scene

async function startScene() {
  const canvas = $("[data-scene]");
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!gl) return noScene();
  try {
    const { createScene } = await import("./scene.js");
    scene = await createScene(canvas, {
      reducedMotion,
      time: () => sharedSeconds(Date.now(), offset),
      onPick: (pick) => select(pick === "bench" ? { kind: "bench" } : { kind: "slot", slot: Number(pick.split(":")[1]) }),
      // what lies over the scene, so a close-up is composed in the rest
      covers: () =>
        [".panel", ".brand", "[data-people]", "[data-nav]", "[data-home]"]
          .map((q) => $(q))
          .filter((n) => n && n.checkVisibility())
          .map((n) => n.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
      onMoved: (m) => {
        cameraMoved = m;
        renderHome();
      },
      onPiece,
    });
    if (state) scene.update(state, selected, currentDraftParts());
  } catch (err) {
    console.warn("no 3D:", err);
    noScene();
  }
}

function noScene() {
  document.body.classList.add("no-gl");
  $("[data-scene]").hidden = true;
}

connect();
startScene();
