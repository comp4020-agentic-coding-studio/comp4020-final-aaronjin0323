import {
  accepts,
  arrivals,
  buildingName,
  canHelp,
  CLAIMED_TEXT,
  dashParts,
  describeTile,
  diffBoards,
  ECONOMY,
  EXPIRED_TEXT,
  eventText,
  expiredText,
  goal,
  goalParts,
  initialsOf,
  inspect,
  landmarkAt,
  leaseSoon,
  pendingNow,
  perMinute,
  place,
  preview,
  raisedText,
  statusText,
  tileAria,
  tileWords,
  timeLeft,
  upgrades,
  welcomeText,
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
  keysHint.textContent = " Keys: WASD or arrows move, Enter builds, Q/E turn.";
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
  // The server sends the whole city as this visitor sees it, after every
  // change anywhere. Patching only what differs keeps focus, the camera and
  // any running transition where they are.
  const form = board.closest("form");
  const status = document.querySelector("#status");
  const claimedCount = document.querySelector("[data-claimed]");
  const notices = document.querySelector("[data-notices]");

  const setData = (el, key, value) => {
    if (value === null || value === undefined) {
      if (el.dataset[key] !== undefined) delete el.dataset[key];
    } else if (el.dataset[key] !== String(value)) el.dataset[key] = String(value);
  };

  const patchTile = (el, t, view, now) => {
    if (el.dataset.state !== t.state) el.dataset.state = t.state;
    if (el.dataset.height !== String(t.height)) {
      el.dataset.height = String(t.height);
      el.style.setProperty("--h", String(t.height));
    }
    if (t.hue === null) el.style.removeProperty("--hue");
    else el.style.setProperty("--hue", String(t.hue));
    const free = t.state === "free";
    setData(el, "level", free ? null : t.level);
    setData(el, "neighbours", free ? null : t.neighbours);
    setData(el, "rate", free ? null : t.rate);
    setData(el, "leaseEndsAt", free ? null : t.leaseEndsAt);
    setData(el, "lease", leaseSoon(t, now) ? "soon" : null);
    // A landmark ever raised on this cell: a crown on the roof, and the
    // plot's label names who raised it.
    const mark = landmarkAt(view, t.id);
    const aria = tileAria(tileWords(t, now), mark);
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
    const words = t.initials ?? initialsOf(t.label);
    if (initials && initials.textContent !== words) initials.textContent = words;
  };

  // The city the page currently shows, read from the server-rendered HTML
  // (the tiles' data-* and the JSON block with your wallet and the log), so
  // the very first update has something to be compared with.
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
  const readPrivate = () => {
    try {
      return JSON.parse(document.querySelector("[data-board-data]")?.textContent ?? "{}");
    } catch {
      return {};
    }
  };
  const num = (v) => (v === undefined || v === "" ? null : Number(v));
  const readBoard = () => {
    const extra = readPrivate();
    return {
      version: Number(board.dataset.version) || 0,
      landmarks: readLandmarks(),
      me: extra.me ?? null,
      events: extra.events ?? [],
      tiles: tiles.map((el, id) => ({
        id,
        state: el.dataset.state,
        height: Number(el.dataset.height),
        label: el.dataset.state === "free" ? null : el.title,
        hue: el.style.getPropertyValue("--hue") === "" ? null : Number(el.style.getPropertyValue("--hue")),
        level: num(el.dataset.level),
        neighbours: num(el.dataset.neighbours) ?? 0,
        rate: num(el.dataset.rate) ?? 0,
        leaseEndsAt: el.dataset.leaseEndsAt ?? null,
      })),
    };
  };
  let shown = readBoard();
  // When `shown.me.pending` was true, for counting it up between boards.
  let pendingSince = new Date();

  // --- what a plot is, and what building on it would do ---
  // One plot at a time is "looked at": the one under the mouse, else the one
  // with keyboard focus, else the one tapped on a phone. It gets the preview
  // (its height and income if you built there, and whose income would rise)
  // and the inspector. Only data-* attributes change: the board doesn't.
  const inspector = document.querySelector("[data-inspect]");
  const inspectTitle = inspector?.querySelector("[data-inspect-title]");
  const inspectFacts = inspector?.querySelector("[data-inspect-facts]");
  if (inspector && !inspector.id) inspector.id = "inspect";
  const announcer = document.querySelector("[data-announce]");
  let hovered = null;
  let looked = null; // plot id currently previewed and inspected
  // A building clicked with a mouse stays inspected after the pointer
  // leaves it, so the inspector's Help button can be reached.
  let pinned = null;

  // The inspector's one action: Help, at a neighbour's building. Made here,
  // so without script it isn't offered (helping is a live gesture).
  const inspectActions = document.createElement("div");
  inspectActions.className = "inspect-actions";
  inspectActions.hidden = true;
  const helpButton = document.createElement("button");
  helpButton.type = "button"; // inside the form: never submit it
  helpButton.className = "help-button";
  const helpSaid = document.createElement("p");
  helpSaid.className = "help-said";
  inspectActions.append(helpButton, helpSaid);
  inspector?.append(inspectActions);
  let helpSaidFor = null; // which plot the answer is about

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
    const now = new Date();
    const info = id === null ? null : inspect(shown, id, now);
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
    // Help: only at someone else's building right beside mine.
    const target = canHelp(shown, id, now);
    if (target) {
      helpButton.textContent = target.ok ? `Help ${target.label} (+${ECONOMY.helpGift} to them, +${ECONOMY.helpReward} to you)` : `Help again in ${target.wait}`;
      helpButton.disabled = !target.ok || helping;
      helpButton.dataset.cell = String(id);
    }
    if (helpSaidFor !== id) {
      helpSaid.textContent = "";
      helpSaidFor = null;
    }
    inspectActions.hidden = !target;
    inspector.hidden = false;
  };
  // Keyboard focus only: a plot focused by a mouse click isn't "looked at"
  // once the pointer leaves it.
  const focusedTile = () => {
    const el = document.activeElement;
    return tiles.includes(el) && el.matches(":focus-visible") ? el : null;
  };
  // Re-picks the plot being looked at and redraws its preview and inspector:
  // after a hover, focus or selection change, and after every new board.
  const look = () => {
    const kept = inspector?.contains(document.activeElement) && looked !== null ? tiles[looked] : null;
    const el = hovered ?? focusedTile() ?? kept ?? selected ?? pinned;
    looked = el ? Number(el.value) : null;
    showPreview(looked);
    showInspect(looked);
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
  board.addEventListener("focusin", () => {
    if (focusedTile()) hovered = null;
    look();
  });
  board.addEventListener("focusout", () => setTimeout(look, 0));
  inspector?.addEventListener("focusout", () => setTimeout(look, 0));
  document.addEventListener("click", (e) => {
    if (!pinned || !(e.target instanceof Node) || board.contains(e.target) || inspector?.contains(e.target)) return;
    pinned = null;
    look();
  });

  // Read out through the one polite live region, so a screen reader hears
  // each result once. Cleared first, so the same words twice are still read.
  const announce = (text) => {
    if (!announcer) return;
    announcer.textContent = "";
    requestAnimationFrame(() => {
      announcer.textContent = text;
    });
  };

  // A plot someone else just built on is marked for a moment.
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

  // A building going up, or up a level, plays its construction once.
  const builtTimers = new Map();
  const markBuilt = (id) => {
    clearTimeout(builtTimers.get(id));
    delete tiles[id].dataset.built;
    void tiles[id].offsetWidth; // restart the animation if it's mid-way
    tiles[id].dataset.built = "";
    builtTimers.set(
      id,
      setTimeout(() => {
        delete tiles[id].dataset.built;
        builtTimers.delete(id);
      }, 800),
    );
  };

  // A "+1" or "−1" that floats up off a building whose height changed.
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

  // --- your city: the dashboard ---
  // Every slot is a data-dash-* element the server already filled; this
  // keeps them current, and counts uncollected income up every second from
  // the last board's `pending` and `rate` (display only: the server's
  // number replaces it on every board).
  const dash = document.querySelector("[data-dash]");
  const slot = (key) => dash?.querySelector(`[data-dash-${key}]`) ?? null;
  const slots = Object.fromEntries(["coins", "building", "rate", "neighbours", "pending", "lease", "move"].map((k) => [k, slot(k)]));
  const actButtons = Object.fromEntries(
    ["collect", "upgrade", "renew", "relocate"].map((k) => [k, dash?.querySelector(`[data-act="${k}"]`) ?? null]),
  );
  const whys = Object.fromEntries(["collect", "upgrade", "renew", "relocate"].map((k) => [k, dash?.querySelector(`[data-why="${k}"]`) ?? null]));
  const renewBox = dash?.querySelector("[data-renew]") ?? null;
  const renewButtons = [...(renewBox?.querySelectorAll("[data-renew-hours]") ?? [])];
  let busy = null; // the action in flight: one at a time
  let relocating = false;

  const setText = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  const showDash = () => {
    if (!dash) return;
    const now = new Date();
    const pending = pendingNow(shown.me, pendingSince, now);
    const d = dashParts(shown, now, pending, { busy });
    for (const k of ["coins", "building", "rate", "neighbours", "pending", "lease", "move"]) setText(slots[k], d[k]);
    setData(dash, "land", shown.tiles.some((t) => t.state === "mine") ? "" : null);
    const leaseFact = slots.lease?.closest(".fact");
    if (leaseFact) setData(leaseFact, "lease", d.leaseSoon ? "soon" : null);
    for (const k of ["collect", "upgrade", "renew", "relocate"]) {
      const b = actButtons[k];
      if (!b) continue;
      const a = d[k];
      // An open toggle stays usable, so it can be closed again.
      const open = (k === "relocate" && relocating) || (k === "renew" && b.getAttribute("aria-expanded") === "true");
      const disabled = !a.ok && !open;
      if (b.disabled !== disabled) b.disabled = disabled;
      setText(b.querySelector(".act-sub"), open && k === "relocate" ? "cancel" : a.sub);
      setText(whys[k], k === "relocate" && relocating ? "Pick a free plot on the map, or press Relocate again to cancel." : a.why);
    }
    d.renewOptions.forEach((o) => {
      const b = renewButtons.find((x) => x.dataset.renewHours === String(o.hours));
      if (!b) return;
      const disabled = !o.ok || busy !== null;
      if (b.disabled !== disabled) b.disabled = disabled;
      setText(b, o.label);
      setText(renewBox.querySelector(`[data-renew-why="${o.hours}"]`), o.why);
    });
    // Without land there's nothing to relocate: leave relocation mode.
    if (relocating && !shown.tiles.some((t) => t.state === "mine")) setRelocating(false);
  };
  setInterval(showDash, 1000);

  // On a phone one reason shows at a time: for the action last touched.
  const showWhy = (k) => {
    for (const [key, el] of Object.entries(whys)) if (el) setData(el, "active", key === k ? "" : null);
  };
  for (const [k, b] of Object.entries(actButtons)) {
    b?.addEventListener("focus", () => showWhy(k));
    b?.addEventListener("pointerenter", () => showWhy(k));
    // A disabled button takes no focus or click: its wrapper area still
    // picks up the touch, so a tap on it explains it.
    b?.parentElement?.addEventListener("pointerdown", (e) => {
      if (e.target instanceof Element && e.target.closest(`[data-act="${k}"]`)) showWhy(k);
    });
  }

  // Renew folds its three options behind the button.
  if (renewBox && actButtons.renew) {
    renewBox.hidden = true;
    actButtons.renew.addEventListener("click", () => {
      const open = actButtons.renew.getAttribute("aria-expanded") !== "true";
      actButtons.renew.setAttribute("aria-expanded", String(open));
      renewBox.hidden = !open;
      showDash();
      if (open) renewButtons.find((b) => !b.disabled)?.focus({ preventScroll: true });
    });
  }

  // Relocate: pick a free plot on the map, see what the move does, confirm.
  const setRelocating = (on) => {
    relocating = on;
    actButtons.relocate?.setAttribute("aria-pressed", String(on));
    if (on) board.dataset.relocating = "";
    else delete board.dataset.relocating;
    if (!on && selected && confirmMode === "move") select(null);
    showDash();
  };
  actButtons.relocate?.addEventListener("click", () => {
    setRelocating(!relocating);
    if (relocating) {
      showNotice("relocate", "Pick a free plot on the map to see what moving there does.", { speak: true });
      moveTo(current, true);
    }
  });

  // --- every board comes through here ---
  // From the stream or from an action's own response. A board no newer than
  // the one shown is dropped, so the same change arriving twice is shown,
  // and narrated, once. `streamVersion` is passed only for the first board
  // on a reopened stream (accepts() in diff.js lets a restarted server in).
  const once = new Set(); // the welcome and expired notices, said once each
  const applyBoard = (view, { streamVersion = null } = {}) => {
    if (view.raised) celebrate(view.raised);
    if (!accepts(shown.version, view.version, streamVersion)) return;
    const { rises, messages } = diffBoards(shown, view);
    const fresh = arrivals(shown, view);
    const built = upgrades(shown, view);
    const prevMe = shown.me;
    const prevMine = shown.tiles.findIndex((t) => t.state === "mine");
    shown = view;
    pendingSince = new Date();
    const now = new Date();

    view.tiles.forEach((t, i) => tiles[i] && patchTile(tiles[i], t, view, now));
    showGoal(view);
    showEvents(view);
    showDash();
    if (prevMe && view.me && view.me.coins > prevMe.coins && slots.coins) {
      slots.coins.dataset.bump = "";
      setTimeout(() => delete slots.coins.dataset.bump, 1000);
    }
    if (selected) select(selected); // re-read its state: someone may have taken it
    if (claimedCount) claimedCount.textContent = String(view.claimed);
    if (status) status.textContent = statusText(view);
    const mine = view.tiles.findIndex((t) => t.state === "mine");
    if (mine >= 0 && !tiles.includes(document.activeElement)) moveTo(mine, false);

    for (const { id, delta } of rises) float(id, delta);
    for (const id of fresh) {
      markFresh(id);
      markBuilt(id);
    }
    for (const id of built) markBuilt(id);
    if (mine >= 0 && mine !== prevMine) markBuilt(mine); // my claim, or my move
    look();
    sayOnce(view.me);
    if (messages.length) {
      const text = messages.map((m) => m.text).join(" ");
      // My own claim or move is shown when the server's reply confirms it
      // (see the action handler), even if the stream brought it first; my
      // own lease ending is said by the server's `expired`, once.
      if (messages[0].key === "claimed" && busy === "claim") actionText = text;
      else if (messages[0].key === "expired") sayExpired();
      else showNotice(messages[0].key, text);
    }
  };
  let actionText = null; // my last claim's narration, waiting for its reply

  // The welcome and the expired lease: each said once per page, whether the
  // server rendered it or the stream brought it.
  const sayExpired = () => {
    if (once.has("expired")) return;
    once.add("expired");
    showNotice("expired", EXPIRED_TEXT, { append: true });
  };
  const sayOnce = (me) => {
    const w = welcomeText(me);
    if (w && !once.has("welcome")) {
      once.add("welcome");
      showNotice("welcome", w, { append: true });
    }
    if (expiredText(me)) sayExpired();
  };
  // Already on the page from the server: don't say them again.
  if (notices?.querySelector('[data-notice="welcome"]')) once.add("welcome");
  if (notices?.querySelector('[data-notice="expired"]')) once.add("expired");

  // --- the city log ---
  const eventsList = document.querySelector("[data-events]");
  const showEvents = (view) => {
    if (!eventsList || !Array.isArray(view.events)) return;
    const lines = view.events.map(eventText);
    const now = [...eventsList.children].map((li) => li.textContent);
    if (lines.join("\n") === now.join("\n")) return;
    eventsList.replaceChildren(
      ...lines.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
  };

  // --- the room's goal (docs/adr/0004) ---
  const goalLine = document.querySelector("[data-goal]");
  const goalSlots = goalLine
    ? Object.fromEntries(["noun", "lead", "who", "tail", "unit"].map((k) => [k, goalLine.querySelector(`[data-goal-${k}]`)]))
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
    if (busy) raisedNews = text;
    else announce(text);
  };
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.append(cheer);
  (document.querySelector(".hud") ?? board).after(toasts);

  // A notice is shown, and read out once. `append` keeps the notices already
  // there (a welcome beside a claim's result); otherwise it replaces them.
  const showNotice = (key, text, { speak = true, append = false } = {}) => {
    if (speak) announce(text);
    if (!notices) return;
    const p = document.createElement("p");
    p.className = "notice";
    p.dataset.notice = key;
    if (!announcer) p.setAttribute("role", "status");
    p.textContent = text;
    if (append) {
      notices.querySelector(`[data-notice="${key}"]`)?.remove();
      notices.append(p);
    } else notices.replaceChildren(p);
  };

  // A notice that arrived in the URL (?notice=collected after a no-JS post)
  // is shown once; drop it from the address so a reload doesn't repeat it.
  if (location.search.includes("notice=")) history.replaceState(null, "", location.pathname);

  // --- the connection ---
  const conn = document.querySelector("[data-conn]");
  const CONN_TEXT = { live: "Live", reconnecting: "Reconnecting…", offline: "Offline: the map may be out of date" };
  const setConn = (state) => {
    if (!conn) return;
    if (conn.dataset.conn !== state) conn.dataset.conn = state;
    conn.textContent = CONN_TEXT[state];
  };
  if ("EventSource" in window) {
    const events = new EventSource("/events");
    let streamVersion = null;
    let reopened = false;
    events.addEventListener("board", (e) => {
      const view = JSON.parse(e.data);
      applyBoard(view, { streamVersion: reopened ? streamVersion : null });
      streamVersion = view.version;
      reopened = false;
      setConn("live");
    });
    events.addEventListener("open", () => setConn("live"));
    events.addEventListener("error", () => {
      reopened = true;
      setConn(events.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    });
    addEventListener("offline", () => setConn("offline"));
    addEventListener("online", () => events.readyState !== EventSource.OPEN && setConn("reconnecting"));
  } else setConn("offline");

  // --- actions: one POST each, one at a time ---
  // Every refusal has its own plain words; the server's key picks them.
  const ERRORS = {
    taken: "Someone got there first. Pick another plot.",
    coins: "You don't have enough coins for that.",
    cooldown: "Not yet: that's still cooling down.",
    "max-level": "Your building is already a Skyscraper, the top level.",
    "max-lease": "That would take your lease past 48 hours from when you claimed.",
    "not-neighbour": "You can only help a building right next to yours.",
    "no-land": "You have no land. Pick a free plot first.",
    hours: "Pick a renewal of 6, 12 or 24 hours.",
    label: "Names are 1 to 24 characters.",
    cell: "That plot doesn't exist.",
  };
  const STATUS_ERRORS = {
    403: "The server refused that from this page. Reload and try again.",
    409: ERRORS.taken,
    402: ERRORS.coins,
    429: ERRORS.cooldown,
    413: "That was too large to send.",
  };
  const DONE = {
    collected: (body) => `Collected ${body.paid ?? ""} coins.`.replace("  ", " "),
    "nothing-to-collect": () => "Nothing to collect yet.",
    upgraded: (body, view) => `Upgraded to a ${buildingName(body.level ?? view.me?.level ?? 1)}! Your income is now ${perMinute(view.me?.rate ?? 0)} coins/min.`,
    renewed: (body, view) => `Lease renewed: ${timeLeft(body.leaseEndsAt ?? view.me?.leaseEndsAt, new Date()) ?? "extended"} left.`,
    helped: () => `You helped your neighbour: +${ECONOMY.helpGift} coins to them, +${ECONOMY.helpReward} to you.`,
  };

  // POST one action as JSON; resolves to { ok, body, status } or a network
  // failure. While it runs every other action is ignored.
  const post = async (route, data) => {
    let res;
    try {
      res = await fetch(route, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(data),
      });
    } catch {
      return { network: true };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  };
  const refusal = (r) =>
    r.network
      ? "Couldn't reach the server, so nothing changed. Check your connection and try again."
      : (Object.hasOwn(ERRORS, r.body?.error ?? "") ? ERRORS[r.body.error] : null) ?? STATUS_ERRORS[r.status] ?? `That didn't work (error ${r.status}). Try again.`;

  const runAction = async (name, route, data = {}) => {
    if (busy) return;
    busy = name;
    showDash();
    try {
      const r = await post(route, data);
      if (r.ok && r.body.board) {
        applyBoard(r.body.board);
        const words = DONE[r.body.notice]?.(r.body, r.body.board) ?? "Done.";
        showNotice(r.body.notice ?? name, words);
        if (name === "renew") {
          actionsClose();
        }
      } else showNotice(r.body?.error ?? (r.network ? "network" : `http-${r.status}`), refusal(r));
    } finally {
      busy = null;
      showDash();
    }
  };
  const actionsClose = () => {
    if (!renewBox || !actButtons.renew) return;
    actButtons.renew.setAttribute("aria-expanded", "false");
    renewBox.hidden = true;
  };

  // --- phones: tap to select, then confirm; relocation always confirms ---
  // A plot on a phone is about 27px across, under a comfortable tap, so a
  // first tap only selects it and a full-width bar names it and claims it.
  // Mouse and keyboard claim directly. A move costs coins, so it is always
  // confirmed in the bar, on any device.
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
  // On a phone a neighbour's building is helped from the bar, under the thumb.
  const confirmHelp = document.createElement("button");
  confirmHelp.type = "button";
  confirmHelp.className = "confirm-help";
  confirmHelp.hidden = true;
  confirmBar.append(confirmText, confirmButton, confirmHelp, confirmCancel);
  form?.append(confirmBar);

  let selected = null;
  let confirmMode = null; // "claim" | "move" | "held" | "mine"
  const select = (tile) => {
    if (selected !== tile) {
      selected?.classList.remove("is-selected");
      if (selected) delete selected.dataset.selected;
    }
    selected = tile;
    if (!tile) {
      confirmBar.hidden = true;
      confirmMode = null;
      look();
      return;
    }
    tile.classList.add("is-selected");
    tile.dataset.selected = "";
    const now = new Date();
    const id = Number(tile.value);
    const d = describeTile(shown, id, now);
    confirmMode = d.kind;
    confirmText.textContent = d.title;
    confirmButton.textContent = d.action ?? "";
    confirmButton.value = tile.value;
    confirmButton.hidden = !d.action;
    confirmButton.disabled = !d.open || busy !== null;
    confirmButton.classList.toggle("confirm-move", d.kind === "move");
    const neighbour = canHelp(shown, id, now);
    confirmHelp.hidden = !neighbour || !touch.matches;
    if (neighbour) {
      confirmHelp.textContent = neighbour.ok ? `Help ${neighbour.label}` : `Help in ${neighbour.wait}`;
      confirmHelp.disabled = !neighbour.ok || helping;
      confirmHelp.dataset.cell = tile.value;
    }
    confirmBar.hidden = false;
    look();
  };
  confirmCancel.addEventListener("click", () => {
    select(null);
    if (relocating) setRelocating(false);
  });

  // --- helping a neighbour ---
  let helping = false;
  const sendHelp = async (cell) => {
    if (helping || busy) return null;
    helping = true;
    busy = "help";
    try {
      const r = await post("/help", { cellId: String(cell) });
      if (r.ok && r.body.board) {
        applyBoard(r.body.board);
        return DONE.helped();
      }
      return refusal(r);
    } finally {
      helping = false;
      busy = null;
      showDash();
    }
  };
  helpButton.addEventListener("click", async () => {
    const cell = Number(helpButton.dataset.cell);
    const text = await sendHelp(cell);
    if (!text) return;
    helpSaid.textContent = text;
    helpSaidFor = cell;
    announce(text);
    showInspect(looked);
  });
  confirmHelp.addEventListener("click", async () => {
    const text = await sendHelp(Number(confirmHelp.dataset.cell));
    if (!text) return;
    confirmText.textContent = text;
    confirmHelp.hidden = true;
    announce(text);
  });

  form?.addEventListener(
    "click",
    (e) => {
      const tile = e.target instanceof Element ? e.target.closest("button.tile") : null;
      if (!tile) return;
      if (!touch.matches) {
        // A mouse click on someone's building keeps it inspected (for its
        // Help button); any other click lets go.
        pinned = tile.dataset.state === "held" ? tile : null;
        look();
      }
      // A move always confirms first, on any device, by mouse or key.
      const moving = tile.dataset.state === "free" && shown.tiles.some((t) => t.state === "mine");
      if (moving) {
        if (!relocating) setRelocating(true);
        e.preventDefault();
        select(tile === selected ? null : tile);
        if (selected) confirmButton.focus({ preventScroll: true });
        return;
      }
      if (!touch.matches || e.detail === 0) return; // detail 0: keyboard Enter
      e.preventDefault(); // the first tap selects; it never submits
      select(tile === selected ? null : tile);
    },
    true,
  );

  form?.addEventListener("submit", async (e) => {
    const submitter = e.submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    // The dashboard's actions: same routes as without script, by fetch.
    const act = submitter.dataset.act;
    if (act === "collect" || act === "upgrade") {
      e.preventDefault();
      return runAction(act, `/${act}`);
    }
    if (submitter.dataset.renewHours) {
      e.preventDefault();
      return runAction("renew", "/renew", { hours: submitter.dataset.renewHours });
    }
    const isClaim = submitter.classList.contains("tile") || submitter === confirmButton;
    if (!isClaim) return;
    e.preventDefault();
    if (busy) return; // one action at a time: a second click or Enter does nothing
    if (!nameField.value.trim()) {
      showNotice("label", "Type a name first, then pick a plot.");
      nameField.focus();
      return;
    }
    const id = Number(submitter.value);
    const target = describeTile(shown, id, new Date());
    if (target.kind === "held") {
      showNotice("held", `${target.title} Pick a free plot.`);
      return;
    }
    if (target.kind === "move" && !target.open) {
      showNotice(target.move?.reason ?? "move", target.move?.why ?? "You can't move there right now.");
      return;
    }
    const moving = target.kind === "move";
    busy = "claim";
    const pendingTile = tiles[id];
    pendingTile.dataset.pending = "";
    pendingTile.setAttribute("aria-busy", "true");
    confirmButton.disabled = true;
    actionText = null;
    showDash();
    try {
      const r = await post("/claim", { cellId: String(id), label: nameField.value });
      if (r.ok && r.body.board) {
        select(null);
        if (moving) setRelocating(false);
        applyBoard(r.body.board); // a no-op if the stream already brought it
        const said =
          r.body.notice === "renamed"
            ? `Name saved: you're ${r.body.label ?? nameField.value.trim()}.`
            : (actionText ?? (r.body.notice === "moved" ? `Moved to ${place(id)}.` : CLAIMED_TEXT));
        showNotice(r.body.notice ?? "claimed", said, { speak: false });
        announce(raisedNews ? `${said} ${raisedNews}` : said);
      } else {
        showNotice(r.body?.error ?? (r.network ? "network" : `http-${r.status}`), r.network ? "Couldn't reach the server, so nothing was claimed. Check your connection and try again." : refusal(r));
      }
    } finally {
      delete pendingTile.dataset.pending;
      pendingTile.removeAttribute("aria-busy");
      busy = null;
      actionText = null;
      raisedNews = null;
      confirmButton.disabled = false;
      showDash();
    }
  });

  // The lease and cooldown countdowns, and the inspector, tick while shown.
  setInterval(() => {
    if (looked !== null && inspector && !inspector.hidden) showInspect(looked);
    const now = new Date();
    shown.tiles.forEach((t, i) => tiles[i] && setData(tiles[i], "lease", leaseSoon(t, now) ? "soon" : null));
  }, 15_000);

  sayOnce(shown.me);
  showDash();
}
