# 15. Orbit: pieces that affect each other, placed by hand

- **Status:** accepted, week 11, as a reversible prototype
- **Decides:** a fourth recipe, made by dragging pieces rather than moving
  sliders, and how a visitor reaches it

## Context

Collaboration on the workbench was real but hard to see. Each visitor took
a part and moved its sliders, and a part's lease meant two people never
touched the same numbers. Nothing anyone did changed what anyone else's
part did. So the reason to make something together was never visible: two
people side by side, each adjusting their own controls.

A playtest proposal asked for the opposite: pick up a piece, drop it on
the sculpture, and see it react to the pieces already there. When someone
else changes one piece, yours responds and you respond back. Its full
version (ribbon, glass, spheres, colour through glass) is several weeks.
The smallest version that shows the idea is a ribbon and spheres: a
sphere dropped near the ribbon follows its path, and anyone reshaping the
ribbon changes that motion straight away.

## Decision

A fourth recipe, **Orbit**, in `public/recipes.js`, held by the same
rules as the other three: bounded numbers, server-checked edits, a lease
per part, credit per part, publishing as an exhibit version.

- **Five parts:** a ribbon (loops, twist, reach, colour, tilt) and four
  spheres. Each sphere has `placed` (0 on the shelf, 1 on the sculpture),
  where it was dropped (`angle`, `height`, `distance` from the ribbon's
  centre), a size and a colour.
- **A connection is a rule, not a stored link.** `public/orbit.js` is the
  one copy. A placed sphere within `CATCH` of the ribbon's path is
  **caught**: it rides the path from the point nearest where it was
  dropped. A placed sphere further away rests where it was dropped.
  Because the rule reads the ribbon's numbers at draw time, a change to the
  ribbon by anyone moves every caught sphere on every screen, with no
  write from the sphere's owner. Animation stays derived from saved
  numbers and the shared clock.
- **Visible cause and effect.** A caught sphere glows in its colour, a
  short line joins it to the ribbon, and the stretch of ribbon it rides
  lights up. A sphere being dragged shows the same glow the moment it
  would be caught, before it's dropped.
- **Direct manipulation.** Spheres wait on a shelf beside the bench; drag
  one onto the sculpture to place it, drag it again to move it, drag it
  off to put it back. Dragging the ribbon up or down changes its loops,
  sideways its reach. Each drag takes the part's lease and sends edits as
  a slider does (at most every 100 ms, always on release).
- **Undo** steps back this visitor's own last edit on this draft. It
  sends the part's previous numbers as an ordinary edit, so it's credited,
  leased and broadcast like any other. It never undoes someone else.
- **The main experience hides sliders, history and archives.** On an
  Orbit draft the editor shows the pieces, Undo and Exhibit. The sliders
  sit in a closed "Fine-tune" disclosure. The storeroom and archive
  drawers are hidden while an Orbit draft is open.
- **Every drag has a button.** Each sphere has "Place"/"Return" and
  "Move along" buttons, and the ribbon has "More loops", "Fewer loops",
  "Wider" and "Narrower". They're real buttons in tab order, each an
  ordinary edit.
- **Reached by choice, never imposed.** Orbit is the first starter on an
  empty bench, and the bench card offers "Play" to start one. If the
  bench holds something, Play asks first, then archives it (recoverable,
  as every replace is). No migration touches the live bench.

## Turned down

- **A new data model of pieces and links.** It would need new tables,
  routes and tests, and couldn't be reversed by removing one recipe.
- **Glass that recolours what passes behind it.** It's the next step if
  the ribbon and spheres work. It needs a second rule and a second kind of
  connection. Left out to keep the prototype to one rule.
- **Undo for everyone (a shared history).** Undoing someone else's work
  is the fight leases exist to prevent.

## Consequences

- The "three recipes" rule becomes four. The recipe test holds Orbit's
  shape.
- **Reversing it** means removing `orbit` from `RECIPES`, its builder and
  `public/orbit.js`, and the Play button. Exhibits already published as
  Orbit would then draw as empty groups (the builder's rule for unknown
  recipes) but stay in the database with their history.
- Checked by `spec/orbit.test.ts` (the catch rule, and a ribbon change
  moving a caught sphere) and the browser check's `orbit` section: a drag
  places a sphere; a second visitor's ribbon change moves it on the first
  visitor's screen; Undo; the keyboard path; sliders, history and drawers
  are out of sight.
