# 4. The room's goal is to raise landmarks, and neighbours can wave

- **Status:** accepted, crit 10 (week 11)
- **Decides:** what players are working toward, and what they can do besides
  claim

## Context

Playing it showed the game was a single action: you claim a tile, then wait
while others do the same. Heights moved, but nothing said what a good board
looked like, so there was no reason to move once settled, and nothing to do
with the strangers you'd settled beside. A game for a room needs a goal the
room can see moving, and something to do with the people next to you.

## Decision

**The goal is landmarks.** A tower becomes a landmark the moment it reaches
height 8: all 8 neighbours held by people who are around (faded tiles lift
nobody, ADR 3). It takes nine people, so nobody can do it alone, and every
empty or faded spot around a nearly finished tower is a reason to move.

- **A landmark is permanent.** It's recorded when it's raised (a new
  `landmarks` table, by migration: cell, holder's label, the eight neighbour
  labels, time) and stays raised even after people leave. The room's score
  only goes up.
- **It's announced to everyone, briefly.** Every open page celebrates it and
  names the nine people who raised it. That's the one room-wide message the
  game sends; everything else is still narrated only for your own tile.
- **The room can see what's next.** The page shows how many landmarks the
  room has raised and the closest tower to its next one ("Mia's tower, 6 of
  8"). The tiles that would bring a tower closer glow, and the preview and
  inspector say so ("settling here brings Mia's tower to 7 of 8").
- **A landmark changes nothing about ownership.** Its holder may move, and
  their tile can fade and be settled like any other. The landmark is a mark
  on the spot, shown as a crown, not a lock on the tile.

**Neighbours can wave.** Selecting a neighbour's tower offers a Wave
button. The neighbour sees a small hand on your tile and a short message
("Kai waved"), and can wave back.

- **Only neighbours, only people.** You can wave only at a tile next to
  yours, held by someone, while you hold a tile. The server checks this.
- **No text.** A wave carries nothing a person typed, so it can't become
  chat (README: left out).
- **Rate-limited and never stored.** One wave per pair every 10 seconds; a
  wave is pushed to the two people involved and then forgotten.
- **Without JavaScript,** waving isn't offered. It's a live gesture, and the
  game is still fully playable without it.

## Options considered

1. **A shared floor count, with milestones.** The simplest goal, but it
   rises from any claim anywhere, so it gives no reason to move.
2. **Timed blueprints** (fill a shape before the clock runs out). A fresh
   target each round, but a clock and rounds add a second system for the
   room to learn.
3. **Two competing districts.** Clear stakes, but it turns strangers into
   rivals, which is the opposite of the hook.
4. **Landmarks (chosen).** The goal is the hook made explicit: standing
   beside strangers, fully. It's local enough that you can see which move
   helps, and it needs cooperation by definition.

For interaction, a "room here" invite marker and a cooldown on moving were
also offered. They were left out for now: waving is the lightest contact
between neighbours that isn't chat.

## Consequences

- **A full landmark needs nine people around at once.** A small crit pod
  may never raise one; the "closest tower" line keeps the goal visible
  anyway, and the showcase is where it's meant to happen.
- **Landmarks are the first state that isn't derived from the board.** They
  can't be recomputed from tiles, because the people who raised one may have
  left. That's why they're stored, not derived like heights.
- **Waves add a POST route** (`/wave`), checked like `/claim`: same-origin
  only, the waver's `pid`, a rate limit. ADR 2's table gains a row for it.

## How it's held

- Store tests: a tower reaching 8 records exactly one landmark; reaching 8
  again later doesn't record a second; faded neighbours don't count toward
  it; the migration upgrades a crit-10 database with no claim lost.
- HTTP and realtime tests: every open stream is told a landmark was raised;
  a wave reaches only the person waved at; waving at a non-neighbour, at a
  free tile, or without a tile is refused; a second wave within 10 seconds
  is refused.
- `spec/diff.test.ts`: "closest tower" and the glowing helpful tiles agree
  with the server's heights.
