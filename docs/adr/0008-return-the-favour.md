# 8. Return the favour: a bonus for helping back

- **Status:** accepted, week 12. Amends ADR 5 (Help) and ADR 2 (who may
  see what).
- **Decides:** what happens when a neighbour you helped helps you back, and
  what the store keeps to know it

## Context

With two or three friends in the room, Help (ADR 5) is the only thing one
player does *to* another, and it's a solo decision: once an hour, press the
button at whoever is beside you. Nothing about it depends on what the other
person did. The game needs a decision friends make about each other, without
widening Help or adding a new screen: a reason to answer someone.

## Decision

**If B helps A within an hour of A helping B, both get an extra 30 coins.**

- Help itself is unchanged: +50 to the neighbour, +20 to the helper, once an
  hour, adjacent only. A return pays that **plus `RETURN_BONUS` (30) to
  each**, so the returner gets 50 and the first helper 80.
- **The window is `RETURN_WINDOW_MS` (an hour) from A's help**, strictly
  less: at exactly 60 minutes it's an ordinary help.
- **Only the person who helped you can be helped back.** Each player keeps
  one open favour: who last helped them and when. A newer help from someone
  else replaces it (the latest favour is the one you can return). A help from
  a third party, or to a third party, never pays the bonus.
- **One return pays once, and a return doesn't open a new favour.** The
  check and the clearing run inside `help()`'s `BEGIN IMMEDIATE`
  transaction, so two simultaneous returns can't both pay. A return clears
  the returner's open favour and leaves the first helper's alone, so a pair
  can't ping-pong the bonus on every help: each exchange needs one of them
  to start it again.
- **A return still has to be a legal help.** Help is adjacent-only, so if
  the helper has moved away (or their lease ended) the favour can't be
  returned and isn't offered. It isn't erased either: if they come back
  beside you inside the hour, it's returnable again.
- **The city log says** "Kai returned Mia's help" (labels only), in place of
  the plain help line. **The server log** is the same `help` line with
  `returned=true`.
- **Numbers live in `src/economy.ts`** (`RETURN_BONUS`, `RETURN_WINDOW_MS`)
  and the `ECONOMY` mirror in `public/diff.js` (`returnBonus`,
  `returnWindowMinutes`).

**Migration 7** adds `players.helped_by TEXT` and `players.helped_by_at
TEXT`, both nullable, so every row production holds is valid as it stands
(no open favour). `helped_by` is a `pid` and never leaves the store: not in
any payload, the server log or the city log.

**The payload:** your own `me` gains `returnable: { cellId, until } | null`:
the plot of whoever's help you can return and when the window closes, only
while it's open and they stand next to your building. Nobody else is sent
it. The page glows that building green (`data-return`) with a "+30" floating
over its roof while you can help, and its Help button reads "Help back +30
each". Without JavaScript a return still
works through the form, as Help does; the page just doesn't offer it.

## Options considered

1. **Help at a distance, along your row or column.** Would let friends help
   each other from anywhere in a line. Turned down: friends just stand
   together anyway, so it buys little, and it weakens the adjacency hook,
   the one thing that makes where you stand matter.
2. **A tallest-building leaderboard.** Gives a race, but it's a race against
   everyone, rewards sitting still and saving, and is one more panel on a
   page that shows, rather than tells. It gives friends nothing to decide
   about each other.
3. **A bonus for any two neighbours helping each other, in either order,
   any time.** Simpler, but then it's two solo button presses, not an
   answer, and a pair can farm it every hour without thinking.
4. **Return the favour, within an hour, once (chosen).** Small, readable
   off the screen (one glowing building, one button label), uses the Help
   that already exists, and makes the second person's choice depend on the
   first person's.

## Consequences

- **A pair that keeps returning earns 150 coins an hour between them** from
  help instead of 70, but only if someone starts each exchange. That's the
  point; no other number changes.
- **The latest helper replaces an earlier one.** In a busy block a favour
  can be "lost" to a newer one; one column keeps the rule and the store
  simple.
- **Moving away closes the return** for as long as you're apart, since Help
  can't reach. That's told by the glow going out, not by a message.

## How it's held

- Store tests over an injected clock (`spec/return.test.ts`): a return
  inside the window pays +30 each on top of help; at 60 minutes it doesn't;
  a third party's help doesn't count either way; a return clears the favour
  and doesn't open one back; `returnable` follows adjacency and the window;
  migration from a version-6 database, with `user_version` 7.
- HTTP (`spec/landmarks.test.ts`): two simultaneous returns pay once; the
  city log and the server log name the return without a `pid`.
- `spec/access.test.ts`: `returnable` reaches only the helped person's page,
  and no `pid` is in it or in anyone's board.
- `spec/diff.test.ts`: the mirror equals `src/economy.ts`; the page offers
  "Help back" only at the returnable building while help is possible, and
  the server draws the same glow on that one tile.
- `scripts/browser-check.ts` (`returning`): two browsers, Kai helps, Mia's
  page glows Kai's building with +30, her Help reads "Help back +30 each",
  and both wallets move by the bonus.
