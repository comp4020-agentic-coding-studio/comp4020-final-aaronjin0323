// The hall page (ADR 24, 25): the stream of robots' snapshots, the floor
// drawn from above, aiming by drag, touch or keys, and collecting. Where a
// robot is comes from the server's snapshot advanced on the shared clock by
// hall.js; the page only predicts your own launch until the server's answer
// arrives. What's carried and kept comes only from the server's stream.
import { ARTIFACT_R, HALL, HOMES, KINDS, PAD_R, ROBOT_R, STEP_MS, advance, launch, path } from "./hall.js";
import { hallConnectionMessage, welcomeWords } from "./hall-ui.js";
import { KEY_AIM_START, KIND_NAMES, aimFromPull, aimWords, behind, cargoSlots, cargoWords, keyAim, launchOfKeyAim, newsWords, placeIn, readiness, shield, slotChoices, trust } from "./hall-ui.js";
import { drawKind, kindIcon } from "./hall-draw.js";
import { INITIAL_CONN, VISITOR_COLOURS, canPlay, connection, retryDelay } from "./ui.js";

const $ = (sel) => document.querySelector(sel);
const canvas = $("[data-hall]");
const g = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const colourOf = (c) => VISITOR_COLOURS[(c ?? 0) % VISITOR_COLOURS.length];

let conn = INITIAL_CONN;
let offset = 0; // server clock minus ours, ms
let you = null;
let robots = []; // the server's snapshots, with tag, name, colour, home, carrying
let artifacts = []; // available on the floor: { id, kind, pos }
let kept = null; // your zone, collection and display, as the server last said
let mine = null; // your own predicted snapshot, until the server's catches up
let seq = 0;
let aim = null; // { dir, power } while aiming
let keyAiming = null; // { angle, power } while aiming by keys
let lastKeyAim = KEY_AIM_START; // keys start from the last shot, so Enter again repeats it
let pull = null; // the pointer, in hall metres, while dragging
// where each robot was drawn minus where its new snapshot puts it, eased
// away, so a robot never jumps when the server's word changes its path
const corrections = new Map();
let flashes = []; // knocks: where, and when (server ms)
let looking = null; // the tag of the player whose display is open
let newsUntil = 0;
const serverNow = () => Date.now() + offset;

// ---- the stream; a refused one is opened again, backing off (as on the stage)
let tries = 0;
function connect() {
  const es = new EventSource("/hall/events");
  es.addEventListener("open", () => {
    setConn(connection(conn, "open"));
    // a new stream: its first event is the whole hall; drop what we guessed
    mine = null;
    seq = 0;
    corrections.clear();
    cancelAim();
  });
  es.addEventListener("hall", (e) => {
    tries = 0;
    const d = JSON.parse(e.data);
    offset = d.serverTime - Date.now();
    you = d.you;
    const now = serverNow();
    const before = new Map(robots.map((r) => [r.tag, shownAt(snapOf(r), now)]));
    robots = d.robots;
    const server = robots.find((r) => r.tag === you.tag);
    if (server) {
      seq = Math.max(seq, server.seq);
      if (trust(mine, server) === server) mine = null; // the server's word on your launch
    }
    // every robot whose path changed eases from where it was drawn
    for (const r of robots) {
      const was = before.get(r.tag);
      if (!was) continue;
      const is = shownAt(snapOf(r), now);
      const c = corrections.get(r.tag) ?? [0, 0];
      corrections.set(r.tag, [c[0] + was[0] - is[0], c[1] + was[1] - is[1]]);
    }
    for (const n of d.news ?? []) {
      if (n.kind === "knock") flashes.push({ pos: n.pos, at: n.at }); // only a knock happens somewhere
      showNews(newsWords(n, you.tag, (tag) => robots.find((r) => r.tag === tag)?.name ?? "Someone"));
    }
    artifacts = d.artifacts;
    const before2 = kept;
    kept = d.mine;
    setConn(connection(conn, "state"));
    renderPeople();
    renderCollecting(before2);
    renderTheirs();
    if (d.mine.welcome) {
      const w = welcomeWords(d.mine.welcome);
      if (w) showNews(w);
    }
  });
  es.addEventListener("error", () => {
    setConn(connection(conn, "error"));
    if (es.readyState !== EventSource.CLOSED) return;
    es.close();
    setTimeout(connect, retryDelay(tries++));
  });
}
function setConn(c) {
  conn = c;
  const msg = hallConnectionMessage(c);
  const status = $("[data-status]");
  status.textContent = msg;
  status.hidden = !msg;
  document.body.dataset.conn = canPlay(c) ? "live" : c.status;
  if (!canPlay(c)) cancelAim();
}
// ---- what you carry and keep, only as the server says
const PLURALS = { fish: "luminous fish", cloud: "rain clouds", door: "doors onto stars" };
const plural = (n, kind) => `${n} ${n === 1 ? KIND_NAMES[kind] : PLURALS[kind]}`;
let displayBusy = false;
function renderCollecting(before) {
  $("[data-cards]").hidden = false;
  const me = robots.find((r) => r.tag === you.tag);
  $("[data-cargo]").textContent = cargoWords(me?.carrying ?? []);
  // only now, with the server's count, is a delivery yours
  if (before) {
    const more = KINDS.filter((k) => kept.collection[k] > before.collection[k]);
    const n = more.reduce((t, k) => t + kept.collection[k] - before.collection[k], 0);
    if (n) $("[data-kept]").textContent = `Kept: ${more.map((k) => plural(kept.collection[k] - before.collection[k], k)).join(", ")}. ${n === 1 ? "It's" : "They're"} yours.`;
  }
  $("[data-collection]").replaceChildren(
    ...KINDS.map((k) => {
      const li = document.createElement("li");
      if (!kept.collection[k]) li.dataset.none = "";
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(kept.collection[k]);
      li.append(kindIcon(k), KIND_NAMES[k][0].toUpperCase() + KIND_NAMES[k].slice(1), n);
      return li;
    }),
  );
  if (!displayBusy) renderDisplay();
}
function renderDisplay() {
  const choices = slotChoices(kept.collection);
  $("[data-display]").replaceChildren(
    ...kept.display.map((kind, slot) => {
      const li = document.createElement("li");
      if (kind) li.dataset.full = "";
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = kind ? `${KIND_NAMES[kind][0].toUpperCase() + KIND_NAMES[kind].slice(1)} ×${kept.collection[kind]}` : "Empty";
      const id = `slot-${slot + 1}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = `Place ${slot + 1}`;
      const sel = document.createElement("select");
      sel.id = id;
      sel.dataset.slot = String(slot);
      sel.disabled = !canPlay(conn) || choices.length === 1;
      for (const k of choices) {
        const o = document.createElement("option");
        o.value = k ?? "";
        o.textContent = k ? KIND_NAMES[k] : "Empty";
        o.selected = k === kind;
        sel.append(o);
      }
      sel.addEventListener("change", () => arrange(slot, sel.value || null));
      li.append(kind ? kindIcon(kind, 44) : document.createElement("span"), what, label, sel);
      return li;
    }),
  );
}
async function arrange(slot, kind) {
  const slots = placeIn(kept.display, slot, kind);
  displayBusy = true;
  for (const s of document.querySelectorAll("[data-display] select")) s.disabled = true;
  $("[data-display-error]").textContent = "";
  try {
    const r = await fetch("/hall/display", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slots, was: kept.display }) });
    const j = await r.json().catch(() => ({}));
    // changed somewhere else since this page saw it: show what it is now
    if (r.status === 409 && j.error === "stale-display") kept = { ...kept, display: j.display };
    if (!r.ok) throw new Error(j.message ?? "The display didn't change.");
    kept = { ...kept, display: j.display };
  } catch (e) {
    $("[data-display-error]").textContent = e.message || "The hall didn't answer. Try again.";
  }
  displayBusy = false;
  renderDisplay();
}

function showNews(text) {
  $("[data-news]").textContent = text;
  newsUntil = Date.now() + 6000;
}
setInterval(() => {
  if (newsUntil && Date.now() > newsUntil) {
    newsUntil = 0;
    $("[data-news]").textContent = "";
  }
}, 500);

// who's here: everyone else with the hall open, each with their display to look at
let hereKey = "";
function renderPeople() {
  $("[data-you]").hidden = false;
  $("[data-you-name]").textContent = you.name;
  $("[data-you-dot]").style.setProperty("--c", colourOf(you.colour));
  const others = robots.filter((r) => r.tag !== you.tag);
  const key = others.map((r) => `${r.tag}:${r.name}:${r.colour}`).join();
  if (key === hereKey) return;
  hereKey = key;
  const list = $("[data-here]");
  if (!others.length) return list.replaceChildren("just you");
  list.replaceChildren(
    ...others.map((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "who";
      b.dataset.look = r.tag;
      b.style.setProperty("--c", colourOf(r.colour));
      b.textContent = `${r.name}'s display`;
      b.addEventListener("click", () => look(r.tag));
      return b;
    }),
  );
}
function look(tag) {
  looking = tag;
  renderTheirs();
  $("[data-their]").scrollIntoView({ block: "nearest" });
  $("#their-h").focus();
}
$("[data-their-close]").addEventListener("click", () => {
  looking = null;
  renderTheirs();
});
// ---- the directory: everyone's display, present or not, a page at a time
let directory = [];
let directoryNext = null;
async function loadDirectory(more = false) {
  const q = more && directoryNext ? `?before=${encodeURIComponent(directoryNext)}` : "";
  const d = await fetch(`/hall/displays${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) return;
  directory = more ? [...directory, ...d.entries] : d.entries;
  directoryNext = d.next;
  renderDirectory();
}
function renderDirectory() {
  const list = $("[data-directory]");
  if (!directory.length) {
    list.replaceChildren(Object.assign(document.createElement("li"), { className: "none", textContent: "Nobody has arranged a display yet." }));
  } else {
    list.replaceChildren(
      ...directory.map((e) => {
        const li = document.createElement("li");
        const here = robots.some((r) => r.tag === e.tag);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "who";
        b.dataset.look = e.tag;
        b.style.setProperty("--c", colourOf(e.colour));
        b.textContent = e.tag === you?.tag ? "Your display" : `${e.name}'s display`;
        b.addEventListener("click", () => look(e.tag));
        const kinds = e.display.filter(Boolean).map((d) => `${KIND_NAMES[d.kind]} ×${d.count}`).join(", ");
        li.append(b, ` ${kinds}${here ? " · here now" : ""}`);
        return li;
      }),
    );
  }
  $("[data-directory-more]").hidden = !directoryNext;
}
$("[data-directory-more]").addEventListener("click", () => loadDirectory(true));
$("[data-directory-refresh]").addEventListener("click", () => loadDirectory(false));

// someone else's display: read-only, live, from their real deliveries
function renderTheirs() {
  const card = $("[data-their]");
  card.hidden = !looking;
  if (!looking) return;
  // someone here now (live), or someone from the directory (as listed)
  const r = robots.find((x) => x.tag === looking) ?? directory.find((x) => x.tag === looking);
  $("#their-h").textContent = r ? `${r.name}'s display` : "They've left the hall";
  $("[data-their-places]").replaceChildren(
    ...(r?.display ?? []).map((d, i) => {
      const li = document.createElement("li");
      if (d) li.dataset.full = "";
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = d ? `${KIND_NAMES[d.kind][0].toUpperCase() + KIND_NAMES[d.kind].slice(1)} ×${d.count}` : "Empty";
      const place = document.createElement("span");
      place.className = "place";
      place.textContent = `Place ${i + 1}`;
      li.append(d ? kindIcon(d.kind, 44) : document.createElement("span"), what, place);
      return li;
    }),
  );
}

// ---- where robots are: snapshots advanced on the shared clock, between steps smoothly
function snapOf(r) {
  return r.tag === you?.tag ? trust(mine, r) : r;
}
function shownAt(snap, now) {
  const a = advance(snap, now);
  const b = advance(a, a.t + STEP_MS);
  const f = Math.min(1, Math.max(0, (now - a.t) / STEP_MS));
  return [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f];
}
function myShown() {
  const r = you && robots.find((x) => x.tag === you.tag);
  return r ? shownAt(snapOf(r), serverNow()) : null;
}
/** Your robot's snapshot right now: what a launch starts from. */
function myNow() {
  const r = you && robots.find((x) => x.tag === you.tag);
  return r ? advance(snapOf(r), serverNow()) : null;
}

// ---- launching: predicted here at once, decided by the server
async function fire(l) {
  const from = myNow();
  if (!from || !canPlay(conn)) return;
  seq = Math.max(seq, from.seq) + 1;
  const sent = { dir: l.dir, power: l.power, seq };
  mine = { ...launch(from, sent, serverNow()), tag: you.tag };
  try {
    let r = await fetch("/hall/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
    let j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.error === "stale-launch") {
      // another tab launched since: catch up with the robot, and send it once more
      seq = j.robot.seq + 1;
      sent.seq = seq;
      mine = { ...launch(j.robot, sent, serverNow()), tag: you.tag };
      r = await fetch("/hall/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok) throw new Error(j.message ?? "The hall didn't take that launch.");
  } catch (e) {
    mine = null; // the server's snapshot stands
    $("[data-aim]").textContent = e.message || "The hall didn't answer. Try again.";
  }
}

// ---- drawing: metres to pixels, the floor, every robot, your aim
let view = { scale: 1, dpr: 1 };
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  view = { scale: w / HALL.w, dpr };
}
const px = (m) => m * view.scale;
function toHall(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * HALL.w, ((e.clientY - r.top) / r.height) * HALL.h];
}

function draw() {
  resize();
  const now = serverNow();
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.fillStyle = "#efe6d8";
  g.fillRect(0, 0, px(HALL.w), px(HALL.h));
  g.strokeStyle = "#b9a98f";
  g.lineWidth = 4;
  g.strokeRect(2, 2, px(HALL.w) - 4, px(HALL.h) - 4);
  drawZones();
  for (const a of artifacts) drawArtifact(a, now);
  drawFlashes(now);

  // corrections ease out, or go at once with reduced motion
  const keep = reducedMotion.matches ? 0 : 0.85;
  for (const [tag, c] of corrections) {
    if (!robots.some((r) => r.tag === tag) || Math.hypot(c[0], c[1]) < 1e-3) corrections.delete(tag);
    else corrections.set(tag, [c[0] * keep, c[1] * keep]);
  }
  for (const r of robots) {
    const isMe = r.tag === you?.tag;
    const p = shownAt(snapOf(r), now);
    const c = corrections.get(r.tag);
    if (c) {
      p[0] += c[0];
      p[1] += c[1];
    }
    if (isMe && aim) drawAim(p);
    if (r.away) g.globalAlpha = 0.35; // a ghost while its player reconnects, cargo and all
    drawCargo(p, advance(snapOf(r), now).vel, r.carrying ?? [], now);
    drawRobot(p, colourOf(r.colour), r.away ? `${r.name} (reconnecting)` : r.name, isMe);
    g.globalAlpha = 1;
    drawShield(p, shield(r.protectedUntil ?? 0, now));
  }
  requestAnimationFrame(draw);
}
// delivery zones: yours solid in your colour; another player's in theirs,
// closed to you; nobody's, faint and dashed (the panel says so in words)
function drawZones() {
  const myHome = kept?.home;
  HOMES.forEach((h, i) => {
    const mine = i === myHome;
    const owner = mine ? null : robots.find((r) => r.tag !== you?.tag && r.home === i);
    const c = mine ? colourOf(you?.colour) : owner ? colourOf(owner.colour) : null;
    g.beginPath();
    g.arc(px(h[0]), px(h[1]), px(PAD_R), 0, Math.PI * 2);
    g.fillStyle = mine ? `${c}66` : owner ? `${c}33` : "rgba(185,169,143,.18)";
    g.fill();
    g.setLineDash(mine ? [] : owner ? [8, 4] : [4, 4]);
    g.strokeStyle = c ?? "rgba(185,169,143,.6)";
    g.lineWidth = mine ? 4 : owner ? 3 : 1.5;
    g.stroke();
    g.setLineDash([]);
  });
}
// an artifact: faded with a ring filling while it can't be taken yet
function drawArtifact(a, now) {
  const x = px(a.pos[0]), y = px(a.pos[1]);
  const ready = readiness(a.readyAt ?? 0, now);
  g.globalAlpha = ready < 1 ? 0.4 + 0.4 * ready : 1;
  drawKind(g, a.kind, x, y, px(ARTIFACT_R) * 1.15, reducedMotion.matches ? 0 : now / 1000);
  g.globalAlpha = 1;
  if (ready >= 1) return;
  g.beginPath();
  g.arc(x, y, px(ARTIFACT_R) + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
  g.strokeStyle = "#26223d";
  g.lineWidth = 2.5;
  g.stroke();
}
// a knock: a ring opening out where it happened
function drawFlashes(now) {
  flashes = flashes.filter((f) => now - f.at < 700);
  for (const f of flashes) {
    const k = (now - f.at) / 700;
    g.beginPath();
    g.arc(px(f.pos[0]), px(f.pos[1]), px(ARTIFACT_R) + (reducedMotion.matches ? 10 : 30 * k), 0, Math.PI * 2);
    g.strokeStyle = `rgba(217,96,74,${1 - k})`;
    g.lineWidth = 3;
    g.stroke();
  }
}
// a shield round a robot that just dropped one: strong, then fading away
function drawShield(p, strength) {
  if (strength <= 0) return;
  g.beginPath();
  g.arc(px(p[0]), px(p[1]), px(ROBOT_R) + 14, 0, Math.PI * 2);
  g.setLineDash([6, 4]);
  g.strokeStyle = `rgba(79,134,198,${0.25 + 0.75 * strength})`;
  g.lineWidth = 3;
  g.stroke();
  g.setLineDash([]);
}
// cargo trails behind a robot: what it carries, then rings for the room left
function drawCargo(p, vel, carrying, now) {
  const b = behind(vel, p);
  const step = ROBOT_R * 1.25;
  cargoSlots(carrying).forEach((kind, i) => {
    const d = ROBOT_R + step * (i + 0.8);
    const x = px(p[0] + b[0] * d), y = px(p[1] + b[1] * d);
    g.beginPath();
    g.arc(x, y, px(ARTIFACT_R) * 1.05, 0, Math.PI * 2);
    g.fillStyle = kind ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.35)";
    g.fill();
    g.setLineDash(kind ? [] : [3, 3]);
    g.strokeStyle = "rgba(38,34,61,.55)";
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
    if (kind) drawKind(g, kind, x, y, px(ARTIFACT_R) * 0.85, reducedMotion.matches ? 0 : now / 1000);
  });
}
function drawRobot(p, colour, name, isMe) {
  const [x, y] = [px(p[0]), px(p[1])];
  g.beginPath();
  g.arc(x, y, px(ROBOT_R), 0, Math.PI * 2);
  g.fillStyle = colour;
  g.fill();
  g.lineWidth = isMe ? 3 : 1.5;
  g.strokeStyle = isMe ? "#ffffff" : "rgba(38,34,61,.5)";
  g.stroke();
  if (isMe) {
    g.beginPath();
    g.arc(x, y, px(ROBOT_R) + 4, 0, Math.PI * 2);
    g.strokeStyle = "#26223d";
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.font = "600 12px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillStyle = "#26223d";
  g.fillText(isMe ? "You" : name, x, y - px(ROBOT_R) - 18); // clear of the power arc
}
function drawAim(p) {
  // the pull: a band from the robot back to the pointer
  if (pull) {
    g.beginPath();
    g.moveTo(px(p[0]), px(p[1]));
    g.lineTo(px(pull[0]), px(pull[1]));
    g.strokeStyle = "rgba(38,34,61,.35)";
    g.lineWidth = 2;
    g.stroke();
  }
  // the path it will take, bounces included, fading to where it stops
  const pts = path({ pos: p, vel: [0, 0], t: 0, seq: 0 }, { dir: aim.dir, power: aim.power, seq: 0 });
  pts.forEach((q, i) => {
    if (i % 2) return;
    g.beginPath();
    g.arc(px(q[0]), px(q[1]), 2.5, 0, Math.PI * 2);
    g.fillStyle = `rgba(217,96,74,${0.95 - (0.75 * i) / pts.length})`;
    g.fill();
  });
  // the strength: an arc round the robot, full circle at full power
  g.beginPath();
  g.arc(px(p[0]), px(p[1]), px(ROBOT_R) + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * aim.power);
  g.strokeStyle = "#d9604a";
  g.lineWidth = 4;
  g.stroke();
}
function showAim() {
  $("[data-aim]").textContent = aim ? aimWords(aim) : "";
  if (aim) canvas.dataset.aiming = "";
  else delete canvas.dataset.aiming;
}
function cancelAim() {
  aim = null;
  pull = null;
  keyAiming = null;
  showAim();
}

// ---- mouse and touch: press near your robot, pull back, let go
let dragging = null; // pointerId
const nearMe = (q) => {
  const p = myShown();
  if (!p) return false;
  const reach = Math.max(ROBOT_R * 1.8, 26 / view.scale); // at least a fingertip
  return Math.hypot(q[0] - p[0], q[1] - p[1]) <= reach;
};
canvas.addEventListener("pointerdown", (e) => {
  if (!canPlay(conn) || dragging !== null) return;
  const q = toHall(e);
  if (!nearMe(q)) {
    // someone else's robot: look at their display
    const now = serverNow();
    const other = robots.find((r) => r.tag !== you?.tag && Math.hypot(q[0] - shownAt(snapOf(r), now)[0], q[1] - shownAt(snapOf(r), now)[1]) <= ROBOT_R * 1.4);
    if (other) look(other.tag);
    return;
  }
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  dragging = e.pointerId;
  keyAiming = null;
  pull = q;
  aim = aimFromPull(myShown(), q);
  showAim();
});
canvas.addEventListener("pointermove", (e) => {
  const q = toHall(e);
  if (dragging === null) {
    canvas.dataset.over = canPlay(conn) && nearMe(q) ? "robot" : "";
    return;
  }
  if (e.pointerId !== dragging) return;
  pull = q;
  aim = aimFromPull(myShown(), q);
  showAim();
});
const letGo = (e) => {
  if (e.pointerId !== dragging) return;
  dragging = null;
  const l = e.type === "pointerup" ? aim : null;
  cancelAim();
  if (l) fire(l);
};
canvas.addEventListener("pointerup", letGo);
canvas.addEventListener("pointercancel", letGo);

// ---- keys: the same aim, turned and strengthened step by step
canvas.addEventListener("keydown", (e) => {
  if (!canPlay(conn)) return;
  const k = keyAim(keyAiming ?? lastKeyAim, e.key);
  if (!k) return;
  e.preventDefault();
  if (k.act === "cancel") return cancelAim();
  if (k.act === "launch") {
    lastKeyAim = k.aim;
    const l = launchOfKeyAim(k.aim);
    cancelAim();
    return fire(l);
  }
  keyAiming = k.aim;
  pull = null;
  aim = launchOfKeyAim(keyAiming);
  showAim();
});
canvas.addEventListener("blur", () => {
  if (keyAiming) cancelAim();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dragging !== null) {
    dragging = null;
    cancelAim();
  }
});

// For the browser check: where things are, in the hall and on screen.
canvas.probe = () => {
  const r = canvas.getBoundingClientRect();
  const at = (p) => ({ x: r.left + (p[0] / HALL.w) * r.width, y: r.top + (p[1] / HALL.h) * r.height });
  const now = serverNow();
  return {
    you: you?.tag ?? null,
    robots: robots.map((x) => {
      const p = shownAt(snapOf(x), now);
      return { tag: x.tag, pos: p, ...at(p), speed: Math.hypot(...advance(snapOf(x), now).vel), away: !!x.away, home: x.home };
    }),
    aim,
    metre: r.width / HALL.w,
    artifacts: artifacts.map((a) => ({ ...a, ...at(a.pos) })),
    carrying: robots.find((x) => x.tag === you?.tag)?.carrying ?? [],
    shields: Object.fromEntries(robots.map((x) => [x.tag, shield(x.protectedUntil ?? 0, now)])),
    looking,
    kept,
    home: kept ? { pos: HOMES[kept.home], ...at(HOMES[kept.home]) } : null,
  };
};

connect();
loadDirectory();
requestAnimationFrame(draw);
