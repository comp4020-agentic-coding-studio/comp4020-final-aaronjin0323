# 29. Every contact scatters both players' cargo

- **Status:** accepted, week 12 (2 Nov). Supersedes ADR 28's knock, striker
  and shield.
- **Decides:** what a contact does to cargo, and when scattered artifacts
  can be taken

## Context

The student asked that every player-to-player contact scatter both
players' entire cargo, whatever the speed and whoever started it. The
artifacts scatter outward and become collectible after briefly settling,
and anyone, their previous owner included, can reclaim them. Delivery is
one shared point, reached by carrying, and deposits are permanent. Outcomes
must agree across clients.

## Decision

- **A contact is any step on which two robots overlap and are closing.**
  There is no speed threshold, no striker and no shield.
- **Both lose everything,** so hitting someone while loaded costs you too.
  An empty robot risks nothing, which makes it the natural hunter.
- **Artifacts fan out away from the other robot,** to landing spots the
  server chooses on that step. They're on the floor from then on, and
  nobody can take them for `SETTLE_MS`, their previous owner included.
- **Delivery stays the one vault,** by moving in it. On a single step
  contacts come before touches, so a contact in the vault scatters
  before banking. Banked artifacts are untouched by a contact.
- **Consistency:** only the server decides. Pages receive the same landing
  spots, and animate from the contact to the spot during the settle.

## Costs

- A slow graze can wipe out a full load, so a robot with nothing has no
  reason to avoid anyone, and carrying a big load across a busy arena may
  rarely pay. Playtests should say whether that's chaos or just cruelty.
- With no shield or speed threshold there's no "clean hit" skill left, by
  request.
