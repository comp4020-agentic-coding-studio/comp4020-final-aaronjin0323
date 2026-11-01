# 30. Supply follows the crowd; artifacts are worth wanting

- **Status:** accepted, week 12 (2 Nov). Replaces the instant refill to six
  or seven, and the three interchangeable kinds.
- **Decides:** when artifacts appear and how many, what makes one
  desirable, and how the collection is shown

## Context

The student asked to adjust spawn timing and density to the active
population, with total supply growing more slowly than player count, and
rare or distinctive artifacts more likely as more people join. Artifacts
should be desirable through appearance, materials, details and rarity.
Personal collecting comes first, a catalog second, and the spawn and rarity
numbers must be configurable.

## Decision

- **`SPAWN` in `public/arena.js` is the one table of parameters,** indexed
  by active players (0 to 4): the floor's `target`, the gap `everyMs`
  between spawns, and `rarity` weights. `createArena` takes another table,
  so a test or a tuning session can swap it whole.
- **Active means playing:** ghosts and people in line don't count.
- **One artifact at a time, on a timer,** only below the target and only
  with someone playing. The first arrival still finds a floor. Artifacts
  above the target stay; nothing expires.
- **Scarcity rises with the crowd.** Per player, both the floor and the
  spawn rate fall as people join, so a full arena fights harder.
- **Rarity rises with the crowd.** Mythics are worth finding four strangers
  for, which rewards staying when the arena is busy.
- **An artifact is a kind, a material and a seed.** Materials: tin
  (common), glass and gold (rare), starlight (mythic). Three kinds and four
  materials make twelve catalog entries. The seed varies the details, so no
  two look quite alike, including two of the same entry.
- **Rarity shows on the floor,** as a halo and rays, so everyone sees what's
  worth a chase. It still weighs the same as anything else.
- **Your shelf comes first:** each banked artifact as its own card, newest
  first. The catalog is a closed section under it, counting what you've
  found, with unknown entries as silhouettes.
- **The shelf is fetched, not streamed:** `GET /collection` when your count
  changes, because the stream runs up to twenty times a second.

## Costs

- The weights and targets are first guesses, with no play behind them.
- With few players the floor fills slowly after a big scatter, and solo
  play rarely sees a mythic, by design.
- A migration adds `material` and `seed`, so everything already stored is
  tin. Nothing has shipped yet, so that touches only local files.
