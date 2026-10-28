# 26. Playing together in the hall: collisions, knocks and fair zones

- **Status:** accepted, week 12
- **Decides:** how robots meet, when a hit knocks an artifact loose and
  whose, the protections after a knock, the zones' fairness, and looking
  at other players' displays

## Context

The student asked (27 Oct) for shared play in the hall: everyone moving
in one hall, every change reaching other sessions within about a second,
exactly one winner when two reach the same artifact, and collision-based
competition: only a clear high-speed impact knocks one carried artifact
loose, with consistent server-side rules, a short pickup delay and drop
protection, visibly. Nobody eliminated, everyone equal; deposited
collections untouchable; zones visible and not blockable or campable;
real displays to inspect; no fabricated players; solo play whole.

Robots passed through each other (ADR 24), and the server walked each
robot alone. Colliding needs every robot stepped together.

## Decision

- **One clock for every robot.** Snapshot times sit on a shared 20 ms
  grid: a launch takes effect at the server's current step, and the tick
  steps every robot together, step by step. The rule stays the one in
  `public/hall.js`.
- **Robots bounce off each other** as equal masses, keeping 80% of their
  closing speed. The server sends both new snapshots at once; every
  screen eases from where it showed each robot to the new path, so a
  correction never jumps.
- **A knock**, decided by the server on the step of the hit:
  - the closing speed along the line between centres is at least
    `KNOCK_SPEED` (4.5 m/s, a solid launch; full power is 8);
  - the **struck** robot is the one moving less towards the other along
    that line, by at least `KNOCK_CLEAR` (0.5 m/s); if neither clearly
    is, it's a draw and nothing drops;
  - the struck robot drops **one** carried artifact, its newest, just
    beyond it on the far side from the striker (inside the walls, out of
    every zone);
  - it doesn't drop if it carries nothing, if it's protected, or if it's
    within `SAFE_R` of its own zone.
  The striker never drops anything for hitting.
- **A dropped artifact can't be picked up for `PICKUP_DELAY_MS` (1 s)**,
  by anyone; it shows faded with a ring filling until ready.
- **A robot that dropped one is protected for `DROP_PROTECT_MS` (3 s)**:
  it can't be knocked again. It shows a shield ring that fades; no
  numbers counting down.
- **Zones are fair:** every zone is drawn, yours solid in your colour,
  other players' in theirs; a zone that isn't yours is solid to your
  robot, part of the shared rule, so nobody can sit in it; and nothing
  is knocked loose near its owner's zone (`SAFE_R`), so waiting by an
  entrance wins nothing.
- **Deposited is final.** The store's trigger now allows carried →
  available (a knock) and still nothing out of `deposited`.
- **Displays are public, read-only.** Each robot's snapshot carries its
  owner's display (kinds and counts from their real deliveries); "Here
  now" lists each player present with a button to look at theirs.
- **Nothing invented.** Only people with the hall open appear. Alone, the
  hall plays exactly as before.

Turned down:

- **Knocks by any touch.** Gentle bumps taking cargo would make play
  feel like theft and reward crowding.
- **Dropping everything carried.** One per hit keeps a hit meaningful
  without wiping a run.
- **The striker as the one that drops** in a head-on hit. Drawing it as
  a tie is clearer and equal.
- **Numeric protection timers on screen.** The brief rules out
  countdowns; a fading ring says the same.
- **Client-predicted collisions.** The server's snapshot arrives within
  a tick and the screen eases to it; predicting other people's robots
  would make them jump when wrong.

## Consequences

- Migration 3 adds `ready_at` and replaces the one-way trigger; the file
  is copied first (ADR 25).
- A launch can be up to 20 ms later than pressed; nobody can feel it.
- Two players both reaching an artifact on the same step: robots are
  checked in a fixed order and the store's conditional update lets
  exactly one carry it.
