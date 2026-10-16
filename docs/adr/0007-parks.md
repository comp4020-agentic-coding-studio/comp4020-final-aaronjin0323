# 7. Parks: a public good you place for your neighbours

- **Status:** accepted, week 12. Amends ADR 5 (what counts as an occupied
  neighbour) and ADR 6 (gold needs three people).
- **Decides:** what a second, temporary thing on the board is, who it helps,
  and how it ends

## Context

With two or three players Skyline is still mostly waiting. Each person holds
one building, so a room of three has three buildings and at most two
neighbours each: nobody passes bronze (ADR 6), and the only thing to do with
coins after an upgrade or two is renew. The game needs a way for a small
room to fill the gaps round each other's towers, spending coins on someone
else, without giving up "one tile per person" (ADR 2), which is what makes
where you stand matter.

## Decision

**A park is a public good you place on a free plot, for everyone but you.**

- `POST /park` with `cellId`. You must hold land. It costs **60 coins**,
  lasts **2 hours** from placement, and **can't be renewed**: when it ends
  the plot is free, and anyone may place another there. **At most 2 active
  parks per player.** Same-origin, `pid` only, JSON or form (a form gets a
  `303` and a notice, as `/claim` does). Refusals: `402` coins, `409` the
  plot isn't free (a building or a park stands there), `400` no land, park
  limit or bad input. One `BEGIN IMMEDIATE` transaction that settles first.
- **A park counts as an occupied neighbour for every building except its
  placer's own**: for height, for the +20% income bonus and for landmark
  tiers. So a park beside a stranger lifts them, and parking beside your own
  building does nothing for you. That's the point: the only way a park pays
  you is through the neighbour it helps (who may help you back).
- **A park earns nothing and blocks building on its plot while it lasts.** A
  claim or move onto it is `409`, the same as a held tile.
- **A park ends on the clock, like a lease** (ADR 5). An ended park is gone
  on every read, whether or not the sweep has deleted it; the sweep deletes
  ended rows, writes a city-log line, logs and broadcasts. A park's start and
  end are cut points in income integration, exactly as a lease end is: no
  building is paid a park's bonus for a minute it wasn't there.
- **Gold needs three people** (amending ADR 6): at least 3 distinct people
  among the building's holder, its occupied neighbours' holders and the
  placers of the parks counted round it. Bronze and silver need no such
  rule. With today's limits it can't bind (each other person adds at most a
  building and 2 parks, so 8 neighbours already takes 3 other people), so
  it is a stated floor that keeps gold "ringed by a room" if the limits ever
  change, not a rule a player meets in play.
- **The payload:** a park tile has `state: "park"`, the placer's label, when
  it ends (`endsAt`), and `mine: true` only on your own; never a `pid`.
  Buildings' `neighbours`, `height` and `rate` include the parks that count
  for them. Your `me` gains `parks` (your active count) and `parkLimit`.
- **The log:** `park who=<tag> at=<cell> label="…"` when placed,
  `park.end at=<cell> who=<tag> label="…" dropped=…` when it ends. Never a
  `pid`.
- **Numbers live in `src/economy.ts`** (`PARK_COST`, `PARK_MS`,
  `PARK_LIMIT`, `GOLD_PEOPLE`) and the `ECONOMY` mirror in `public/diff.js`.

**Migration 6** adds `parks (cell_id INTEGER PRIMARY KEY, placed_by TEXT NOT
NULL, label TEXT, placed_at TEXT NOT NULL, ends_at TEXT NOT NULL)`. Nothing
to backfill, and the `one_tile_each` index on `cells` is untouched: a park
is not a tile anyone holds.

## Options considered

1. **Let a player hold several plots.** The obvious way to fill gaps.
   Turned down: it breaks the `one_tile_each` index that ADR 2 relies on as a
   backstop, every `mineOf(pid)` in the store would become a list, ADR 2's
   table ("change only the one row your `pid` holds") would need rewriting,
   and a lone player could ring their own building with their own plots and
   farm the bonus with nobody else in the room. That's the opposite of the
   hook.
2. **Parks that also count for their placer.** Simpler to explain, but a
   player could buy their own +20% twice over and the park stops being
   something you give. Turned down for the same self-farming reason.
3. **Renewable or permanent parks.** Would let a rich player freeze a plot
   for good. Turned down: land has to keep coming back to the room (ADR 5);
   a 2-hour park that simply ends needs no extra rules.
4. **A placeable, temporary, self-excluded public good (chosen).** Keeps
   one building per person, gives coins a social use, and gives a room of
   two a bronze (one neighbour plus their two parks round your building) and
   a room of three a silver.

## Consequences

- **Two people can raise bronze; three can raise silver.** Gold still needs
  at least four people, as before.
- **Income integration gains cut points** at every park start and end in an
  interval. `integrate()` takes the parks alongside the buildings.
- **Without JavaScript** a park can be placed by a form post, but the page
  offers the button only with script, like Help.
- **The page's preview stays exact without knowing who placed a park:** it
  starts from the server's per-building `neighbours` and changes only the
  buildings beside the plot you'd take or leave; for your own new building
  it counts parks that aren't `mine`.

## How it's held

- Store tests over an injected clock: cost, the 2-park limit, 2-hour end,
  no renewal, refusals in order; a park counts for neighbours and never its
  placer; income across a park's end, a park placed mid-interval, and own
  park exclusion, to the cent; ended parks gone on read before any sweep;
  claims onto a park refused; gold needs three people; tiers count parks.
- A migration test from a version-5 database; `user_version` is 6.
- HTTP: `spec/access.test.ts` (10 concurrent parks by one person leave at
  most 2; no `pid` in a park's view; no park on a held tile) and the log
  line.
- `spec/diff.test.ts`: the preview equals the server's heights and income on
  random boards with parks (mine, others', ended); the mirror equals
  `src/economy.ts`.
