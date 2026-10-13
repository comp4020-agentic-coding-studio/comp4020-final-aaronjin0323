# Process overview

How Skyline got from the brief to a live, real-time board, as of crit 9.
Every linked commit is in this repo; the tag `crit-8` marks the state my
first crit saw, and the range
[`3add18f...cd2ddb3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/compare/3add18f...cd2ddb3)
is this week's work.

## Harness before code

Each week starts the same way: the agent reads the brief and the template
and lists what's undecided, I answer, and the answers land in `CLAUDE.md`
before any code. At crit 8 that settled the game: one tile each, and a tile
rises for every claimed neighbour, so the only way up is to stand near
strangers
([`2cc77e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2cc77e4)).
At crit 9 it settled the transport, in-place claims, what happens when people
leave, and phone input
([`2f50d78`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2f50d78)).
I carry only general lessons forward from earlier crits, never last week's
domain rules, which would be noise the agent tries to satisfy.

## The stack, and why

- **Bare `node:http`, TypeScript run directly by Node 24.** Few routes, and
  no build step means the repo is exactly what runs on Fly. The cost is
  hand-written body parsing and cookies.
- **SQLite through `node:sqlite` on the one volume.** No database server is
  allowed, and a built-in driver needs no native compile. A unique index
  makes "one tile per person" a database guarantee
  ([`7183b98`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7183b98)).
- **CSS 3D over real buttons, not Three.js.** Markers do a keyboard pass, so
  a form of tile buttons had to exist anyway; with CSS 3D that form *is* the
  scene, so focus, screen-reader labels and no-JS claiming come free
  ([`7301095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7301095)).
  The cost is no real lighting.
- **Server-sent events for real-time.** Only the server ever needs to push;
  claims are already `POST`s. SSE runs on bare `node:http` with no library
  and reconnects by itself. WebSockets would pay off only for streaming
  input like live cursors, which this game deliberately doesn't have.
  Polling would keep every tab hitting the 256 MB machine every second.

## Crit 9: designing for a connection that drops

Before building, I had the agent research how Fly treats long-lived
connections instead of assuming. It found that Fly's proxy closes a
connection after about 60 seconds of silence (a recent report says about 30
for a stalled stream), and that machines have been stopped with connections
open. Three design rules came from that, all written into `CLAUDE.md` first
([`364d658`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/364d658)):
a heartbeat every 15 seconds; every event carries the *whole* board, so a
page that reconnects is correct from its first message with no replay logic;
and on shutdown the server ends its streams so pages reconnect at once
([`9f51eb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/9f51eb8)).

Each stream is sent the board *as its own visitor sees it*: "mine" depends on
who's asking, and a visitor's identity cookie never leaves the server.

## The multi-person decision

The decision I wrote up is what happens to the tile of someone who leaves
([ADR 0001](docs/adr/0001-dormant-tiles.md)). Permanent tiles honour "your
mark stays" but fill the showcase board with people who went home; expiring
leases free space but erase people. I chose a middle path: after 24 hours
away a tile fades but keeps standing and keeps raising its neighbours, and
anyone new may settle on it. The holder is told once if that happens. The
cost, which the ADR owns, is that someone returning after a day may find
their tile taken. The README's second commitment was rewritten to say so,
because a promise the rules don't keep is worse than a smaller promise.

## Directing, grounding and correcting

**Tests that move the clock.** Dormancy needs a day to pass, so the store
now takes its database and the current time as arguments, and
`spec/store.test.ts` jumps 25 hours forward. The same file upgrades a copy
of a crit-8 database and checks no claim is lost: this was the first schema
change against real production data
([`1df0f39`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1df0f39)).

**The brief's main line as a test.** `spec/realtime.test.ts` opens two
streams as different people, claims as a third, and fails unless both see
it within 1000 ms. It runs in CI against the built image.

**Breaking things on purpose.** A test written after the code has never been
seen to fail. I had the agent remove the broadcast, delay it by 1.5 seconds,
and leak identity cookies into the stream, one at a time; each turned a test
red. The same for the dormancy rule, a lost claim, and the migration's
backfill.

**A real browser, kept in the repo.** The browser checks are now a committed
script ([`7036cc5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7036cc5)):
two browsers time a claim crossing (under 100 ms locally), plus the keyboard
pass, no-JS posting and both viewports. It caught two things the HTTP tests
couldn't. In 3D a tall block can hide a shorter one, so the script turns the
camera to reach a tile, as a player would. And the phone confirm bar stayed
on screen after hiding, because a CSS `display` rule beat the `hidden`
attribute
([`586b139`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/586b139)).
Both became general lessons in `CLAUDE.md`.

**Correcting from use.** At crit 8, playing it myself found that keyboard
play meant tabbing through 144 tiles. I rejected the agent's first fix and
described what a player should do instead, which led to page-wide WASD and
exposed a bug where Enter in the name field claimed the top-left tile
([`2ae2576`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2ae2576)).

**Keeping production clean.** The browser script refuses a `fly.dev` URL,
and claim tests never run against production, since every claim there
stays on the showcase board.
