# 36. Rooms are shared: visitors see each other walk, in real time

- **Status:** accepted, week 12 (9 Nov). Extends ADR 31 (exhibition rooms)
  and ADR 33 (the walkable room). Keeps every rule about who may change a room.
- **Decides:** who you see in a room, and how their walking reaches you

## Context

The student pointed out that exhibition rooms are a shared space too: people
in the same room should see each other in real time. Until now two visitors
in one room each walked alone. The arena already makes strangers visible to
each other within a second; the rooms now do the same.

## Decision

- **Everyone in a room sees everyone else in it, walking, within about a
  second.** Each open room page joins that room's presence with its own
  stream, `GET /rooms/:tag/live`, and is shown as a robot walking or sitting
  where its visitor is. Closing the page, or losing the stream, takes the
  robot out for everyone.
- **A walker is cosmetic and ephemeral.** Positions live in server memory
  only, are never stored, and change nothing in the room. A restart empties
  every room's presence; each page rejoins on its own when its stream comes
  back.
- **Your walk is sent, not decided:** `POST /rooms/:tag/walk` with where you
  are, which way you face, and whether you're moving or sitting. The server
  checks the shape (inside the room, a known seat) and that you're in that
  room, then passes it to everyone there. Collisions with furniture stay on
  each page, as they were.
- **Movement is still the only voice.** Walkers carry a tag and nothing else:
  no names, no chat. A visitor's colour comes from their tag, so it stays the
  same in every room; yours keeps its white ring.
- **A room shows at most `PRESENCE_MAX` walkers** (12). Beyond that, a page
  still watches the room and the others, but isn't shown.
- **One visitor, one walker,** however many tabs they have open in that room;
  the last update wins.
- **When the owner saves, everyone in the room sees the new layout** without
  reloading.

## Consequences

- The room page now holds a stream, like the arena, and reconnects the same
  way: refused, it tries again, 1 s doubling to 15 s.
- The server's presence is a plain module (`src/presence.ts`) with unit tests;
  the routes are covered in `spec/http.test.ts`, and two browsers in one room
  in `browser-check`'s `visitors` section.
- Persistence is unchanged: what persists is still the room, never who was in
  it.
