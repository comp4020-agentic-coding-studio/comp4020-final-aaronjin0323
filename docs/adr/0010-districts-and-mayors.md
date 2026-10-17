# 10. Districts and mayors: a contest for two or three, that scales to a room

- **Status:** accepted, week 12. Amends ADR 5 (how a building's income is
  worked out) and ADR 2 (who may see what).
- **Decides:** what a district is, who is its mayor, what being mayor pays,
  and what the store keeps (nothing new)

## Context

Every way players affect each other so far is local: help, the favour,
parks and zones all act on the eight plots round your building. Two or three
friends who aren't standing side by side have nothing to compete over, and
a full room has no reason to care what happens three plots away. Upgrading
is the only long-term spend, and it pays only you. The game needs a contest
that two or three people can have with each other, that still means
something with twenty, and that keeps "where you stand matters".

## Decision

**The 12×12 board is nine 4×4 districts.** `district(cell) = floor(r / 4) ×
3 + floor(c / 4)`, with `r` and `c` from 0, so districts are 0..8 in
row-major order: 0 is the top-left block and 4 the centre. People read them
as **1..9** (the page, the city log and the server log all say `district
5` for the centre); the payload carries the formula's 0..8. Derived on
every read from the plot id, never stored.

**A building qualifies in its district at level 2 or more**
(`MAYOR_MIN_LEVEL`). Each qualifier costs an upgrade (150 coins), so a
handful of alt-cookie Small Houses can't make anyone mayor. Parks never
qualify; they have no level.

**The mayor of a district is the holder of its single highest-level
qualifying building,** and only if at least one other qualifying building
in the district is held by someone else (`MAYOR_MIN_OTHERS = 1`). A mayor
of nobody is not a mayor: you are mayor *over* someone.

- **A tie for the highest level means no mayor.** Not broken by who got
  there first, by income or by plot order: each of those is a rule nobody
  can read off the board, and "first to Lv3" would need a stored time. A tie
  is visible (two Lv3 roofs, no star), and it's a move in its own right:
  matching the mayor's level unseats them, one more level takes the seat.
- **"Someone else's" is checked by holder.** The mayor's own buildings never
  count as others. With one building per person it can't happen today; the
  rule is written so it stays true.

**The mayor's building earns +8% per other qualifying building in the
district** (`MAYOR_BONUS_PERCENT`), **at most +40%** (`MAYOR_CAP_PERCENT`,
five others). It adds into `rate()`'s one summed bonus term, alongside the
neighbours' +20% each and the zone terms (ADR 9), inside the same floor: a
building's bonus never goes under 0, so nobody earns less than their
no-neighbour base. The mayor term is never negative, so the floor binds
exactly where it did before; a test holds it on `rate()` and on random
boards. Being out-levelled costs you nothing but the seat: there is no
penalty for not being mayor, so standing in a busy district is never worse
than standing in an empty one.

**Mayorship is derived, not stored, and changes only at existing cut
points.** It depends on which buildings run and their levels, which change
only on a claim, a move, an upgrade or a lease end. Every one of those
already settles first in its own `BEGIN IMMEDIATE` (ADR 5), and
`integrate()` already cuts the time at every lease end, so recomputing the
mayors for each piece it integrates is exact: no rate is ever applied to
time before the change that set it. No new action, route or migration.

**It's public, by label.** Each tile carries `district`; each board carries
`mayors: [{ district, cellId, label }]`. Labels only, never a `pid` (ADR 2).

**The page shows it:** a thin line on the street grid every four plots (CSS
only); a small gold star on the mayor's roof, on the opposite edge from a
zone sign, so a crowned, zoned mayor shows all three; the inspector says
"District 5 · Mayor +16%" on a mayor's building, and on your own what it
would take ("2 more Lv2+ to be mayor", "Lv4 to take mayor", "Lv2 to run for
mayor"). The preview's `+N/min` and each neighbour's `+N%` include the mayor
term, held equal to the server's rates on random boards. Narration is for
your own building only, one line: "You're mayor! +16%", "Kai took mayor",
"You're no longer mayor".

**Logs:** when a district's mayor changes (compared before and after each
broadcast, like `lifted` and `dropped`), `mayor district=5 who=<tag>
label="Kai" from=<tag|none>`, or `who=none` when the seat empties. The city
log says "Kai became mayor of district 5". Never a `pid`.

**Numbers live in `src/economy.ts`** (`DISTRICT_SIZE`, `MAYOR_MIN_LEVEL`,
`MAYOR_MIN_OTHERS`, `MAYOR_BONUS_PERCENT`, `MAYOR_CAP_PERCENT`) and the
`ECONOMY` mirror in `public/diff.js` (`districtSize`, `mayorMinLevel`,
`mayorMinOthers`, `mayorBonusPercent`, `mayorCapPercent`).

## Options considered

1. **A tallest-building leaderboard.** One list for the room, easy to show.
   Turned down: it's a ranking, not a decision. Nobody's choice about where
   to stand or whether to upgrade changes what anyone else earns, and with
   twenty players it's a list most people are at the bottom of. A district
   is small enough that two people can fight over it and the room has nine
   of them.
2. **Mayor by total income.** Rewards the best-placed player in the
   district. Turned down: income mixes neighbours, zones, parks and the
   mayor bonus itself (circular), so nobody can see from the board why
   they lost the seat or what would win it. Levels are on every roof.
3. **Storing mayors (a table, or a column on `cells`).** Would let a seat
   carry a start time and a tie-break. Turned down: it's derivable from the
   plots and their levels, so a stored copy can only ever disagree with
   them, and it would need writing at every claim, move, upgrade and lease
   end. The before/after comparison gives the log lines without it.
4. **A tie broken by who got there first.** Turned down above: invisible,
   and it needs a stored time.
5. **Districts by neighbourhood (the 8 plots round you).** Turned down:
   that's what every other mechanic already is. A fixed block is what pulls
   people who aren't adjacent into the same contest.

## Consequences

- **Two friends in one district can't both be mayor,** and with exactly two
  Lv2+ buildings the higher one wins +8%. The other can tie it to take it
  away, or out-level it. That's the contest a pair can have.
- **A busy district pays its mayor up to +40%,** which is worth fighting
  for in a full room; everyone else's upgrade makes the seat worth more,
  and makes it easier to take.
- **A move can take a seat or give one up,** and a lease ending can unseat
  a mayor (their rival, or their last other, went). Both are cut points
  already.
- **Without JavaScript** the star and the district lines still draw (the
  server renders `data-mayor`), and the inspector is script-only, as before.

## How it's held

- `spec/districts.test.ts` (store, injected clock): the district formula on
  all 144 plots; the rules each seen to fail with the rule broken: Lv1
  doesn't qualify, a lone qualifier isn't mayor, a tie is no mayor, +8% per
  other capped at +40%, parks don't count, the mayor's own buildings don't
  count as others; the floor holds; income across a mayorship change is
  exact to the cent; random runs of claims, moves, upgrades and collects
  held to a minute-by-minute model; the city log line.
- `spec/parks.test.ts`: the minute-by-minute model of `integrate()` on
  random boards with levels, zones and parks now works out the mayors by
  hand too.
- `spec/diff.test.ts`: the mirror equals `src/economy.ts`; the page's mayors
  equal the server's on random boards; the preview's rates equal the
  server's with mayors in them; the narration lines; the inspector line.
- `spec/log.test.ts`: the `mayor` line, `from=`, `who=none`, never a `pid`.
- `scripts/browser-check.ts` (`districts`): the grid lines draw, the star
  shows on the mayor's roof and not on others, beside a zone sign and a
  crown without overlapping them, shot at 4x.
