// The room page (ADR 31): anyone sees a room and looks closely at what's on
// show; its owner, and only its owner, can arrange it. The server is what
// enforces that: POST /room names no room. Everything here shows or edits a
// draft; a layout counts once the server has saved it.
import { COLOURS, FLOORS, ITEMS, LIGHTS, ROOM_ASPECT, ROOM_MAX_ITEMS, WALK_START, WALLS, walkerColour, baseOf, bounds, canTurn, dropSpot, freeNear, freeSpot, hitItem, hitShown, iso, nextUid, project, reachable, restOn, route, snapSpot, stepWalker, unproject } from "./room.js";
import { CATALOG, MATERIALS } from "./arena.js";
import { drawItem, itemIcon } from "./arena-draw.js";
import { catalogCell, itemName, waitingCount } from "./arena-ui.js";

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
// ---- everyone else in this room (ADR 36): their last walk, eased towards
let others = new Map();
let myTag = null;
let live = null;
let liveRoom = null;
let liveTries = 0;
let sentKey = "";
let sentAt = 0;
let sending = false;
let placed = false; // you've been given a spot clear of everyone already here
// where arrivals stand, nearest the door first: the first one nobody's on
const ARRIVALS = [[0.9, 0.9], [0.9, 0.76], [0.76, 0.9], [0.9, 0.62], [0.62, 0.9], [0.78, 0.78], [0.9, 0.48], [0.48, 0.9]];
function standClear(list) {
  placed = true;
  if (!walker || walker.moving || walker.sitting || path.length) return;
  const clear = (p) => list.every((w) => Math.hypot(w.x - p.x, w.y - p.y) > 0.08);
  for (const [x, y] of ARRIVALS) {
    const p = freeNear({ x, y }, draft.items);
    if (clear(p)) return Object.assign(walker, p);
  }
}

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
  placed = false;
  $("[data-name]").textContent = j.name;
  document.title = `${j.name} · Exhibition room`;
  showOwner();
  renderOnShow();
  renderPanel();
  if (mine) loadCatalog();
  joinLive(j.tag);
}

// ---- the room is shared: a stream of who's here, and your walk sent to them
function joinLive(tag) {
  if (!tag || (live && liveRoom === tag)) return;
  live?.close();
  liveRoom = tag;
  sentKey = "";
  const es = (live = new EventSource(`/rooms/${tag}/live`));
  es.addEventListener("room", (e) => {
    liveTries = 0;
    const d = JSON.parse(e.data);
    myTag = d.you.tag;
    const seen = new Set();
    for (const w of d.walkers) {
      if (w.tag === myTag) continue;
      seen.add(w.tag);
      const o = others.get(w.tag);
      if (o) Object.assign(o, { tx: w.x, ty: w.y, face: w.face, moving: w.moving, sitting: w.sitting, seat: w.seat });
      else others.set(w.tag, { ...w, tx: w.x, ty: w.y, colour: walkerColour(w.tag), phase: (parseInt(w.tag.slice(0, 4), 16) % 7) || 0 });
    }
    for (const t of [...others.keys()]) if (!seen.has(t)) others.delete(t);
    if (!placed) standClear(d.walkers.filter((w) => w.tag !== myTag));
    // the owner changed the room: everyone in it sees the new layout
    if (!mine && room && d.rev > room.rev) refreshLayout(tag);
  });
  es.addEventListener("error", () => {
    if (es.readyState !== EventSource.CLOSED || live !== es) return;
    es.close();
    live = null;
    others.clear();
    const wait = Math.min(15000, 1000 * 2 ** liveTries++);
    setTimeout(() => {
      if (!live && liveRoom === tag) {
        liveRoom = null;
        joinLive(tag);
      }
    }, wait);
  });
}
async function refreshLayout(tag) {
  const j = await fetch(`/rooms/${tag}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!j || mine || j.rev <= (room?.rev ?? 0)) return;
  room = j;
  draft = structuredClone(j.layout);
  if (walker) Object.assign(walker, freeNear(walker, draft.items), walker.sitting ? { sitting: false, seat: null } : {});
  renderOnShow();
}
/** Sends your walk when it changes, at most ten times a second. */
function sendWalk(ms) {
  if (!live || !walker || !liveRoom || sending || ms - sentAt < 100) return;
  const b = { x: +walker.x.toFixed(4), y: +walker.y.toFixed(4), face: walker.face.map((v) => +(+v).toFixed(3)), moving: !!walker.moving, sitting: !!walker.sitting, seat: walker.sitting ? walker.seat : null };
  const key = JSON.stringify(b);
  if (key === sentKey) return;
  sentKey = key;
  sentAt = ms;
  sending = true;
  fetch(`/rooms/${liveRoom}/walk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: key })
    .catch(() => {})
    .finally(() => (sending = false));
}
function easeOthers(dt) {
  const k = reduced.matches ? 1 : Math.min(1, dt * 10);
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * k;
    o.y += (o.ty - o.y) * k;
  }
}
/** What the owner can do next: decorate, or go and win something to decorate with. */
function showOwner() {
  const hasAny = mine && shelf.length > 0;
  $("[data-edit]").hidden = !hasAny || editing;
  $("[data-go-win]").hidden = !mine || shelf.length > 0;
  const n = hasAny ? waitingCount(shelf, room.layout.items) : 0;
  const w = $("[data-waiting]");
  w.textContent = `${n} new`;
  w.hidden = !n;
}

// ---- what's on show, or all you've collected: buttons, so nothing depends on the canvas
function renderOnShow() {
  const all = artifactsNow();
  const list = mine ? shelf : draft.items.filter((i) => all[i.artifact ?? ""]).map((i) => all[i.artifact]);
  $("[data-nothing]").hidden = mine || list.length > 0;
  $("#onshow-h").textContent = mine ? "Your collection" : "On show";
  $("#onshow-h").hidden = mine && !list.length;
  $("[data-onshow]").replaceChildren(
    ...list.map((a) => {
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
async function loadCatalog() {
  const j = await fetch("/collection").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!j) return;
  $("[data-catalog-box]").hidden = false;
  $("[data-catalog-count]").textContent = `Catalog ${Object.keys(j.catalog).length} of ${CATALOG.length}`;
  $("[data-catalog]").replaceChildren(
    ...CATALOG.map((entry) => {
      const c = catalogCell(entry, j.catalog);
      const li = document.createElement("li");
      li.dataset.found = c.found ? "yes" : "no";
      li.append(itemIcon({ kind: c.kind, material: c.material, seed: 1 }, 48, { dark: !c.found }), c.words);
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

// ---- decorating: a draft, for the owner's eyes, until Done saves it
function changed() {
  dirty = true;
  disarmCancel();
  say("");
  renderOnShow();
  renderSelection();
}
const TABS = [["shown", "Artifacts"], ["things", "Things"], ["room", "Room"]];
const GROUPS = [["stand", "Stands"], ["furniture", "Seats"], ["rug", "Rugs"], ["wall", "On walls"], ["decor", "Decor"], ["pet", "Pets"]];
let tab = "shown";
let colourOpen = false;
let finishAim = null; // "wall" or "floor": the finish whose palette is open
function tile(label, picture, pressed, onPick, key) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tile";
  b.dataset.tile = key;
  b.setAttribute("aria-pressed", String(!!pressed));
  b.append(picture, label);
  b.addEventListener("click", onPick);
  return b;
}
function renderTabs() {
  $("[data-tabs]").replaceChildren(
    ...TABS.map(([id, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.tab = id;
      b.textContent = label;
      b.setAttribute("aria-selected", String(id === tab));
      b.addEventListener("click", () => {
        tab = id;
        renderPanel();
      });
      return b;
    }),
  );
}
function chipOf(k) {
  const c = document.createElement("span");
  c.className = "chip";
  c.dataset.finish = k;
  return c;
}
const heading = (words) => Object.assign(document.createElement("h3"), { className: "group", textContent: words });
/** A row of colours; `key` is the one in use, and pressing it again clears it. */
function swatches(key, set) {
  return Object.entries(COLOURS).map(([name, hex]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = hex;
    b.dataset.colour = name;
    b.setAttribute("aria-label", name);
    b.title = name;
    b.setAttribute("aria-pressed", String(key === name));
    b.addEventListener("click", () => {
      set(key === name ? null : name);
      changed();
      renderPanel();
    });
    return b;
  });
}
function finishRow(aim, title, table, value, tintKey) {
  const out = [heading(title), ...Object.entries(table).map(([k, v]) => tile(v.name, finishThumb(aim, k, draft[tintKey]), draft[value] === k, () => {
    draft[value] = k;
    finishAim = aim;
    changed();
    renderPanel();
  }, k))];
  if (finishAim === aim) {
    const row = document.createElement("div");
    row.className = "colours";
    row.setAttribute("aria-label", `Colour of the ${title.toLowerCase()}`);
    row.append(...swatches(draft[tintKey] ?? null, (c) => (c ? (draft[tintKey] = c) : delete draft[tintKey])));
    out.push(row);
  }
  return out;
}
/** Where an artifact goes: the stand you chose, else the first empty one, else a new plinth. */
const chosenStand = () => {
  const i = selectedItem();
  return i && ITEMS[i.type].group === "stand" ? i : null;
};
function renderTiles() {
  let tiles = [];
  let hint = "";
  if (tab === "room") {
    tiles = [
      ...finishRow("wall", "Walls", WALLS, "wall", "wallTint"),
      ...finishRow("floor", "Floors", FLOORS, "floor", "floorTint"),
      heading("Light"),
      ...Object.entries(LIGHTS).map(([k, v]) => tile(v.name, chipOf(k), draft.light === k, () => {
        draft.light = k;
        changed();
        renderPanel();
      }, k)),
    ];
  } else if (tab === "shown") {
    const stand = chosenStand();
    const used = new Set(draft.items.filter((x) => x.artifact && x.uid !== stand?.uid).map((x) => x.artifact));
    const free = shelf.filter((a) => !used.has(a.id));
    tiles = free.map((a) => {
      const pressed = stand?.artifact === a.id;
      return tile(itemName(a.kind, a.material), itemIcon(a, 64), pressed, () => showArtifact(a, stand, pressed), a.id);
    });
    if (!free.length) hint = "Everything is on show.";
  } else {
    const full = draft.items.length >= ROOM_MAX_ITEMS;
    for (const [group, title] of GROUPS) {
      tiles.push(heading(title));
      for (const [type, t] of Object.entries(ITEMS)) {
        if (t.group !== group) continue;
        const b = tile(t.name, itemThumb(type, null), false, () => add(type), type);
        b.disabled = full;
        tiles.push(b);
      }
    }
    if (full) hint = `The room is full. Remove something first.`;
  }
  $("[data-tiles]").replaceChildren(...tiles);
  const h = $("[data-tiles-hint]");
  h.textContent = hint;
  h.hidden = !hint;
}
function showArtifact(a, stand, pressed) {
  if (stand) {
    if (pressed) delete stand.artifact;
    else stand.artifact = a.id;
  } else {
    const empty = draft.items.find((i) => ITEMS[i.type].group === "stand" && !i.artifact);
    if (empty) empty.artifact = a.id;
    else {
      if (draft.items.length >= ROOM_MAX_ITEMS) return say("The room is full. Remove something first.");
      const [x, y] = freeSpot(draft.items, "floor");
      draft.items.push({ uid: nextUid(draft.items), type: "plinth", x, y, artifact: a.id });
    }
  }
  changed();
  renderPanel();
}
function renderPanel() {
  renderTabs();
  renderTiles();
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
  $("[data-tools]").hidden = !i || !editing;
  const open = !!i && colourOpen;
  $("[data-colours]").hidden = !open;
  $("[data-colour-tool]").setAttribute("aria-pressed", String(open));
  if (!i) return;
  $("[data-rotate]").hidden = !canTurn(i.type);
  if (open) $("[data-colours]").replaceChildren(...swatches(i.colour ?? null, (c) => (c ? (i.colour = c) : delete i.colour)));
}
function select(uid) {
  if (uid !== selected) colourOpen = false;
  selected = uid;
  renderTiles();
  renderSelection();
}
$("[data-colour-tool]").addEventListener("click", () => {
  colourOpen = !colourOpen;
  renderSelection();
});
$("[data-rotate]").addEventListener("click", () => {
  const i = selectedItem();
  if (!i) return;
  const r = ((i.rot ?? 0) + 1) % 4;
  if (r) i.rot = r;
  else delete i.rot;
  changed();
});
function removeSelected() {
  draft.items = draft.items.filter((i) => i.uid !== selected);
  selected = null;
  colourOpen = false;
  changed();
  renderPanel();
}
$("[data-remove]").addEventListener("click", removeSelected);
/** One grid step, as it looks on screen: on the floor, right is along x and away from y. */
function nudge(dx, dy) {
  const i = selectedItem();
  if (!i) return;
  const wall = ITEMS[i.type].place === "wall";
  const mx = wall ? dx : dx + dy, my = wall ? -dy : dy - dx;
  [i.x, i.y] = snapSpot(i.x + mx / 16, i.y + my / 16);
  changed();
}
const MOVE = { ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowRight: [1, 0] };
function editKey(e) {
  if (MOVE[e.key]) nudge(...MOVE[e.key]);
  else if (e.key === "Enter") {
    const at = draft.items.findIndex((i) => i.uid === selected);
    select(draft.items[(at + 1) % draft.items.length]?.uid ?? null);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (selected !== null) removeSelected();
  } else if (e.key === "Escape") select(null);
  else return;
  e.preventDefault();
}
$("[data-photo]").addEventListener("click", () => {
  const was = selected;
  selected = null;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      canvas.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(room?.name ?? "room").toLowerCase().replace(/[^a-z]+/g, "-")}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        selected = was;
      });
    }),
  );
});
function setEditing(on) {
  editing = on;
  document.body.toggleAttribute("data-editing", on);
  $("[data-panel]").hidden = !on;
  if (on) tab = waitingCount(shelf, draft.items) ? "shown" : "things";
  else {
    selected = null;
    finishAim = null;
    colourOpen = false;
  }
  showOwner();
  path = [];
  goal = null;
  $("[data-prompt]").hidden = true;
  $("[data-walk-hint]").hidden = on || walked;
  renderPanel();
  if (!on && draft) walker = { ...walker, ...freeNear(walker, draft.items), sitting: false };
}
$("[data-edit]").addEventListener("click", () => setEditing(true));
// Cancel loses work, so with changes it asks once, on the button itself
let cancelArmed = 0;
function disarmCancel() {
  clearTimeout(cancelArmed);
  cancelArmed = 0;
  $("[data-cancel]").textContent = "Cancel";
}
$("[data-cancel]").addEventListener("click", () => {
  if (dirty && !cancelArmed) {
    $("[data-cancel]").textContent = "Lose changes?";
    cancelArmed = setTimeout(disarmCancel, 3000);
    return;
  }
  disarmCancel();
  draft = structuredClone(room.layout);
  dirty = false;
  say("");
  renderOnShow();
  setEditing(false);
});
$("[data-done]").addEventListener("click", async () => {
  if (!dirty) return setEditing(false);
  const done = $("[data-done]");
  done.disabled = true;
  const r = await fetch("/room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: draft, was: room.rev }) }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  done.disabled = false;
  if (!r?.ok) {
    if (j?.error === "stale-room") {
      await load();
      return say(`${j.message}.`);
    }
    return say(j?.message ?? "That didn't save. Try again.");
  }
  room = { ...room, rev: j.rev, layout: structuredClone(draft) };
  dirty = false;
  setEditing(false);
  say("Saved.");
  setTimeout(() => $("[data-status]").textContent === "Saved." && say(""), 2500);
  loadRooms();
});
addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
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
  select(hit?.uid ?? null);
  if (!hit) return;
  const p = project(hit, ITEMS[hit.type].place);
  drag = { id: e.pointerId, dx: p.X - X, dy: p.Y - Y };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const [X, Y] = inView(e);
  if (!editing && draft) {
    const h = hitShown(draft.items, X, Y, artifactsNow()) ?? hitItem(draft.items, X, Y);
    canvas.style.cursor = h && (artifactsNow()[h.artifact ?? ""] || ITEMS[h.type].seat) ? "pointer" : "default";
  }
  if (!drag || e.pointerId !== drag.id) return;
  const i = selectedItem();
  if (!i) return;
  const [x, y] = unproject(X + drag.dx, Y + drag.dy, ITEMS[i.type].place);
  [i.x, i.y] = dropSpot(i, draft.items, ...snapSpot(x, y));
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
let walked = localStorage.getItem("room-walked") === "yes";
function hideWalkHint() {
  if (walked) return;
  walked = true;
  localStorage.setItem("room-walked", "yes");
}
function walkTo(to, item = null) {
  hideWalkHint();
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
  const shownHit = hitShown(draft.items, X, Y, artifactsNow());
  if (shownHit) return walkTo(shownHit, shownHit);
  const hit = hitItem(draft.items, X, Y);
  if (hit && ITEMS[hit.type].place === "floor" && (artifactsNow()[hit.artifact ?? ""] || ITEMS[hit.type].seat)) return walkTo(hit, hit);
  const [x, y] = unproject(X, Y, "floor");
  const b = iso(x, y);
  if (Math.hypot(b.X - X, b.Y - Y) < 0.02) walkTo({ x, y }); // on the floor, not a wall
});
const STEER = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1], w: [-1, -1], s: [1, 1], a: [-1, 1], d: [1, -1] };
canvas.addEventListener("keydown", (e) => {
  if (editing) return editKey(e);
  if (dialog.open) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (STEER[k]) {
    e.preventDefault();
    held.add(k);
    path = [];
    goal = null;
    standUp();
    hideWalkHint();
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
  const words = walker.sitting ? "Stand up" : a ? "Look closely" : near ? "Sit" : "";
  if (words !== p.textContent) p.textContent = words;
  p.hidden = !words || editing;
  $("[data-walk-hint]").hidden = walked || !p.hidden || editing;
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
      sendWalk(ms);
    }
    easeOthers(dt);
    if (!reduced.matches && near) stir += dt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRoom(g, w, h, dpr, draft, artifactsNow(), { t: reduced.matches ? 0 : ms / 1000, stir, selected, editing, walker: editing ? null : { ...walker, colour: myTag ? walkerColour(myTag) : undefined }, others: [...others.values()], near: near?.uid ?? null });
  }
  requestAnimationFrame(frame);
}

// ---- looking closely: larger, a light you carry, and a moment awake
const dialog = $("[data-closer]");
const up = $("[data-closeup]");
const cg = up.getContext("2d");
let look = null; // { item, zoom, light: [x, y], wakeUntil, t }
function closer(a) {
  look = { item: a, light: [0.38, 0.3], wakeUntil: 0, t: 0 };
  $("[data-closer-name]").textContent = itemName(a.kind, a.material);
  const when = a.at ? new Date(a.at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  $("[data-closer-tier]").textContent = [MATERIALS[a.material].rarity, when].filter(Boolean).join(" · ");
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
  const r = W * 0.27;
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
function wake() {
  look.wakeUntil = performance.now() + 2600;
  // with reduced motion a wake is one still step: the pose changes, not a run
  if (reduced.matches) look.t += 0.5;
}
$("[data-wake]").addEventListener("click", wake);
up.addEventListener("click", wake);
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
    me: myTag,
    myColour: myTag ? walkerColour(myTag) : null,
    others: [...others.values()].map((o) => ({ tag: o.tag, x: o.tx, y: o.ty, moving: o.moving, sitting: o.sitting, colour: o.colour })),
    prompt: $("[data-prompt]").hidden ? "" : $("[data-prompt]").textContent,
    rev: room?.rev ?? null,
    tag: room?.tag ?? null,
    wall: draft?.wall,
    wallTint: draft?.wallTint,
    selected,
    shelf: shelf.length,
    shown: draft?.items.filter((i) => i.artifact).length ?? 0,
    looking: dialog.open ? { t: look.t } : null,
    items: (draft?.items ?? []).map((i) => {
      const up = baseOf(i, draft.items);
      const b = bounds(i, up);
      const rest = restOn(i);
      return { uid: i.uid, type: i.type, x: i.x, y: i.y, rot: i.rot, colour: i.colour, up, artifact: i.artifact, ax: r.left + rest.X * r.width, ay: r.top + (rest.Y - 0.03) * r.height, cx: r.left + b.X * r.width, cy: r.top + ((b.top + b.bottom) / 2) * r.height };
    }),
  };
};

import { drawRoom, finishThumb, itemThumb } from "./room-draw.js";
load();
loadRooms();
requestAnimationFrame(frame);
