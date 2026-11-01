# 31. Everyone gets an exhibition room

- **Status:** accepted, week 12 (2 Nov). Brings back what ADR 28 cleared as
  displays, in a richer form.
- **Decides:** what a room is, how it's saved, who may change it, and how
  people find each other's

## Context

The student asked for a personal collection page presented as a customisable
exhibition room: artifacts, display stands, furniture, walls, flooring and
decorations arranged and saved, other players' rooms to browse, a refined
exhibition look, close observation with a few simple interactions, and
editing for the owner only.

## Options

- **3D room.** Most immersive, but a second renderer and 256 MB of machine,
  with a week left and the writing unstarted.
- **A top-down plan.** Easy to edit, but looks like a diagram, not a gallery.
- **One fixed frontal view, a wall and a floor in simple perspective.**
  Chosen: it composes like a photograph of a gallery, stays editable with
  a drag, and draws on the arena's existing 2D artifacts.

## Decision

- **A room is one JSON layout:** wall, floor, light, and at most 24 items at
  fractions of the room. `public/room.js` is the one table of what can be
  placed, shared by server and page, and holds `checkLayout`.
- **Artifacts stand on stands.** An artifact is only ever on a stand, once,
  and must be banked by the room's owner; the store checks that.
- **Ownership is the cookie, with no address in the write.** `POST /room`
  takes no tag or id, so a request can only ever change its sender's own
  room. There's no route that could name someone else's.
- **Stale edits are refused** with `was`, a revision, as two tabs can differ.
- **No free text anywhere in a room.** Rooms get generated names from their
  tag ("The Amber Cabinet"). That keeps ADR 28's silence, and means nothing
  to moderate on a public site.
- **The directory lists rooms with at least one artifact on show,** newest
  change first, 12 a page by a keyset cursor. Rooms are public by address.
- **Close observation:** open any exhibited artifact to see it large, move
  a light across it, bring it closer, and wake it for a moment.
- **Every artifact stays reachable without a canvas:** the room lists what's
  on show as buttons.

## Costs

- One view means no walking through a room. It reads as a picture.
- Generated names say nothing personal, so people recognise a room by how
  it looks.
- The canvas room is less accessible than the list beside it; editing has
  keyboard moves, but they're plainer than dragging.
- A visitor's cookie is their only claim on their room.
