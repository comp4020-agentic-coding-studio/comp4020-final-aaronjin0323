# Process overview

How Skyline got from the brief to its first live slice at crit 8. All linked
commits are in this repo.

## Harness before code

I started by having the agent read the template and the brief and list what
was still undecided, rather than asking it to build. That list became
`CLAUDE.md`: a short **Decisions** section (what a person is, one tile each,
first claim wins, grid size, stack), an **Open decisions** section for what I
hadn't settled, and working rules carried over from earlier crits. I answered
each open question myself, so the rules the agent follows are rules I chose,
committed before any app code in
[`2cc77e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2cc77e4).

Two answers changed the project. First, I rejected a plain grid and asked for
something that plays like a 3D game. Second, I chose **adjacency** as the
hook: a tile rises for each claimed neighbour. That gives the "co-presence"
the brief asks for a mechanic, not just a slogan, since you only rise by
standing near strangers.

I carried forward only the *general* lessons from earlier crits' harnesses
(verification habits, CSS and shell gotchas) and dropped rules tied to the
previous prototype's stack (Astro, Drizzle, its CSRF quirk). Last week's
domain rules would have been noise the agent tried to satisfy.

## The stack, and why

- **Bare `node:http`, TypeScript run directly by Node 24.** The app has three
  routes. A framework would add more to learn and debug than it saves, and
  running `.ts` with no build step means the code in the repo is exactly what
  runs on Fly. The cost is writing body parsing and cookie handling by hand.
- **SQLite through `node:sqlite`, one file on the `/data` volume.** The
  platform gives one 256 MB machine and one volume, so a database server is
  out. `node:sqlite` is built in, so the image needs no native compile. The
  schema is one table with a unique index that makes "one tile per person" a
  database guarantee, not just application logic
  ([`7183b98`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7183b98)).
- **CSS 3D transforms over real buttons, not Three.js.** This was the biggest
  call. The marker does a keyboard pass, so a server-rendered form of tile
  buttons had to exist regardless. With WebGL that form would be a second
  copy of the board to keep in sync; with CSS 3D the form *is* the scene.
  Keyboard focus, screen-reader labels and no-JS claiming come for free
  ([`7301095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7301095)).
  When I later asked for a camera that isn't fixed, this still held: a small
  script turns the same board through CSS variables, and each block gained
  its two hidden faces so it stays solid from any side. The remaining
  trade-off is no real lighting, recorded in `CLAUDE.md` as the condition
  for revisiting WebGL.

## How I directed, grounded and corrected the work

**Deploy first.** The placeholder went to Fly on day one, before any app
code, so the deploy path was proven while it was still trivial.

**Tests against the running app.** My checks in `spec/claim.test.ts` talk to
the live server over HTTP, the same way the course's invariants do
([`efb4fdf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/efb4fdf)).
Each rule in **Decisions** that can be checked mechanically has a test, and
the height test checks every tile on the board against its neighbours rather
than one hand-picked example. Because the database persists between runs,
the tests use fixed persona IDs: each persona holds one tile, so repeated
runs move tiles instead of slowly filling the board.

**Proving the tests can fail.** A test written after the code has never been
seen to fail, so I had the agent break the first-claim-wins rule on purpose.
The matching test went red, and the rule was restored.

**Looking, not just testing.** Green tests don't say whether the board looks
right. The agent screenshotted it at 1440×900 and 390×844 and read the
images. That caught a large empty band above the tilted board (the tilt makes
it look shorter than the box it lays out in) and showed that phone tiles are
about 27×22 px, below a comfortable tap size.

**Playing it found what the tests didn't.** Using the board myself, I
found that the keyboard path meant tabbing through 144 tiles, and then that
reaching the board at all relied on knowing it was a Tab stop. Both times I
rejected the agent's fix and described what a player should be able to do:
WASD should just work when you're on the board. Chasing that turned up a
real bug: pressing Enter in the name field claimed the top-left tile. The
test for it was written first and failed against the running server before
the fix went in
([`2ae2576`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2ae2576)).

**A correction that landed in the harness.** Before building, I asked
whether `CLAUDE.md` was enough for a *polished* result. The honest answer was
no: it covered behaviour but said nothing about visual direction, phone tap
size, first-time use or how to check the page. Rather than leave that in
chat, the gaps went into the harness as a look-at-it routine and as named
open decisions
([`d02f0b9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/d02f0b9)).

**Keeping production clean.** After deploying, the agent checked the live
site with read-only requests and a deliberately invalid claim, but did not
run the claim tests against production: every claim is permanent, and test
tiles would sit on the showcase board.

## What's next

Crit 9 makes the board real-time. The transport (SSE, WebSockets or polling)
and the phone tap size are open decisions in `CLAUDE.md`, to be settled and
argued here before they're built.
