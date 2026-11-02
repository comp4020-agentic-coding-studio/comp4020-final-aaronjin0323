# 35. Say less: each screen shows its one next thing

- **Status:** accepted, week 12 (2 Nov). Replaces ADR 32's always-visible
  steps, tray and speed meter, and ADR 34's ten tabs, always-on palette, arrow
  buttons and Save, Discard and Done. Keeps every game rule, the art, and
  ADR 34's mechanics.
- **Decides:** what each screen shows, and how much

## Context

The student found too much text and too many buttons: people would feel lost.
Screenshots agreed. A newcomer's first arena screen named a journey, a tray, a
speed, a collection, a catalog, a vault count and a cookie, with five links to
one room, before they had moved. The editor showed ten tabs, fifteen colours
and eleven buttons at once. Each piece had been added to explain something, so
words had become the way the app teaches.

## Decision

- **The world does the teaching.** The game shows the next thing on the arena
  itself: a hand drawing back from your robot, then a ring on the nearest
  artifact, then the vault lit up. Three words at most beside it, gone once
  learned. A carrying robot's vault stays lit for everyone who holds cargo.
- **The arena page is the game.** The arena fills it, with one way out: a Room
  button carrying your count, which glows when something isn't on show. A
  small "?" holds the rules, the keys and the about link. Cargo shows behind
  your robot, and its weight shows in how it flies and in the aim line, so
  tray, meter and steps go.
- **Your collection and catalog move to the room,** where they're used.
- **A visit is the room, and at most two ways out.** Decorate floats on the
  owner's room. The walking hint goes after the first step.
- **Three tabs: Artifacts, Things, Room.** Things groups furniture under small
  headings. Room shows walls, floors and light together.
- **Controls appear when they apply.** Nothing selected, no tools. Selected:
  Turn, Colour and Remove, on the room. The palette opens from Colour, or
  under a wall or floor finish when you pick one. Drag moves; for keys,
  arrows move, Enter picks the next thing, Delete removes, Escape lets go.
- **Two ways out of decorating:** Done saves and leaves; Cancel leaves without
  saving, asking once if there are changes. Saving is still explicit: nothing
  public changes until Done. The page warns before leaving unsaved work.
- **An artifact goes where you'd expect:** on the selected stand, else the
  first empty stand, else a new plinth.
- **A close look is the artifact,** Wake it and a close button. Zoom goes.
- **The budget is enforced.** A browser check counts the words and controls in
  view on each screen and fails over budget, so this can't quietly grow back.

## Not changed

- At risk stays amber and dashed, on the robot. Kept stays gold.
- The accessible text stays: the arena's rules for screen readers, the list of
  what's on show, so nothing depends on the canvas.

## Costs

- A number for top speed is gone; the slowdown is felt, not read.
- A picture is harder to translate into understanding than a sentence, and no
  real newcomer has tried it yet.
- Rules and the cookie note now sit behind "?" or at the foot of the room, so
  fewer people will read them.
