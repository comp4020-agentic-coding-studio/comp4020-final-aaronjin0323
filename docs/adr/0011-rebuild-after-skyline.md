# 11. Rebuild the final project: Skyline was the exploration, not the answer

- **Status:** accepted, after crit 10 (week 11). Supersedes the game in
  ADRs 2 and 4--10 as the thing being built; keeps what they taught.
- **Decides:** that the final project is rebuilt from a new idea in this same
  repo, and what carries over from Skyline into it

## Context

Skyline is a shared 12×12 board where each person holds one plot and their
building rises with every neighbour. It ran from crit 8 to crit 10
([`2cc77e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2cc77e4)
to
[`372b109`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/372b109),
the state crit 10 saw). It meets the three fixed requirements: multi-user,
real-time and persistent.

Playing it, I don't think it's good, by my own definition. Two reasons:

- **It's boring in a short session.** The meaningful moves (placing,
  upgrading, helping, zoning) are slow, and most of the reward is income
  that accrues over minutes and hours. Someone with five minutes at the
  showcase never reaches the part of the game that is interesting.
- **There's no instant feedback.** A move's consequences arrive later, as
  coins, or for someone else, as a +1 on their building. Nothing answers you
  in the moment you act.

Each crit added a mechanic to fix the last one's thinness: landmarks
(ADR 4), an economy (ADR 5), tiers, parks, favours, zoning, districts
(ADRs 6--10). The game got deeper and not more fun to pick up. More rules
on a slow core is the wrong direction.

## Decision

Rebuild the final project around a new interactive idea, chosen for short,
immediate, co-present play. Skyline is kept in the history as the
exploration of what makes the final project's interaction work, not
deleted as a failure.

What carries into the rebuild is everything that isn't about Skyline:

- **The harness and how it's used.** Decide in `CLAUDE.md` before code;
  decide, then server, then page; every rule with a check, each seen to
  fail; rules that matter enforced in code, not only written down; prune
  rules the code no longer follows.
- **The course's fixed contract.** One 256 MB machine, one `/data` volume,
  `/` answering and `/readme/` publishing the README; `pnpm check` and
  `pnpm check:evidence` passing.
- **General lessons**, in `CLAUDE.md`'s "Things this stack keeps getting
  wrong", and the guard that keeps the checks off the live app
  ([`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f)).
- **The stack is reopened**, to be chosen for the new idea and argued in
  `PROCESS.md`, rather than kept by default.

What does not carry over: the board, the economy and every number in it,
the art direction, the interactions, and the scope of play.

## The Skyline decisions that mattered

Kept here because they shaped how the project is built, whatever is built.

- **A cookie is a person**
  ([ADR 2](0002-who-may-see-and-change-what.md)): no accounts, so a stranger
  joins in seconds; every rule is held on the server for a client that
  ignores the page.
- **The whole state in every real-time event**
  ([`9f51eb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/9f51eb8)):
  a reconnecting page is right from its first message, and comparing two
  states let the page show what each action did to others.
- **Show what your choice does to other people**
  ([`616eaa6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/616eaa6)):
  crit 9 found the game one decision deep. This is the lesson the rebuild
  takes furthest: the consequence has to be visible, and immediate.
- **Logs that tell strangers apart**
  ([`4194287`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4194287)):
  a hash of the identity, never the identity.
- **A rule enforced in code, not only written down**
  ([`05a68ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/05a68ca)
  then
  [`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f)).
- **Checking it the way the marker does**
  ([`2c3b59d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2c3b59d)):
  acting out the next-day return found persisted data that looked lost.

## Consequences

- **Less time.** The A3 deadline is noon, Monday 9 November 2026, about
  19 days from this decision, with week 12's studio for finishing. The new
  idea has to be small enough to build well in that time.
- **The live volume holds Skyline's database.** The new app either migrates
  away from it with a numbered step or starts a fresh file; a committed
  migration is still never edited.
- **The README, `CLAUDE.md`'s game rules, `PROCESS.md` and `spec/` are
  rewritten for the new idea.** Skyline's specs go with Skyline; the two
  template checks stay.
- **`PROCESS.md` will tell this as a pivot, with this ADR as its record**:
  what Skyline taught, why it stopped, and what the new idea answers.
- The crit 8, 9 and 10 reflections stay as written: they are true of the
  work as it was.
