# 12. Impossible Museum: a shared workbench, immutable versions, per-part leases

- **Status:** accepted, week 11, after [ADR 11](0011-rebuild-after-skyline.md)
- **Decides:** what the rebuild is, how people share one sculpture without
  fighting over it, what is kept forever, and the stack

## Context

ADR 11 dropped Skyline because nothing answered you in the moment you acted
and the interesting part arrived only after minutes. The rebuild has to be
picked up in seconds by a handful of people visiting together for five to ten
minutes, some with no introduction, and still meet the brief: two or more
people in separate browsers acting on shared state, told apart, every change
on every screen within about a second, and everything surviving restarts,
redeploys and a next-day return.

## Decision

A small 3D gallery: six plinths and one shared workbench. Visitors shape a
sculpture together from one of three bounded recipes, publish it as an
exhibit version, and remix one another's exhibits. `CLAUDE.md`'s Decisions
are the rules; this records why they are those rules.

- **Bounded recipes, not free modelling.** Every sculpture is a recipe id and
  numbers in ranges. A slider answers on the frame you move it, which is the
  instant feedback Skyline lacked, and the server can check every value.
  Free mesh editing was turned down: slow to learn, impossible to validate,
  and nothing to remix but geometry.
- **One shared draft, with per-part leases.** Turned down: *last write wins*
  (two people on one slider fight invisibly, and the loser's work vanishes
  with no one to credit); *a lock on the whole draft* (one person works while
  the room watches); *operational transforms/CRDTs* (a lot of machinery for
  bounded numbers with one obvious owner at a time). A short per-part lease
  lets three people work on three parts at once, makes "someone is on this"
  visible, and frees itself on expiry or disconnect.
- **Every accepted edit is durable.** If only publishing persisted, a
  restart would silently lose shared work, and the brief's marker reloads
  the next day.
- **Versions are immutable; restore and replace only ever add.** Feeling
  free to experiment depends on nothing being lost. Editing a version in
  place was turned down: credit would follow the wrong person. Restore
  creates version N+1; replacing a slot moves the old exhibit to the
  storeroom; replacing the draft archives it first. Immutability is
  enforced by a database trigger as well as by having no route that updates
  a version, since a rule only in prose didn't hold in Skyline
  ([`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f)).
- **Coloured markers, not avatars.** Avatars invite walking around, which is
  out of scope and pulls attention off the sculpture.
- **The stack, reopened as ADR 11 asked.** The server stays bare
  `node:http` with `node:sqlite` and SSE: nothing about the museum needs
  more, and every lesson in the harness applies to it. The page moves from
  Skyline's CSS 3D to **Three.js**: glass, lighting, curves and continuous
  animation are exactly what CSS 3D can't do (Skyline's ADR said to revisit
  then). WebGL isn't accessible by itself, so every control stays in the
  DOM and the canvas is decoration over it.
- **A fresh database file** (`museum.db`) beside Skyline's on the volume,
  rather than a migration that drops Skyline's tables: nothing of Skyline is
  read, and its history isn't destroyed.

## Consequences

- The lease length and the page's send interval are guesses until measured
  with two browsers.
- One shared draft means a busy room queues on the bench. If the showcase
  shows that, the next step is more than one bench, not a weaker lease.
- Skyline's spec and source are deleted from the working tree (they remain
  in history at `372b109`); the template's two checks and the live-URL guard
  stay.
