# 5. Skyline becomes a city economy: land on a lease, buildings that earn

- **Status:** accepted, crit 10 (week 11). Replaces ADR 3 (faded tiles).
  Amends ADR 4: landmarks stay; Help replaces Wave.
- **Decides:** what a player owns, earns and spends, and how land returns
  to the room

## Context

Landmarks gave the room a goal, but a single player still had one decision:
where to stand. Inspired by the social web game 抢车位 ("grab a parking
space"), the game gains an economy, so that where you stand pays, money buys
choices (bigger buildings, moving, keeping land), and land keeps coming back
to the room on its own.

## Decision

**A player** is still an anonymous `pid` cookie, now with a stored wallet:
display name, coins (starting at 100, never negative), and cooldowns. Losing
land never touches the wallet.

**Land is leased, not held.** Claiming a free plot is free for anyone without
active land, and starts a 24-hour lease from the claim, not from the last
visit. Coins renew it (6 h for 100, 12 h for 180, 24 h for 300), but never
beyond 48 hours from the start of that ownership. When a lease ends, the
building is removed and the plot is free. Time is server time, computed on
read, so a lease that ended while the server was off has ended on the first
request after it starts.

**Buildings earn.** A plot carries a building, levels 1--5 (Small House,
Townhouse, Apartment, Office Building, Skyscraper), upgraded with coins
(150, 400, 900, 1800). It earns
`10 × level × (1 + 0.2 × occupied neighbours)` coins a minute, floored to
whole coins when settled. Earnings pile up uncollected, capped at 4 hours'
worth, and stop when the lease ends; the owner collects them.

**Income is integrated, not guessed.** A building's rate changes whenever a
neighbour arrives, leaves, upgrades or expires. So before any change that
can alter anyone's rate, the server settles every affected building at its
old rate up to that moment, then applies the change. Each building stores
what it has earned so far (`pending`, in hundredths of a coin so fractions
aren't lost between settlements) and when it was last settled. Lease ends
and the 4-hour cap are settled at the instant they happen, even if nobody
looks until later. Nothing is ever back-dated at today's rate.

**Moving costs.** Relocating to a free plot costs 50 coins, keeps the level
and the lease end, settles income first, and then can't be done again for
30 minutes.

**Height shows both.** A tower's visible height is `level + occupied
neighbours`: the level sets the building's type and floors, the neighbours
lift it. A **landmark** is a building with all 8 neighbours occupied
(ADR 4, now counted by occupied neighbours rather than height).

**Helping replaces waving.** Once an hour you may help one neighbour: they
get 50 coins, you get 20. It's settled in one transaction, so a repeated or
simultaneous request can't pay twice. The wordless Wave button goes, since
two "be nice to your neighbour" buttons would compete.

**A short city log.** Claims, upgrades, moves, renewals, expiries and help
are stored as public events (names and plots, never a `pid`) and the latest
few are shown.

**Every number is a constant in `src/economy.ts`.** Money is integers;
calculations are deterministic and take the clock as an argument.

## Options considered

1. **Keep fading (ADR 3).** Land stays as long as you visit. Turned down:
   with no end to ownership, coins have nothing to protect and the board
   never turns over.
2. **A lease that visiting renews for free.** Gentler, but active players
   would never need to spend coins on renewals.
3. **The lease as specified (chosen).** Land is scarce and temporary, so
   moving, renewing and choosing neighbours are real decisions.
4. **Income computed at today's rate over the whole absence.** Simpler,
   but wrong: a neighbour who left an hour after you went offline would
   still be paying you.

## Consequences

- **Nobody keeps a plot past 48 hours,** even while playing. The board turns
  over by design; progress lives in the wallet and a player can claim again
  at once.
- **ADR 3's rules go**: no dormant state, no waking by visiting, no "your
  tile went quiet" notice. Expired land is simply free.
- **Migration of live data.** Existing claims become level-1 buildings whose
  lease and ownership start at the moment the migration runs, so nobody
  loses a plot on deploy. Everyone gets a wallet of 100 coins on first
  sight. Landmarks already raised stay.
- **Without JavaScript** you can still claim, collect, upgrade, renew and
  move with forms; income counts up live only with JS.

## How it's held

Store tests over an injected clock: income integration across neighbour
changes while offline, the 4-hour cap, expiry mid-absence, duplicate
collection, insufficient funds, every upgrade and renewal limit, relocation
rules and cooldowns, help rules and cooldowns. HTTP tests for each route's
refusals and for concurrent requests. Realtime tests for every change
reaching other pages. A migration test from a crit-10 database.
