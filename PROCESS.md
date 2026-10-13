# Process overview

How Skyline got from the brief to a live board that tells people apart and
says who did what, as of crit 10. Every linked commit is in this repo; the
tag `crit-8` marks the state my first crit saw, and the range
[`6999be5...4194287`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/compare/6999be5...4194287)
is this week's work.

## Harness before code

Each week starts the same way: the agent reads the brief and the template
and lists what's undecided, I answer, and the answers land in `CLAUDE.md`
before any code. At crit 8 that settled the game: one tile each, and a tile
rises for every claimed neighbour, so the only way up is to stand near
strangers
([`2cc77e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2cc77e4)).
At crit 9 it settled the transport, in-place claims, leaving, and phone input
([`2f50d78`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2f50d78)).
At crit 10 it settled who may see and change what, and the log format
([`df8f06d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/df8f06d)).
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
- **CSS 3D over real buttons, not Three.js.** A form of tile buttons had to
  exist anyway for keyboard and no-JS play; with CSS 3D that form *is* the
  scene
  ([`7301095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7301095)).
  The cost is no real lighting.
- **Server-sent events for real-time.** Only the server pushes; claims are
  already `POST`s. Every event carries the whole board, so a page that
  reconnects after Fly drops it is correct from its first message, and a
  heartbeat keeps idle streams under Fly's proxy timeout
  ([`9f51eb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/9f51eb8)).
- **`stdout` for logs, no logging library.** Fly already collects stdout and
  `flyctl logs` tails it; one line per event is all the narration needs.

## Crit 10: who may see and change what

There are no accounts: a random `pid` in an HttpOnly cookie is a person, and
the typed name is display only. Before writing anything down I had an agent
audit every route against the code, then try to break each rule with
`curl` against a local server: claiming a held tile with someone else's
cookie and with none, a foreign and a `null` `Origin`, twenty concurrent
claims from one person, and looking for any `pid` in the page and the
stream. The claim rules held, because they live in one SQL `WHERE` inside an
immediate transaction, not in the page.

It did find one real bug: `?notice=constructor` printed `function Object()
{ [native code] }` as the page's notice, because the notice lookup used
`in`, which finds inherited names
([`9ac2629`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/9ac2629)).
It couldn't inject anything, but it was the server showing text nobody
chose.

The decision is [ADR 0002](docs/adr/0002-who-may-see-and-change-what.md): a
table of what anyone, you, and nobody may see or change, and the server
function that enforces each. It owns its limits rather than hiding them: one
tile per person really means one per browser profile, and losing the cookie
loses the tile. Accounts, signed tokens, IP identity and rate limiting were
each turned down, with the reason recorded: an IP limit would make the whole
showcase room, behind one NAT, a single person.

## Crit 10: who did what

At the crit two of my pod use the app from its URL while I narrate from
`flyctl logs`, so the logs had to tell two strangers apart without leaking
the one thing that proves who they are
([`4194287`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4194287)):

    claim who=4c6894 label="Kai" at=r6c7 lifted=12584b:"Mia"
    claim.refused who=4c6894 status=409 reason=taken at=r6c6 label="Kai" held=12584b:"Mia"

A person is a six-character hash of their `pid`, never the `pid`: logs
leave the server, and a `pid` beside a name would let anyone reading them
act as that person. Names are typed by strangers, so every string is quoted;
a test posts a name containing a newline and a fake `claim` line and checks
it stays one line. A claim names whom it lifted and dropped, worked out by
the same before-and-after comparison the page uses for its +1/−1, so the
log and the screen can't disagree.

## Directing, grounding and correcting

**Delegating in parallel, with fixed boundaries.** This week I asked the
main agent session to fan the work out. It split it between two subagents
that owned separate files: one built logging and tests in `src/` and
`spec/`, the other audited access and wrote the ADR in `docs/`. When the
audit found the notice bug, the fix went to the subagent that owned `src/`
rather than two agents editing one file. The main session then checked
their work by reading the diff and rerunning the full suite instead of
trusting their reports, and drafted the `CLAUDE.md` changes and this file
for me to review.

**Breaking things on purpose.** A test written after the code has never
been seen to fail, so every rule was broken once and its test watched go
red: a raw `pid` in the logs, one tag for everyone, unquoted names, a
cookie-less claim on a held tile, any `Origin` accepted. One break stayed
green at first: a `pid` printed only on page loads passed the "no `pid` in
the logs" test, because that test never loaded a page. It now drives every
path that logs and requires each line to exist before checking for absence.
That became a general lesson in `CLAUDE.md`.

**Tests that hold the brief's main lines.** `spec/realtime.test.ts` fails
unless a claim reaches two other people within 1000 ms. `spec/store.test.ts`
moves the clock 25 hours to test dormancy, and upgrades a copy of a crit-8
database to check no claim is lost
([`1df0f39`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1df0f39)).
`spec/log.test.ts` reads the output of a server it starts itself, because
the app CI tests runs in a container whose stdout the spec can't see.

**A real browser, kept in the repo.** The browser checks are a committed
script ([`7036cc5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7036cc5))
that found what HTTP tests couldn't: a third of empty tiles were
unclickable at the default angle, live since crit 8, because a flat tile
lay in the board's own 3D plane
([`3157737`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/3157737)).

**Correcting from use.** Playing it myself found that keyboard play meant
tabbing through 144 tiles; I rejected the agent's first fix and described
what a player should do instead
([`2ae2576`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2ae2576)).
At crit 9, asking what the main interaction actually was found the game
one decision deep, which led to showing whom each claim lifts
([`616eaa6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/616eaa6)).

**Keeping production clean.** Neither the spec nor the browser script is
ever pointed at the `fly.dev` URL; every claim there stays on the showcase
board.
