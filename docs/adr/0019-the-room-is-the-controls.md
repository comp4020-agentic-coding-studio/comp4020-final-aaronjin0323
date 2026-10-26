# 19. The room is the controls: the panel stops being a second remote

- **Status:** accepted, week 12
- **Decides:** where a visitor learns what they can do with an object, and
  what the stage card still shows
- **Keeps:** everything of ADR 13 (the word budget, icons with accessible
  names), ADR 16 (gestures, claims, Undo, Leave it) and ADR 17 (first
  person, the reticle). Every gesture still has a real button.

## Context

Since ADR 17 the visitor plays with their own hand in the room: the reticle
rests on a sphere, they hold and let go. But the stage card kept ADR 14's
row of gesture buttons (one per object, ten on Orbit) and ADR 18's row of
set icons, all as bare icons. Looking at the deployed page in week 12, the
user read the panel as broken: a grid of unlabeled swatches and glyphs
beside the room, doing the same things the room does, and saying nothing
about what any of them is until you hover, which a phone can't. Two
control surfaces for one action, and the one that's labeled least is the
one on screen most.

Meanwhile the room says nothing either. The reticle lights an object, but
nothing says whether it wants a hold or a click, or what it'll do.

## Decision

The room teaches the controls; the panel holds what the room can't.

- **A hint at the reticle.** When the reticle rests on something it can
  touch, a short line beside it says how and what: "Hold to throw",
  "Click to ring", "Let go to throw" while holding; "Tap" instead of
  "Click" on a touch screen. At most four words. The verb is the set
  view's own (`verb` on each of its `buttons`), so a new set brings its
  words with it. The hint is a pure function (`aimHint` in
  `public/ui-logic.js`), held by `spec/ui-logic.test.ts`.
- **The stage card is small.** It shows the title, who's playing, sound,
  the loop strip, Leave it, Undo and Start over, and one set-picker button
  that opens the set row. Nothing else is on screen.
- **The gesture buttons stay, out of sight until they're needed.** They are
  still real buttons in tab order with their accessible names, so keyboard
  and screen-reader visitors lose nothing (ADR 13). They are visually
  hidden until one has keyboard focus, when the whole row shows. Without
  WebGL there's no room to play in, so they show.
- Held by the browser check's `controls` section, at both sizes: no gesture
  button is visible on the stage view; Tab reaches one and the row becomes
  visible; the set row is closed until the picker is pressed; and aiming at
  an object shows its hint.

Turned down:

- **Keep the panel, add visible labels** (the user's option 1). It fixes
  the reading but keeps two surfaces for one action, and it spends the
  word budget on a duplicate.
- **A collapsed menu of labeled controls** (option 3). Clean, but it hides
  the place the hint would teach and still duplicates the room.
- **Drop the gesture buttons.** Keyboard and screen-reader visitors, and
  anyone without WebGL, would have no way to play.

## Consequences

- Most of the browser check's sections press gesture and set buttons. They
  now press them the way a keyboard visitor does (focus, then Enter) and
  open the set picker first; a click on a visually hidden button would
  test a path no mouse visitor has.
- A visitor who never aims at anything never sees a hint. The opening view
  faces the stage with its objects in reach of the walk, and the
  how-to-move hint already says to click and walk.
- The panel no longer explains the set; the room and the hint do. If people
  at the showcase still can't find what to do, that's evidence against
  this decision, to be recorded here.
