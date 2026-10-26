// The page: the stream, the panel, and the requests. The 3D room is
// scene.js, loaded after, so the panel works without WebGL; the rules are
// fountain.js and the page's own decisions ui.js.
import { BALLS, LOOP, gestureMoment, shown, simulate } from "./fountain.js";
import * as sound from "./sound.js";
import {
  BALL_COLOURS,
  BALL_NAMES,
  INITIAL_CONN,
  VISITOR_COLOURS,
  buttonFlick,
  canPlay,
  clock,
  clockOffset,
  connection,
  connectionMessage,
  loopNow,
  publishBody,
  publishTargets,
  suggestTitle,
} from "./ui.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const phone = matchMedia("(max-width: 760px)");

let state = null;
let you = null;
let conn = INITIAL_CONN;
let offset = 0;
let selected = { kind: "stage" };
let scene = null;
const now = () => loopNow(Date.now(), offset);

/** An element, with attributes, dataset, style vars and children. */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "style") for (const [p, x] of Object.entries(v)) e.style.setProperty(p, x);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
const colourOf = (w) => VISITOR_COLOURS[(w?.colour ?? 0) % VISITOR_COLOURS.length];
const chip = (w, extra = "") => el("span", { class: "chip" }, el("span", { class: "dot", style: { "--c": colourOf(w) }, "aria-hidden": "true" }), `${w.name}${extra}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- requests: every refusal comes back as words on screen
async function post(path, body = {}) {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, json };
  } catch {
    return { status: 0, ok: false, json: { message: "The museum didn't answer. Try again." } };
  }
}
async function act(path, body, done = "") {
  const r = await post(path, body);
  if (!r.ok) toast(r.json.message ?? "That didn't work.");
  else if (done) toast(done);
  return r;
}
let toastTimer = null;
function toast(text) {
  const t = $("[data-toast]");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
function ask(text, yes = "Yes") {
  const d = $("[data-ask]");
  $("[data-ask-text]").textContent = text;
  $("[data-ask-yes]").textContent = yes;
  d.showModal();
  return new Promise((done) => d.addEventListener("close", () => done(d.returnValue === "yes"), { once: true }));
}

// ---- gestures: from the room and from the buttons, played at once here
async function gesture(g) {
  if (!canPlay(conn) || !state) return;
  sound.wake();
  $("[data-hint]").dataset.done = "";
  scene?.playLocal([...state.stage.gestures, { ...g, by: you.tag, seq: 1e9 }]);
  const r = await act("/stage/gesture", { gesture: g });
  if (!r.ok && state) scene?.update(state, you);
}

// ---- the stream
function connect() {
  const es = new EventSource("/events");
  es.addEventListener("open", () => setConn(connection(conn, "open")));
  es.addEventListener("state", (e) => {
    const s = JSON.parse(e.data);
    offset = clockOffset(s.serverTime, Date.now());
    state = s;
    you = s.you;
    setConn(connection(conn, "state"));
    render();
  });
  es.addEventListener("pointers", (e) => scene?.setPointers(JSON.parse(e.data)));
  es.addEventListener("error", () => setConn(connection(conn, "error")));
}
function setConn(c) {
  conn = c;
  const msg = connectionMessage(c);
  const status = $("[data-status]");
  status.textContent = msg;
  status.hidden = !msg || (!c.everLive && !state);
  document.body.dataset.conn = canPlay(c) ? "live" : c.status;
  for (const b of document.querySelectorAll("[data-play]")) b.disabled = !canPlay(c) || b.dataset.blocked === "1";
  scene?.setPlayable(canPlay(c));
}

// ---- the panel
function render() {
  if (!state) return;
  $("[data-static]").hidden = true;
  $("[data-people]").hidden = false;
  $("[data-tabs]").hidden = false;
  $("[data-drawers]").hidden = false;
  $("[data-you-dot]").style.setProperty("--c", colourOf(you));
  $("[data-you-name]").textContent = you.name;
  $("[data-here]").replaceChildren(...state.here.filter((w) => w.tag !== you.tag).map((w) => el("li", {}, chip(w))));
  if (!state.here.some((w) => w.tag !== you.tag)) $("[data-here]").replaceChildren(el("li", { class: "by" }, "just you, for now"));
  renderTabs();
  renderStage();
  renderPlinth();
  renderDrawers();
  scene?.update(state, you);
  setConn(conn);
}

function renderTabs() {
  const tabs = [{ key: "stage", label: "The stage", full: state.stage.gestures.length > 0 }, ...state.slots.map((s) => ({ key: `slot:${s.slot}`, label: `${s.slot}`, full: !!s.exhibit, name: s.exhibit ? `Plinth ${s.slot}: ${s.exhibit.latest.title}` : `Plinth ${s.slot}: empty` }))];
  const cur = selected.kind === "stage" ? "stage" : `slot:${selected.slot}`;
  $("[data-tabs]").replaceChildren(
    ...tabs.map((t) =>
      el("button", { type: "button", class: "tab", "aria-pressed": String(t.key === cur), "aria-label": t.name, title: t.name, dataset: { go: t.key }, onclick: () => choose(t.key === "stage" ? { kind: "stage" } : { kind: "slot", slot: Number(t.key.slice(5)) }) },
        el("span", { class: `pip${t.full ? " full" : ""}`, "aria-hidden": "true" }),
        t.key === "stage" ? t.label : `Plinth ${t.label}`),
    ),
  );
}

function choose(sel, focus = true) {
  selected = sel;
  $("[data-back]").hidden = sel.kind === "stage";
  scene?.select(sel);
  if (state) {
    renderTabs();
    renderStage();
    renderPlinth();
  }
  if (focus) $(sel.kind === "stage" ? "#stage-h" : "#plinth-h").focus({ preventScroll: phone.matches });
}

function renderStage() {
  const card = $('[data-card="stage"]');
  card.hidden = selected.kind !== "stage";
  const st = state.stage;
  const based = $("[data-based]");
  based.hidden = !st.basedOn;
  if (st.basedOn) based.textContent = `Joined in from "${st.basedOn.title}", version ${st.basedOn.n}.`;
  $("[data-credits-label]").textContent = st.gestures.length ? `Playing, ${plural(st.gestures.length, "gesture")}:` : "Quiet. Flick a ball to start.";
  $("[data-credits]").replaceChildren(...st.credits.map((c) => chip(c, ` ×${c.count}`)));
  renderTicks();
  renderGestureButtons();
  const empty = st.gestures.length === 0;
  const mine = st.gestures.some((g) => g.by === you.tag);
  $("[data-publish-open]").dataset.blocked = empty ? "1" : "0";
  $("[data-clear]").dataset.blocked = empty ? "1" : "0";
  $("[data-undo]").dataset.blocked = mine ? "0" : "1";
  if (!$("[data-publish]").hidden) renderTargets();
}

function renderTicks() {
  const who = new Map(state.stage.credits.map((c) => [c.tag, c]));
  $("[data-ticks]").replaceChildren(
    ...state.stage.gestures.map((g) => el("span", { class: `tick${g.kind === "ring" ? " ring" : ""}`, style: { left: `${(g.at / LOOP) * 100}%`, "--c": colourOf(who.get(g.by)) } })),
  );
}

let buttonsBuilt = false;
function renderGestureButtons() {
  if (buttonsBuilt) return;
  buttonsBuilt = true;
  $("[data-gestures]").replaceChildren(
    ...BALLS.map((id) =>
      el("button", { type: "button", class: "gesture", "data-play": true, dataset: { gesture: `flick:${id}` }, onclick: () => {
        const pos = shown(simulate(state.stage.gestures, now()), now()).balls[id].pos;
        gesture({ kind: "flick", ball: id, v: buttonFlick(pos), at: gestureMoment(now()) });
      } }, el("span", { class: "ball", style: { "--c": BALL_COLOURS[id] }, "aria-hidden": "true" }), `Flick ${BALL_NAMES[id].toLowerCase()}`),
    ),
    el("button", { type: "button", class: "gesture", "data-play": true, dataset: { gesture: "ring" }, onclick: () => gesture({ kind: "ring", at: gestureMoment(now()) }) }, el("span", { class: "ball", style: { "--c": "#e0b356" }, "aria-hidden": "true" }), "Ring the bell"),
  );
}

// the loop's head runs along the strip on the shared clock
function tickHead() {
  const head = $("[data-head]");
  if (head) head.style.left = `${(now() / LOOP) * 100}%`;
  requestAnimationFrame(tickHead);
}

// ---- leave it
let publishFor = null; // a slot chosen from a plinth card
function openPublish(slot = null) {
  publishFor = slot;
  choose({ kind: "stage" }, false);
  const f = $("[data-publish]");
  f.hidden = false;
  $("#publish-title").value = suggestTitle(state.stage.gestures);
  $("[data-publish-error]").textContent = "";
  renderTargets();
  $("#publish-title").focus();
  $("#publish-title").select();
}
function renderTargets() {
  const box = $("[data-targets]");
  const was = box.querySelector("input:checked")?.value;
  const targets = publishTargets(state);
  box.replaceChildren(
    ...targets.map((t, i) => {
      const value = `${t.kind}:${t.slot}`;
      const checked = was ? was === value : publishFor ? t.slot === publishFor && t.kind !== "replace" : i === 0;
      return el("label", {}, el("input", { type: "radio", name: "target", value, checked, dataset: { i: String(i) } }), t.label);
    }),
  );
  box._targets = targets;
}
$("[data-publish-open]").addEventListener("click", () => openPublish());
$("[data-publish-here]").addEventListener("click", () => openPublish(selected.slot));
$("[data-publish-cancel]").addEventListener("click", () => ($("[data-publish]").hidden = true));
$("[data-publish]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = $("[data-targets]");
  const picked = box.querySelector("input:checked");
  const err = $("[data-publish-error]");
  if (!picked) return (err.textContent = "Choose where it goes.");
  const target = box._targets[Number(picked.dataset.i)];
  const title = $("#publish-title").value.trim();
  if (!title || title.length > 40) return (err.textContent = "A title is 1 to 40 characters.");
  if (target.kind === "replace" && !(await ask(`Replace what's on plinth ${target.slot}? It moves to the storeroom with every version kept.`, "Replace it"))) return;
  const r = await post("/publish", publishBody(target, title));
  if (!r.ok) return (err.textContent = r.json.message ?? "That didn't work.");
  $("[data-publish]").hidden = true;
  toast(`Left on plinth ${target.slot}.`);
  choose({ kind: "slot", slot: target.slot });
});

$("[data-undo]").addEventListener("click", () => act("/stage/undo"));
$("[data-clear]").addEventListener("click", async () => {
  if (await ask("Start over? This loop is kept in Cleared loops, and anyone can bring it back.", "Start over")) act("/stage/clear", {}, "Started over.");
});

// ---- a plinth
const histories = new Map(); // exhibit id -> { key, versions }
async function historyOf(ex) {
  const key = `${ex.id}:${ex.versionCount}`;
  const h = histories.get(ex.id);
  if (h?.key === key) return h.versions;
  const r = await fetch(`/exhibits/${ex.id}`).then((x) => x.json()).catch(() => null);
  if (!r) return null;
  histories.set(ex.id, { key, versions: r.versions });
  return r.versions;
}
async function renderPlinth() {
  const card = $('[data-card="plinth"]');
  card.hidden = selected.kind !== "slot";
  if (selected.kind !== "slot") return;
  const s = state.slots[selected.slot - 1];
  $("[data-plinth-where]").textContent = `Plinth ${s.slot}`;
  $("[data-plinth-title]").textContent = s.exhibit ? s.exhibit.latest.title : "Empty";
  $("[data-plinth-full]").hidden = !s.exhibit;
  $("[data-plinth-empty]").hidden = !!s.exhibit;
  $("[data-publish-here]").dataset.blocked = state.stage.gestures.length ? "0" : "1";
  if (!s.exhibit) return setConn(conn);
  const ex = s.exhibit;
  $("[data-plinth-credits]").replaceChildren(...(ex.latest.credits.length ? ex.latest.credits.map((c) => chip(c)) : ["nobody"]));
  const versions = await historyOf(ex);
  if (!versions || selected.kind !== "slot" || selected.slot !== s.slot) return;
  $("[data-versions]").replaceChildren(
    ...versions.map((v) =>
      el("li", {},
        el("span", {}, el("strong", {}, `Version ${v.n}`), ` "${v.title}" `, el("span", { class: "meta" }, `left by ${v.leftBy.name}${v.restoredFrom ? `, restored from version ${v.restoredFrom}` : ""}`)),
        el("span", { class: "row" },
          el("button", { type: "button", "data-play": true, "aria-label": `Join in on version ${v.n}`, onclick: () => joinIn(v) }, "Join in"),
          v.n !== ex.latest.n ? el("button", { type: "button", class: "quiet", "data-play": true, "aria-label": `Restore version ${v.n} as the newest`, onclick: () => act(`/exhibits/${ex.id}/restore`, { versionId: v.id }, `Version ${v.n} is the newest again.`) }, "Restore") : null),
      ),
    ),
  );
  setConn(conn);
}
async function joinIn(version) {
  const busy = state.stage.gestures.length > 0;
  if (busy && !(await ask(`Bring "${version.title}" to the stage? What's playing now is kept in Cleared loops.`, "Bring it"))) return;
  const r = await act("/stage/join", { versionId: version.id, replace: busy }, `"${version.title}" is on the stage. Play along.`);
  if (r.ok) choose({ kind: "stage" });
}
$("[data-join]").addEventListener("click", async () => {
  const ex = state.slots[selected.slot - 1].exhibit;
  if (ex) joinIn(ex.latest);
});
$("[data-store]").addEventListener("click", async () => {
  const ex = state.slots[selected.slot - 1].exhibit;
  if (ex && (await ask(`Move "${ex.latest.title}" to the storeroom? Every version is kept, and it can come back.`, "Move it"))) act(`/exhibits/${ex.id}/store`, {}, "Moved to the storeroom.");
});

// ---- the drawers
function renderDrawers() {
  $("[data-store-count]").textContent = String(state.storeroom.length);
  $("[data-archive-count]").textContent = String(state.archivedTotal);
  const empties = state.slots.filter((s) => !s.exhibit).map((s) => s.slot);
  $("[data-storeroom]").replaceChildren(
    ...(state.storeroom.length
      ? state.storeroom.map((ex) => {
          const sel = el("select", { "aria-label": `Plinth for "${ex.latest.title}"` }, ...empties.map((n) => el("option", { value: String(n) }, `Plinth ${n}`)));
          return el("li", {}, el("span", {}, `"${ex.latest.title}" `, el("span", { class: "by" }, plural(ex.versionCount, "version"))),
            empties.length
              ? el("span", {}, sel, " ", el("button", { type: "button", "data-play": true, onclick: () => act(`/exhibits/${ex.id}/display`, { slot: Number(sel.value) }, "Back on display.") }, "Put it out"))
              : el("span", { class: "by" }, "no empty plinth"));
        })
      : [el("li", { class: "by" }, "Empty")]),
  );
  $("[data-archive]").replaceChildren(
    ...(state.archived.length
      ? state.archived.map((a) =>
          el("li", {}, el("span", {}, plural(a.gestures.length, "gesture"), " by ", a.credits.map((c) => c.name).join(", ") || "nobody"),
            el("button", { type: "button", "data-play": true, onclick: () => bringBack(a) }, "Bring back")))
      : [el("li", { class: "by" }, "Empty")]),
  );
}
async function bringBack(a) {
  const busy = state.stage.gestures.length > 0;
  if (busy && !(await ask("Bring this loop back to the stage? What's playing now is kept in Cleared loops.", "Bring it"))) return;
  const r = await act("/stage/bring-back", { archivedId: a.id, replace: busy }, "It's back on the stage.");
  if (r.ok) choose({ kind: "stage" });
}

// ---- who you are
$("[data-rename-open]").addEventListener("click", () => {
  $("[data-rename]").hidden = false;
  $("#rename-input").value = you.name;
  $("#rename-input").focus();
});
$("[data-rename-cancel]").addEventListener("click", () => ($("[data-rename]").hidden = true));
$("[data-rename]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await act("/me", { name: $("#rename-input").value });
  if (r.ok) $("[data-rename]").hidden = true;
});

$("[data-back]").addEventListener("click", () => choose({ kind: "stage" }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest("input, select, dialog") && selected.kind !== "stage") choose({ kind: "stage" });
});
document.addEventListener("pointerdown", () => sound.wake(), { once: true });
document.addEventListener("keydown", () => sound.wake(), { once: true });

// ---- start: the panel at once, the room when it loads
connect();
tickHead();
try {
  const { createScene } = await import("./scene.js");
  const canvas = $("[data-scene]");
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) throw new Error("no WebGL");
  scene = await createScene(canvas, {
    loopNow: now,
    reducedMotion: () => reducedMotion.matches,
    coverRight: () => (phone.matches || document.body.classList.contains("no-gl") ? 0 : $("#panel").getBoundingClientRect().width + 16),
    onGesture: gesture,
    onSelect: (sel) => choose(sel),
    onPointer: (p) => canPlay(conn) && post("/pointer", { p }),
  });
  scene.onEvent((e) => sound.play(e));
  scene.select(selected);
  if (state) render();
} catch {
  document.body.classList.add("no-gl");
}
