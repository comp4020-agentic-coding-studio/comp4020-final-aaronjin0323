import {
  connAfter,
  lostClaimText,
  accepts,
  arrivals,
  canHelp,
  canPark,
  describeTile,
  diffBoards,
  doneText,
  ECONOMY,
  eventText,
  expiredText,
  goal,
  goalParts,
  goalShown,
  heldText,
  helpButtonText,
  hudParts,
  initialsOf,
  inspect,
  isGold,
  landmarkAt,
  leaseSoon,
  pendingNow,
  perMinute,
  pctText,
  preview,
  raisedText,
  refusalText,
  relocateInfo,
  returnGlow,
  returnWords,
  rezoneOptions,
  mayorAt,
  statusText,
  tileAria,
  tileWords,
  upgrades,
  welcomeSaid,
  welcomeText,
} from "./diff.js";

// Everything the board does beyond plain HTML. Without this script the board
// sits at a fixed angle, every action is a form post and a reload, and other
// people's claims show on the next load. With it: a camera you can turn,
// keyboard play, a live board that updates in place, and the board teaching
// the game by showing what each move would do (CLAUDE.md, "Show, don't
// tell").

const board = document.querySelector(".board");
const stage = document.querySelector("[data-stage]");

if (board && stage) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        return null; // no storage (private window, blocked)
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // just not remembered
      }
    },
  };

  // --- the tucked-away panels: key, city activity, camera, keys ---
  // Each is a <details> behind a small icon. Closed on a first visit; which
  // ones are open is remembered.
  const TOOLS_KEY = "skyline-tools";
  const tools = [...document.querySelectorAll("details[data-tool]")];
  const openTools = store.get(TOOLS_KEY) ?? {};
  for (const t of tools) {
    t.hidden = false; // the camera and keys panels need this script
    t.open = openTools[t.dataset.tool] === true;
    t.addEventListener("toggle", () => {
      openTools[t.dataset.tool] = t.open;
      store.set(TOOLS_KEY, openTools);
    });
  }

  // --- the camera ---
  const KEY = "skyline-view";
  const TILT_MIN = 10;
  const TILT_MAX = 75;
  const phone = matchMedia("(max-width: 40rem)");
  const defaults = () => (phone.matches ? { tilt: 36, spin: 20 } : { tilt: 52, spin: 35 });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  let view = defaults();
  const saved = store.get(KEY);
  if (saved && Number.isFinite(saved.tilt) && Number.isFinite(saved.spin)) view = saved;

  const apply = () => {
    board.style.setProperty("--tilt", `${view.tilt}deg`);
    board.style.setProperty("--spin", `${view.spin}deg`);
  };
  const save = () => store.set(KEY, view);
  // The saved view is applied without the transition, so the board doesn't
  // swing round from the default angle on every page load.
  board.classList.add("is-instant");
  apply();
  requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove("is-instant")));

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

  // Buttons, for the keyboard and anyone who'd rather not drag, in the
  // camera panel.
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
  const cameraBar = document.querySelector("[data-camera]");
  for (const [text, action] of controls) {
    const b = document.createElement("button");
    b.type = "button"; // inside the claim form: never submit it
    b.textContent = text;
    b.addEventListener("click", action);
    cameraBar?.append(b);
  }

  // --- keyboard: the board is one Tab stop ---
  // Only one tile is in the tab order (a roving tabindex): your own, or the
  // centre. Arrows and WASD move relative to the screen, so "up" means
  // visually up however the camera is turned.
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

  const typing = (el) =>
    el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    // Enter in the name field never submits the form (that would claim tile
    // 0). With a plot already picked and a name typed, it claims that plot;
    // otherwise it goes to the board.
    if (e.target === nameField && key === "enter") {
      e.preventDefault();
      if (wanted !== null && nameField.value.trim()) return void claim(wanted);
      moveTo(wanted ?? current, true);
      return;
    }
    if (typing(e.target)) return;
    const onBoard = tiles.includes(document.activeElement);
    if (key in SCREEN_DIRS) {
      e.preventDefault();
      if (!onBoard) return moveTo(current, true);
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

  // --- the city the page shows ---
  const form = board.closest("form");
  // The page checks the name itself (a plot picked first is remembered), so
  // the browser's own "fill in this field" stays for the no-script page only.
  if (form) form.noValidate = true;
  const status = document.querySelector("#status");
  const notices = document.querySelector("[data-notices]");
  const announcer = document.querySelector("[data-announce]");

  const setData = (el, key, value) => {
    if (!el) return;
    if (value === null || value === undefined) {
      if (el.dataset[key] !== undefined) delete el.dataset[key];
    } else if (el.dataset[key] !== String(value)) el.dataset[key] = String(value);
  };
  const setText = (el, text) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  const show = (el, on) => {
    if (el && el.hidden === on) el.hidden = !on;
  };

  const patchTile = (el, t, shownBoard, now) => {
    if (el.dataset.state !== t.state) el.dataset.state = t.state;
    if (el.dataset.height !== String(t.height)) {
      el.dataset.height = String(t.height);
      el.style.setProperty("--h", String(t.height));
    }
    if (t.hue === null) el.style.removeProperty("--hue");
    else el.style.setProperty("--hue", String(t.hue));
    const free = t.state === "free" || t.state === "park";
    setData(el, "level", free ? null : t.level);
    setData(el, "neighbours", free ? null : t.neighbours);
    setData(el, "rate", free ? null : t.rate);
    setData(el, "leaseEndsAt", free ? null : t.leaseEndsAt);
    // the zone picks the roof icon (docs/adr/0009); civic draws none
    setData(el, "zone", free ? null : (t.zone ?? "civic"));
    setData(el, "endsAt", t.state === "park" ? t.endsAt : null);
    setData(el, "yours", t.state === "park" && t.mine ? "" : null);
    setData(el, "lease", leaseSoon(t, now) ? "soon" : null);
    if (t.state !== "mine") el.style.removeProperty("--lease");
    const mark = landmarkAt(shownBoard, t.id);
    const back = returnGlow(shownBoard, now) === t.id;
    setData(el, "return", back ? "" : null);
    const beacon = el.querySelector(".beacon");
    setData(beacon, "back", back ? `+${ECONOMY.returnBonus}` : null);
    // the district's mayor wears a star (docs/adr/0010)
    const mayor = mayorAt(shownBoard, t.id) !== null;
    setData(el, "mayor", mayor ? "" : null);
    const said = tileWords(t, now, mayor);
    const aria = back ? returnWords(tileAria(said, mark)) : tileAria(said, mark);
    if (el.getAttribute("aria-label") !== aria) el.setAttribute("aria-label", aria);
    if (mark) {
      el.dataset.landmark = mark.label;
      el.dataset.tier = mark.tier ?? "gold";
      el.dataset.landmarkRaisers = JSON.stringify(mark.raisers);
      if (!el.querySelector(".crown")) {
        const crown = document.createElement("span");
        crown.className = "crown";
        crown.setAttribute("aria-hidden", "true");
        el.append(crown);
      }
    } else if (el.dataset.landmark !== undefined) {
      delete el.dataset.landmark;
      delete el.dataset.tier;
      delete el.dataset.landmarkRaisers;
      el.querySelector(".crown")?.remove();
    }
    if (t.label === null) el.removeAttribute("title");
    else el.title = t.label;
    const initials = el.querySelector(".initials");
    const words = t.initials ?? initialsOf(t.label);
    if (initials && initials.textContent !== words) initials.textContent = words;
  };

  // The first board to compare against, read from the server-rendered HTML.
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
      cells[String(id)] = { tier: el.dataset.tier ?? "gold", label: el.dataset.landmark, raisers };
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
      mayors: extra.mayors ?? [],
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
        ...(el.dataset.zone ? { zone: el.dataset.zone } : {}),
        ...(el.dataset.state === "park" ? { endsAt: el.dataset.endsAt ?? null, mine: el.dataset.yours !== undefined } : {}),
      })),
    };
  };
  let shown = readBoard();
  let pendingSince = new Date();
  const mineIndex = () => shown.tiles.findIndex((t) => t.state === "mine");

  // --- one line at a time ---
  // A message is shown briefly near what it's about (`at`, a plot), and its
  // full sentence is spoken through the one polite live region.
  const announce = (text) => {
    if (!announcer) return;
    announcer.textContent = "";
    requestAnimationFrame(() => {
      announcer.textContent = text;
    });
  };
  const play = document.querySelector(".play");
  let noticeTimer = 0;
  const placeNotice = (p, at) => {
    if (at === null || at === undefined || !tiles[at] || !play) {
      p.style.removeProperty("left");
      p.style.removeProperty("top");
      delete p.dataset.at;
      return;
    }
    const box = play.getBoundingClientRect();
    const r = tiles[at].getBoundingClientRect();
    const half = Math.min(p.offsetWidth / 2 + 8, box.width / 2);
    const x = clamp(r.left + r.width / 2 - box.left, half, box.width - half);
    p.dataset.at = "";
    p.style.left = `${Math.round(x)}px`;
    p.style.top = `${Math.round(r.top - box.top)}px`;
  };
  const showNotice = (key, text, { said = text, speak = true, at = null } = {}) => {
    if (speak) announce(said);
    if (!notices) return;
    const p = document.createElement("p");
    p.className = "notice";
    p.dataset.notice = key;
    if (!announcer) p.setAttribute("role", "status");
    p.textContent = text;
    notices.replaceChildren(p);
    placeNotice(p, at);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (p.dataset.gone = ""), 4500);
  };
  // A notice that arrived in the URL (after a no-script post) is shown once.
  if (location.search.includes("notice=")) history.replaceState(null, "", location.pathname);
  const firstNotice = notices?.querySelector(".notice");
  if (firstNotice) noticeTimer = setTimeout(() => (firstNotice.dataset.gone = ""), 6000);

  // --- the wallet ---
  const wallet = document.querySelector("[data-wallet]");
  const hud = {
    coins: wallet?.querySelector("[data-hud-coins]"),
    coinsSaid: wallet?.querySelector("[data-hud-coins-said]"),
    rate: wallet?.querySelector("[data-hud-rate]"),
    rateSaid: wallet?.querySelector("[data-hud-rate-said]"),
    lease: wallet?.querySelector("[data-hud-lease]"),
    collect: wallet?.querySelector('[data-act="collect"]'),
    owed: wallet?.querySelector("[data-hud-owed]"),
    upgrade: wallet?.querySelector('[data-act="upgrade"]'),
    next: wallet?.querySelector("[data-hud-next]"),
    cost: wallet?.querySelector("[data-hud-cost]"),
    renew: [...(wallet?.querySelectorAll("[data-renew-hours]") ?? [])],
    coin: wallet?.querySelector("[data-coin]"),
  };
  let busy = null; // the action in flight: one at a time

  // The "+N" over your building while income waits.
  const owedMark = document.createElement("span");
  owedMark.className = "owed";
  owedMark.setAttribute("aria-hidden", "true");

  const showHud = () => {
    const now = new Date();
    const h = hudParts(shown, now, pendingNow(shown.me, pendingSince, now));
    const mine = mineIndex();
    // Land, not the wallet: with no land the wallet can still show, to
    // collect what an ended lease left, and the free plots still invite.
    form?.toggleAttribute("data-land", mine >= 0);
    setData(board, "invite", mine < 0 ? "" : null);
    show(wallet, h !== null);
    if (!h) {
      owedMark.remove();
      return;
    }
    setText(hud.coins, h.coins);
    setText(hud.coinsSaid, h.coinsSaid);
    setText(hud.rate, h.rate);
    setText(hud.rateSaid, h.rateSaid);
    if (hud.lease) show(hud.lease, h.level > 0); // no land, no lease
    show(hud.rate?.closest(".income"), h.level > 0); // and no income
    if (hud.lease && h.level > 0) {
      hud.lease.style.setProperty("--lease", h.lease.frac.toFixed(3));
      if (hud.lease.getAttribute("aria-label") !== h.lease.said) {
        hud.lease.setAttribute("aria-label", h.lease.said);
        hud.lease.title = h.lease.said;
      }
      setData(hud.lease, "lease", h.lease.soon ? "soon" : null);
    }
    if (mine >= 0) tiles[mine].style.setProperty("--lease", h.lease.frac.toFixed(3));
    show(hud.collect, h.collect !== null && busy !== "collect");
    if (h.collect) {
      setText(hud.owed, h.collect.text);
      if (hud.collect.getAttribute("aria-label") !== h.collect.said) hud.collect.setAttribute("aria-label", h.collect.said);
    }
    show(hud.upgrade, h.upgrade !== null && busy !== "upgrade");
    if (h.upgrade) {
      setText(hud.next, h.upgrade.name);
      setText(hud.cost, String(h.upgrade.cost));
      if (hud.upgrade.getAttribute("aria-label") !== h.upgrade.said) hud.upgrade.setAttribute("aria-label", h.upgrade.said);
    }
    const renewable = new Set(h.renew.map((r) => String(r.hours)));
    for (const b of hud.renew) show(b, renewable.has(b.dataset.renewHours) && busy !== "renew");
    // the waiting income, ticking up over the building itself
    if (mine >= 0 && h.collect) {
      if (owedMark.parentElement !== tiles[mine]) tiles[mine].append(owedMark);
      setText(owedMark, h.collect.text);
    } else owedMark.remove();
  };
  setInterval(showHud, 1000);

  // --- what a plot is, and what building on it would do ---
  // One plot at a time is "looked at": the one under the mouse, else the one
  // with keyboard focus, else the one tapped or picked. It gets the preview
  // on the board and the inspector beside it.
  const inspector = document.querySelector("[data-inspect]");
  const inspectTitle = inspector?.querySelector("[data-inspect-title]");
  const inspectFacts = inspector?.querySelector("[data-inspect-facts]");
  let hovered = null;
  let looked = null;
  let pinned = null; // a plot clicked with a mouse stays inspected
  let selected = null; // a plot tapped on a touch screen
  let wanted = null; // a plot picked before a name was typed

  // The inspector's actions, only when they can be taken: Move here (at a
  // free plot, holding land) and Help (at a neighbour's building).
  const inspectActions = document.createElement("div");
  inspectActions.className = "inspect-actions";
  inspectActions.hidden = true;
  const moveButton = document.createElement("button");
  moveButton.type = "submit";
  moveButton.name = "cellId";
  moveButton.className = "move-button";
  const helpButton = document.createElement("button");
  helpButton.type = "button";
  helpButton.className = "help-button";
  // Place park: at a free plot beside someone else's building (docs/adr/0007)
  const parkButton = document.createElement("button");
  parkButton.type = "button";
  parkButton.className = "park-button";
  // Rezone: on your own building, one button per other zone (docs/adr/0009)
  const zoneButtons = document.createElement("div");
  zoneButtons.className = "zone-buttons";
  zoneButtons.hidden = true;
  inspectActions.append(moveButton, helpButton, parkButton, zoneButtons);
  inspector?.append(inspectActions);

  const clearPreview = () => {
    for (const el of board.querySelectorAll("[data-preview]")) {
      delete el.dataset.preview;
      delete el.dataset.previewHeight;
    }
    for (const el of board.querySelectorAll(".beacon[data-gain]")) delete el.dataset.gain;
    for (const el of board.querySelectorAll(".beacon[data-pct]")) delete el.dataset.pct;
  };
  const showPreview = (id) => {
    clearPreview();
    const p = id === null ? null : preview(shown, id);
    if (!p) return;
    tiles[id].dataset.preview = "target";
    tiles[id].dataset.previewHeight = String(p.height);
    const ghost = tiles[id].querySelector(".beacon");
    if (ghost) ghost.dataset.gain = `+${perMinute(p.rate)}/min`;
    for (const n of p.lifted) tiles[n].dataset.preview = "lift";
    for (const n of p.dropped) tiles[n].dataset.preview = "drop";
    // each neighbour's own change, zones included: +20%, +10%, +35%
    for (const n of [...p.lifted, ...p.dropped]) {
      const b = tiles[n].querySelector(".beacon");
      if (b && Number.isFinite(p.pct?.[n])) b.dataset.pct = pctText(p.pct[n]);
    }
  };
  const showInspect = (id) => {
    if (!inspector) return;
    const now = new Date();
    const info = id === null ? null : inspect(shown, id, now);
    if (!info) {
      inspector.hidden = true;
      return;
    }
    setText(inspectTitle, info.title);
    inspectFacts?.replaceChildren(
      ...info.facts.flatMap(([term, value]) => {
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.textContent = value;
        return [dt, dd];
      }),
    );
    const move = relocateInfo(shown, id, now);
    const help = canHelp(shown, id, now);
    show(moveButton, Boolean(move?.ok) && !touch.matches);
    if (move?.ok) {
      moveButton.value = String(id);
      setText(moveButton, `Move here · ${move.cost}`);
    }
    show(helpButton, Boolean(help?.ok));
    if (help?.ok) {
      const words = helpButtonText(help);
      helpButton.dataset.cell = String(id);
      helpButton.classList.toggle("help-back", help.back);
      setText(helpButton, words.text);
      helpButton.setAttribute("aria-label", words.said);
    }
    const park = canPark(shown, id);
    show(parkButton, Boolean(park?.ok) && busy !== "park" && !touch.matches); // a phone has it in the confirm bar
    if (park?.ok) {
      parkButton.dataset.cell = String(id);
      setText(parkButton, `Place park (${park.cost})`);
      parkButton.setAttribute("aria-label", `Place a park here for ${park.cost} coins: lifts ${park.names.join(", ")} for ${ECONOMY.parkHours} hours`);
    }
    const zones = shown.tiles[id]?.state === "mine" && busy !== "rezone" ? rezoneOptions(shown, now) : [];
    const key = zones.map((o) => o.zone).join(",");
    if (zoneButtons.dataset.zones !== key) {
      zoneButtons.dataset.zones = key;
      zoneButtons.replaceChildren(
        ...zones.map((o) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "zone-button";
          b.dataset.zone = o.zone;
          b.textContent = o.text;
          b.setAttribute("aria-label", o.said);
          b.addEventListener("click", () => runAction("rezone", "/rezone", { zone: o.zone }).then(() => showInspect(looked)));
          return b;
        }),
      );
    }
    show(zoneButtons, zones.length > 0);
    inspectActions.hidden = moveButton.hidden && helpButton.hidden && parkButton.hidden && zoneButtons.hidden;
    inspector.hidden = false;
  };
  const focusedTile = () => {
    const el = document.activeElement;
    return tiles.includes(el) && el.matches(":focus-visible") ? el : null;
  };
  const look = () => {
    const kept = inspector?.contains(document.activeElement) && looked !== null ? tiles[looked] : null;
    const el = hovered ?? focusedTile() ?? kept ?? selected ?? pinned ?? (wanted === null ? null : tiles[wanted]);
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

  // --- the board's own cues ---
  // A mark on a plot for a moment, restarting its animation if it's mid-way.
  // `set` writes the attribute by name, so the stylesheet test can see it.
  const timed = new Map();
  const mark = (id, name, set, ms) => {
    const el = tiles[id];
    const k = `${name}:${id}`;
    clearTimeout(timed.get(k));
    delete el.dataset[name];
    void el.offsetWidth;
    set(el);
    timed.set(
      k,
      setTimeout(() => {
        delete el.dataset[name];
        timed.delete(k);
      }, ms),
    );
  };
  // someone else just built here
  const markFresh = (id) => mark(id, "fresh", (el) => (el.dataset.fresh = ""), 2000);
  // a building going up, or up a level
  const markBuilt = (id) => mark(id, "built", (el) => (el.dataset.built = ""), 800);

  // A "+1" or "−1" floating up off a building whose height changed.
  const float = (id, delta) => {
    const el = document.createElement("span");
    el.className = "rise";
    el.dataset.delta = delta > 0 ? "up" : "down";
    el.setAttribute("aria-hidden", "true");
    el.textContent = delta > 0 ? `+${delta}` : `\u2212${-delta}`;
    tiles[id].append(el);
    setTimeout(() => el.remove(), 1500);
  };

  // A short burst of coins off a building that just went up.
  const coinBurst = (id) => {
    const el = document.createElement("span");
    el.className = "coin-burst";
    el.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 8; i++) {
      const c = document.createElement("span");
      c.className = "coin-bit";
      c.style.setProperty("--a", `${i * 45}deg`);
      el.append(c);
    }
    tiles[id].append(el);
    setTimeout(() => el.remove(), 1200);
  };

  // Coins flying from your building to the wallet when you collect.
  const flyCoins = (from, count) => {
    const target = hud.coin;
    if (!target || from < 0) return;
    const a = tiles[from].getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const n = Math.max(1, Math.min(8, count));
    for (let i = 0; i < n; i++) {
      const c = document.createElement("span");
      c.className = "flying-coin";
      c.setAttribute("aria-hidden", "true");
      c.style.left = `${a.left + a.width / 2}px`;
      c.style.top = `${a.top + a.height / 2}px`;
      document.body.append(c);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      if (reducedMotion.matches || !c.animate) {
        setTimeout(() => c.remove(), 0);
        continue;
      }
      const lift = -60 - Math.random() * 40;
      c.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0 },
          { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${lift}px)) scale(1)`, opacity: 1, offset: 0.3 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`, opacity: 1 },
        ],
        { duration: 700 + i * 60, delay: i * 50, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "backwards" },
      ).finished.then(() => c.remove(), () => c.remove());
    }
    setTimeout(() => bump(), reducedMotion.matches ? 0 : 750);
  };
  const bump = () => {
    if (!hud.coins) return;
    delete hud.coins.dataset.bump;
    void hud.coins.offsetWidth;
    hud.coins.dataset.bump = "";
    setTimeout(() => delete hud.coins.dataset.bump, 1000);
  };

  // --- every board comes through here ---
  const once = new Set();
  let actionMessage = null; // my claim's narration, waiting for its reply
  let lostClaim = null; // a claim whose reply never came, until a board settles it
  const applyBoard = (next, { streamVersion = null } = {}) => {
    if (next.raised) celebrate(next.raised);
    if (!accepts(shown.version, next.version, streamVersion)) return;
    const { rises, messages } = diffBoards(shown, next);
    const fresh = arrivals(shown, next);
    const built = upgrades(shown, next);
    const prevMe = shown.me;
    const prevMine = mineIndex();
    shown = next;
    pendingSince = new Date();
    const settled = lostClaim;
    lostClaim = null;
    const now = new Date();

    next.tiles.forEach((t, i) => tiles[i] && patchTile(tiles[i], t, next, now));
    showGoal(next);
    showEvents(next);
    showHud();
    if (prevMe && next.me && next.me.coins > prevMe.coins && busy !== "collect") bump();
    if (selected) select(selected); // re-read its state: someone may have taken it
    setText(document.querySelector("[data-claimed]"), String(next.claimed));
    setText(status, statusText(next));
    const mine = mineIndex();
    if (mine >= 0 && !tiles.includes(document.activeElement)) moveTo(mine, false);

    for (const { id, delta } of rises) float(id, delta);
    for (const id of fresh) {
      markFresh(id);
      markBuilt(id);
    }
    for (const id of built) markBuilt(id);
    if (mine >= 0 && mine !== prevMine) {
      markBuilt(mine);
      coinBurst(mine);
    }
    look();
    sayOnce(next.me);
    const [m] = messages;
    // A claim whose reply was lost: the first board after it settles it. If
    // the tile came to me, the diff's own "claimed" message says so below.
    if (settled !== null && next.tiles[settled]?.state !== "mine" && !m) {
      const r = refusalText({ network: true }, { claim: true });
      showNotice("network", r.text, { said: r.said, at: settled });
    }
    if (m) {
      // My own claim or move is said when the server's reply confirms it,
      // even if the stream brought it first; my lease ending is said once.
      if (m.key === "claimed" && busy === "claim") actionMessage = m;
      else if (m.key === "expired") sayExpired();
      else showNotice(m.key, m.text, { said: m.said, at: mine >= 0 ? mine : null });
    }
  };

  const sayExpired = (me = null) => {
    if (once.has("expired")) return;
    once.add("expired").add("welcome"); // the one line says both
    const text = expiredText({ ...me, expired: true });
    showNotice("expired", text);
  };
  const sayOnce = (me) => {
    // A lease that ended is said first, with what was earned in the same line.
    if (expiredText(me)) return sayExpired(me);
    const w = welcomeText(me);
    if (w && !once.has("welcome")) {
      once.add("welcome");
      showNotice("welcome", w, { said: welcomeSaid(me), at: mineIndex() >= 0 ? mineIndex() : null });
    }
  };
  if (notices?.querySelector('[data-notice="welcome"]')) once.add("welcome");
  // The lease-ended line already carries what was earned away, so the
  // stream's own welcome (opening it counts as a visit too) mustn't replace it.
  if (notices?.querySelector('[data-notice="expired"]')) once.add("expired").add("welcome");

  // --- the city log, behind its icon ---
  const eventsList = document.querySelector("[data-events]");
  const showEvents = (next) => {
    if (!eventsList || !Array.isArray(next.events)) return;
    const lines = next.events.map(eventText);
    if (lines.join("\n") === [...eventsList.children].map((li) => li.textContent).join("\n")) return;
    eventsList.replaceChildren(
      ...lines.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
  };

  // --- the room's goal (docs/adr/0004): shown once it's within reach ---
  const goalLine = document.querySelector("[data-goal]");
  const goalSlots = goalLine
    ? Object.fromEntries(["noun", "lead", "who", "tail", "unit", "tier"].map((k) => [k, goalLine.querySelector(`[data-goal-${k}]`)]))
    : {};
  const showGoal = (next) => {
    const g = goal(next);
    const parts = goalParts(g);
    show(goalLine, goalShown(g));
    setText(landmarkCount, parts.count);
    for (const [k, el] of Object.entries(goalSlots)) setText(el, parts[k]);
    const glow = new Set(g.helps);
    tiles.forEach((el, id) => setData(el, "helps", glow.has(id) ? "" : null));
  };

  // --- a crown raised: the room-wide moments (docs/adr/0006). Gold is the
  // celebration, a burst and every name; bronze and silver only a toast. ---
  const celebrated = new Set();
  const cheer = document.createElement("p");
  cheer.className = "cheer";
  cheer.hidden = true;
  let cheerTimer = 0;
  let raisedNews = null; // a raising that landed while my claim was in flight
  const celebrate = (raised) => {
    const id = Number(raised.cellId);
    const key = `${id}:${raised.tier ?? "gold"}`;
    if (celebrated.has(key) || !tiles[id]) return;
    celebrated.add(key);
    const tile = tiles[id];
    if (!isGold(raised)) {
      // never over a gold celebration still on screen
      if (!cheer.hidden && cheer.dataset.tier === "gold") return;
      cheer.dataset.tier = raised.tier;
      cheer.textContent = raisedText(raised);
      cheer.hidden = false;
      clearTimeout(cheerTimer);
      cheerTimer = setTimeout(() => (cheer.hidden = true), 4000);
      if (busy) raisedNews = raisedText(raised);
      else announce(raisedText(raised));
      return;
    }
    cheer.dataset.tier = "gold";
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
    cheer.textContent = raisedText(raised);
    cheer.hidden = false;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => (cheer.hidden = true), 8000);
    if (busy) raisedNews = raisedText(raised);
    else announce(raisedText(raised));
  };
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.append(cheer);
  document.body.append(toasts);

  // --- the connection: a dot when live, words when it isn't ---
  const conn = document.querySelector("[data-conn]");
  const connText = conn?.querySelector(".conn-text");
  const CONN_TEXT = { live: "Live", reconnecting: "Reconnecting…", offline: "Offline: the map may be out of date" };
  const setConn = (state) => {
    if (!conn) return;
    if (conn.dataset.conn !== state) conn.dataset.conn = state;
    setText(connText, CONN_TEXT[state]);
    conn.title = CONN_TEXT[state];
  };
  if ("EventSource" in window) {
    const events = new EventSource("/events");
    let streamVersion = null;
    let reopened = false;
    events.addEventListener("board", (e) => {
      const next = JSON.parse(e.data);
      applyBoard(next, { streamVersion: reopened ? streamVersion : null });
      streamVersion = next.version;
      reopened = false;
      setConn("live");
    });
    events.addEventListener("open", () => setConn(connAfter("open")));
    events.addEventListener("message", () => setConn(connAfter("message")));
    events.addEventListener("error", () => {
      reopened = true;
      setConn(connAfter("error", { closed: events.readyState === EventSource.CLOSED }));
    });
    addEventListener("offline", () => setConn(connAfter("offline")));
    addEventListener("online", () => setConn(connAfter("online", { streamOpen: events.readyState === EventSource.OPEN })));
  } else setConn("offline");

  // --- actions: one POST each, one at a time ---
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
  const refusal = (r, opts) => refusalText({ network: Boolean(r.network), status: r.status ?? 0, error: r.body?.error ?? null }, opts);
  const refusalKey = (r) => r.body?.error ?? (r.network ? "network" : `http-${r.status}`);

  const runAction = async (name, route, data = {}) => {
    if (busy) return;
    busy = name;
    const from = mineIndex();
    const owed = Math.floor(pendingNow(shown.me, pendingSince, new Date()) / 100);
    showHud();
    try {
      const r = await post(route, data);
      if (r.ok && r.body.board) {
        applyBoard(r.body.board);
        const m = doneText(r.body.notice, r.body, r.body.board, new Date());
        showNotice(r.body.notice ?? name, m.text, { said: m.said, at: mineIndex() >= 0 ? mineIndex() : null });
        if (r.body.notice === "collected") flyCoins(from, Number(r.body.paid) || owed);
      } else {
        const m = refusal(r);
        showNotice(refusalKey(r), m.text, { said: m.said });
      }
    } finally {
      busy = null;
      showHud();
    }
  };

  // --- touch screens: tap to select, then confirm ---
  // A plot on a phone is about 27px across, so a first tap selects it and a
  // full-width bar shows what building there would do, with one button.
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
  const confirmHelp = document.createElement("button");
  confirmHelp.type = "button";
  confirmHelp.className = "confirm-help";
  confirmHelp.hidden = true;
  const confirmPark = document.createElement("button");
  confirmPark.type = "button";
  confirmPark.className = "confirm-park";
  confirmPark.hidden = true;
  const confirmCancel = document.createElement("button");
  confirmCancel.type = "button";
  confirmCancel.className = "confirm-cancel";
  confirmCancel.textContent = "\u2715";
  confirmCancel.setAttribute("aria-label", "Cancel");
  confirmCancel.title = "Cancel";
  confirmBar.append(confirmText, confirmButton, confirmHelp, confirmPark, confirmCancel);
  form?.append(confirmBar);

  const select = (tile) => {
    if (selected !== tile && selected) delete selected.dataset.selected;
    selected = tile;
    if (!tile) {
      confirmBar.hidden = true;
      look();
      return;
    }
    tile.dataset.selected = "";
    const now = new Date();
    const id = Number(tile.value);
    const d = describeTile(shown, id, now);
    confirmText.textContent = d.title;
    confirmButton.textContent = d.action ?? "";
    confirmButton.value = tile.value;
    confirmButton.hidden = !d.action;
    confirmButton.disabled = busy !== null;
    confirmButton.classList.toggle("confirm-move", d.kind === "move");
    const neighbour = canHelp(shown, id, now);
    confirmHelp.hidden = !neighbour?.ok;
    if (neighbour?.ok) {
      const words = helpButtonText(neighbour);
      confirmHelp.textContent = words.text;
      confirmHelp.setAttribute("aria-label", words.said);
      confirmHelp.classList.toggle("help-back", neighbour.back);
      confirmHelp.dataset.cell = tile.value;
    }
    const park = canPark(shown, id);
    confirmPark.hidden = !park?.ok;
    if (park?.ok) {
      confirmPark.textContent = `Park · ${park.cost}`;
      confirmPark.setAttribute("aria-label", `Place a park here for ${park.cost} coins`);
      confirmPark.dataset.cell = tile.value;
    }
    confirmBar.hidden = false;
    look();
  };
  confirmCancel.addEventListener("click", () => {
    want(null);
    select(null);
  });

  // --- picking a plot before typing a name ---
  // Typing a name isn't a gate: a plot picked first is remembered, the name
  // field pulses and takes focus, and the claim goes through as soon as a
  // name is there (Enter in the field, or picking the plot again).
  const want = (id) => {
    if (wanted !== null && tiles[wanted]) delete tiles[wanted].dataset.wanted;
    wanted = id;
    if (id === null) {
      delete nameField.dataset.want;
      return;
    }
    tiles[id].dataset.wanted = "";
    delete nameField.dataset.want;
    void nameField.offsetWidth; // pulse again on a second pick
    nameField.dataset.want = "";
    nameField.focus({ preventScroll: true });
    nameField.scrollIntoView({ block: "nearest" });
    look();
    announce("Type your name to build here.");
  };
  nameField.addEventListener("input", () => {
    if (nameField.value.trim()) delete nameField.dataset.want;
  });

  // --- helping a neighbour ---
  const sendHelp = async (cell) => {
    if (busy) return;
    busy = "help";
    try {
      const r = await post("/help", { cellId: String(cell) });
      if (r.ok && r.body.board) {
        applyBoard(r.body.board);
        const key = r.body.notice === "returned" ? "returned" : "helped";
        const m = doneText(key);
        showNotice(key, m.text, { said: m.said, at: cell });
      } else {
        const m = refusal(r);
        showNotice(refusalKey(r), m.text, { said: m.said });
      }
    } finally {
      busy = null;
      showHud();
      showInspect(looked);
      if (selected) select(selected);
    }
  };
  helpButton.addEventListener("click", () => sendHelp(Number(helpButton.dataset.cell)));
  confirmHelp.addEventListener("click", () => sendHelp(Number(confirmHelp.dataset.cell)));

  // --- placing a park (docs/adr/0007) ---
  const sendPark = async (cell) => {
    if (busy) return;
    busy = "park";
    try {
      const r = await post("/park", { cellId: String(cell) });
      if (r.ok && r.body.board) {
        applyBoard(r.body.board);
        const m = doneText("parked");
        showNotice("parked", m.text, { said: m.said, at: cell });
      } else {
        const m = refusal(r);
        showNotice(refusalKey(r), m.text, { said: m.said, at: cell });
      }
    } finally {
      busy = null;
      showHud();
      showInspect(looked);
      if (selected) select(selected);
    }
  };
  parkButton.addEventListener("click", () => sendPark(Number(parkButton.dataset.cell)));
  confirmPark.addEventListener("click", () => sendPark(Number(confirmPark.dataset.cell)));

  // --- claiming and moving ---
  const claim = async (id) => {
    if (busy) return; // one action at a time: a second click or Enter does nothing
    const target = describeTile(shown, id, new Date());
    if (target.kind === "held" || target.kind === "park") {
      // Looking at a building ends the plan to build on a plot picked before
      // a name was typed, so Enter in the name field can't build there unseen.
      want(null);
      const m = heldText(shown, id);
      return showNotice("held", m.text, { said: m.said, at: id });
    }
    if (!nameField.value.trim()) return want(id);
    if (target.kind === "mine" && nameField.value.trim() === shown.tiles[id].label) return; // a different name renames
    if (target.kind === "move" && !target.open) {
      const m = refusalText({ error: target.move?.reason ?? null });
      return showNotice(target.move?.reason ?? "move", m.text, { said: m.said, at: id });
    }
    busy = "claim";
    const pendingTile = tiles[id];
    pendingTile.dataset.pending = "";
    pendingTile.setAttribute("aria-busy", "true");
    confirmButton.disabled = true;
    actionMessage = null;
    try {
      const r = await post("/claim", { cellId: String(id), label: nameField.value });
      if (r.ok && r.body.board) {
        select(null);
        want(null);
        pinned = null;
        applyBoard(r.body.board); // a no-op if the stream already brought it
        // a claim made from the name field hands focus to the new building
        if (document.activeElement === nameField) moveTo(id, true);
        const m =
          r.body.notice === "renamed"
            ? { key: "renamed", ...doneText("renamed", { label: r.body.label ?? nameField.value.trim() }) }
            : (actionMessage ?? { key: r.body.notice ?? "claimed", text: r.body.notice === "moved" ? "Moved!" : "Your building is up!", said: r.body.notice === "moved" ? "Moved." : "Your building is up." });
        showNotice(r.body.notice ?? "claimed", m.text, { said: raisedNews ? `${m.said} ${raisedNews}` : m.said, at: id });
      } else if (r.network) {
        // The reply was lost, not necessarily the claim: say what the board says.
        const m = lostClaimText(shown, id);
        showNotice(m.key, m.text, { said: m.said, at: id });
        if (m.key === "network") {
          // On a quiet board no new board may come to settle it. A claim the
          // server made reaches the stream within a second (realtime.test.ts),
          // so a live stream that still shows it free a few seconds on means
          // it wasn't made.
          lostClaim = id;
          setTimeout(() => {
            if (lostClaim !== id || conn?.dataset.conn !== "live") return;
            lostClaim = null;
            if (shown.tiles[id]?.state === "mine") return;
            const r = refusalText({ network: true }, { claim: true });
            showNotice("network", r.text, { said: r.said, at: id });
          }, 3000);
        }
      } else {
        const m = refusal(r, { claim: true });
        showNotice(refusalKey(r), m.text, { said: m.said, at: id });
      }
    } finally {
      delete pendingTile.dataset.pending;
      pendingTile.removeAttribute("aria-busy");
      busy = null;
      actionMessage = null;
      raisedNews = null;
      confirmButton.disabled = false;
      showHud();
      look();
    }
  };

  form?.addEventListener(
    "click",
    (e) => {
      const tile = e.target instanceof Element ? e.target.closest("button.tile") : null;
      if (!tile) return;
      const id = Number(tile.value);
      const holding = mineIndex() >= 0;
      if (touch.matches && e.detail !== 0) {
        // the first tap selects; it never submits
        e.preventDefault();
        if (tile === selected && !holding && tile.dataset.state === "free") return void claim(id);
        select(tile === selected ? null : tile);
        if (selected && !holding && tile.dataset.state === "free" && !nameField.value.trim()) want(id);
        else if (tile.dataset.state === "held" || tile.dataset.state === "park") want(null); // as in claim()
        return;
      }
      // A mouse click on a building or a park, or on a free plot while you
      // hold land, keeps it inspected: its Help, Move or Park button is there.
      const other = tile.dataset.state === "held" || tile.dataset.state === "park";
      if (other || (holding && tile.dataset.state === "free")) {
        e.preventDefault();
        pinned = pinned === tile ? null : tile;
        look();
        if (other) claim(id); // says whose it is; never posts
      } else if (tile.dataset.state === "mine") {
        // your own building stays inspected for its zone buttons (ADR 9);
        // the click still submits, so a new name typed first renames
        pinned = tile;
        look();
      }
    },
    true,
  );

  form?.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    const act = submitter.dataset.act;
    if (act === "collect" || act === "upgrade") {
      e.preventDefault();
      return void runAction(act, `/${act}`);
    }
    if (submitter.dataset.renewHours) {
      e.preventDefault();
      return void runAction("renew", "/renew", { hours: submitter.dataset.renewHours });
    }
    if (submitter.classList.contains("tile") || submitter === confirmButton || submitter === moveButton) {
      e.preventDefault();
      claim(Number(submitter.value));
    }
  });

  // The lease marks, the help-back glow and the inspector tick while shown:
  // a favour's hour and my help's cooldown both end with no board sent.
  setInterval(() => {
    if (looked !== null && inspector && !inspector.hidden) showInspect(looked);
    const now = new Date();
    shown.tiles.forEach((t, i) => tiles[i] && patchTile(tiles[i], t, shown, now));
  }, 15_000);

  sayOnce(shown.me);
  showGoal(shown);
  showHud();
}
