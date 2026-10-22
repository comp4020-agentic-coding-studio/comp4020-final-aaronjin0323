# Adding a set

A set is a plug-in (ADR 18): one rules module, one view module, one line
in the registry. Orbit (`orbit.js`, `orbit-view.js`) is the worked
example; read it first.

## The files

| File | What |
|---|---|
| `public/sets/<id>.js` | the rules: objects, gestures, bounds, the 60 Hz step. Imported by the server and the page. |
| `public/sets/<id>-view.js` | the look, touch, buttons, sounds. Page only. |
| `public/stage.js` | add `import <id> from "./sets/<id>.js";` and put it in `SETS`. That's the one registry line; views are found from `SETS` by file name (`sets/views.js`). |
| `spec/sets-<id>.test.ts` | `holdsTheSetContract("<id>")` from `spec/set-helpers.ts`, then a test per rule that sets one object off another, each seen red. |
| `src/db.ts` | one starter performance in a new numbered migration (never edit a committed one). |
| `scripts/browser-check.ts` | a section that picks the set from the card's set row, plays a gesture by button and by reticle, and sees it on a second visitor's screen. `engines` already plays every set's fingerprint. |

`<id>` and every object id and gesture kind are lowercase letters only.

## Rules module: `export default` a `StageSet`

The full type is the JSDoc `StageSet` in `public/stage.js`.

```js
import { LOOP, STAGE, STEP, THROW, turnSin, turnCos } from "./kit.js";
export default {
  id: "<id>", name: "Chime Tree",          // name reads "Play the <name>"
  objects: ["striker", "c1", ...],         // every object, once
  holdable: ["striker"],                   // can be grabbed and thrown under a claim
  gestures: {                              // kind -> shape
    throw: { objects: ["striker"] },       // the shared throw: adds from[3], v[3] (THROW bounds)
    tap: { objects: ["c1", ...] },
    nudge: { objects: ["plank"], fields: { side: { lo: -1, hi: 1, step: 1 } } },
  },
  colour: { striker: 7, c1: 3, ... },      // PALETTE index per object
  startState(),                            // your state at the loop's start, everything at rest
  tick(st, t, emit),                       // one STEP; t = seconds since loop start; mutate st
  apply(st, g, t, emit),                   // a checked gesture lands (after the tick of its step)
  copyState(st),                           // a deep copy: snapshots must share nothing
  view(st, t),                             // a fresh plain object the view draws (no shared arrays)
  ease(view, e),                           // e from 0 to 1: everything e of the way home to rest; + - * only
  positions(view),                         // number[][]: every moving thing's position, for checks
  fingerprint: { gestures, hash, events }, // a busy performance (by "aaaaaa"), its hash, its event count
};
```

- **Fields:** `{ lo, hi, step }` (both ends allowed), `{ lo, below, step }`
  (up to under `below`), or `{ len, lo: [], hi: [], step }` for a list.
  `checkGesture` refuses unknown keys (`constructor` too), objects, kinds,
  non-numbers and anything out of range, and snaps to `step`. Never clamp.
- **emit** takes `{ kind, object, pos, by?, ...any }`; the run adds `t`.
  `by` is the gesture's `by` (a player's tag) when a person set it off, or
  an object id when an object did. The view flashes and sounds these.
  `top` and `home` are reserved (the loop's own).
- **Determinism:** + − × ÷ and `Math.sqrt` only (abs, min, max, floor,
  round, sign are fine). No `Math.sin`/`cos`/`pow`/`exp`/`atan2`/`hypot`,
  no `**`, no randomness, no `Date` or `performance.now`. For trig use
  `turnSin(turns)` / `turnCos(turns)` from `kit.js`; for anything else,
  precompute a table at load from them. The source check in
  `spec/stage.test.ts` reads every non-`-view.js` file here.
- **Rest:** with no gestures nothing moves; `ease(view, 1)` is exactly the
  rest pose; the glide (last `GLIDE` seconds) must never jump more than
  about 0.1 m per frame.
- **Stay on the stage:** within `STAGE.radius` of the centre, between the
  floor (y = 0) and `STAGE.ceiling`. A thrown thing starts at `g.from`
  with speed `g.v`.
- **The server** checks gestures with your shapes, lets a `throw` through
  only with the thrower's claim, and lets anything in `holdable` be
  grabbed. It never names an object.

## View module: named exports

The view never imports Three.js; it's handed `THREE`, so the page can
read the buttons, names and sounds without WebGL.

```js
export const icon = '<path .../>';         // the set row's icon: SVG inner markup, 24x24, currentColor
export const buttons = [                   // the card's gesture buttons, in tab order, one per object
  { gesture: "throw:striker", label: "Throw the striker", ball: "#e3b65b" },  // ball: a colour swatch
  { gesture: "tap:c1", label: "Strike the low chime", icon: '<path .../>' },  // or an icon
];
export function heldLabel(id, who)         // a throw button's label while `who` holds it
export function fromButton(kind, object, at, shown) // the gesture a button plays (shown = shownAt now)
export function nameOf(id)                 // "the striker"; return id unchanged if it isn't yours
export function swatch(p)                  // thumbnail colours (hex[]) for a performance
export function held(id)                   // { r, colour, metalness, roughness } in a hand, or null
export function sounds(events, tone)       // play your events with tone({ freq, type, dur, gain, slide, delay })
export function createView(THREE, { small }) // -> the view below; small = a plinth: fewer facets
```

`createView` returns:

```js
{
  root,                                     // a THREE.Group in the stage's frame (floor at y 0)
  update(p, t, { colourOf, held, still }),  // play p to moment t; returns the events that are news
  objects(),                                // { id: Object3D } for every object (claim rings, checks)
  aim(origin, dir, reach, skip, nearestHit),// reticle: nearest { id, t, point } or null (stage frame)
  haloOf(id, point),                        // { c, r }: where the reticle's halo sits
  press(id, point),                         // a quick press: a gesture without `at`, or null
  marks(),                                  // { name: [x,y,z] } fixed points for the browser check
  moving(), busy(), dispose(),
}
```

Use `createPlayer()` and `createFlashes(THREE, group)` from
`shared-view.js` for the playing, the glide and the flashes. A hold on a
holdable picks it up after 180 ms and throws it on release (the scene does
that); `press` is everything else. `moving()` must go false once things are
still (the page stops drawing then); keep draw calls low (the whole room
stays under 160).

## The checks to run

`pnpm -s typecheck`; `APP_URL=... pnpm -s test` (your spec, plus
`stage.test.ts`'s source check); `node scripts/browser-check.ts engines`,
your section, then the whole browser check, and read `.shots/`.
