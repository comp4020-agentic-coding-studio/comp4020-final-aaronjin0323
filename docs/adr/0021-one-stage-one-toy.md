# 21. One stage, one toy, played directly

- **Status:** accepted, week 12
- **Decides:** what visitors play, how they touch it, and what they can
  leave behind

## Context

The Goal asks for short co-present play with feedback the moment you act,
nothing to read first, and work that's credited and recoverable. Two
weeks remain. The rebuild (ADR 20) starts with no decisions but the Goal.

## Decision

- **One toy, the Upside-down Fountain**: four balls that fall up into a
  glass dome, and a bell. Few objects, each with an obvious touch (flick a
  ball, ring the bell), and they set each other off (a ball rings the
  bell, the bell scatters the balls), so two people's gestures collide.
- **Direct touch with an orbit camera.** You press the thing you see. The
  camera turns by dragging empty space.
- **A shared 20 s loop of gestures, replayed by a deterministic rule.**
  Everyone sees the same performance at the same moment, a gesture is the
  only write, and a performance is small enough to keep every version of.
- **Plinths hold versions.** Leaving, joining in, restoring and the
  storeroom make playing safe: nothing anyone made is lost.
- **Others' pointers in the room**, so you can see someone reaching for the
  ball you're about to flick.
- **Every action is a labelled button too**, so the panel never reads as a
  grid of mystery icons, and keyboard visitors can play.

Turned down:

- **Several toys to choose from.** More to build and test in two weeks,
  and a choice to make before playing.
- **First-person walking.** More controls to learn before the first touch.
- **Free-form recording (positions per frame).** Large, and two screens
  would drift; a rule over gestures is small and identical everywhere.
- **Icons without words.** Shorter, but a newcomer can't tell what they do.

## Consequences

- The fun depends on one toy's tuning; the numbers live in one place in
  `public/fountain.js`.
- The same rules run on server and page, so the arithmetic must round the
  same in every engine (+ − × ÷ and `Math.sqrt` only).
