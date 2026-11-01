# 32. One journey: grab, deliver, exhibit

- **Status:** accepted, week 12 (2 Nov).
- **Decides:** how the arena, vault, collection and room read as one path,
  how risk is shown, how a newcomer learns, and how it works on a phone

## Context

The student asked to connect the arena, delivery point, collection and room
into a clear journey; to show aiming, cargo, weight, collisions, scattering,
readiness and delivery clearly; to distinguish vulnerable cargo from
permanent artifacts; to work on desktop and mobile; and to give concise
first-time guidance, checked in the rendered interface.

## Decision

- **Three steps, always visible:** grab, deliver, exhibit, with the current
  one marked, worked out from what the server says you hold.
- **Two visual languages.** At risk is amber and dashed, everywhere: on the
  robot and in the tray. Kept for good is solid gold, everywhere: the
  collection, and the room. Colour is never the only signal; words and line
  style say it too.
- **Weight is a number and a meter:** your top speed now, as a share of
  empty.
- **Guidance is one line at a time, in context,** on the arena: what to do
  next, gone once done. No modal. A first launch is remembered in the
  browser; a collection means you've learned.
- **Words about you are allowed; words about others still aren't.** "You
  dropped 3" keeps ADR 28's silence.
- **Deliveries are events,** sent to every page once, so a burst plays at the
  vault for all, and only the deliverer gets the message.
- **The room asks for what's waiting:** how many of yours aren't on show.
- **Phones get a pull pad under the arena,** so a thumb never hides the
  action; a press on the arena still works. Landscape puts the panel beside
  the arena.

## Costs

- The tray and coach take space from the arena on small screens.
- The first-launch flag lives in the browser, so clearing it replays one line.
