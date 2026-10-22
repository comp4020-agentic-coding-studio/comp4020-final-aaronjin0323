// The museum page: the stream, the DOM controls and the 3D scene.
//
// The DOM holds every control (CLAUDE.md, "Phone and keyboard"); the canvas
// is decoration over it, loaded on its own so the page still works when
// WebGL or the CDN isn't there. Names and titles only ever reach the page as
// textContent. Small decisions (connection, publish flow, input rules) live
// in ui-logic.js, where a test can hold them; the stage's rules are
// stage.js.
import { LOOP, PALETTE, SETS, VISITOR_COLOURS, isHoldable, loopMoment, shownAt } from "./stage.js";
import { objectName, viewOf } from "./sets/views.js";
import { isMuted, play as playSounds, setMuted, unlock } from "./sound.js";
import {
  INITIAL_CONN,
  canEdit,
  clockOffset,
  connection,
  connectionMessage,
  emptySlots,
  gestureLine,
  nameProblem,
  playfulTitle,
  plural,
  publishPlan,
  refusalText,
  sharedSeconds,
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
/** A performance's colours as a small conic swatch: the objects its
 * gestures touched, in order; the old sculptures (storeroom only) get
 * their own muted ring. */
function swatchOf(recipe, parts) {
  const view = parts && viewOf(parts.set);
  if (recipe !== "stage" || !view) return el("span", { class: `thumb${recipe ? " is-old" : " is-empty"}`, "aria-hidden": "true" });
  // the set's view picks the colours (its `swatch`)
  const cols = view.swatch(parts);
  if (!cols.length) cols.push(PALETTE[0].hex);
  const stops = cols.map((c, i) => `${c} ${Math.round((i / cols.length) * 360)}deg ${Math.round(((i + 1) / cols.length) * 360)}deg`).join(", ");
  return el("span", { class: `thumb${parts.gestures.length ? "" : " is-quiet"}`, style: { "--thumb": `conic-gradient(${stops})` }, "aria-hidden": "true" });
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
/** what's being looked at: the stage, a plinth, or a storeroom exhibit */
let selected = /** @type {{kind: "bench"} | {kind: "slot", slot: number} | {kind: "exhibit", id: number}} */ ({ kind: "bench" });
const historyCache = new Map();
let scene = null;
let cameraMoved = false; // the visitor walked or turned away from the start

// the loop moment now: the shared clock, or the start when held still
const moment = () => (reducedMotion.matches ? 0 : loopMoment(sharedSeconds(Date.now(), offset)));
const editable = () => canEdit(conn);

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
    const was = offset;
    offset = clockOffset(next.serverTime, Date.now());
    // the loop strip's head follows the shared clock: re-sync it when the
    // clock moved by more than a frame
    if (Math.abs(offset - was) > 20) runHead();
    state = next;
    conn = connection(conn, "state");
    render();
  });
  // where everyone else stands and looks (ADR 17): live, never stored
  es.addEventListener("poses", (e) => {
    if (!state) return;
    try {
      scene?.setPoses(JSON.parse(e.data), state.you.tag);
    } catch {
      // a malformed poses event only means no heads this time
    }
  });
  es.addEventListener("error", () => dropped(es.readyState === EventSource.CLOSED));
}

function dropped(closed) {
  conn = connection(conn, "error");
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
  $("[data-drawers]").hidden = false;
  if (selected.kind === "exhibit" && !findExhibit(selected.id)) selected = { kind: "bench" };
  if (selected.kind === "exhibit") {
    const e = findExhibit(selected.id);
    if (e.slot !== null) selected = { kind: "slot", slot: e.slot };
  }
  renderPeople();
  renderNav();
  renderStage();
  renderExhibit();
  renderDrawers();
  renderConnection();
  renderHome();
  document.body.dataset.mode = "explore";
  scene?.update(state, selected);
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
 * whether it's blocked (nothing to undo, nothing to leave). */
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
      const you = p.tag === state.you.tag;
      const holding = p.holding.map(objectName);
      return el("li", { class: holding.length ? "is-editing" : "" }, dot(p, { you, note: holding.length ? `holding ${holding.join(", ")}` : "" }));
    }),
  );
}

function renderNav() {
  const list = $("[data-plinths]");
  const n = state.draft.parts?.gestures.length ?? 0;
  const items = [
    { key: "bench", label: "★", name: `The stage: ${n ? plural(n, "gesture") : "quiet"}`, recipe: "stage", parts: state.draft.parts, pressed: selected.kind === "bench" },
    ...state.slots.map((s) => ({ key: `slot:${s.slot}`, label: String(s.slot), name: `Plinth ${s.slot}: ${s.exhibit ? s.exhibit.latest.title : "empty"}`, recipe: s.exhibit?.latest.recipe ?? null, parts: s.exhibit?.latest.parts ?? null, empty: !s.exhibit, pressed: selected.kind === "slot" && selected.slot === s.slot })),
  ];
  // Rebuild only when the labels change, so focus stays on the button.
  const sig = JSON.stringify(items.map((it) => [it.key, it.name, it.pressed, it.recipe, it.parts?.gestures.length]));
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

/** Chooses what the card shows. `walk` also walks you there in the room:
 * in front of a plinth, or back to your spot by the stage; a choice the
 * room made itself (you walked up to a plinth) doesn't. */
function select(next, { focusHeading = false, walk = true } = {}) {
  selected = next;
  if (walk) scene?.walkTo(next);
  closePublish();
  render();
  if (focusHeading) $(selected.kind === "bench" ? "#bench-h" : "#exhibit-h")?.focus({ preventScroll: true });
  const panel = $(".panel");
  if (getComputedStyle(panel).overflowY === "auto") panel.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  // on the phone the plinth row scrolls sideways: bring the chosen one into it
  $("[data-plinths] [aria-pressed='true']")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

// Back to the stage: shown whenever you've walked or turned away from
// your starting spot, or are at a plinth.
function renderHome() {
  $("[data-home]").hidden = !scene || (selected.kind === "bench" && !cameraMoved);
}
function goHome() {
  select({ kind: "bench" }, { walk: false });
  scene?.home();
  $("#bench-h").focus({ preventScroll: true });
}
$("[data-home]").addEventListener("click", goHome);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || $("[data-ask]").open) return;
  if (e.target.closest?.("input:not([type=radio]), select, textarea, form")) return;
  e.preventDefault();
  if (!$("[data-publish]").hidden) return closePublish();
  // back to the stage from anywhere else, or to the opening view
  if (selected.kind === "bench" && $("[data-home]").hidden) return;
  goHome();
});

$("[data-plinths]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  const go = b.dataset.go;
  select(go === "bench" ? { kind: "bench" } : { kind: "slot", slot: Number(go.split(":")[1]) });
});

// ---------------------------------------------------------------- the stage

function renderStage() {
  const view = $('[data-view="bench"]');
  view.hidden = selected.kind !== "bench";
  const d = state.draft;
  const gestures = d.parts?.gestures ?? [];
  $("[data-bench-thumb]").replaceChildren(swatchOf("stage", d.parts));
  $("[data-bench-title]").textContent = d.basedOn ? d.basedOn.title : "The stage";
  $("[data-bench-about]").textContent = gestures.length
    ? `${plural(gestures.length, "gesture")} in a ${LOOP}-second loop${d.basedOn ? `, joined from "${d.basedOn.title}" version ${d.basedOn.n}` : ""}.`
    : `Quiet. Play the ${SETS[d.parts?.set ?? ""]?.name ?? "stage"} with the buttons below.`;
  $("[data-bench-credits]").replaceChildren(...d.contributors.map((c) => el("li", {}, dot(c, { you: c.tag === state.you.tag, note: plural(c.edits, "gesture") }))));
  // Undo has something to take back only if you're in the loop; Leave it
  // and Start over only if anyone is
  const mine = gestures.some((g) => g.by === state.you.tag);
  $("[data-undo]").dataset.blocked = mine ? "0" : "1";
  $("[data-publish-open]").dataset.blocked = gestures.length ? "0" : "1";
  $("[data-clear]").dataset.blocked = gestures.length ? "0" : "1";
  renderGestures();
  renderSets();
  // what someone else holds wears their colour on its button
  const setView = viewOf(d.parts?.set);
  for (const b of $$("[data-gesture^='throw:']")) {
    const id = b.dataset.gesture.split(":")[1];
    const claim = state.claims.find((c) => c.part === id && !c.mine && Date.parse(c.expiresAt) > Date.now() + offset - 1000);
    b.style.setProperty("--held", claim ? colourOf(claim.holder) : "transparent");
    b.setAttribute("aria-label", claim ? setView.heldLabel(id, claim.holder.name) : b.dataset.label);
    b.title = b.getAttribute("aria-label");
  }
  renderTicks();
  if (!$("[data-publish]").hidden) renderTargets();
}

// The gesture buttons: one per object of the set on the stage, as its view
// lists them (`buttons`), rebuilt only when the set changes. Icons and
// swatches are the view's own markup, never a visitor's text.
function renderGestures() {
  const box = $("[data-gestures]");
  const set = state.draft.parts?.set ?? "";
  if (box.dataset.set === set) return;
  box.dataset.set = set;
  const view = viewOf(set);
  box.replaceChildren(
    ...(view?.buttons ?? []).map((b) => {
      const btn = el("button", { type: "button", class: "gesture", "data-edit": true, "aria-label": b.label, title: b.title ?? b.label, dataset: { gesture: b.gesture, label: b.label } });
      if (b.ball) btn.append(el("span", { class: "ball", style: { "--ball": b.ball } }));
      else btn.insertAdjacentHTML("beforeend", `<svg aria-hidden="true" viewBox="0 0 24 24">${b.icon ?? ""}</svg>`);
      return btn;
    }),
  );
  box.style.setProperty("--n", String(Math.max(1, view?.buttons.length ?? 1)));
  applyEnabled();
}

// The set row (ADR 18): an icon per set, the one on the stage pressed.
// Shown once there's more than one set to choose from.
function renderSets() {
  const box = $("[data-sets]");
  const ids = Object.keys(SETS);
  box.hidden = ids.length < 2;
  const set = state.draft.parts?.set ?? "";
  if (!box.children.length) {
    box.replaceChildren(
      ...ids.map((id) => {
        const label = `Play the ${SETS[id].name}`;
        const btn = el("button", { type: "button", class: "set-btn", "data-edit": true, "aria-label": label, title: label, "aria-pressed": "false", dataset: { set: id } });
        btn.insertAdjacentHTML("beforeend", `<svg aria-hidden="true" viewBox="0 0 24 24">${viewOf(id)?.icon ?? ""}</svg>`);
        return btn;
      }),
    );
    applyEnabled();
  }
  for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.set === set));
}

$("[data-sets]").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-set]");
  if (!b || b.disabled || !state) return;
  const set = b.dataset.set;
  if (set === state.draft.parts?.set) return;
  const busy = (state.draft.parts?.gestures.length ?? 0) > 0;
  if (busy && !(await ask(`Play the ${SETS[set].name}? This loop is kept in Archived loops, and anyone can bring it back.`, "Play it"))) return;
  act("/stage/clear", { set });
});

// The loop as a strip: a tick for each gesture, in its player's colour, and
// a head running along it. You can see the conversation, and when it'll
// come round again.
function renderTicks() {
  const box = $("[data-loop-ticks]");
  const gestures = state.draft.parts?.gestures ?? [];
  const sig = JSON.stringify(gestures.map((g) => [g.at, g.by]));
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const colour = (tag) => {
    const who = [...state.present, ...state.draft.contributors].find((p) => p.tag === tag);
    return who ? colourOf(who) : "var(--ink-soft)";
  };
  box.replaceChildren(...gestures.map((g) => el("span", { class: "tick", style: { left: `${(g.at / LOOP) * 100}%`, "--who": colour(g.by) } })));
}
// The head runs as a CSS animation, which the browser drives on its own
// (no script per frame, no layout): one sweep per loop, started at the
// loop's moment now, and set again only when the clock offset or motion
// preference changes.
function runHead() {
  const head = $("[data-loop-head]");
  const still = reducedMotion.matches;
  head.style.animationDuration = `${LOOP}s`;
  head.style.animationDelay = `${-moment()}s`;
  head.style.animationPlayState = still ? "paused" : "running";
  // restart the animation so the new delay takes effect
  head.style.animationName = "none";
  void head.offsetWidth;
  head.style.animationName = "";
}
reducedMotion.addEventListener("change", runHead);

// ---- gestures: from the scene (touch) and from the buttons (keyboard)

/** Plays a gesture: drawn at once on this screen, then sent. A throw grabs
 * its sphere first if this visitor isn't holding it. */
async function gesture(g) {
  if (!editable()) return;
  unlock();
  const mine = { ...g, by: state.you.tag, _at: Date.now() };
  scene?.play(mine);
  const send = { ...g };
  const r = await post("/stage/gesture", { gesture: send });
  if (!r.ok) {
    scene?.unplay(mine);
    toast(refusalText(r.status, r.body));
  }
}

async function onGesture(ev) {
  if (!editable() || !state) return;
  unlock();
  if (ev.kind === "grab") {
    const r = await post("/stage/grab", { object: ev.object });
    if (r.ok && r.body.from) toast(`Took it from ${r.body.from.name}`, "ok");
    return;
  }
  gesture(ev);
}

// The buttons: each one an ordinary gesture at this moment of the loop,
// as the set's view makes it from the stage as shown now (`fromButton`).
// A throw grabs what it throws first.
$("[data-gestures]").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-gesture]");
  if (!b || b.disabled || !state?.draft.parts) return;
  const [kind, object] = b.dataset.gesture.split(":");
  const parts = state.draft.parts;
  const view = viewOf(parts.set);
  if (!view) return;
  const at = Number(moment().toFixed(3));
  const g = view.fromButton(kind, object, at, shownAt(parts, at));
  if (kind === "throw" && isHoldable(parts.set, object)) {
    const r = await post("/stage/grab", { object });
    if (!r.ok) return toast(refusalText(r.status, r.body));
  }
  return gesture(g);
});

$("[data-undo]").addEventListener("click", async () => {
  const r = await act("/stage/undo", {});
  if (r?.ok) toast(gestureLine(r.body.removed, "Undid"), "ok");
});

$("[data-clear]").addEventListener("click", async () => {
  if (await ask("Start over? This loop is kept in Archived loops, and anyone can bring it back.", "Start over")) act("/stage/clear", {}, "A quiet stage");
});

// ---- sound: off until the first touch; one button mutes it

function renderSound() {
  const b = $("[data-sound]");
  const off = isMuted();
  b.setAttribute("aria-pressed", String(!off));
  b.setAttribute("aria-label", off ? "Sound is off: turn it on" : "Sound is on: turn it off");
  b.title = b.getAttribute("aria-label");
  b.querySelector("use").setAttribute("href", off ? "#i-mute" : "#i-sound");
}
$("[data-sound]").addEventListener("click", () => {
  unlock();
  setMuted(!isMuted());
  renderSound();
});
document.addEventListener("pointerdown", () => unlock(), { once: true });
renderSound();

// ---- leaving it on a plinth

function closePublish() {
  $("[data-publish]").hidden = true;
  $("[data-publish-open]").hidden = false;
}

function openPublish(preferred) {
  if (!state.draft.parts?.gestures.length) return toast("Play something first");
  if (selected.kind !== "bench") select({ kind: "bench" });
  const form = $("[data-publish]");
  form.hidden = false;
  $("[data-publish-open]").hidden = true;
  const title = $("#publish-title");
  if (!title.value) title.value = state.draft.basedOn ? state.draft.basedOn.title : playfulTitle(state.draft.parts);
  renderTargets(preferred);
  $("[data-publish-error]").textContent = "";
  title.focus();
  title.select();
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
  toast(plan.kind === "add-version" ? "New version on show" : "Left on show", "ok");
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
  const stageQuiet = !state.draft.parts?.gestures.length;
  $("[data-ex-empty]").hidden = !!e;
  $("[data-ex-full]").hidden = !e;
  if (!e) {
    $("[data-ex-where]").textContent = String(selected.slot);
    $("[data-ex-title]").textContent = "Empty";
    $("[data-ex-credits]").replaceChildren();
    $("[data-ex-empty-text]").textContent = stageQuiet ? "Nothing here yet. Play something on the stage, then leave it here." : "Nothing here yet. Leave what's playing on the stage here.";
    const btn = $("[data-ex-publish-here]");
    btn.hidden = stageQuiet;
    btn.onclick = () => openPublish(`slot:${selected.slot}`);
    return;
  }
  const v = e.latest;
  $("[data-ex-where]").textContent = e.slot ? String(e.slot) : "";
  $("[data-ex-title]").textContent = v.title;
  const meta = $("[data-ex-meta]");
  const what = v.recipe === "stage" ? `a performance of ${plural(v.parts.gestures.length, "gesture")}` : "one of the old sculptures";
  meta.replaceChildren(`${what} · version ${v.n} of ${e.versionCount} · `, v.publishedBy ? el("span", {}, "left by ", chip(v.publishedBy)) : "one of the museum's starters", v.publishedAt ? ` · ${when(v.publishedAt)}` : "");
  $("[data-ex-credits]").replaceChildren(...v.contributors.map((c) => el("li", {}, dot(c, { you: c.tag === state.you.tag, note: plural(c.edits, "gesture") }))));
  const join = $("[data-ex-join]");
  join.hidden = v.recipe !== "stage";
  join.onclick = () => joinVersion(v);
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

/** Brings a performance to the stage to play along with. Over a loop
 * someone's playing it asks first; that loop is archived, never lost. */
async function joinVersion(v) {
  const busy = (state.draft.parts?.gestures.length ?? 0) > 0;
  if (busy) {
    const who = state.draft.contributors.length ? `, played by ${state.draft.contributors.map((c) => c.name).join(", ")},` : "";
    if (!(await ask(`Bring "${v.title}" to the stage? What's playing there now${who} is kept in Archived loops.`, "Bring it"))) return;
  }
  const r = await act("/stage/join", { versionId: v.id, replace: busy }, "On the stage");
  if (r?.ok) select({ kind: "bench" }, { focusHeading: true });
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
              v.contributors.length ? el("ul", { class: "dots" }, ...v.contributors.map((c) => el("li", {}, dot(c, { note: plural(c.edits, "gesture") })))) : null,
              v.n !== latestN
                ? el("button", { type: "button", class: "icon", "data-edit": true, "aria-label": restore, title: restore, onclick: () => act(`/exhibits/${e.id}/restore`, { versionId: v.id }, `Restored as v${latestN + 1}`) }, el("svg", { "aria-hidden": "true" }), )
                : null,
              v.n !== latestN && v.recipe === "stage"
                ? el("button", { type: "button", class: "icon", "data-edit": true, "aria-label": "Bring this version to the stage", title: "Bring this version to the stage", onclick: () => joinVersion(v) }, el("svg", { "aria-hidden": "true" }))
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
            el("span", { class: "sr-only" }, `${a.recipe === "stage" ? "A loop" : "An old sculpture"}, ${a.reason === "replaced" ? "replaced" : "started over"} ${when(a.archivedAt)}${a.archivedBy ? ` by ${a.archivedBy.name}` : ""}`),
            el("span", { class: "shelf-meta", "aria-hidden": "true", title: `${a.reason} ${when(a.archivedAt)}` }, `${a.reason} ${when(a.archivedAt)}`),
            a.contributors.length ? el("ul", { class: "dots" }, ...a.contributors.map((c) => el("li", {}, dot(c)))) : null,
            a.recipe === "stage"
              ? el("button", { type: "button", class: "icon", "data-edit": true, "aria-label": "Bring this loop back to the stage", title: "Back to the stage", onclick: () => restoreArchived(a) }, swatchOf("stage", { set: a.set, gestures: [] }))
              : null,
          ),
        )
      : [el("li", { class: "hint" }, "Empty")]),
    ...(olderMore && all.length
      ? [el("li", { class: "shelf-more" }, el("button", { type: "button", class: "small", "data-archive-older": true, "aria-label": `Show ${state.archivedTotal - all.length} older loops`, onclick: showOlder }, `+${state.archivedTotal - all.length}`))]
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
  const busy = (state.draft.parts?.gestures.length ?? 0) > 0;
  if (busy && !(await ask("Bring this loop back? What's playing on the stage now is kept in Archived loops.", "Bring it back"))) return;
  const r = await act("/stage/restore-archived", { archivedId: a.id, replace: busy }, "Back on the stage");
  if (r?.ok) select({ kind: "bench" }, { focusHeading: true });
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
      // walking up to a plinth shows its card; turning back, the stage's
      onPick: (pick) => {
        const next = pick === "bench" ? { kind: "bench" } : { kind: "slot", slot: Number(pick.split(":")[1]) };
        if (JSON.stringify(next) === JSON.stringify(selected) || !document.querySelector("[data-publish]").hidden) return;
        select(next, { walk: false });
      },
      // what lies over the scene: the uncovered part is reported to checks
      covers: () =>
        [".panel", ".brand", "[data-people]", "[data-nav]", "[data-home]"]
          .map((q) => $(q))
          .filter((n) => n && n.checkVisibility())
          .map((n) => n.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
      onMoved: (m) => {
        cameraMoved = m;
        if (m) document.body.dataset.fpUsed = "1";
        renderHome();
      },
      onPose: sendPose,
      onGesture,
      onEvents: playSounds,
    });
    if (state) scene.update(state, selected);
  } catch (err) {
    console.warn("no 3D:", err);
    noScene();
  }
}

// Your pose, for the others: fire and forget. A refusal or a server that
// doesn't know the route yet only means nobody sees you move; never a toast.
let poseInFlight = false;
function sendPose(pose) {
  if (poseInFlight || !editable()) return;
  poseInFlight = true;
  fetch("/pose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pose) })
    .catch(() => null)
    .finally(() => (poseInFlight = false));
}

function noScene() {
  document.body.classList.add("no-gl");
  $("[data-scene]").hidden = true;
}

connect();
startScene();
runHead();
