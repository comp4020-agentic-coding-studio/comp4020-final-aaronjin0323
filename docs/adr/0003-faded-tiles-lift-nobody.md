# 3. A tile fades after a day away: it stands, lifts nobody, and anyone may settle there

- **Status:** accepted, crit 10 (week 11). Replaces ADR 1, which is
  dropped: it kept faded tiles counting toward their neighbours' heights.
- **Decides:** what happens to someone's tile when they leave

## Context

Skyline's board has 144 tiles and everyone holds one. The README says the
game is good when the people in the room matter to each other. Real-time
makes the tension sharp: the board shows who is here *right now*, yet a
tile alone can't say whether its holder is.

Two audiences pull in different directions:

- **The showcase** brings a room of strangers, possibly more than 144 over
  two hours, plus every tile left behind by testing, crits and marking. If
  tiles are permanent, latecomers find a full board of people who went home.
- **Markers** use the app, close it, and come back the next day expecting
  their claim to be there.

ADR 1 settled the first half of this at crit 9: a tile fades after a day
and becomes open. It also kept faded tiles counting toward heights, so the
skyline wouldn't drop when people went home. That half is reversed here.

## Options considered

1. **Permanent.** A tile is yours until you move. It fails the showcase:
   the board fills with absent people, and the heights everyone sees are
   set by people who left.
2. **Lease expires.** After a day the tile is freed and vanishes. It erases
   people: a marker returning the next day finds nothing, not even a sign
   they were there.
3. **Faded, open, and still counted (ADR 1).** The skyline holds when
   people leave. But a tower then stands on the support of people who
   aren't there, so the board overstates the room, and settling beside a
   faded tile looks as rewarding as settling beside a person.
4. **Faded, open, and lifting nobody (chosen).** After 24 hours with no
   visit the tile fades to grey and stays where it is, still yours, until
   someone new settles there. While faded it adds nothing to its
   neighbours' heights.

## Decision

Option 4, with a 24-hour threshold measured on the server's clock.

- **Heights count only people who are around.** A tile's height is the
  number of its 8 neighbours that are claimed and not faded. A faded tile
  keeps its own height, from its active neighbours, so the room can still
  see where it stood.
- **Fading and waking move the skyline.** When a tile fades its neighbours
  drop, and every open page sees it at the next minute's sweep. When its
  holder returns, or a newcomer settles there, they rise again.
- **A faded tile is open.** Anyone may settle on it. Its holder is told
  once, on their next visit: "Your tile went quiet after a day away, and
  someone else settled there." A rule that takes something from you has to
  be readable off the screen (README commitment 4).
- **Time is computed when read, never stored,** so a tile that passes 24
  hours while the server is stopped is faded on the first request after
  it starts.

## Why

The hook is that standing beside someone lifts you both. A tower held up by
people who went home is a record of the past, not the room. Letting faded
tiles lift nobody keeps the skyline an honest picture of who is here, and
makes a faded tile what it should be: a space waiting for someone.

## Consequences

- **The skyline drops when people leave,** for everyone beside them, a day
  after they go. That is the rule working: it is what makes returning, or
  settling in a quiet spot, matter.
- **Someone away for more than a day may find their tile taken,** including
  a marker who returns just after 24 hours, if someone settled there in
  between. Three days was considered; 24 hours frees the board before the
  showcase rather than after it.
- **An open page counts as a visit,** refreshed once a minute, so nobody
  who is playing ever fades.
- **On deploy, old tiles fade at once.** Tiles last seen over a day ago
  stop lifting their neighbours the moment this ships.

## How it's held

- `spec/store.test.ts` moves a fake clock 25 hours forward: a tile is safe
  at 23:59:59, open after 24 hours, woken by a visit, and its holder is told
  once only.
- Height tests over `heights(tiles, now)` cover corners, edges and the
  interior, a faded neighbour that doesn't count, and waking restoring the
  height.
- `spec/diff.test.ts` checks the page's placement preview against the
  server's `heights` on random boards with faded tiles in them.
