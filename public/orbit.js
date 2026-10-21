// Orbit's one rule (ADR 15): a placed sphere near the ribbon rides it. The
// ribbon's path and the catch are worked out here, from saved numbers and
// the shared clock only, so every screen agrees and a ribbon edit by anyone
// moves every caught sphere with no write from the sphere's owner. The
// scene draws from this, the page asks it whether a drag would catch, and
// spec/orbit.test.ts holds it. Plain arrays, no Three.js, so it runs in Node.

// Part ids are lowercase letters only, as the server checks.
export const SPHERES = ["chrome", "teal", "gold", "dusk"];
/** How close (in sculpture units) a dropped sphere must be to the ribbon's
 * path to be caught by it. */
export const CATCH = 0.42;
/** How fast a caught sphere rides the ribbon: loops of the path per second. */
export const RIDE = 0.06;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * A point on the ribbon's path at u in [0, 1): a circle that dips and rises
 * `turns` times, its reach breathing in and out, tipped by `tilt` degrees
 * about the x axis. Centred on the ribbon's own origin.
 * @returns {[number, number, number]}
 */
export function ribbonPoint(ribbon, u) {
  const a = u * TAU;
  const r = ribbon.radius * (1 + 0.22 * Math.cos(ribbon.turns * a + Math.PI / 2));
  const x = r * Math.cos(a);
  const y = 0.42 * ribbon.radius * Math.sin(ribbon.turns * a);
  const z = r * Math.sin(a);
  const t = ribbon.tilt * DEG;
  return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
}

/** Where a sphere was dropped, from its numbers, in the ribbon's frame. */
export function dropPoint(s) {
  const a = s.angle * DEG;
  return [Math.cos(a) * s.distance, s.height, Math.sin(a) * s.distance];
}

const SAMPLES = 240;
/** The point on the path nearest p: its u and how far it is. */
export function nearestU(ribbon, p) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const q = ribbonPoint(ribbon, i / SAMPLES);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // refine between the neighbouring samples
  let lo = (best - 1) / SAMPLES;
  let hi = (best + 1) / SAMPLES;
  for (let k = 0; k < 24; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = distTo(ribbon, m1, p);
    const d2 = distTo(ribbon, m2, p);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const u = (((lo + hi) / 2) % 1 + 1) % 1;
  return { u, d: distTo(ribbon, u, p) };
}
const distTo = (ribbon, u, p) => {
  const q = ribbonPoint(ribbon, u);
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
};

/**
 * Where a sphere is at shared time t, and whether it rides the ribbon. A
 * caught sphere holds its point of the ribbon (`along`), wherever the
 * ribbon's numbers put that point now, so a bend moves it and never drops
 * it. The catch itself was decided at the drop (dropOn).
 * @returns {{ onSculpture: boolean, caught: boolean, u: number, pos: [number, number, number] }}
 */
export function sphereAt(ribbon, s, t) {
  const drop = dropPoint(s);
  if (!s.placed) return { onSculpture: false, caught: false, u: 0, pos: drop };
  if (!s.ride) return { onSculpture: true, caught: false, u: 0, pos: drop };
  const u = (((s.along + t * RIDE) % 1) + 1) % 1;
  return { onSculpture: true, caught: true, u, pos: ribbonPoint(ribbon, u) };
}

const snap = (v, step, lo, hi) => Math.min(hi, Math.max(lo, Number((Math.round(v / step) * step).toFixed(4))));

/** Whether a sphere dropped at p (in the ribbon's frame) at shared time t
 * is caught, and the numbers to save for it, snapped into the recipe's
 * ranges. `along` has the ride so far taken off, so at time t the sphere is
 * drawn on the very point it was dropped on. */
export function dropOn(ribbon, p, t = 0) {
  const near = nearestU(ribbon, p);
  const caught = near.d <= CATCH;
  const along = (((near.u - t * RIDE) % 1) + 1) % 1;
  return { ...placeAt(p), ride: caught ? 1 : 0, along: caught ? snap(along, 0.001, 0, 0.999) : 0 };
}

/** The numbers that put a sphere at point p in the ribbon's frame. */
export function placeAt(p) {
  const angle = ((Math.atan2(p[2], p[0]) / DEG) % 360 + 360) % 360;
  return {
    placed: 1,
    angle: snap(angle, 1, 0, 359),
    height: snap(p[1], 0.01, -0.8, 0.8),
    distance: snap(Math.hypot(p[0], p[2]), 0.01, 0, 2),
  };
}
