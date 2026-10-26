// The hall page (ADR 24, 25): the stream of robots' snapshots, the floor
// drawn from above, aiming by drag, touch or keys, and collecting. Where a
// robot is comes from the server's snapshot advanced on the shared clock by
// hall.js; the page only predicts your own launch until the server's answer
// arrives. What's carried and kept comes only from the server's stream.
import { ARTIFACT_R, HALL, HOMES, KINDS, PAD_R, ROBOT_R, STEP_MS, advance, launch, path } from "./hall.js";
import { KEY_AIM_START, KIND_NAMES, aimFromPull, aimWords, behind, cargoSlots, cargoWords, keyAim, launchOfKeyAim, placeIn, slotChoices, trust } from "./hall-ui.js";
import { drawKind, kindIcon } from "./hall-draw.js";
import { INITIAL_CONN, VISITOR_COLOURS, canPlay, connection, connectionMessage, retryDelay } from "./ui.js";

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
let correction = [0, 0]; // eased away when the server's snapshot differs from the prediction
const serverNow = () => Date.now() + offset;

// ---- the stream; a refused one is opened again, backing off (as on the stage)
let tries = 0;
function connect() {
  const es = new EventSource("/hall/events");
  es.addEventListener("open", () => setConn(connection(conn, "open")));
  es.addEventListener("hall", (e) => {
    tries = 0;
    const d = JSON.parse(e.data);
    offset = d.serverTime - Date.now();
    you = d.you;
    const before = myShown();
    robots = d.robots;
    const server = robots.find((r) => r.tag === you.tag);
    if (server) {
      seq = Math.max(seq, server.seq);
      const next = trust(mine, server);
      if (next === server && mine) {
        // the server's word on your launch: ease from where you saw it
        mine = null;
        const after = myShown();
        if (before && after) correction = [before[0] - after[0] + correction[0], before[1] - after[1] + correction[1]];
      }
    }
    artifacts = d.artifacts;
    const before2 = kept;
    kept = d.mine;
    setConn(connection(conn, "state"));
    renderPeople();
    renderCollecting(before2);
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
  const msg = connectionMessage(c);
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
    const r = await fetch("/hall/display", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slots }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message ?? "The display didn't change.");
    kept = { ...kept, display: j.display };
  } catch (e) {
    $("[data-display-error]").textContent = e.message || "The hall didn't answer. Try again.";
  }
  displayBusy = false;
  renderDisplay();
}

function renderPeople() {
  $("[data-you]").hidden = false;
  $("[data-you-name]").textContent = you.name;
  $("[data-you-dot]").style.setProperty("--c", colourOf(you.colour));
  const others = robots.filter((r) => r.tag !== you.tag).map((r) => r.name);
  $("[data-here]").textContent = others.length ? others.join(", ") : "just you";
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
  seq += 1;
  const sent = { dir: l.dir, power: l.power, seq };
  mine = { ...launch(from, sent, serverNow()), tag: you.tag };
  try {
    const r = await fetch("/hall/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The hall didn't take that launch.");
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
  for (const a of artifacts) drawKind(g, a.kind, px(a.pos[0]), px(a.pos[1]), px(ARTIFACT_R) * 1.15, reducedMotion.matches ? 0 : now / 1000);

  // the difference from a prediction eases out, or goes at once with reduced motion
  const keep = reducedMotion.matches ? 0 : 0.85;
  correction = [correction[0] * keep, correction[1] * keep];
  for (const r of robots) {
    const isMe = r.tag === you?.tag;
    const p = shownAt(snapOf(r), now);
    if (isMe) {
      p[0] += correction[0];
      p[1] += correction[1];
    }
    if (isMe && aim) drawAim(p);
    drawCargo(p, advance(snapOf(r), now).vel, r.carrying ?? [], now);
    drawRobot(p, colourOf(r.colour), r.name, isMe);
  }
  requestAnimationFrame(draw);
}
// delivery zones: every pad faint and dashed; yours solid in your colour
// (the panel says so in words; a label here would sit under the robot)
function drawZones() {
  const myHome = kept?.home;
  HOMES.forEach((h, i) => {
    const mine = i === myHome;
    g.beginPath();
    g.arc(px(h[0]), px(h[1]), px(PAD_R), 0, Math.PI * 2);
    g.fillStyle = mine ? `${colourOf(you?.colour)}66` : "rgba(185,169,143,.18)";
    g.fill();
    g.setLineDash(mine ? [] : [4, 4]);
    g.strokeStyle = mine ? colourOf(you?.colour) : "rgba(185,169,143,.6)";
    g.lineWidth = mine ? 4 : 1.5;
    g.stroke();
    g.setLineDash([]);
  });
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
  if (!nearMe(q)) return;
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
      return { tag: x.tag, pos: p, ...at(p), speed: Math.hypot(...advance(snapOf(x), now).vel) };
    }),
    aim,
    metre: r.width / HALL.w,
    artifacts: artifacts.map((a) => ({ ...a, ...at(a.pos) })),
    carrying: robots.find((x) => x.tag === you?.tag)?.carrying ?? [],
    kept,
    home: kept ? { pos: HOMES[kept.home], ...at(HOMES[kept.home]) } : null,
  };
};

connect();
requestAnimationFrame(draw);
