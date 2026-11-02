// The room page (ADR 31): anyone sees a room and looks closely at what's on
// show; its owner, and only its owner, can arrange it. The server is what
// enforces that: POST /room names no room. Everything here shows or edits a
// draft; a layout counts once the server has saved it.
import { DEFAULT_ROOM, FLOORS, ITEMS, LIGHTS, ROOM_ASPECT, ROOM_MAX_ITEMS, WALLS, bounds, freeSpot, hitItem, nextUid, project, unproject } from "./room.js";
import { MATERIALS } from "./arena.js";
import { drawItem, itemIcon } from "./arena-draw.js";
import { itemName, waitingWords } from "./arena-ui.js";

const $ = (s) => document.querySelector(s);
const canvas = $("[data-room]");
const g = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const tagInUrl = /^\/room\/([0-9a-f]{8})$/.exec(location.pathname)?.[1] ?? null;

let room = null; // as the server last said
let draft = null; // the layout on screen
let mine = false;
let shelf = [];
let editing = false;
let selected = null;
let dirty = false;
let drag = null;

const say = (text) => {
  const s = $("[data-status]");
  s.textContent = text;
  s.hidden = !text;
};
const artifactsNow = () => {
  const out = { ...room.artifacts };
  for (const a of shelf) out[a.id] = a;
  return out;
};
const selectedItem = () => draft?.items.find((i) => i.uid === selected) ?? null;

async function load() {
  const r = await fetch(tagInUrl ? `/rooms/${tagInUrl}` : "/rooms/me");
  if (!r.ok) {
    $("[data-name]").textContent = "No such room";
    say("This room doesn't exist.");
    return;
  }
  const j = await r.json();
  if (j.mine && tagInUrl) {
    // your own room, by its public address: the same as /room/
    const me = await (await fetch("/rooms/me")).json();
    return show(me);
  }
  show(j);
}
function show(j) {
  room = j;
  mine = j.mine;
  shelf = j.shelf ?? [];
  draft = structuredClone(j.layout);
  dirty = false;
  $("[data-name]").textContent = j.name;
  $("[data-kicker]").textContent = mine ? "Your exhibition room" : "Exhibition room";
  document.title = `${j.name} · Exhibition room`;
  $("[data-owner-tools]").hidden = !mine || editing || !shelf.length;
  $("[data-go-win]").hidden = !mine || shelf.length > 0;
  $("[data-waiting]").textContent = mine ? waitingWords(shelf, j.layout.items) : "";
  $("[data-my-room]").hidden = mine;
  renderOnShow();
  renderPanel();
}

// ---- what's on show: buttons, so nothing depends on the canvas
function renderOnShow() {
  const all = artifactsNow();
  const shown = draft.items.filter((i) => all[i.artifact ?? ""]);
  $("[data-nothing]").hidden = shown.length > 0;
  $("[data-onshow]").replaceChildren(
    ...shown.map((i) => {
      const a = all[i.artifact];
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = MATERIALS[a.material].rarity;
      b.append(itemIcon(a, 72), itemName(a.kind, a.material), sub);
      b.addEventListener("click", () => closer(a));
      li.append(b);
      return li;
    }),
  );
}

// ---- the room's directory
let nextRooms = null;
async function loadRooms(more = false) {
  const q = more && nextRooms ? `?before=${encodeURIComponent(nextRooms)}` : "";
  const j = await fetch(`/rooms${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!j) return;
  nextRooms = j.next;
  $("[data-rooms-more]").hidden = !nextRooms;
  const lis = j.entries.map((e) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/room/${e.tag}`;
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = `${e.onShow} on show · ${WALLS[e.wall]?.name ?? ""}`;
    a.append(e.name, sub);
    li.append(a);
    return li;
  });
  if (more) $("[data-rooms]").append(...lis);
  else $("[data-rooms]").replaceChildren(...lis);
  if (!more && !lis.length) $("[data-rooms]").replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "No rooms have anything on show yet." }));
}
$("[data-rooms-more]").addEventListener("click", () => loadRooms(true));

// ---- arranging: a draft, for the owner's eyes, until it's saved
function showDirty() {
  $("[data-save]").disabled = !dirty;
  $("[data-discard]").disabled = !dirty;
  const d = $("[data-dirty]");
  d.textContent = dirty ? "Unsaved changes" : "No changes";
  d.toggleAttribute("data-on", dirty);
}
function changed() {
  dirty = true;
  showDirty();
  say("");
  renderOnShow();
  renderSelection();
}
function renderPanel() {
  showDirty();
  const pick = (host, table, key) => {
    $(host).replaceChildren(
      ...Object.entries(table).map(([k, v]) => {
        const b = document.createElement("button");
        b.type = "button";
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.dataset.finish = k;
        b.append(chip, v.name);
        b.setAttribute("aria-pressed", String(draft[key] === k));
        b.addEventListener("click", () => {
          draft[key] = k;
          changed();
          renderPanel();
        });
        return b;
      }),
    );
  };
  pick("[data-walls]", WALLS, "wall");
  pick("[data-floors]", FLOORS, "floor");
  pick("[data-lights]", LIGHTS, "light");
  for (const group of ["stand", "furniture", "decor"]) {
    $(`[data-add-${group}]`).replaceChildren(
      ...Object.entries(ITEMS)
        .filter(([, t]) => t.group === group)
        .map(([type, t]) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = t.name;
          b.disabled = draft.items.length >= ROOM_MAX_ITEMS;
          b.addEventListener("click", () => add(type));
          return b;
        }),
    );
  }
  renderSelection();
}
function add(type) {
  if (draft.items.length >= ROOM_MAX_ITEMS) return;
  const [x, y] = freeSpot(draft.items, ITEMS[type].place);
  const i = { uid: nextUid(draft.items), type, x, y };
  draft.items.push(i);
  selected = i.uid;
  changed();
  renderPanel();
}
function renderSelection() {
  const i = selectedItem();
  $("[data-selection]").hidden = !i;
  $("[data-select-hint]").hidden = !!i;
  if (!i) return;
  $("[data-selected-name]").textContent = ITEMS[i.type].name;
  const isStand = ITEMS[i.type].group === "stand";
  $("[data-artifact-label]").hidden = !isStand;
  if (!isStand) return;
  const used = new Set(draft.items.filter((x) => x.artifact && x.uid !== i.uid).map((x) => x.artifact));
  const sel = $("[data-artifact]");
  sel.replaceChildren(new Option("Nothing", ""), ...shelf.filter((a) => !used.has(a.id)).map((a) => new Option(`${itemName(a.kind, a.material)} (no. ${a.seed})`, a.id)));
  sel.value = i.artifact ?? "";
  sel.disabled = shelf.length === 0;
}
$("[data-artifact]").addEventListener("change", (e) => {
  const i = selectedItem();
  if (!i) return;
  if (e.target.value) i.artifact = e.target.value;
  else delete i.artifact;
  changed();
});
$("[data-remove]").addEventListener("click", () => {
  draft.items = draft.items.filter((i) => i.uid !== selected);
  selected = null;
  changed();
  renderPanel();
});
for (const b of document.querySelectorAll("[data-nudge]")) {
  b.addEventListener("click", () => {
    const i = selectedItem();
    if (!i) return;
    const [dx, dy] = b.dataset.nudge.split(",").map(Number);
    i.x = Math.max(0, Math.min(1, Math.round((i.x + dx * 0.02) * 1000) / 1000));
    i.y = Math.max(0, Math.min(1, Math.round((i.y + (ITEMS[i.type].place === "wall" ? -dy : dy) * 0.02) * 1000) / 1000));
    changed();
  });
}
function setEditing(on) {
  editing = on;
  document.body.toggleAttribute("data-editing", on);
  $("[data-panel]").hidden = !on;
  $("[data-owner-tools]").hidden = !mine || on || !shelf.length;
  if (!on) selected = null;
}
$("[data-edit]").addEventListener("click", () => setEditing(true));
$("[data-done]").addEventListener("click", () => {
  if (dirty) return say("Save or discard your changes first.");
  setEditing(false);
});
$("[data-discard]").addEventListener("click", () => {
  draft = structuredClone(room.layout);
  selected = null;
  dirty = false;
  say("");
  renderOnShow();
  renderPanel();
});
$("[data-save]").addEventListener("click", async () => {
  $("[data-save]").disabled = true;
  const r = await fetch("/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: draft, was: room.rev }) }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  if (!r?.ok) {
    if (j?.error === "stale-room") {
      await load();
      return say(`${j.message}.`);
    }
    $("[data-save]").disabled = false;
    return say(j?.message ?? "The room didn't save. Try again.");
  }
  room = { ...room, rev: j.rev, layout: structuredClone(draft) };
  dirty = false;
  $("[data-waiting]").textContent = waitingWords(shelf, draft.items);
  renderPanel();
  say("Saved.");
  loadRooms();
});

// the room's pointer: dragging when arranging, looking closer otherwise
const inView = (e) => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
};
canvas.addEventListener("pointerdown", (e) => {
  if (!draft) return;
  const [X, Y] = inView(e);
  const hit = hitItem(draft.items, X, Y);
  if (!editing) {
    const a = hit && artifactsNow()[hit.artifact ?? ""];
    if (a) closer(a);
    return;
  }
  e.preventDefault();
  selected = hit?.uid ?? null;
  renderSelection();
  if (!hit) return;
  const p = project(hit, ITEMS[hit.type].place);
  drag = { id: e.pointerId, dx: p.X - X, dy: p.Y - Y };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const [X, Y] = inView(e);
  if (!editing && draft) canvas.style.cursor = artifactsNow()[hitItem(draft.items, X, Y)?.artifact ?? ""] ? "zoom-in" : "default";
  if (!drag || e.pointerId !== drag.id) return;
  const i = selectedItem();
  if (!i) return;
  const [x, y] = unproject(X + drag.dx, Y + drag.dy, ITEMS[i.type].place);
  i.x = Math.round(x * 1000) / 1000;
  i.y = Math.round(y * 1000) / 1000;
  drag.moved = true;
});
const drop = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null;
  if (moved) changed();
};
canvas.addEventListener("pointerup", drop);
canvas.addEventListener("pointercancel", drop);

// ---- the room's picture
function frame(ms) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = w / ROOM_ASPECT;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  if (draft) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRoom(g, w, h, draft, artifactsNow(), { t: reduced.matches ? 0 : ms / 4000, selected, editing });
  }
  requestAnimationFrame(frame);
}

// ---- looking closely: larger, a light you carry, and a moment awake
const dialog = $("[data-closer]");
const up = $("[data-closeup]");
const cg = up.getContext("2d");
let look = null; // { item, zoom, light: [x, y], wakeUntil, t }
function closer(a) {
  look = { item: a, zoom: 1, light: [0.38, 0.3], wakeUntil: 0, t: 0 };
  $("[data-closer-name]").textContent = itemName(a.kind, a.material);
  $("[data-closer-tier]").textContent = MATERIALS[a.material].rarity;
  const when = a.at ? new Date(a.at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  $("[data-closer-detail]").textContent = `Piece no. ${a.seed}${when ? `, collected ${when}` : ""}.`;
  dialog.showModal();
  requestAnimationFrame(drawCloser);
}
function drawCloser(ms) {
  if (!dialog.open) return;
  const W = up.width;
  const awake = !reduced.matches && performance.now() < look.wakeUntil;
  if (awake) look.t += 1 / 60;
  cg.setTransform(1, 0, 0, 1, 0, 0);
  const bg = cg.createRadialGradient(W / 2, W * 0.46, W * 0.05, W / 2, W / 2, W * 0.72);
  bg.addColorStop(0, "#2d2820");
  bg.addColorStop(1, "#0d0b09");
  cg.fillStyle = bg;
  cg.fillRect(0, 0, W, W);
  const r = (W * 0.27 * look.zoom);
  cg.fillStyle = "rgba(0,0,0,.3)";
  cg.filter = `blur(${W * 0.012}px)`;
  cg.beginPath();
  cg.ellipse(W / 2, W / 2 + r * 0.92, r * 0.8, r * 0.07, 0, 0, Math.PI * 2);
  cg.fill();
  cg.filter = "none";
  drawItem(cg, look.item, W / 2 + (look.item.kind === "door" ? r * 0.3 : 0), W / 2, r, look.t);
  // the carried light: it brightens what's under it and dims the rest
  const [lx, ly] = look.light;
  const light = cg.createRadialGradient(lx * W, ly * W, 0, lx * W, ly * W, W * 0.5);
  light.addColorStop(0, "rgba(255,240,214,.26)");
  light.addColorStop(0.3, "rgba(255,240,214,.1)");
  light.addColorStop(0.6, "rgba(0,0,0,.14)");
  light.addColorStop(1, "rgba(0,0,0,.5)");
  cg.fillStyle = light;
  cg.fillRect(0, 0, W, W);
  requestAnimationFrame(drawCloser);
}
const moveLight = (e) => {
  const r = up.getBoundingClientRect();
  look.light = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
};
up.addEventListener("pointermove", moveLight);
up.addEventListener("pointerdown", moveLight);
const zoomBy = (k) => {
  look.zoom = Math.max(0.7, Math.min(1.5, look.zoom * k));
};
$("[data-nearer]").addEventListener("click", () => zoomBy(1.2));
$("[data-further]").addEventListener("click", () => zoomBy(1 / 1.2));
$("[data-wake]").addEventListener("click", () => {
  look.wakeUntil = performance.now() + 2600;
  look.wokenAt = performance.now();
  // with reduced motion a wake is one still step: the pose changes, not a run
  if (reduced.matches) look.t += 0.5;
});
$("[data-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

// For the browser check: where things are, on screen.
canvas.probe = () => {
  const r = canvas.getBoundingClientRect();
  return {
    mine,
    dirty,
    rev: room?.rev ?? null,
    tag: room?.tag ?? null,
    wall: draft?.wall,
    shelf: shelf.length,
    shown: draft?.items.filter((i) => i.artifact).length ?? 0,
    looking: dialog.open ? { zoom: look.zoom, t: look.t } : null,
    items: (draft?.items ?? []).map((i) => {
      const b = bounds(i);
      return { uid: i.uid, type: i.type, x: i.x, y: i.y, artifact: i.artifact, cx: r.left + b.X * r.width, cy: r.top + ((b.top + b.bottom) / 2) * r.height };
    }),
  };
};

import { drawRoom } from "./room-draw.js";
load();
loadRooms();
requestAnimationFrame(frame);
