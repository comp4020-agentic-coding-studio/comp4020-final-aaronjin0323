# 23. See the aim before a flick, and whose ball hit whose after

- **Status:** accepted, week 12
- **Decides:** what one visitor sees of another's play, before a gesture
  and after it

## Context

The fountain already lets gestures collide: balls knock each other and
ring the bell (ADR 21). Playing it with two windows open showed that the
collisions don't read as people playing together. A ball leaps with no
warning, so there's nothing to read and no moment to cut in; and once
balls are knocking about, nobody can tell whose flick caused what. The
Goal's fun is "reading each other's gestures, playing along, cutting in",
and "the same performance carries different stories". Neither shows.

## Decision

- **Aim is live.** While a visitor drags a ball, everyone else sees a
  line in that visitor's colour from the ball, the way it will go, and a
  halo round the ball they hold. It rides on the pointer, in memory only
  like the pointer, and is never part of a performance.
- **A ball carries who last moved it.** A flick makes a ball yours; a
  ring makes every ball it pushes the ringer's; a ball that knocks another
  passes its mover on. For a moment after, the ball trails and glows in
  that visitor's colour, so a chain reads in colour across the dome. It
  is part of the rule in `public/fountain.js`, worked out from the
  gestures alone, so every screen and every plinth tells the same story.
- **The story in words.** The stage card says the latest chain ("Rosy
  Wren flicked coral; coral knocked Copper Ibis's teal; teal rang the
  bell"), so it reads without the room too.

Turned down:

- **A predicted path for the aim.** Clearer about where a ball will go,
  but it gives away the surprise and costs a simulation per pointer
  update; the line says enough to react to.
- **Showing aim as a stored gesture.** It would put half-made gestures in
  the loop and the database; aim is presence, like the pointer.
- **Moments done together (two gestures at once glow), and a sound per
  visitor.** Both fit, and they wait until these two have been played
  with.

## Consequences

- Credit changes no physics: the numbers every screen computes are the
  same as before, so performances already on plinths look the same and
  now tell their story too.
- A ring caused by a ball is now credited to a visitor, not the ball: the
  event's `by` is who moved it, and `ball` says which ball.
- The pointer route takes a little more, checked as strictly as a
  gesture: a flick's ball and speed, nothing else.
