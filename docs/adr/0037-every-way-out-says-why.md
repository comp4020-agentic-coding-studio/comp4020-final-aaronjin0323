# 37. Every way out of a room says why, and your room is always one tap away

- **Status:** accepted, week 12 (9 Nov). Amends ADR 35's "a visit is the
  room, and at most two ways out": still two, but which two, and what they
  say, change. Builds on ADR 36 (shared rooms).
- **Decides:** the room page's header, and how a collection shows rarity

## Context

Trying the shared rooms, the student found three problems. From someone
else's room there was no way back to their own, the room they reach from the
arena's Room button. The header's "← Arena" and "Rooms" links gave no reason
to press them. And in their collection every card looked the same, so a
mythic artifact read like a common one.

## Decision

- **The header holds two buttons, and each carries its reason.**
  - In your own room: **Play**, to the arena, with how many are playing now;
    and **Visit rooms**, to the list of rooms, with how many people are in
    rooms now.
  - In anyone else's room: **Your room**, back to the one you decorate, in
    your colour and with a count when something new is waiting to go on
    show; and **Play**. The list of rooms stays below the room.
- **Each room in the list says how many are in it now.** Who's there is a
  reason to visit (ADR 36).
- **The live counts come with the list,** in `GET /rooms`: `playing`, the
  robots in the arena, and each entry's `here`. Counts only: never who.
- **A collection shows rarity at a glance.** Cards are sorted rarest first,
  and each card is drawn in its material: tin plain, glass cool, gold warm,
  starlight a night sky, with its rarity as a label. Rarity was already a
  halo on the floor; now the card says it too.

## Consequences

- `browser-check` checks a visitor can get back to their own room in one
  tap, and the `budget` section still holds the room page to its words and
  controls.
- `spec/http.test.ts` checks the counts in `GET /rooms`.
