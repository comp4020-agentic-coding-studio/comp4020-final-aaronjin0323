# 16. The Loop Stage: exhibits are performances, played together

- **Status:** accepted, week 12
- **Decides:** what visitors do in the museum, what an exhibit is, and what
  replaces sculpture recipes, sliders and the workbench editor
- **Supersedes:** [ADR 15](0015-orbit-play.md) (Orbit), and the editor half
  of [ADR 14](0014-explore-then-create.md). Keeps ADR 12's shared draft,
  versions, archive and storeroom, and ADR 13's word budget.

## Context

The museum made sculptures by moving numbers. Orbit (ADR 15) showed the
first sign of what we want: one visitor's change moving another's piece
live. But it was still building an object, and the fun stopped once the
object was built. What we want instead is the fun of improvising together:
reading what someone else just did, playing along, cutting in, getting
surprised. Different people should bring different stories to the same
exhibit, with no puzzle and no right answer. Controls should feel like
touching real objects, and the exhibit should answer with movement at once.
Parameter panels, long instructions and menus work against all of that.

## Decision

**An exhibit is a short performance played on a small stage of impossible
objects. A performance is a loop of gestures that anyone can add to.**

- **The stage is the centre of the room** (where the workbench stood). It
  always holds the live performance: one set of objects plus the loop of
  gestures made on it so far. It's never empty; "Start over" archives the
  loop and starts a silent one.
- **The objects of the first set ("Orbit stage")** are toy physics, decided
  by one shared module (`public/stage.js`) and nothing else:
  - **four spheres that fall upward.** Pick one up and throw it. It floats
    up, bounces off the ceiling, knocks into other spheres, and anywhere it
    passes close to the ribbon, the ribbon catches it and it rides along.
  - **a ribbon**, a closed loop. Pluck it and a pulse runs round it,
    flinging off any sphere riding there.
  - **a bell** hanging from nothing. Tap it and it rings, and every sphere
    near it hops away. A sphere that hits it rings it too.
  So objects set each other off: your throw rings the bell, the bell hops
  my sphere, my sphere lands on the ribbon, and your pluck throws it off.
- **The loop is 12 seconds and replays forever.** Every gesture is
  recorded at the moment in the loop it happened and plays again every
  cycle. You can answer something someone did three cycles ago, cut across
  it, or play along with it. Someone who arrives later sees the whole
  exchange and adds to it. The loop keeps the newest 40 gestures; older
  ones fade out, so a performance keeps changing.
- **Deterministic, so every screen agrees.** The state of the stage at any
  moment comes from the set, the gestures and the shared clock alone: a
  fixed 60 Hz step from the start of the loop, with no randomness. No frame
  writes to the server; a gesture is the only write.
- **Grabbing takes it.** Holding a sphere is a short claim (10 s), visible
  to everyone as the holder's colour ring. Anyone can grab it from you: the
  claim moves to them, and both screens show the tug in both colours. A
  throw needs the claim, so the last person to grab a sphere is the one who
  throws it (`409 taken` names who took it). Plucks and taps need no claim.
  Per-part leases and `409 lease-held` go away.
- **Every gesture also has a real button.** Throw each sphere, pluck the
  ribbon, ring the bell. They're icon buttons in tab order, each an
  ordinary gesture at the current moment of the loop.
- **Undo** removes your own newest gesture from the loop. It never removes
  anyone else's.
- **Leave it here.** "Leave it" saves the live loop as an exhibit version
  on a plinth: a new exhibit, or the next version of one. It suggests a
  title you can change, and credits everyone whose gestures are in the loop.
  Plinths play their saved performances on a loop, so walking round the
  room means watching what people left.
- **Join in.** On a plinth, "Join in" brings that performance to the stage,
  where everyone can play with it. If the stage's loop has gestures, it asks
  first and archives them, as replacing always has. Versions, restore, the
  storeroom and archived loops work as before.
- **Feedback is motion and sound.** Every catch, ring, pluck and collision
  shows on the object (a flash, a ring of light, a wobble), and plays a
  short synthesized sound. Sound is off until the visitor first touches
  something, and one icon button mutes it. Reduced motion stops the stage
  at the start of its loop but still shows that a gesture landed.
- **What goes:** recipes, sliders, Fine-tune, starters, "Shape it" and
  Done, the shelf, leases. Exhibits made with the old recipes move to the
  storeroom in one migration, with every version kept; nothing is deleted.
  Three starter performances go on plinths 1 to 3.

## Turned down

- **A stage on every plinth, played in place.** It's more to discover, but
  a handful of visitors would spread across six stages and rarely meet.
  One shared stage is where they run into each other; plinths are where
  performances are kept and watched.
- **Live only, saving a still moment.** It's simpler, but a still moment
  can't be answered. The loop is what lets visitors respond to each other
  across time.
- **Recorded takes, one after another.** These are turns, not play. You
  can't cut into someone else's take.
- **Keeping leases.** Then interrupting could happen only through the
  loop. Being able to grab someone's sphere is part of the fun, and the
  claim keeps it fair: one throw per grab, and you can see who has it.
- **A physics library.** It wouldn't be deterministic across browsers, it's
  more than the toy needs, and it would be a build step. A few hundred lines
  of fixed-step rules can be tested in Node.

## Consequences

- The data model mostly stays. The live loop is the old draft row. Its
  `recipe` names the set (`stage`), and its `parts` hold the loop
  `{ set, gestures }`. Versions copy it unchanged, and the immutability
  trigger, the archive and the storeroom are untouched.
- **Held by:** `spec/stage.test.ts` (validation; determinism; a throw near
  the ribbon is caught; a pluck flings riders off; a tap hops spheres near
  the bell; a sphere hitting the bell rings it; the newest 40 play), HTTP
  tests (a throw needs the claim; a grab takes it and the throw that lost
  it is `409 taken`; undo removes only your own; Leave it credits everyone
  in the loop; Join in archives), and the browser check (two visitors: one
  throws, the other sees the sphere move within a second; one grabs what
  the other holds and both see it; the keyboard buttons play gestures; the
  word budget; the sculpture-in-view checks at both sizes).
- The physics is ours to keep honest. It's tuned for fun, not realism, and
  the tuning numbers live in one place.
