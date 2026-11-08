# 40. A bigger floor

- **Status:** accepted, week 12 (9 Nov). Builds on ADR 39 (the door).
- **Decides:** the arena's size

## Context

With the door added to the top wall (ADR 39), the student found the arena
too small for both the vault and the door: the door sat close above the
vault, and the floor between them, where most of the chasing happens, felt
cramped.

## Decision

- **The floor grows by a quarter, from 16 by 10 metres to 20 by 12.5,** the
  same shape, so the page's layout is unchanged.
- **Everything with a size keeps it:** robots, artifacts, the vault and the
  door are as big as they were in metres, so on screen they are smaller and
  the floor round them is wider.
- The starting spots stay 1.5 m from their corners; the spawn spots follow
  the floor, as they always have.
- Launch speed, friction and load are unchanged: crossing the floor takes a
  little longer, and that is the room we wanted.

## Consequences

- `ARENA` in `public/arena.js` is the one number changed, with `SPAWNS`
  derived from it.
- The spec, `session-check` and `browser-check` run unchanged, all relative
  to the floor's size.
