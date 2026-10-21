# 17. First person: you're in the room, with everyone else

- **Status:** accepted, week 12
- **Decides:** how a visitor sees, moves through and touches the museum,
  and how visitors see each other
- **Supersedes:** the orbit camera of ADR 12 and 14, the composed plinth
  close-ups, and the "visitors are coloured markers, never avatars" rule
  of CLAUDE.md, "The look". Keeps everything about the Loop Stage (ADR 16):
  performances, gestures, claims and the rules in `public/stage.js`.

## Context

The Loop Stage makes play social, but every visitor watched the stage
from an orbit camera, like a model on a turntable. People couldn't see
each other: a sphere flew because "someone" threw it. Playing along and
interrupting are easier when you can see who is reaching for the bell, who
is standing by the ribbon, and who just took your sphere out of your hand.
Being in the room should feel like being in a room together.

## Decision

**Every visitor stands in the museum in first person, and sees the others
standing there too.**

- **The view is your eyes.** The camera stands at eye height (1.62) on the
  floor inside the ring of arches. You walk (WASD or arrow keys on desktop,
  a thumb joystick on the phone) and look round (mouse with pointer lock on
  desktop, a drag anywhere else on the phone). You can't walk through the
  stage, the plinths or the arches, or off the floor.
- **A reticle in the centre of the view is your hand.** Whatever it rests on
  within reach (3.2 m) lights up. Hold to pick up a sphere: it floats in
  front of you. Let go to throw it where you're looking, harder the longer
  you held (up to the stage's speed limit). A tap on a sphere hops it; a
  click on the ribbon plucks it there; a click on the bell rings it. On the
  phone a big round button bottom-right is the hand: hold and release.
  Plinths are looked at, not played: walk up to one and its card shows.
- **Other visitors are there.** Each is a soft floating head in their
  colour, with their name above it, and a hand orb where they're reaching.
  A sphere someone holds floats in front of their head. You see who is
  looking at what, and whose hand is on which sphere.
- **Presence is live and never stored.** Each page sends its pose (where
  it stands, where it looks, what it's reaching for) at most 8 times a
  second to `POST /pose`. The server keeps the newest pose per visitor in
  memory only, and sends every stream a small `poses` event at most 10
  times a second, apart from the whole-state `state` events. A pose older
  than 5 s is dropped. Poses never touch the database, so the museum's
  state, versions and archives are unchanged.
- **The panel stays, and gets smaller.** The stage card (credits, the loop
  strip, gesture buttons, Undo, Leave it, Start over, sound) and the plinth
  card stay in the DOM. On desktop they sit in a corner and never take
  focus from the view. On the phone they fold below the view, as now.
  Every gesture keeps its button, so keyboard and screen-reader play works
  without walking. "Gallery" becomes "Back to the stage": it walks you back
  to your starting spot.
- **Choosing a plinth from the row walks you there.** The plinth buttons
  still pick a plinth; your view glides to stand in front of it.

## Turned down

- **Hands only, no heads.** It's lighter, but you can't see where someone
  is looking, and that's half of reading what they're about to do.
- **Pointer instead of reticle.** It's closer to the old controls, but the
  mouse and the view fight each other, and it doesn't feel like reaching.
- **Tap the floor to walk, on the phone.** It's simpler, but too slow to
  catch a sphere someone just threw at you.
- **Storing poses.** They change ten times a second and mean nothing a
  minute later. Saving them would be a write storm for no history.

## Consequences

- The camera-composition code (scored plinth close-ups, the clear
  rectangle) goes. The browser check's `focus` and `opening` sections
  become first-person checks: you start inside the pavilion at eye height
  facing the stage, and walking up to a plinth shows its card.
- A new SSE event type (`poses`) and route (`POST /pose`), rate-limited per
  visitor so one page can't flood the others.
- **Held by:** HTTP tests (a pose is accepted, echoed to other streams
  within a second, dropped after 5 s, never in `state` and never stored;
  bad poses are `400`; too frequent ones are ignored), unit tests of the
  movement rules (collision with the stage, plinths and the rim; a reticle
  ray picks the nearest object in reach), and the browser check (two
  visitors: each sees the other's head move; one picks up a sphere by
  reticle and the other sees it float in front of their head, then sees it
  thrown; walking by keyboard; the phone joystick and hand button).
