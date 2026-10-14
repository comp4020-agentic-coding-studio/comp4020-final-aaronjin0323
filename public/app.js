import {
  accepts,
  arrivals,
  canWave,
  describeTile,
  diffBoards,
  goal,
  goalParts,
  helpText,
  helpsWith,
  inspect,
  landmarkAt,
  preview,
  raisedText,
  tileAria,
} from "./diff.js";

// Everything the board does beyond plain HTML. Without this script the board
// sits at a fixed angle, every claim is a form post and a reload, and other
// people's claims show on the next load. With it: a camera you can turn,
// keyboard play, and a live board that updates in place.

const board = document.querySelector(".board");
const stage = document.querySelector("[data-stage]");

if (board && stage) {
  const KEY = "skyline-view";
  const TILT_MIN = 10;
  const TILT_MAX = 75;
  const phone = matchMedia("(max-width: 40rem)");
  const defaults = () => (phone.matches ? { tilt: 36, spin: 20 } : { tilt: 52, spin: 35 });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  let view = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && Number.isFinite(saved.tilt) && Number.isFinite(saved.spin)) view = saved;
  } catch {
    // no storage (private window, blocked): start from the default view
  }

  const apply = () => {
    board.style.setProperty("--tilt", `${view.tilt}deg`);
    board.style.setProperty("--spin", `${view.spin}deg`);
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(view));
    } catch {
      // the view just won't be remembered
    }
  };
  // The saved view is applied without the transition, so the board doesn't
  // swing round from the default angle on every page load.
  board.classList.add("is-instant");
  apply();
  requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove("is-instant")));

  // --- drag ---
  // A drag that moved is not a click: the click it ends with is swallowed, so
  // turning the board never claims the tile the pointer let go over.
  let start = null;
  let dragged = false;

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, tilt: view.tilt, spin: view.spin, id: e.pointerId };
    dragged = false;
  });

  stage.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < 6) return;
    if (!dragged) {
      dragged = true;
      board.classList.add("is-instant");
      stage.setPointerCapture(e.pointerId);
    }
    view.spin = start.spin - dx * 0.4;
    // On touch a vertical drag scrolls the page, so only mouse and pen tilt.
    if (e.pointerType !== "touch") view.tilt = clamp(start.tilt - dy * 0.3, TILT_MIN, TILT_MAX);
    apply();
  });

  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    board.classList.remove("is-instant");
    if (dragged) save();
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", (e) => {
    end(e);
    dragged = false;
  });

  stage.addEventListener(
    "click",
    (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      dragged = false;
    },
    true,
  );

  // --- buttons, for keyboard and anyone who'd rather not drag ---
  const step = (dTilt, dSpin) => () => {
    view.tilt = clamp(view.tilt + dTilt, TILT_MIN, TILT_MAX);
    view.spin += dSpin;
    apply();
    save();
  };
  const controls = [
    ["Turn left", step(0, 45)],
    ["Turn right", step(0, -45)],
    ["Tilt up", step(-10, 0)],
    ["Tilt down", step(10, 0)],
    [
      "Reset view",
      () => {
        view = defaults();
        apply();
        save();
      },
    ],
  ];

  const bar = document.createElement("div");
  bar.className = "camera";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Camera");
  for (const [text, action] of controls) {
    const b = document.createElement("button");
    b.type = "button"; // inside the claim form: never submit it
    b.textContent = text;
    b.addEventListener("click", action);
    bar.append(b);
  }
  const hint = document.createElement("span");
  hint.className = "camera-hint";
  hint.id = "board-keys";
  hint.textContent = "or drag the board.";
  const keysHint = document.createElement("span");
  keysHint.className = "keys-hint";
  keysHint.textContent = " Keys: WASD or arrows move, Enter claims, Q/E turn.";
  hint.append(keysHint);
  bar.append(hint);
  stage.before(bar);

  // --- keyboard: the board is one Tab stop ---
  // Tabbing through 144 tiles is unusable, so only one tile is in the tab
  // order (a roving tabindex): your own, or the centre. Arrows and WASD move
  // between tiles relative to the screen, so "up" means visually up however
  // the camera is turned.
  const tiles = [...board.querySelectorAll("button.tile")];
  const nameField = document.querySelector("#label");
  const N = Math.round(Math.sqrt(tiles.length));
  const BOARD_DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // north, east, south, west
  const SCREEN_DIRS = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 };

  let current = tiles.findIndex((t) => t.dataset.state === "mine");
  if (current < 0) current = Math.floor(N / 2) * N + Math.floor(N / 2);

  const moveTo = (i, focus) => {
    tiles[current].tabIndex = -1;
    current = i;
    tiles[current].tabIndex = 0;
    if (focus) tiles[current].focus({ preventScroll: true });
  };
  tiles.forEach((t, i) => {
    t.tabIndex = i === current ? 0 : -1;
    t.addEventListener("focus", () => moveTo(i, false));
  });
  board.setAttribute("aria-describedby", "status board-keys");

  // Keys work anywhere on the page, not only once a tile has focus: nobody
  // should have to discover that the board is a Tab stop. The one exception
  // is a text field, where W, A, S and D are letters.
  const typing = (el) =>
    el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();

    // Enter in the name field goes to the board instead of submitting the form
    // (which, with no tile chosen, would claim nothing useful).
    if (e.target === nameField && key === "enter") {
      e.preventDefault();
      moveTo(current, true);
      return;
    }
    if (typing(e.target)) return;

    const onBoard = tiles.includes(document.activeElement);
    if (key in SCREEN_DIRS) {
      e.preventDefault();
      // the first press from elsewhere on the page lands on the board and
      // shows where you are; after that, each press moves
      if (!onBoard) return moveTo(current, true);
      // the board's spin, rounded to the nearest quarter turn, says which
      // board direction currently faces each screen direction
      const quarter = ((Math.round(view.spin / 90) % 4) + 4) % 4;
      const [dr, dc] = BOARD_DIRS[(SCREEN_DIRS[key] - quarter + 4) % 4];
      const r = Math.floor(current / N) + dr;
      const c = (current % N) + dc;
      if (r >= 0 && r < N && c >= 0 && c < N) moveTo(r * N + c, true);
    } else if (key === "q" || key === "e") {
      (key === "q" ? controls[0][1] : controls[1][1])();
      e.preventDefault();
    }
  });

  // --- live board ---
  // The server sends the whole board as this visitor sees it, after every
  // change anywhere. Patching only what differs keeps focus, the camera and
  // any running transition where they are.
  const form = board.closest("form");
  const status = document.querySelector("#status");
  const claimedCount = document.querySelector("[data-claimed]");
  const notices = document.querySelector("[data-notices]");

  const patchTile = (el, t, view) => {
    if (el.dataset.state !== t.state) el.dataset.state = t.state;
    if (el.dataset.height !== String(t.height)) {
      el.dataset.height = String(t.height);
      el.style.setProperty("--h", String(t.height));
    }
    if (t.hue === null) el.style.removeProperty("--hue");
    else el.style.setProperty("--hue", String(t.hue));
    // A landmark ever raised on this cell: a crown on the roof, and the
    // tile's label names who raised it.
    const mark = landmarkAt(view, t.id);
    const aria = tileAria(t.aria, mark);
    if (el.getAttribute("aria-label") !== aria) el.setAttribute("aria-label", aria);
    if (mark) {
      el.dataset.landmark = mark.label;
      el.dataset.landmarkRaisers = JSON.stringify(mark.raisers);
      if (!el.querySelector(".crown")) {
        const crown = document.createElement("span");
        crown.className = "crown";
        crown.setAttribute("aria-hidden", "true");
        el.append(crown);
      }
    } else if (el.dataset.landmark !== undefined) {
      delete el.dataset.landmark;
      delete el.dataset.landmarkRaisers;
      el.querySelector(".crown")?.remove();
    }
    if (t.label === null) el.removeAttribute("title");
    else el.title = t.label;
    const initials = el.querySelector(".initials");
    if (initials && initials.textContent !== t.initials) initials.textContent = t.initials;
    if (t.safeUntil) el.dataset.safeUntil = t.safeUntil;
    else delete el.dataset.safeUntil;
  };

  // The board the page currently shows, read from the server-rendered HTML,
  // so the very first update has something to be compared with.
  const landmarkCount = document.querySelector("[data-landmarks]");
  const readLandmarks = () => {
    const cells = {};
    tiles.forEach((el, id) => {
      if (el.dataset.landmark === undefined) return;
      let raisers = [];
      try {
        raisers = JSON.parse(el.dataset.landmarkRaisers ?? "[]");
      } catch {
        // unreadable: the crown still shows, with no names
      }
      cells[String(id)] = { label: el.dataset.landmark, raisers };
    });
    return { count: Number(landmarkCount?.textContent) || Object.keys(cells).length, cells };
  };
  const readBoard = () => ({
    version: Number(board.dataset.version) || 0,
    landmarks: readLandmarks(),
    tiles: tiles.map((el, id) => ({
      id,
      state: el.dataset.state,
      height: Number(el.dataset.height),
      label: el.dataset.state === "free" ? null : el.title,
      hue: el.style.getPropertyValue("--hue") === "" ? null : Number(el.style.getPropertyValue("--hue")),
      safeUntil: el.dataset.safeUntil ?? null,
    })),
  });
  let shown = readBoard();

  // --- what a tile is, and what claiming it would do ---
  // One tile at a time is "looked at": the one under the mouse, else the one
  // with keyboard focus, else the one tapped on a phone. It gets the preview
  // (its height if you settled there, and whose tiles would rise or drop) and
  // the inspector. Only data-* attributes change: the board itself doesn't.
  const inspector = document.querySelector("[data-inspect]");
  const inspectTitle = inspector?.querySelector("[data-inspect-title]");
  const inspectFacts = inspector?.querySelector("[data-inspect-facts]");
  if (inspector && !inspector.id) inspector.id = "inspect";
  const announcer = document.querySelector("[data-announce]");
  let hovered = null;
  let looked = null; // tile id currently previewed and inspected
  // A held tile clicked with a mouse stays inspected after the pointer
  // leaves it, so the inspector's Wave button can be reached.
  let pinned = null;

  // The inspector's actions: a Wave button for a neighbour's tower, and the
  // answer to the last wave. Made here, so without script nothing offers a
  // wave (docs/adr/0004).
  const inspectActions = document.createElement("div");
  inspectActions.className = "inspect-actions";
  inspectActions.hidden = true;
  const waveButton = document.createElement("button");
  waveButton.type = "button"; // inside the claim form: never submit it
  waveButton.className = "wave-button";
  const waveSaid = document.createElement("p");
  waveSaid.className = "wave-said";
  inspectActions.append(waveButton, waveSaid);
  inspector?.append(inspectActions);
  let waveSaidFor = null; // which tile the answer is about

  const clearPreview = () => {
    for (const el of board.querySelectorAll("[data-preview]")) {
      delete el.dataset.preview;
      delete el.dataset.previewHeight;
    }
  };
  const showPreview = (id) => {
    clearPreview();
    const p = id === null ? null : preview(shown, id);
    if (!p) return;
    tiles[id].dataset.preview = "target";
    tiles[id].dataset.previewHeight = String(p.height);
    for (const n of p.lifted) tiles[n].dataset.preview = "lift";
    for (const n of p.dropped) tiles[n].dataset.preview = "drop";
  };
  const showInspect = (id) => {
    if (!inspector) return;
    const info = id === null ? null : inspect(shown, id, new Date());
    if (!info) {
      inspector.hidden = true;
      return;
    }
    if (inspectTitle) inspectTitle.textContent = info.title;
    if (inspectFacts) {
      inspectFacts.replaceChildren(
        ...info.facts.flatMap(([term, value]) => {
          const dt = document.createElement("dt");
          dt.textContent = term;
          const dd = document.createElement("dd");
          dd.textContent = value;
          return [dt, dd];
        }),
      );
    }
    // Wave: only at someone else's held tile beside mine.
    const target = canWave(shown, id);
    if (target) {
      waveButton.textContent = `Wave at ${target.label}`;
      waveButton.dataset.cell = String(id);
    }
    if (waveSaidFor !== id) {
      waveSaid.textContent = "";
      waveSaidFor = null;
    }
    inspectActions.hidden = !target;
    inspector.hidden = false;
  };
  // Keyboard focus only: a tile focused by a mouse click isn't "looked at"
  // once the pointer leaves it.
  const focusedTile = () => {
    const el = document.activeElement;
    return tiles.includes(el) && el.matches(":focus-visible") ? el : null;
  };
  // Re-picks the tile being looked at and redraws its preview and inspector:
  // after a hover, focus or selection change, and after every new board.
  const look = () => {
    // Focus inside the inspector (on its Wave button) keeps its tile in view.
    const kept = inspector?.contains(document.activeElement) && looked !== null ? tiles[looked] : null;
    const el = hovered ?? focusedTile() ?? kept ?? selected ?? pinned;
    looked = el ? Number(el.value) : null;
    showPreview(looked);
    showInspect(looked);
    // A screen reader hears the inspector as the focused tile's description.
    const focused = tiles.includes(document.activeElement) ? document.activeElement : null;
    for (const t of tiles) {
      if (inspector && t === focused && looked === Number(t.value) && !inspector.hidden) t.setAttribute("aria-describedby", inspector.id);
      else if (t.hasAttribute("aria-describedby")) t.removeAttribute("aria-describedby");
    }
  };

  board.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return; // a tap selects instead
    const tile = e.target instanceof Element ? e.target.closest("button.tile") : null;
    if (tile && tile !== hovered) {
      hovered = tile;
      look();
    }
  });
  board.addEventListener("pointerout", (e) => {
    if (!hovered || e.pointerType === "touch") return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest("button.tile") : null;
    if (to === hovered) return;
    hovered = to;
    look();
  });
  // A keyboard move takes over from a mouse resting on the board.
  board.addEventListener("focusin", () => {
    if (focusedTile()) hovered = null;
    look();
  });
  // Focus leaving the board: wait until it has landed, so moving between
  // tiles doesn't flash the inspector shut.
  board.addEventListener("focusout", () => setTimeout(look, 0));
  inspector?.addEventListener("focusout", () => setTimeout(look, 0));
  // A click anywhere but the board and the inspector lets go of a pinned tile.
  document.addEventListener("click", (e) => {
    if (!pinned || !(e.target instanceof Node) || board.contains(e.target) || inspector?.contains(e.target)) return;
    pinned = null;
    look();
  });

  // The protection countdown ticks while it's on screen.
  setInterval(() => {
    if (looked !== null && inspector && !inspector.hidden) showInspect(looked);
  }, 15_000);

  // Read out through the one polite live region, so a screen reader hears
  // each claim's result once. Cleared first, so the same words twice in a
  // row are still read.
  const announce = (text) => {
    if (!announcer) return;
    announcer.textContent = "";
    requestAnimationFrame(() => {
      announcer.textContent = text;
    });
  };

  // A tile someone else just claimed is marked for a moment, so a claim
  // across the board catches the eye without taking focus.
  const freshTimers = new Map();
  const markFresh = (id) => {
    clearTimeout(freshTimers.get(id));
    tiles[id].dataset.fresh = "";
    freshTimers.set(
      id,
      setTimeout(() => {
        delete tiles[id].dataset.fresh;
        freshTimers.delete(id);
      }, 2000),
    );
  };

  // A "+1" or "−1" that floats up off a tile whose height just changed. It
  // sits inside the tile, so it moves with the camera and the block.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const float = (id, delta) => {
    const el = document.createElement("span");
    el.className = "rise";
    el.dataset.delta = delta > 0 ? "up" : "down";
    el.setAttribute("aria-hidden", "true");
    el.textContent = delta > 0 ? `+${delta}` : `−${-delta}`;
    tiles[id].append(el);
    setTimeout(() => el.remove(), reducedMotion.matches ? 1500 : 1300);
  };

  // Every board, from the stream or from a claim's own response, comes
  // through here. A board no newer than the one shown is dropped, so the
  // same change arriving twice is shown, and narrated, once.
  // `streamVersion` is passed only for the first board on a reopened stream
  // (see accepts() in diff.js: it lets a restarted server's board through).
  const applyBoard = (view, { streamVersion = null } = {}) => {
    // A landmark just raised is celebrated even when this board is dropped as
    // no newer: my own claim's reply can bring the same board first, without
    // the news. Each cell is celebrated once.
    if (view.raised) celebrate(view.raised);
    if (!accepts(shown.version, view.version, streamVersion)) return;
    const { rises, messages } = diffBoards(shown, view);
    const fresh = arrivals(shown, view);
    shown = view;

    view.tiles.forEach((t, i) => tiles[i] && patchTile(tiles[i], t, view));
    showGoal(view);
    if (selected) select(selected); // re-read its state: someone may have taken it
    if (claimedCount) claimedCount.textContent = String(view.claimed);
    if (status) status.textContent = view.status;
    // The tile in the tab order follows yours when you get one.
    const mine = view.tiles.findIndex((t) => t.state === "mine");
    if (mine >= 0 && !tiles.includes(document.activeElement)) moveTo(mine, false);

    for (const { id, delta } of rises) float(id, delta);
    for (const id of fresh) markFresh(id);
    look(); // the preview and inspector follow the new board
    if (messages.length) {
      const text = messages.map((m) => m.text).join(" ");
      // My own claim is shown and read out when the server's reply confirms
      // it (see the submit handler), even if the stream brought it first.
      // (A claim from another tab of mine has no reply here: shown now.)
      if (messages[0].key === "claimed" && pending) claimText = text;
      else showNotice(messages[0].key, text);
    }
  };
  let claimText = null; // my last claim's narration, waiting for its reply

  // --- the room's goal (docs/adr/0004) ---
  // The status row says how many landmarks the room has raised and which
  // tower is closest to the next, and the tiles that would bring a tower
  // closer glow. All from the board, like the +1/-1: goal() in diff.js,
  // which the server also uses to render the same line before any script.
  const goalLine = document.querySelector("[data-goal]");
  const goalSlots = goalLine
    ? Object.fromEntries(["noun", "lead", "who", "tail"].map((k) => [k, goalLine.querySelector(`[data-goal-${k}]`)]))
    : {};
  const showGoal = (view) => {
    const g = goal(view);
    const parts = goalParts(g);
    if (landmarkCount && landmarkCount.textContent !== parts.count) landmarkCount.textContent = parts.count;
    for (const [k, el] of Object.entries(goalSlots)) if (el && el.textContent !== parts[k]) el.textContent = parts[k];
    const glow = new Set(g.helps);
    tiles.forEach((el, id) => {
      if (glow.has(id)) {
        if (el.dataset.helps === undefined) el.dataset.helps = "";
      } else if (el.dataset.helps !== undefined) delete el.dataset.helps;
    });
  };

  // --- a landmark raised: the one room-wide moment ---
  // A burst over the tower and the count bumping, on every open page, and one
  // line naming the nine, shown and read out once. Nothing modal and focus
  // stays put. Under reduced motion it's a static highlight instead.
  const celebrated = new Set();
  const cheer = document.createElement("p");
  cheer.className = "cheer";
  cheer.hidden = true;
  let cheerTimer = 0;
  let raisedNews = null; // a raising that landed while my claim was in flight
  const celebrate = (raised) => {
    const id = Number(raised.cellId);
    if (celebrated.has(id) || !tiles[id]) return;
    celebrated.add(id);
    const text = raisedText(raised);
    const tile = tiles[id];
    tile.dataset.raised = "";
    const burst = document.createElement("span");
    burst.className = "burst";
    burst.setAttribute("aria-hidden", "true");
    tile.append(burst);
    setTimeout(() => {
      burst.remove();
      delete tile.dataset.raised;
    }, 3000);
    if (landmarkCount) {
      landmarkCount.dataset.bump = "";
      setTimeout(() => delete landmarkCount.dataset.bump, 1200);
    }
    cheer.textContent = text;
    cheer.hidden = false;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => (cheer.hidden = true), 8000);
    // Read out once. My own claim's words wait for its reply, so the news
    // joins them there instead of being cut off by them.
    if (pending) raisedNews = text;
    else announce(text);
  };

  // A notice is shown, and read out once: through the page's one live region
  // when it has one, else as its own status element.
  const showNotice = (key, text, { speak = true } = {}) => {
    if (speak) announce(text);
    if (!notices) return;
    const p = document.createElement("p");
    p.className = "notice";
    p.dataset.notice = key;
    if (!announcer) p.setAttribute("role", "status");
    p.textContent = text;
    notices.replaceChildren(p);
  };

  // A notice that arrived in the URL (?notice=claimed after a no-JS-style
  // post) is shown once; drop it from the address so a reload doesn't repeat it.
  if (location.search.includes("notice=")) history.replaceState(null, "", location.pathname);

  // --- the connection ---
  // On a drop the browser reconnects by itself (the server sets retry), and
  // the first event after reconnecting is the full board, so nothing is
  // missed. The line says whether what's on screen is live.
  const conn = document.querySelector("[data-conn]");
  const CONN_TEXT = { live: "Live", reconnecting: "Reconnecting…", offline: "Offline: the board may be out of date" };
  const setConn = (state) => {
    if (!conn) return;
    if (conn.dataset.conn !== state) conn.dataset.conn = state;
    conn.textContent = CONN_TEXT[state];
  };
  if ("EventSource" in window) {
    const events = new EventSource("/events");
    let streamVersion = null; // the last version this stream delivered
    let reopened = false; // the next board is the first since a drop
    events.addEventListener("board", (e) => {
      const view = JSON.parse(e.data);
      applyBoard(view, { streamVersion: reopened ? streamVersion : null });
      streamVersion = view.version;
      reopened = false;
      setConn("live");
    });
    events.addEventListener("open", () => setConn("live"));
    events.addEventListener("wave", (e) => {
      try {
        onWave(JSON.parse(e.data));
      } catch {
        // a malformed wave shows nothing
      }
    });
    events.addEventListener("error", () => {
      reopened = true;
      // CONNECTING: the browser is retrying by itself. CLOSED: it gave up
      // (the server answered with an error), and only a reload helps.
      setConn(events.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    });
    addEventListener("offline", () => setConn("offline"));
    addEventListener("online", () => events.readyState !== EventSource.OPEN && setConn("reconnecting"));
  } else setConn("offline");

  // --- waving (docs/adr/0004) ---
  // POST /wave with a neighbour's cell. Each answer has its own short words,
  // shown where the wave was made and read out once.
  const WAVE_ERRORS = {
    "too-soon": () => "You can wave again in a moment.",
    "no-tile": () => "Hold a tile first, then wave at a neighbour.",
    "not-neighbour": (who) => `${who} isn't beside you any more.`,
    cell: () => "That tile doesn't exist.",
  };
  let waving = false;
  const sendWave = async (cell, who) => {
    if (waving) return null;
    waving = true;
    try {
      let res;
      try {
        res = await fetch("/wave", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ cellId: cell }),
        });
      } catch {
        return "Couldn't reach the server, so no wave was sent.";
      }
      if (res.ok) return `Waved at ${who}.`;
      if (res.status === 403) return "The server refused a wave from this page. Reload and try again.";
      const body = await res.json().catch(() => ({}));
      const words = Object.hasOwn(WAVE_ERRORS, body.error ?? "") ? WAVE_ERRORS[body.error] : null;
      return words ? words(who) : `That didn't work (error ${res.status}). Try again.`;
    } finally {
      waving = false;
    }
  };
  const waveFrom = async (button, where) => {
    const cell = Number(button.dataset.cell);
    const who = shown.tiles[cell]?.label ?? "them";
    const text = await sendWave(cell, who);
    if (!text) return;
    where(text);
    announce(text);
  };
  waveButton.addEventListener("click", () =>
    waveFrom(waveButton, (text) => {
      waveSaid.textContent = text;
      waveSaidFor = Number(waveButton.dataset.cell);
    }),
  );

  // Someone beside me waved: a small hand on their tower for about three
  // seconds, and a line above the board with a Wave back button. Nothing
  // modal; focus stays where it is.
  const waved = document.createElement("div");
  waved.className = "waved";
  waved.hidden = true;
  const wavedText = document.createElement("span");
  wavedText.className = "waved-text";
  const waveBack = document.createElement("button");
  waveBack.type = "button";
  waveBack.className = "wave-back";
  waveBack.textContent = "Wave back";
  waved.append(wavedText, waveBack);
  let wavedTimer = 0;
  const handTimers = new Map();
  const showHand = (id) => {
    const tile = tiles[id];
    clearTimeout(handTimers.get(id));
    if (!tile.querySelector(".hand")) {
      const hand = document.createElement("span");
      hand.className = "hand";
      hand.setAttribute("aria-hidden", "true");
      tile.append(hand);
    }
    tile.dataset.waving = "";
    handTimers.set(
      id,
      setTimeout(() => {
        tile.querySelector(".hand")?.remove();
        delete tile.dataset.waving;
        handTimers.delete(id);
      }, 3000),
    );
  };
  const onWave = (data) => {
    const id = Number(data.from);
    if (!Number.isInteger(id) || !tiles[id]) return;
    const who = typeof data.label === "string" && data.label ? data.label : "A neighbour";
    showHand(id);
    wavedText.textContent = `${who} waved at you.`;
    waveBack.dataset.cell = String(id);
    waveBack.hidden = false;
    waved.hidden = false;
    clearTimeout(wavedTimer);
    wavedTimer = setTimeout(() => (waved.hidden = true), 10_000);
    announce(`${who} waved at you.`);
  };
  waveBack.addEventListener("click", async () => {
    const cell = Number(waveBack.dataset.cell);
    const who = shown.tiles[cell]?.label ?? "them";
    const text = await sendWave(cell, who);
    if (!text) return;
    wavedText.textContent = text.startsWith("Waved at") ? `Waved back at ${who}.` : text;
    if (text.startsWith("Waved at")) waveBack.hidden = true;
    announce(wavedText.textContent);
    clearTimeout(wavedTimer);
    wavedTimer = setTimeout(() => (waved.hidden = true), 4000);
  });

  // The room-wide line and the wave line float at the top of the screen, so
  // they're seen wherever the page is scrolled, and the board never shifts
  // under a pointer because a message came in. In the page they follow the
  // board's HUD, so Tab reaches Wave back soon after the board.
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.append(cheer, waved);
  (document.querySelector(".hud") ?? board).after(toasts);

  // --- claiming in place ---
  // With script the form posts through fetch: no reload, so the camera and
  // focus stay put. The server answers with the board as you now see it.
  // While a claim is in flight its tile is marked pending and every other
  // claim is ignored, so a double click or a held Enter posts once. Nothing
  // says "claimed" until the server's reply does: the stream may show the
  // board first, but the words wait for the reply.
  const MESSAGES = {
    taken: "Someone got there first. Pick another tile.",
    label: "Names are 1 to 24 characters.",
    cell: "That tile doesn't exist.",
  };
  const STATUS_MESSAGES = {
    403: "The server refused a claim from this page. Reload and try again.",
    409: MESSAGES.taken,
    413: "That claim was too large to send.",
  };
  let pending = null; // the tile whose claim is in flight

  // --- phones: tap to select, then confirm ---
  // A tile on a phone is about 27px across, under a comfortable tap, so a
  // first tap only selects it and a full-width bar names it and claims it.
  // Mouse and keyboard keep claiming directly. Only the first tap is
  // intercepted; the bar's button is an ordinary submitter for the tile.
  const touch = matchMedia("(hover: none) and (pointer: coarse)");
  const confirmBar = document.createElement("div");
  confirmBar.className = "confirm";
  confirmBar.hidden = true;
  const confirmText = document.createElement("span");
  confirmText.className = "confirm-text";
  const confirmButton = document.createElement("button");
  confirmButton.type = "submit";
  confirmButton.name = "cellId";
  confirmButton.className = "confirm-claim";
  const confirmCancel = document.createElement("button");
  confirmCancel.type = "button";
  confirmCancel.className = "confirm-cancel";
  confirmCancel.textContent = "Cancel";
  // On a phone a neighbour's tower is waved at from the bar, under the thumb.
  const confirmWave = document.createElement("button");
  confirmWave.type = "button";
  confirmWave.className = "confirm-wave";
  confirmWave.hidden = true;
  confirmBar.append(confirmText, confirmButton, confirmWave, confirmCancel);
  form?.append(confirmBar);

  let selected = null;
  const select = (tile) => {
    if (selected !== tile) {
      selected?.classList.remove("is-selected");
      if (selected) delete selected.dataset.selected;
    }
    selected = tile;
    if (!tile) {
      confirmBar.hidden = true;
      look();
      return;
    }
    tile.classList.add("is-selected");
    tile.dataset.selected = "";
    // On a phone this bar is the only place to learn who holds a tile, and
    // whom you'd lift by settling there.
    const { title, action, open } = describeTile(shown, Number(tile.value));
    confirmText.textContent = title;
    confirmButton.textContent = action ?? "";
    confirmButton.value = tile.value;
    confirmButton.hidden = !open;
    const neighbour = canWave(shown, Number(tile.value));
    confirmWave.hidden = !neighbour;
    if (neighbour) {
      confirmWave.textContent = `Wave at ${neighbour.label}`;
      confirmWave.dataset.cell = tile.value;
    }
    confirmBar.hidden = false;
    look();
  };
  confirmCancel.addEventListener("click", () => select(null));
  confirmWave.addEventListener("click", () => waveFrom(confirmWave, (text) => (confirmText.textContent = text)));

  form?.addEventListener(
    "click",
    (e) => {
      const tile = e.target instanceof Element ? e.target.closest("button.tile") : null;
      if (tile && !touch.matches) {
        // A mouse click on someone's tower keeps it inspected (for its Wave
        // button); any other click lets go.
        pinned = tile.dataset.state === "held" ? tile : null;
        look();
      }
      if (!tile || !touch.matches || e.detail === 0) return; // detail 0: keyboard Enter
      e.preventDefault(); // the first tap selects; it never submits
      select(tile === selected ? null : tile);
    },
    true,
  );

  form?.addEventListener("submit", async (e) => {
    const submitter = e.submitter;
    const isClaim =
      submitter instanceof HTMLButtonElement &&
      (submitter.classList.contains("tile") || submitter === confirmButton);
    if (!isClaim) return;
    e.preventDefault();
    if (pending) return; // one claim at a time: a second click or Enter does nothing
    if (!nameField.value.trim()) {
      showNotice("label", "Type a name first, then pick a tile.");
      nameField.focus();
      return;
    }
    const id = Number(submitter.value);
    // Already held as shown: name the holder rather than post a claim that can
    // only lose, whose reply ("someone got there first") would read as a race.
    const target = describeTile(shown, id);
    if (!target.open) {
      showNotice("held", `${target.title}. Pick a free or faded tile.`);
      return;
    }
    pending = tiles[id];
    pending.dataset.pending = "";
    pending.setAttribute("aria-busy", "true");
    confirmButton.disabled = true;
    claimText = null;
    try {
      let res;
      try {
        res = await fetch("/claim", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ cellId: String(id), label: nameField.value }),
        });
      } catch {
        // Never reached the server, so nothing is claimed, whatever the board
        // shows. The stream will resync the board when it's back.
        showNotice("network", "Couldn't reach the server, so nothing was claimed. Check your connection and try again.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.board) {
        select(null);
        applyBoard(body.board); // a no-op if the stream already brought it
        // A rename on your own tile moves nobody, so the diff has no words.
        const where = `row ${Math.floor(id / N) + 1}, column ${(id % N) + 1}`;
        const said = claimText ?? `Saved: you hold ${where} as ${body.label ?? nameField.value.trim()}.`;
        showNotice("claimed", said, { speak: false });
        announce(raisedNews ? `${said} ${raisedNews}` : said);
      } else {
        const text = MESSAGES[body.error] ?? STATUS_MESSAGES[res.status] ?? `That didn't work (error ${res.status}). Try again.`;
        showNotice(body.error ?? `http-${res.status}`, text);
      }
    } finally {
      delete pending.dataset.pending;
      pending.removeAttribute("aria-busy");
      pending = null;
      claimText = null;
      raisedNews = null;
      confirmButton.disabled = false;
    }
  });
}
