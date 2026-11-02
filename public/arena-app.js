// The arena page: the stream of robots' snapshots, the floor drawn from
// above, and aiming by drag, touch or keys. Where a robot is comes from the
// server's snapshot advanced on the shared clock by arena.js; the page only
// predicts your own launch until the server's answer arrives. What's carried
// and banked comes only from the server's stream.
import { ARENA, ARTIFACT_R, MAX_PLAYERS, ROBOT_R, STEP_MS, VAULT, VAULT_R, advance, launch, loadCap, path } from "./arena.js";
import { INITIAL_CONN, KEY_AIM_START, SLOT_COLOURS, aimFromPull, behind, canPlay, connection, connectionMessage, deliveryWords, dropWords, flying, guide, keyAim, launchOfKeyAim, placeWords, readiness, retryDelay, roomCalls, silent, trust } from "./arena-ui.js";
import { drawAura, drawItem } from "./arena-draw.js";

const $ = (sel) => document.querySelector(sel);
const canvas = $("[data-arena]");
const g = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let conn = INITIAL_CONN;
let offset = 0; // server clock minus ours, ms
let you = null;
let robots = []; // the server's snapshots, with tag, slot, carrying
let artifacts = []; // on the floor: { id, kind, pos, readyAt }
let mine = null; // your own predicted snapshot, until the server's catches up
let seq = 0;
let aim = null; // { dir, power } while aiming
let keyAiming = null; // { angle, power } while aiming by keys
let lastKeyAim = KEY_AIM_START; // keys start from the last shot, so Enter again repeats it
let pull = null; // { from, to } in metres, while dragging
// where each robot was drawn minus where its new snapshot puts it, eased
// away, so a robot never jumps when the server's word changes its path
const corrections = new Map();
let flashes = []; // contacts: where, and when (server ms)
let bursts = []; // deliveries: a burst at the vault
const thrown = new Map(); // artifact id to where it left a robot, while it settles
const serverNow = () => Date.now() + offset;
const myRobot = () => (you ? robots.find((r) => r.tag === you.tag) : null);
const myLoad = () => myRobot()?.carrying?.length ?? 0;

// ---- the stream; a refused one is opened again, backing off
let tries = 0;
let stream = null;
let lastHeard = Date.now();
function connect() {
  const es = (stream = new EventSource("/events"));
  lastHeard = Date.now();
  es.addEventListener("beat", () => {
    lastHeard = Date.now();
  });
  es.addEventListener("open", () => {
    lastHeard = Date.now();
    setConn(connection(conn, "open"));
    // a new stream: its first event is the whole arena; drop what we guessed
    mine = null;
    seq = 0;
    corrections.clear();
    cancelAim();
  });
  es.addEventListener("arena", (e) => {
    tries = 0;
    lastHeard = Date.now();
    const d = JSON.parse(e.data);
    offset = d.serverTime - Date.now();
    you = d.you;
    const now = serverNow();
    const before = new Map(robots.map((r) => [r.tag, shownAt(snapOf(r), now)]));
    robots = d.robots;
    const server = myRobot();
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
    for (const h of d.hits ?? []) {
      flashes.push(h);
      for (const s of h.scattered) thrown.set(s.id, s.from);
      const lost = h.scattered.filter((s) => s.by === you.tag).length;
      if (lost) toast("risk", dropWords(lost));
    }
    for (const b of d.deliveries ?? []) {
      bursts.push(b);
      if (b.tag === you.tag) toast("kept", deliveryWords(b.items));
    }
    artifacts = d.artifacts;
    setConn(connection(conn, "state"));
    renderHud(server?.carrying ?? [], d.mine);
    place = d.mine.place;
    showStatus();
  });
  es.addEventListener("error", () => {
    setConn(connection(conn, "error"));
    if (es.readyState !== EventSource.CLOSED) return;
    es.close();
    setTimeout(connect, retryDelay(tries++));
  });
}
// ---- what you hold, and the one thing to do next
let launched = localStorage.getItem("arena-launched") === "yes";
let held = { carrying: 0, total: 0, onShow: 0 };
function renderHud(carrying, m) {
  held = { carrying: carrying.length, total: m.total, onShow: m.onShow };
  const count = $("[data-banked]");
  count.textContent = m.total;
  count.toggleAttribute("data-none", !m.total);
  const link = $("[data-room-link]");
  link.toggleAttribute("data-calling", roomCalls(held));
  link.setAttribute("aria-label", `Your room, ${m.total} collected`);
  showCoach();
}
const nextThing = () => (myRobot() ? guide({ launched, ...held }) : null);
function showCoach() {
  const words = nextThing()?.words ?? "";
  const c = $("[data-coach]");
  if (c.textContent !== words) c.textContent = words;
}
let toastTimer = 0;
function toast(kind, words) {
  const t = $("[data-toast]");
  t.dataset.kind = kind;
  t.textContent = words;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// a network can vanish without the stream ever closing: silence counts as lost
setInterval(() => {
  if (!stream || stream.readyState === EventSource.CLOSED || !silent(lastHeard, Date.now())) return;
  stream.close();
  setConn(connection(conn, "error"));
  setTimeout(connect, retryDelay(tries++));
}, 1000);
let place = 0;
function showStatus() {
  const msg = connectionMessage(conn) || placeWords(place);
  const status = $("[data-status]");
  status.textContent = msg;
  status.hidden = !msg;
}
function setConn(c) {
  conn = c;
  showStatus();
  document.body.dataset.conn = canPlay(c) ? "live" : c.status;
  if (!canPlay(c)) cancelAim();
}

// ---- where robots are: snapshots on the shared clock, between steps smoothly
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
  const r = myRobot();
  return r ? advance(snapOf(r), serverNow()) : null;
}

// ---- launching: predicted here at once, decided by the server
async function post(sent) {
  const r = await fetch("/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) });
  return { r, j: await r.json().catch(() => ({})) };
}
async function fire(l) {
  const from = myNow();
  if (!from || !canPlay(conn)) return;
  seq = Math.max(seq, from.seq) + 1;
  const sent = { dir: l.dir, power: l.power, seq };
  const load = myLoad();
  mine = { ...launch(from, sent, serverNow(), load), tag: you.tag };
  if (!launched) {
    launched = true;
    localStorage.setItem("arena-launched", "yes");
    showCoach();
  }
  try {
    let { r, j } = await post(sent);
    if (r.status === 409 && j.error === "stale-launch") {
      // another tab launched since: catch up with the robot, and send it once more
      seq = j.robot.seq + 1;
      sent.seq = seq;
      mine = { ...launch(j.robot, sent, serverNow(), load), tag: you.tag };
      ({ r, j } = await post(sent));
    }
    if (!r.ok) mine = null;
  } catch {
    mine = null; // the server's snapshot stands
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
  view = { scale: w / ARENA.w, dpr };
}
const px = (m) => m * view.scale;
function toArena(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * ARENA.w, ((e.clientY - r.top) / r.height) * ARENA.h];
}

function draw() {
  resize();
  const now = serverNow();
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.fillStyle = "#211f33";
  g.fillRect(0, 0, px(ARENA.w), px(ARENA.h));
  g.strokeStyle = "#57527a";
  g.lineWidth = 4;
  g.strokeRect(2, 2, px(ARENA.w) - 4, px(ARENA.h) - 4);
  drawVault(now);
  drawBursts(now);
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
    const snap = advance(snapOf(r), now);
    const p = shownAt(snapOf(r), now);
    const c = corrections.get(r.tag);
    if (c) {
      p[0] += c[0];
      p[1] += c[1];
    }
    if (isMe && aim) drawAim(p, snap);
    if (r.away) g.globalAlpha = 0.3; // a ghost while its player reconnects
    if (!reducedMotion.matches) drawTrail(p, snap.vel, SLOT_COLOURS[r.slot]);
    drawCargo(p, snap.vel, r.carrying ?? [], now);
    drawRobot(p, r.slot, isMe);
    g.globalAlpha = 1;
  }
  drawGuide(now);
  requestAnimationFrame(draw);
}
// the next thing, marked on the arena itself: a hand pulling back, a ring on
// the nearest artifact, a line to the vault. Three words beside it at most.
function nearestArtifact(p, now) {
  return artifacts.filter((a) => readiness(a.readyAt ?? 0, now) >= 1).sort((a, b) => Math.hypot(a.pos[0] - p[0], a.pos[1] - p[1]) - Math.hypot(b.pos[0] - p[0], b.pos[1] - p[1]))[0];
}
function drawGuide(now) {
  const next = nextThing();
  const r = myRobot();
  if (!next || !r || aim) return;
  const p = shownAt(snapOf(r), now);
  const beat = reducedMotion.matches ? 0.7 : (now % 1600) / 1600;
  let at = p;
  if (next.mark === "pull") {
    // a press out in the open, pulled back towards your robot: what launches it the other way
    const to = behind([0, 0], p).map((v) => -v); // away from the middle
    const way = to.map((v) => -v); // towards the middle: the room to show it in
    const press = [p[0] + way[0] * 4.2, p[1] + way[1] * 4.2];
    const pulled = 2.4 * Math.min(1, beat * 1.4);
    const q = [press[0] + to[0] * pulled, press[1] + to[1] * pulled];
    at = press;
    g.beginPath();
    g.moveTo(px(press[0]), px(press[1]));
    g.lineTo(px(q[0]), px(q[1]));
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 3;
    g.stroke();
    g.beginPath();
    g.arc(px(q[0]), px(q[1]), 12, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,.9)";
    g.fill();
    // and where the robot would go
    for (let d = 1.2; d <= 1.2 + pulled * 2; d += 0.7) {
      g.beginPath();
      g.arc(px(p[0] + way[0] * d), px(p[1] + way[1] * d), 2.5, 0, Math.PI * 2);
      g.fill();
    }
  } else if (next.mark === "artifact") {
    const a = nearestArtifact(p, now);
    if (!a) return;
    at = a.pos;
    g.beginPath();
    g.arc(px(at[0]), px(at[1]), px(ARTIFACT_R) + 8 + 14 * beat, 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,255,255,${1 - beat * 0.8})`;
    g.lineWidth = 3;
    g.stroke();
  } else {
    at = VAULT;
    g.beginPath();
    g.moveTo(px(p[0]), px(p[1]));
    g.lineTo(px(at[0]), px(at[1]));
    g.setLineDash([8, 10]);
    g.lineDashOffset = reducedMotion.matches ? 0 : -now / 40;
    g.strokeStyle = "rgba(255,200,61,.8)";
    g.lineWidth = 3;
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
  }
  g.font = "700 14px system-ui, sans-serif";
  const w = g.measureText(next.words).width + 18;
  const x = Math.max(w / 2 + 6, Math.min(px(ARENA.w) - w / 2 - 6, px(at[0])));
  const y = next.mark === "pull" || px(at[1]) < 70 ? px(at[1]) + 44 : px(at[1]) - 44; // the pull's words sit clear of your robot
  g.fillStyle = "rgba(255,255,255,.95)";
  g.beginPath();
  g.roundRect(x - w / 2, y - 13, w, 26, 6);
  g.fill();
  g.fillStyle = "#14131f";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(next.words, x, y + 1);
}
function drawVault(now) {
  const x = px(VAULT[0]), y = px(VAULT[1]);
  const pulse = reducedMotion.matches ? 0 : Math.sin(now / 500) * 0.06;
  g.beginPath();
  g.arc(x, y, px(VAULT_R), 0, Math.PI * 2);
  const lit = held.carrying > 0;
  g.fillStyle = `rgba(255, 200, 61, ${(lit ? 0.32 : 0.14) + pulse})`;
  g.fill();
  g.strokeStyle = "#ffc83d";
  g.lineWidth = lit ? 5 : 3;
  g.setLineDash([10, 6]);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = "#ffc83d";
  g.font = "700 13px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("VAULT", x, y);
}
// a delivery: solid gold rings out of the vault, the opposite of a scatter
function drawBursts(now) {
  bursts = bursts.filter((b) => now - b.at < 900);
  for (const b of bursts) {
    const k = (now - b.at) / 900;
    for (const lag of [0, 0.22]) {
      const f = reducedMotion.matches ? 1 : Math.max(0, k - lag);
      g.beginPath();
      g.arc(px(VAULT[0]), px(VAULT[1]), px(VAULT_R) * (1 + f * 0.9), 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,215,102,${1 - k})`;
      g.lineWidth = 5;
      g.stroke();
    }
  }
}
function drawTrail(p, vel, colour) {
  const s = Math.hypot(vel[0], vel[1]);
  if (s < 2) return;
  g.beginPath();
  g.moveTo(px(p[0]), px(p[1]));
  g.lineTo(px(p[0] - vel[0] * 0.09), px(p[1] - vel[1] * 0.09));
  g.strokeStyle = `${colour}66`;
  g.lineWidth = px(ROBOT_R) * 1.5;
  g.lineCap = "round";
  g.stroke();
  g.lineCap = "butt";
}
// an artifact: faded with a ring filling while it can't be taken yet
function drawArtifact(a, now) {
  const ready = readiness(a.readyAt ?? 0, now);
  const from = thrown.get(a.id);
  if (ready >= 1) thrown.delete(a.id);
  const at = from && ready < 1 && !reducedMotion.matches ? flying(from, a.pos, ready) : a.pos;
  const x = px(at[0]), y = px(at[1]);
  const spin = reducedMotion.matches ? 0 : now / 1000;
  g.globalAlpha = ready < 1 ? 0.4 + 0.4 * ready : 1;
  const size = Math.max(15, px(ARTIFACT_R) * 1.15); // never too small to read on a phone
  drawAura(g, a.material, x, y, size, spin);
  drawItem(g, a, x, y, size, spin);
  g.globalAlpha = 1;
  if (ready >= 1) return;
  g.beginPath();
  g.arc(x, y, px(ARTIFACT_R) + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2.5;
  g.stroke();
}
// a contact: a ring opening out where it happened
function drawFlashes(now) {
  flashes = flashes.filter((f) => now - f.at < 700);
  for (const f of flashes) {
    const k = (now - f.at) / 700;
    g.beginPath();
    g.arc(px(f.pos[0]), px(f.pos[1]), px(ARTIFACT_R) + (reducedMotion.matches ? 10 : 30 * k), 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,107,74,${1 - k})`;
    g.lineWidth = 3;
    g.stroke();
    // each thing thrown, a line from the contact to where it's landing
    g.setLineDash([5, 5]);
    g.strokeStyle = `rgba(255,182,72,${0.8 * (1 - k)})`;
    g.lineWidth = 2;
    for (const s of f.scattered ?? []) {
      g.beginPath();
      g.moveTo(px(s.from[0]), px(s.from[1]));
      g.lineTo(px(s.to[0]), px(s.to[1]));
      g.stroke();
    }
    g.setLineDash([]);
  }
}
// cargo trails behind a robot: what it carries, then rings for the room left
function drawCargo(p, vel, carrying, now) {
  const b = behind(vel, p);
  const step = ROBOT_R * 1.25;
  const held = carrying.filter(Boolean);
  if (!held.length) return;
  // a tether: this is on the robot, not yet anyone's for good
  g.beginPath();
  g.moveTo(px(p[0]), px(p[1]));
  g.lineTo(px(p[0] + b[0] * (ROBOT_R + step * (held.length - 0.2))), px(p[1] + b[1] * (ROBOT_R + step * (held.length - 0.2))));
  g.strokeStyle = "rgba(255,182,72,.6)";
  g.lineWidth = 2;
  g.stroke();
  held.forEach((item, i) => {
    const d = ROBOT_R + step * (i + 0.8);
    const x = px(p[0] + b[0] * d), y = px(p[1] + b[1] * d);
    g.beginPath();
    g.arc(x, y, px(ARTIFACT_R) * 1.05, 0, Math.PI * 2);
    g.fillStyle = "#211f33";
    g.fill();
    g.setLineDash([4, 3]);
    g.strokeStyle = "#ffb648";
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);
    drawItem(g, item, x, y, px(ARTIFACT_R) * 0.8, reducedMotion.matches ? 0 : now / 1000);
  });
}
// a robot: its slot's colour and mark, so no one depends on colour alone
function drawRobot(p, slot, isMe) {
  const [x, y] = [px(p[0]), px(p[1])];
  g.beginPath();
  g.arc(x, y, px(ROBOT_R), 0, Math.PI * 2);
  g.fillStyle = SLOT_COLOURS[slot];
  g.fill();
  g.lineWidth = isMe ? 4 : 1.5;
  g.strokeStyle = isMe ? "#ffffff" : "rgba(0,0,0,.5)";
  g.stroke();
  g.fillStyle = "rgba(0,0,0,.65)";
  const m = px(ROBOT_R) * 0.42;
  g.beginPath();
  if (slot === 0) g.arc(x, y, m, 0, Math.PI * 2);
  else if (slot === 1) g.rect(x - m, y - m, m * 2, m * 2);
  else if (slot === 2) { g.moveTo(x, y - m * 1.2); g.lineTo(x + m * 1.1, y + m); g.lineTo(x - m * 1.1, y + m); g.closePath(); }
  else { g.moveTo(x, y - m * 1.3); g.lineTo(x + m * 1.3, y); g.lineTo(x, y + m * 1.3); g.lineTo(x - m * 1.3, y); g.closePath(); }
  g.fill();
}
function drawAim(p, snap) {
  // the band: from the robot, back the way you pulled
  if (pull) {
    g.beginPath();
    g.moveTo(px(p[0]), px(p[1]));
    g.lineTo(px(p[0] + pull.to[0] - pull.from[0]), px(p[1] + pull.to[1] - pull.from[1]));
    g.strokeStyle = "rgba(255,255,255,.45)";
    g.lineWidth = 3;
    g.stroke();
  }
  // the path it will take from here, at this speed and load
  const pts = path({ pos: p, vel: snap.vel, t: 0, seq: 0 }, { dir: aim.dir, power: aim.power, seq: 0 }, myLoad());
  pts.forEach((q, i) => {
    if (i % 2) return;
    g.beginPath();
    g.arc(px(q[0]), px(q[1]), 2.5, 0, Math.PI * 2);
    g.fillStyle = `rgba(255,255,255,${0.9 - (0.75 * i) / pts.length})`;
    g.fill();
  });
  // where it ends up, and how hard, in figures
  const end = pts[pts.length - 1];
  g.beginPath();
  g.arc(px(end[0]), px(end[1]), 7, 0, Math.PI * 2);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = "700 13px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const above = px(p[1]) > px(ROBOT_R) + 34; // near the top wall, it goes below instead
  g.fillText(`${Math.round(aim.power * 100)}%`, px(p[0]), px(p[1]) + (above ? -px(ROBOT_R) - 16 : px(ROBOT_R) + 26));
  // the strength: an arc round the robot, full circle at full power
  g.beginPath();
  g.arc(px(p[0]), px(p[1]), px(ROBOT_R) + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * aim.power);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 4;
  g.stroke();
}
function showAim() {
  if (aim) canvas.dataset.aiming = "";
  else delete canvas.dataset.aiming;
}
function cancelAim() {
  aim = null;
  pull = null;
  keyAiming = null;
  showAim();
}

// ---- mouse and touch: press anywhere, pull back, let go. The pull is
// measured from the press, because a moving robot can't be pressed reliably.
let dragging = null; // pointerId
const pad = $("[data-pad]");
function press(e) {
  if (!canPlay(conn) || dragging !== null || !myRobot()) return;
  e.preventDefault();
  canvas.dataset.pressed = ""; // no focus ring for a press, only for the keyboard
  canvas.focus({ preventScroll: true });
  e.currentTarget.setPointerCapture(e.pointerId);
  dragging = e.pointerId;
  keyAiming = null;
  const q = toArena(e);
  pull = { from: q, to: q };
  aim = null;
  showAim();
}
function pulling(e) {
  if (e.pointerId !== dragging) return;
  pull.to = toArena(e);
  aim = aimFromPull(pull.from, pull.to);
  showAim();
}
const letGo = (e) => {
  if (e.pointerId !== dragging) return;
  dragging = null;
  const l = e.type === "pointerup" ? aim : null;
  cancelAim();
  if (l) fire(l);
};
for (const el of [canvas, pad]) {
  el.addEventListener("pointerdown", press);
  el.addEventListener("pointermove", pulling);
  el.addEventListener("pointerup", letGo);
  el.addEventListener("pointercancel", letGo);
}

// ---- keys: the same aim, turned and strengthened step by step
canvas.addEventListener("keydown", (e) => {
  delete canvas.dataset.pressed;
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

// For the browser check: where things are, in the arena and on screen.
canvas.probe = () => {
  const r = canvas.getBoundingClientRect();
  const at = (p) => ({ x: r.left + (p[0] / ARENA.w) * r.width, y: r.top + (p[1] / ARENA.h) * r.height });
  const now = serverNow();
  return {
    you: you?.tag ?? null,
    place,
    robots: robots.map((x) => {
      const p = shownAt(snapOf(x), now);
      return { tag: x.tag, slot: x.slot, pos: p, ...at(p), speed: Math.hypot(...advance(snapOf(x), now).vel), away: !!x.away };
    }),
    aim,
    metre: r.width / ARENA.w,
    artifacts: artifacts.map((a) => ({ ...a, ...at(a.pos) })),
    carrying: myRobot()?.carrying ?? [],
    cap: loadCap(myLoad()),
    coach: $("[data-coach]").textContent,
    mark: nextThing()?.mark ?? null,
    held,
    players: MAX_PLAYERS,
  };
};

connect();
requestAnimationFrame(draw);
