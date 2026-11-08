# 38. One look for the whole site: the arena joins the gallery

- **Status:** accepted, week 12 (9 Nov). Replaces the arena's night-garden
  look (`4fd7f45`); the room's look (ADR 33) is unchanged.
- **Decides:** how the arena page and its floor look

## Context

The arena was repainted as a night garden: blue-violet mist, fireflies,
lavender type in a sans-serif. The rooms kept the warm gallery they were
built with: a dim warm page, an oak floor under soft light, cream type in
a serif, gold for what's kept. Playing, the student found the rooms looked
good and the arena looked like another site: going from one to the other
was a change of place, not a change of room.

## Decision

- **The arena is a gallery floor seen from above,** in the room's palette:
  dark oak boards in a dim hall, pools of warm light from above, deepest at
  the walls, a darker skirting at the rim. Nothing on the floor moves.
- **The vault is a lit brass inlay** in the boards: still solid gold,
  because gold means kept (CLAUDE.md), with its light spilling onto the
  floor round it.
- **The page uses the room's tokens:** the warm dark page, cream type,
  the serif, gold accent. Your slot's colour still washes the page faintly.
- **Robots keep their four pastel slot colours,** which read on dark oak.
  Artifacts are unchanged: the same ones stand in rooms.
- At risk stays amber and dashed; kept stays solid gold.

## Consequences

- One look across the site: the arena, the rooms list and every room.
- `browser-check` reads the shots at 1440x900 and 390x844 as before; the
  budget of words and controls is untouched.
