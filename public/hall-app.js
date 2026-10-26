// The hall page (ADR 24): the stream of robots' snapshots, the floor drawn
// from above, and aiming by drag, touch or keys. Where a robot is comes
// from the server's snapshot advanced on the shared clock by hall.js; the
// page only predicts your own launch until the server's answer arrives.
import { HALL, ROBOT_R, STEP_MS, advance, launch, path } from "./hall.js";
import { KEY_AIM_START, aimFromPull, aimWords, keyAim, launchOfKeyAim, trust } from "./hall-ui.js";
import { INITIAL_CONN, VISITOR_COLOURS, canPlay, connection, connectionMessage, retryDelay } from "./ui.js";

const $ = (sel) => document.querySelector(sel);
const canvas = $("[data-hall]");
const g = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const colourOf = (c) => VISITOR_COLOURS[(c ?? 0) % VISITOR_COLOURS.length];

let conn = INITIAL_CONN;
let offset = 0; // server clock minus ours, ms
let you = null;
let robots = []; // the server's snapshots, with tag, name, colour
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
    setConn(connection(conn, "state"));
    renderPeople();
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
    drawRobot(p, colourOf(r.colour), r.name, isMe);
  }
  requestAnimationFrame(draw);
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
  };
};

connect();
requestAnimationFrame(draw);
