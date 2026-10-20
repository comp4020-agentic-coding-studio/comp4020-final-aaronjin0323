# Process overview

How Skyline got from the brief to a live 12×12 city where where you build
depends on who else is there. Every link below is a commit in this repo; the
tags `crit-8` and `crit-9` mark what each crit saw.

## The harness comes before the code

Every change starts as a decision in `CLAUDE.md`, and only then becomes
code. The agent reads the brief and lists what's undecided, I answer, and the
answers become rules
([`2cc77e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2cc77e4)).
From the economy on, that settled into a three-commit rhythm I hold the agent
to: **decide** (CLAUDE.md and an ADR, no code), **server** (the rule and its
tests), **page** (what a player sees). Parks went
[`905aed1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/905aed1),
[`d00aec1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/d00aec1),
[`4666820`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4666820),
and landmark tiers, return the favour, zoning and districts follow the same
shape. The decide commit is the one I review hardest, because a rule is cheap
to change there and expensive once a server test and a page depend on it.

The rules have to stay true, too. By crit 10 `CLAUDE.md` carried three
weeks of superseded rules patched over by "this section wins", so the agent
was reading instructions the code no longer followed. I had it pruned to the
game as it stands, each dropped rule replaced by a pointer to the ADR that
ended it
([`f9ab9d2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/f9ab9d2)).

## The stack, and the trade-offs

- **Bare `node:http`, TypeScript run directly by Node 24.** No build step, so
  the repo is exactly what runs. The cost is hand-written cookies and body
  parsing.
- **SQLite through `node:sqlite`, numbered migrations.** One file on the one
  volume, no native compile. Every schema change runs once at boot against
  whatever production holds, so the crit-8 board survived dormancy, then
  leases
  ([`1df0f39`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1df0f39),
  [`c7f470c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/c7f470c)).
  A committed migration is never edited.
- **Server-sent events, not WebSockets.** Only the server pushes; players
  act through `POST`s. WebSockets would earn their keep only for streaming
  input like live cursors
  ([`2f50d78`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2f50d78)).
  Every event carries the whole board, so a page that reconnects after
  Fly drops an idle stream is right from its first message
  ([`9f51eb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/9f51eb8)).
- **CSS 3D over real buttons, not Three.js.** A form of tile buttons had to
  exist for keyboard and no-JS play; with CSS 3D that form *is* the scene
  ([`7301095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7301095)).
  The cost is no lighting, and a memory bill I paid later.

Who may see and change what is in
[ADR 2](docs/adr/0002-who-may-see-and-change-what.md), and the log format
that tells two strangers apart without printing their cookie is in
[`4194287`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4194287).

## When something went wrong, the fix went into the harness

**A rule that failed until it was code.** Spec runs against the live URL
left test players on the real board. I added a `CLAUDE.md` rule
([`05a68ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/05a68ca));
the next day they were back. So the check now refuses any `fly.dev` host
before sending a request, held by its own test
([`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f)).
A rule the agent can read is weaker than one it can't get past.

**A test that only checked what it happened to see.** "No `pid` in the logs"
passed while a `pid` was printed on page loads, because the test never
loaded a page. It now drives every path that logs and requires each line to
exist before checking for absence
([`4194287`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4194287));
the general lesson went into `CLAUDE.md`
([`df8f06d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/df8f06d)).

**Bugs only a browser could find.** A third of empty tiles were
unclickable, live since crit 8, because a flat tile lay in the board's own
3D plane
([`3157737`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/3157737)).
Clipped roofs cost 1.1 GB of compositor memory and the GPU dropped
buildings
([`1f7ccda`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1f7ccda)).
Both are now measured by `scripts/browser-check.ts` and named in
`CLAUDE.md`.

**A flaky test diagnosed, not retried.** `realtime.test.ts` failed about one
run in two. Reading the server logs of three failures showed it racing
`claim.test.ts` for the same first free tile, so the files now take tiles
from different rows, and the rule is written down
([`5f1ac1f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/5f1ac1f)).

**A test that asserted the bug.** On a throttled connection a claim the
server made, whose reply was lost, said "nothing claimed", and the browser
check *expected* that text. I changed what the check holds rather than
keeping it green, and both new checks fail against the old page
([`52532db`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/52532db)).

## Checking it the way the marker will

Green checks say the rules hold, not that a stranger can play. So I test the
deployed app the way it is marked. Driving the live site in Chrome, with
every write blocked, found that tapping a building left an earlier plot
picked, so Enter built where the player wasn't looking
([`51be412`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/51be412)).
Acting out the next-day persistence check found the worst one: after a 24 h
lease ended, a returning player saw an empty board and no money, though
every coin had persisted. The wallet was hidden without land, so the data
looked lost. It now says the lease ended and how much is waiting, with
Collect
([`2c3b59d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2c3b59d)).
The same session found the page sent 285 KB uncompressed; it is now about
51 KB
([`df0c1f1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/df0c1f1)).

## Directing, grounding and correcting

I direct the agent through the decide commits and through what I find by
playing: tabbing through 144 tiles to reach the board became page-wide
WASD, with a spec test that failed first
([`2ae2576`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2ae2576)),
and finding the game one decision deep led to showing whom each claim
lifts
([`616eaa6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/616eaa6)).
I ground it in the running app, not its reports: a fix counts once its test
has been seen to fail with the fix removed. For larger reviews I run
subagents in parallel on separate concerns, with one allowed to edit files,
and I check their claims against the diff and the commits before acting.
The agent drafts most of the code and much of the prose; the decisions in
`CLAUDE.md` and the ADRs, and which findings become rules, are mine.
