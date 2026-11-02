// The room page (ADR 31): anyone sees a room and looks closely at what's on
// show; its owner, and only its owner, can arrange it. The server is what
// enforces that: POST /room names no room. Everything here shows or edits a
// draft; a layout counts once the server has saved it.
import { FLOORS, ITEMS, LIGHTS, ROOM_ASPECT, ROOM_MAX_ITEMS, WALK_START, WALLS, bounds, freeNear, freeSpot, hitItem, iso, nextUid, project, reachable, route, stepWalker, unproject } from "./room.js";
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
// ---- your robot, on a visit: local, never stored or sent
let walker = null;
let path = []; // points to walk to
let goal = null; // the item to use on arrival
let near = null; // the item in reach
const held = new Set(); // steering keys down
let stir = 0;

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
  walker = { ...freeNear(WALK_START, draft.items), moving: false, sitting: false, seat: null, face: [-0.7, -0.7] };
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
    // as it looks on screen: on the floor, right is along x and away from y
    const wall = ITEMS[i.type].place === "wall";
    const mx = wall ? dx : dx + dy, my = wall ? -dy : dy - dx;
    i.x = Math.max(0, Math.min(1, Math.round((i.x + mx * 0.02) * 1000) / 1000));
    i.y = Math.max(0, Math.min(1, Math.round((i.y + my * 0.02) * 1000) / 1000));
    changed();
  });
}
function setEditing(on) {
  editing = on;
  document.body.toggleAttribute("data-editing", on);
  $("[data-panel]").hidden = !on;
  $("[data-owner-tools]").hidden = !mine || on || !shelf.length;
  if (!on) selected = null;
  path = [];
  goal = null;
  $("[data-prompt]").hidden = true;
  $("[data-walk-hint]").hidden = on;
  if (!on && draft) walker = { ...walker, ...freeNear(walker, draft.items), sitting: false };
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
  if (!editing) return; // a visitor walks, on the click that follows
  const hit = hitItem(draft.items, X, Y);
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
  if (!editing && draft) {
    const h = hitItem(draft.items, X, Y);
    canvas.style.cursor = h && (artifactsNow()[h.artifact ?? ""] || ITEMS[h.type].seat) ? "pointer" : "default";
  }
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

// ---- walking: a click or tap goes there, round whatever's in the way;
// pressing something goes to it and uses it
function standUp() {
  if (!walker.sitting) return;
  walker.sitting = false;
  walker.seat = null;
  Object.assign(walker, freeNear({ x: walker.x + 0.08, y: walker.y + 0.08 }, draft.items));
}
function walkTo(to, item = null) {
  standUp();
  path = route(walker, to, draft.items);
  goal = item;
  if (!path.length && item) arrive();
}
function use(i) {
  const a = artifactsNow()[i.artifact ?? ""];
  if (a) return closer(a);
  if (ITEMS[i.type].seat) {
    Object.assign(walker, { x: i.x, y: i.y, sitting: true, seat: i.type, moving: false });
    path = [];
  }
}
function arrive() {
  const i = goal;
  goal = null;
  if (i) use(i);
}
canvas.addEventListener("click", (e) => {
  if (editing || !draft) return;
  const [X, Y] = inView(e);
  const hit = hitItem(draft.items, X, Y);
  if (hit && ITEMS[hit.type].place === "floor" && (artifactsNow()[hit.artifact ?? ""] || ITEMS[hit.type].seat)) return walkTo(hit, hit);
  const [x, y] = unproject(X, Y, "floor");
  const b = iso(x, y);
  if (Math.hypot(b.X - X, b.Y - Y) < 0.02) walkTo({ x, y }); // on the floor, not a wall
});
const STEER = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1], w: [-1, -1], s: [1, 1], a: [-1, 1], d: [1, -1] };
canvas.addEventListener("keydown", (e) => {
  if (editing || dialog.open) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (STEER[k]) {
    e.preventDefault();
    held.add(k);
    path = [];
    goal = null;
    standUp();
  } else if (k === "e" || k === "Enter") {
    e.preventDefault();
    act();
  } else if (k === "Escape") standUp();
});
addEventListener("keyup", (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
canvas.addEventListener("blur", () => held.clear());
function act() {
  if (walker.sitting) return standUp();
  if (near) use(near);
}
$("[data-prompt]").addEventListener("click", act);
function walk(dt) {
  if (dialog.open) return;
  let dir = [0, 0];
  for (const k of held) dir = [dir[0] + STEER[k][0], dir[1] + STEER[k][1]];
  if (!dir[0] && !dir[1] && path.length) {
    const p = path[0];
    dir = [p.x - walker.x, p.y - walker.y];
    if (Math.hypot(dir[0], dir[1]) < 0.012) {
      path.shift();
      if (!path.length) arrive();
      dir = [0, 0];
    }
  }
  walker.moving = !!(dir[0] || dir[1]);
  if (walker.moving) {
    const n = stepWalker(walker, dir, dt, draft.items);
    if (n === walker && path.length) path = []; // pressed against something: stop trying
    walker.x = n.x;
    walker.y = n.y;
    walker.face = dir;
  }
}
function showPrompt() {
  const was = near?.uid;
  near = walker.sitting ? null : reachable(walker, draft.items, artifactsNow());
  const p = $("[data-prompt]");
  const a = near && artifactsNow()[near.artifact ?? ""];
  const words = walker.sitting ? "Stand up" : a ? `Look closely at the ${itemName(a.kind, a.material).toLowerCase()}` : near ? `Sit on the ${ITEMS[near.type].name.toLowerCase()}` : "";
  if (words !== p.textContent) p.textContent = words;
  p.hidden = !words || editing;
  $("[data-walk-hint]").hidden = !p.hidden || editing;
  if (near?.uid !== was) stir = 0;
}

// ---- the room's picture
let lastFrame = 0;
function frame(ms) {
  const dt = Math.min(0.05, (ms - lastFrame) / 1000 || 0);
  lastFrame = ms;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = w / ROOM_ASPECT;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  if (draft) {
    if (!editing) {
      walk(dt);
      showPrompt();
    }
    if (!reduced.matches && near) stir += dt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRoom(g, w, h, dpr, draft, artifactsNow(), { t: reduced.matches ? 0 : ms / 1000, stir, selected, editing, walker: editing ? null : walker, near: near?.uid ?? null });
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
    walker: walker && { x: walker.x, y: walker.y, sitting: walker.sitting, moving: walker.moving, cx: r.left + iso(walker.x, walker.y).X * r.width, cy: r.top + iso(walker.x, walker.y).Y * r.height },
    near: near?.uid ?? null,
    prompt: $("[data-prompt]").hidden ? "" : $("[data-prompt]").textContent,
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
