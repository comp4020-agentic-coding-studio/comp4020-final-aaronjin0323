# 39. A door between the arena and your room

- **Status:** accepted, week 12 (9 Nov). Builds on ADR 37 (the ways out of a
  room) and ADR 38 (one gallery). The buttons stay.
- **Decides:** how you move between the arena and the rooms without a button

## Context

Movement is the only voice in the arena (CLAUDE.md), but leaving it was a
button. The student asked for a way to cross between the arena and the
rooms that isn't one. The two places move differently: in the arena you
launch and coast to a stop; in a room you walk where you tap or steer.

## Decision

- **A door, at the middle of the arena's top wall.** Come to rest in it and
  you go to your own room. Each place keeps its own movement; the door is
  just somewhere to aim for.
- **Only a robot's own launch can stop it in the door.** A robot coasting
  through doesn't go in, and nor does one knocked into it: after a contact
  it must launch again first. The server decides, as it decides banking.
- **The door opens only to a robot carrying nothing.** Loaded, it's dark,
  and resting in it does nothing: bank first, then go and show it. Nobody
  walks out and loses their cargo to the grace.
- **While you aim, the door lights when your path would stop in it,** as
  the path already shows where you'd stop.
- **In a room, the door is its front corner,** where everyone arrives. Walk
  into it, by tap or keys, and you go back to the arena, from your room or
  anyone's. You arrive standing in it, so arriving never sends you back.
- **Coming back within the grace,** your robot is still at rest in the
  arena's door; only coming to rest sends you through, so you stay.
- Nothing spawns or scatters into the door.
- The ← Arena and Room buttons stay, for keyboards, screen readers and
  anyone who'd rather press.

## Consequences

- `GET /events` carries `exits`: the tags that came to rest in the door on
  this step. A page whose tag is there goes to `/room/`.
- `spec/arena.test.ts` holds the rule: resting in the door empty sends you,
  coasting through, being knocked in or carrying doesn't.
- `browser-check` launches a robot into the door and walks one out of a
  room.
