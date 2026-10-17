# 9. Zoning: a choice about what your building does to your neighbours

- **Status:** accepted, week 12. Amends ADR 5 (how a building's income is
  worked out) and ADR 2 (who may change what).
- **Decides:** what a building's zone is, what each zone does to its own
  income and its neighbours', how a zone is changed, and what the store
  keeps

## Context

Two or three friends in the room can help each other (ADR 5), return the
favour (ADR 8) and place parks for each other (ADR 7). Every one of those is
cooperative: nothing a player does ever costs a neighbour anything, so there
is no decision with a cost to someone else in it, and no reason to watch what
the person beside you is doing. The game needs one choice that can be
generous or selfish, is visible to the people it touches, and keeps the
adjacency hook (where you stand still decides who you affect).

## Decision

**Every building has a zone: `civic`, `market` or `factory`.**

| Zone | Your own income | Each adjacent building held by someone else |
|---|---|---|
| `civic` (the default) | +0% | +0% |
| `market` | +0% | +15% |
| `factory` | +35% | −10% |

- **The percentages add into the rate multiplier** alongside the +20% per
  occupied neighbour (ADR 5). A building's income is
  `10 × level × (100 + 20 × neighbours + zone terms)` hundredths of a coin
  a minute, where the zone terms are its own zone's self term plus what each
  adjacent building's zone gives it. Parks (ADR 7) have no zone: they count
  as a neighbour for the +20% and give nothing else.
- **Markets are capped:** the total market bonus one building receives is at
  most **+30%** (`MARKET_CAP_PERCENT`), however many markets ring it.
- **Nobody is pushed under their base rate:** the whole bonus (neighbours
  plus zone terms) is floored at 0, so a building never earns less than its
  no-neighbour rate, `10 × level` coins a minute. The floor is on the total,
  not on each term. With today's numbers it can't bind (every factory beside
  you is also a neighbour worth +20%, so it nets +10%); it's a stated floor,
  held by a test on `rate()` itself, so a later negative term (districts)
  can't make anyone's building cost them to hold.
- **"Someone else's" is checked by holder,** not assumed: a zone never acts
  on a building held by the same person. With one building per person it
  can't happen today; the rule is written so it stays true.
- **`POST /rezone {zone}`** changes your own building's zone. It costs **40
  coins** (`REZONE_COST`), with a **1-hour cooldown per player**
  (`REZONE_COOLDOWN_MS`). Same-origin, `pid` only, JSON or form (a form gets
  a `303` and a notice key). Refusals: `402` coins, `429` cooldown, `400`
  `no-land`, `zone` (not one of the three) or `same-zone`. One `BEGIN
  IMMEDIATE` transaction that **settles first**: a rezone changes the rates
  of every building beside yours as well as your own, so it is a cut point
  for all of them, exactly like a claim or a move. No rate is ever applied
  to time before the rezone that set it.
- **A new claim starts civic.** A plot that's freed (lease end, move away)
  goes back to civic.
- **A move keeps your zone,** like your level, lease and uncollected income
  (ADR 5): the zone is part of the building, and you paid for it. Resetting
  it on a move would make a move a free way back to civic (or a hidden loss
  of 40 coins), and a move is already paid for and cooled down. A factory
  that moves in beside you is still visible: its roof carries the icon and
  your page says what your income did.
- **The zone is public.** Every tile carries `zone` for everyone: a factory
  beside you is a visible betrayal, and a market a visible gift. Your own
  `me` gains `rezoneAt` (when you may rezone again; null if you never have).
- **The page shows it:** a small icon on the roof of each market and
  factory (civic draws nothing); your own building's inspector offers the
  other zones with their cost, only while you can pay and aren't cooling
  down; the placement preview's `+N/min` and each neighbour's `+N%` include
  zone effects. A neighbour rezoning narrates on your page only, one line:
  "Kai built a factory beside you · −10%".
- **Logs:** `rezone who=<tag> at=<cell> zone=factory from=civic`; the city
  log says "Kai zoned a factory". Never a `pid`.
- **Numbers live in `src/economy.ts`** (`ZONES`, `REZONE_COST`,
  `REZONE_COOLDOWN_MS`, `MARKET_CAP_PERCENT`) and the `ECONOMY` mirror in
  `public/diff.js` (`zones`, `rezoneCost`, `rezoneCooldownMinutes`,
  `marketCapPercent`).

**Migration 8** adds `cells.zone TEXT NOT NULL DEFAULT 'civic'` and
`players.last_rezoned_at TEXT` (nullable). Every row production holds becomes
civic, which is the neutral zone, so **nobody's income changes at the
deploy**; nobody has a cooldown running.

## Options considered

1. **Civic as a +10% default.** Makes the default feel like a choice of its
   own. Turned down: migration 8 would silently raise every live building's
   income at the deploy, a change nobody made and nobody could read off the
   screen. The default has to be the baseline, so a zone is something a
   person did.
2. **Uncapped markets.** Simpler. Turned down: a building ringed by markets
   would earn +120% on top of its neighbours, and one person with a few
   browser profiles (ADR 2 accepts that a profile is a person) could ring
   their main building with alt-cookie markets and farm it. A cap of two
   markets' worth keeps a market a gift between people rather than a farm.
3. **Factories that can push a neighbour below base.** Sharper competition.
   Turned down: holding a plot should never be worth less than holding it
   alone, or the hook (settle next to people) turns into "keep away from
   people", which is the opposite of the game.
4. **A per-pair "rival" or "ally" flag.** Expressive, but private and
   invisible to the room, and an extra table. Zones are one public column
   that everybody already sees on the board.
5. **Three zones on the building, public, paid and cooled down (chosen).**
   A market costs you nothing and helps everyone beside you; a factory pays
   you and costs them, and they can see it and answer (move away, or zone a
   factory back). Small, legible, and still about who stands next to whom.

## Consequences

- **A factory pays the most when it has the most neighbours to hurt,** and
  each of them nets only +10% from it instead of +20%. That's the
  temptation; the answer is visible on every roof.
- **Two friends who both zone markets each get +15%,** the cooperative
  answer, but less than one factory (+35%). The trade is the decision.
- **`rate()` takes one summed percentage term** after the neighbour count,
  so a later term (districts) adds to that sum and keeps the floor.
- **Without JavaScript** a rezone can be posted by a form, but the page
  offers it only with script, like Help and parks.

## How it's held

- Store tests over an injected clock (`spec/zoning.test.ts`): cost, cooldown
  (refused at 59 minutes, allowed at 60), coins, refusals and their order;
  a new claim is civic and a move keeps the zone; a lease end resets it;
  each zone's effect on self and neighbours; the market cap at +30%; the
  floor at the base rate (on `rate()` itself, and over random boards);
  a rezone is a cut point (income before it at the old rates, to the cent);
  random sequences of claims and rezones held to a minute-by-minute model;
  migration from a version-7 database, with `user_version` 8.
- `spec/parks.test.ts`: the minute-by-minute model of `integrate()` on
  random boards now has zones on its buildings, as well as parks.
- HTTP (`spec/access.test.ts`): you can only rezone your own building (the
  route takes no plot, and posting someone else's `cellId` changes nothing);
  ten simultaneous rezones charge once; refusals' statuses; a foreign
  `Origin` is a `403`; a form gets a `303`; no `pid` in any reply or page.
- `spec/log.test.ts`: the `rezone` line and its refusals, never a `pid`.
- `spec/diff.test.ts`: the mirror equals `src/economy.ts`; the preview's
  rates equal the server's on random boards with zones and parks; the
  narration line; the inspector's zone options.
- `scripts/browser-check.ts` (`zoning`): two browsers, one zones a factory,
  the other sees the icon and the line; the icons are screenshotted at 4x.
