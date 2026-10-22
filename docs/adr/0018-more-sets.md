# 18. More sets: the stage can hold other impossible toys

- **Status:** accepted, week 12
- **Decides:** what other objects a performance can be played on, how a
  set is added, and how visitors pick one
- **Keeps:** everything of ADR 16 (the loop, gestures, claims, caps, Undo,
  Leave it, Join in, versions, archive) and ADR 17 (first person, the
  reticle, poses). Orbit stays exactly as it is, bit for bit.

## Context

The Orbit stage (spheres, ribbon, bell) is the only thing to play. After a
few loops a group has seen what it does, and the museum's six plinths all
show variations of the same toy. ADR 16 left "more sets" open until the
first was fun. It is, and the room needs more to discover: different toys
invite different stories (a tune, a trick shot, a chain reaction), and a
plinth showing something you've never seen is a reason to walk over.

## Decision

**A set is a plug-in: one rules module and one view module, registered in
one list. Three new sets join Orbit, each with a starter performance.**

- **A set's rules live in `public/sets/<id>.js`**: its objects, which of
  them can be held (grabbed and thrown, under a claim), the gestures each
  object takes and their bounds, where everything rests, and its fixed
  60 Hz step. Same contract as Orbit's today: deterministic from the
  gestures and the loop moment alone, + − × ÷ and `Math.sqrt` only (the
  polynomial sine is shared), every object back at rest by the end of the
  loop's glide. `public/stage.js` keeps what every set shares (the loop,
  caps, checking, runs, snapshots, easing home) and the registry `SETS`.
- **A set's look and touch live in `public/sets/<id>-view.js`**: the
  meshes, flashes, what the reticle can rest on, what a press and a hold
  turn into, the panel's gesture buttons (each still a real button with an
  accessible name), and its sounds. The scene, page, sound and avatars ask
  the set; none of them names an object.
- **Choosing a set.** The stage card has a small row of set icons (the
  current one pressed). Choosing another starts a silent loop on it; if the
  loop has gestures it asks first and archives them, as "Start over" does,
  so nothing is lost. `POST /stage/clear` takes an optional `set`. "Join
  in" brings whatever set a plinth's performance was made on.
- **Starters.** Each new set gets one starter performance by the museum
  (a numbered migration), on plinths 4–6 where a plinth is free, otherwise
  into the storeroom. So the room shows every toy, and a visitor's "Leave
  it" on a starter's plinth asks first and moves the starter to the
  storeroom as always.
- **The three new sets** (each tuned for fun, not realism):
  - **Chime Tree** (`chimes`). A ring of hanging chime tubes, each a note
    of one pentatonic scale, and a heavy striker ball on a cord in the
    middle. Tap a chime and it swings and sounds; a hard swing knocks its
    neighbours, which sound in turn. Grab the striker, pull, and let go: it
    swings round the ring, striking whatever it passes. The loop becomes a
    tune that anyone can add a note to or knock off balance.
  - **Swap Doors** (`doors`). Two free-standing door frames on the stage
    and three bouncy balls under ordinary gravity. A ball through one door
    comes out of the other, same speed, turned with it. Throw a ball;
    tap a door and it turns a quarter, so everyone else's trick shots
    suddenly go somewhere new.
  - **Tipping Point** (`seesaw`). A long plank on a pivot and three stones
    of different weights. Drop a stone on one end and the plank tips,
    catapulting whatever sits on the other end; stones land, roll, and tip
    it back. Grab and throw a stone; tap the plank to give it a nudge.

## Turned down

- **One big set with every object.** It's one place to look, but the
  objects crowd each other on a 2 m stage and every interaction becomes
  noise.
- **A different set on every plinth, played in place.** Turned down in
  ADR 16: it scatters a handful of visitors over six stages.
- **Sets as data (a scene description the rules interpret).** It sounds
  general, but each toy's fun is in its own few rules; a small module per
  set is easier to read, test and tune than an interpreter.
- **A physics library.** Same reason as ADR 16: not deterministic across
  engines, and a build step.

## Consequences

- `public/stage.js` loses Orbit's rules to `public/sets/orbit.js` and
  `public/stageview.js` to `public/sets/orbit-view.js`, with no change in
  any position or event: the Orbit fingerprint and the engines check hold
  it.
- The server asks the set which objects can be held (`/stage/grab`,
  `/pose`'s `holding`) instead of a fixed sphere list.
- **Held by:** `spec/stage.test.ts`'s source check over every rules file
  in `public/sets/`; a spec per set (`spec/sets-<id>.test.ts`): bounds,
  determinism, a fingerprint, the glide home, and each rule that sets one
  object off another, each seen red; HTTP tests for choosing a set
  (archives a loop with gestures, refuses an unknown set, holdables come
  from the set); and the browser check: the engines section plays every
  set's fingerprint in JavaScriptCore and Node, and a `sets` section picks
  each set from the card, plays a gesture by button and by reticle, and
  sees it on a second visitor's screen.
