// The camera. Without this script the board sits at a fixed angle and every
// claim still works; with it, a drag turns and tilts the board, and buttons
// do the same for keyboard users. The view is remembered per browser.

const board = document.querySelector(".board");
const stage = document.querySelector("[data-stage]");

if (board && stage) {
  const KEY = "skyline-view";
  const TILT_MIN = 10;
  const TILT_MAX = 75;
  const phone = matchMedia("(max-width: 40rem)");
  const defaults = () => (phone.matches ? { tilt: 28, spin: 0 } : { tilt: 52, spin: 35 });
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
  hint.textContent = "or drag the board";
  bar.append(hint);
  stage.before(bar);
}
