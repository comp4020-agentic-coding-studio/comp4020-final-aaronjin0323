# 6. Landmarks come in tiers: bronze, silver, gold on the same spot

- **Status:** accepted, week 12. Amends ADR 4 (and ADR 5's "a landmark is a
  building with all 8 neighbours occupied").
- **Decides:** what counts as a landmark, how it's recorded, and what the
  page says is next

## Context

A landmark (ADR 4) needs a building with all 8 neighbours occupied: nine
people round one spot at once. That's the showcase's goal, and it works for
a big room. Played by two or three people it's flat: the goal line never
moves, nobody is ever close, and the room's score stays at 0 however well
they play. The goal has to have steps a small room can reach, without
taking away the big one.

## Decision

**A tower earns a crown in three tiers on the same spot:** bronze at 3
occupied neighbours, silver at 5, gold at 8. Gold is exactly ADR 4's
landmark. "Occupied" is unchanged: a neighbour whose lease is running (ADR
5). The thresholds are game numbers, so they live in `src/economy.ts`
(`LANDMARK_TIERS`) and its mirror in `public/diff.js`, held equal by
`spec/diff.test.ts`.

- **Each (cell, tier) is recorded once, permanently, only counted up.** The
  same rules as ADR 4, one row per tier: `INSERT OR IGNORE` against a unique
  index on `(cell_id, tier)`. A tower that drops below a tier and reaches it
  again records nothing new.
- **Reaching a tier records every tier below it too, in the same turn.** A
  tower found already standing at 8 (at boot, or after a burst of changes)
  gets bronze, silver and gold rows together. So "this cell has gold" always
  means it has silver and bronze as well, the tiers on a cell are always a
  prefix of bronze, silver, gold, and "what's next" for a cell is simply the
  tier after its highest. The alternative, recording only the highest tier
  reached, would leave gaps that every reader has to reason about.
- **Only the highest new tier is celebrated.** The rows below it are logged
  but not announced. Gold is still the room-wide celebration (burst, cheer
  naming everyone, count bump). Bronze and silver get a lighter one: a short
  toast ("Silver crown at row 4, column 4: Mia, Kai and 4 others") and the
  live region, no burst.
- **A cell's crown shows its highest tier,** coloured by tier (bronze,
  silver, gold), and its label says which. The room's count is crowned
  cells, any tier.
- **"What's next" names the nearest tier.** The goal line picks the
  building with the fewest neighbours still needed for its next tier
  (ties: the higher tier, then more neighbours, then the lower cell) and
  says it: "Closest: Mia's building, 4 of 5 neighbours for silver". A tier a
  cell can't reach is never its next one: a corner (3 neighbours) can only
  ever be bronze, an edge (5) silver. The line appears once a crown stands
  or a building is one neighbour short of its next tier, instead of ADR 4's
  "5 neighbours", which a small room never reached.
- **The log line gains `tier=`:** `landmark at=r4c4 tier=gold label=…
  raisers=…`, one line per row recorded.

**Migration 5** adds `landmarks.tier TEXT NOT NULL DEFAULT 'gold'` (every
existing row was raised at 8), replaces the unique index on `cell_id` with
one on `(cell_id, tier)`, and backfills silver and bronze rows for each
existing gold one (same label, raisers and time), so old rows keep the
prefix rule. The tier names are written out in the step, not read from
`src/economy.ts`: a migration is a record of what was done once.

## Options considered

1. **A threshold that scales with the number of players** (e.g. "all your
   occupied neighbours, out of however many are online"). Turned down: it's
   a moving goal (a tower that was nearly done stops being nearly done when
   someone opens a tab), it rewards keeping people *away* from a tower so
   the bar stays low, which is the opposite of the hook, and it depends on
   who's connected, so a test of it can't be deterministic.
2. **A smaller landmark shape** (a 2x2 block, or 4 orthogonal neighbours).
   Reachable by four people, but it's a second, different goal on the same
   board, and gold would no longer be "ringed by everyone".
3. **Points for any neighbour, summed for the room.** Always moves, but rises
   from any claim anywhere, so it gives no reason to move (ADR 4 option 1).
4. **Tiers on the same spot (chosen).** One goal, one definition
   (occupied neighbours), three steps. Two people can't raise anything yet,
   but four can earn bronze and six silver, and every step is on the way to
   gold, so nothing earned in a small room points the wrong way for a big one.

## Consequences

- **A full 3x3 block now crowns all nine cells**: its centre gold, its edges
  silver, its corners bronze. The board shows more crowns, which is the point,
  and the count grows faster than before.
- **Bronze and silver are room-wide messages too.** ADR 4 kept gold as the
  only one; these are lighter and brief, and still one line at a time.
- **`raise()` writes up to three rows per cell,** so it reads the recorded
  (cell, tier) pairs first and only inserts the missing ones, rather than
  firing 432 `INSERT OR IGNORE`s on every broadcast.
- **The board payload's `landmarks.cells[id]` gains `tier`,** and `raised`
  carries the tier of the news.

## How it's held

- Store tests: each tier is recorded once at its threshold; dropping and
  refilling records nothing new; reaching gold at once records all three;
  ended leases don't count; corners never pass bronze and edges never pass
  silver; raised tiers agree with `heights()` on random boards.
- A migration test from a version-4 database: existing landmarks survive as
  gold (with bronze and silver backfilled), the new index allows a second
  tier on a cell and refuses a duplicate, and `user_version` is 5.
- HTTP/realtime: every page is told of a tier once, gold as the celebration;
  the log carries `tier=`.
- `spec/diff.test.ts`: the tier thresholds equal the server's; "what's next"
  names the nearest tier; the glow, inspector and crown agree with the
  server-rendered page.
