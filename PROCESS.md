# Process overview

<!--
DRAFT by Claude, to be rewritten in your own words (the course asks you
to write PROCESS.md yourself). Every hash below exists in this repo and
was checked by `pnpm check:evidence`. Links to commits after 01c16c4 only
resolve on GitHub once those commits are pushed. Target: 900-1100 words.
The claims about who decided what are yours to confirm or correct. Delete
this comment when it's yours.
-->

How Impossible Museum got from the brief to a shared 3D gallery where
visitors play impossible toys together. It started as a different project.
Every link is a commit in this repo; the tags `crit-8` to `crit-10` mark
what each crit saw.

## Skyline was the exploration

Crits 8 to 10 built Skyline, a 12×12 board where your building rose with
its neighbours. It worked and its checks were green, but in a five-minute
session it was boring: you claimed a tile and waited. Nothing answered you
in the moment you acted. I decided to rebuild from a new idea in the same
repo rather than keep polishing, and recorded why in ADR 11
[`b1d3558`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/b1d3558). What carried over was the harness, not the game: the
decide-then-code rhythm, the live-URL guard, the browser check and the
lessons in `CLAUDE.md`. Nothing Skyline-specific came with it.

## The harness comes before the code

Every change starts as a decision in `CLAUDE.md`, and an ADR when there
were real alternatives. Only then does it become code, as separate commits:
**decide**, then **server** with its tests, then **page**. The museum began
that way [`8347666`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/8347666), and so did each turn after it: the word budget
[`a855543`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/a855543), the Loop Stage [`68b1d80`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/68b1d80), first person [`7880ccd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7880ccd)
and more toys [`2b3d468`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2b3d468). The decide commit is the one I review
hardest. A rule is cheap to change there and expensive once a test and a
page depend on it.

The museum changed shape four times in two weeks, and the ADRs are how
that stayed legible:

- **Sculptures built with sliders** (ADR 12) became a word budget, because
  the room should carry the meaning ([`ddc4711`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/ddc4711), ADR 13).
- **Orbit** [`4f149fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/4f149fd) was a reversible prototype. It showed that one
  person's change moving another's piece was the fun part.
- **The Loop Stage** [`68b1d80`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/68b1d80) made exhibits short performances that
  anyone adds to.
- **First person** [`7880ccd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/7880ccd) let visitors see each other reach.

Each ADR names what it supersedes, so `CLAUDE.md` holds only the museum
as it stands.

## The stack, and the trade-offs

- **Bare `node:http`, TypeScript run directly by Node 24, `node:sqlite`.**
  No build step and no framework, kept from Skyline. Migrations are
  numbered and never edited, because the volume outlives every deploy.
  New starter exhibits arrive as migration 4, which puts a starter in the
  storeroom rather than displace anyone's exhibit [`f5ab2e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/f5ab2e4).
- **Server-sent events with the whole state in every event.** A
  reconnecting page is right from its first message. Held by a test: a
  gesture on one stream reaches another within 1000 ms [`a1fd569`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/a1fd569).
- **Three.js from a pinned CDN, with the DOM still holding every control.**
  It gives real light and a room, and keyboard and screen-reader play still
  work through ordinary buttons.
- **Our own physics, not a library.** Every screen computes the same
  performance from the gestures and the clock, so nothing but a gesture is
  ever written.

## When something went wrong, the fix went into the harness

**Determinism that held in Node but not in Safari.** The rules used
`Math.sin`, which each JavaScript engine may round differently. A sphere
came out a last digit apart 4 s in, enough for two screens to disagree
about a collision. The rules now use only arithmetic IEEE 754 rounds the
same everywhere [`647bcea`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/647bcea). The browser check plays them in macOS's
JavaScriptCore and in Node and compares every position bit for bit
[`c194738`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/c194738). I saw that check fail against the old rules first.

**A rule that failed until it was code** (from Skyline, still true). Spec
runs against the live URL left test players on the real board. A
`CLAUDE.md` rule [`05a68ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/05a68ca) didn't stop it, so the checks now refuse
any `fly.dev` host before sending a request [`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f). A rule the
agent can read is weaker than one it can't get past.

**A loop that read as a glitch.** At 12 s with a hard reset, every sphere
snapped home, and people read it as the sculpture breaking. The loop is
now 30 s and glides home [`01c16c4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/01c16c4). A flaky browser check later
showed the cost of that glide: a gesture made in its last 1.2 s barely
moved. The flake failed every full run at the same loop moment, 29.4 to
29.6 s. Reading its logs instead of retrying found the cause, and such a
gesture now plays at the top of the next loop [`68b1be6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/68b1be6).

**A laptop that ran hot.** The idle page drew about 70 frames a second.
Measuring first showed the cost was the GPU and the drawing, not the
physics. A lighter frame [`c7d1f91`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/c7d1f91) and drawing only when something
moves [`ce2c43b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/ce2c43b) took the idle page to zero frames. The same pass found
that playback re-applied gestures, doubling pulses and flashes
[`1bb6f42`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1bb6f42).

**Bugs only a browser could find.** Two visitors who arrive together stand
on one spot, and each one's view was 86% the inside of the other's head
[`b3f92cd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/b3f92cd). In Safari's engine the doors' glow drew as coloured
speckle, on a real GPU too [`b1f573d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/b1f573d). Both are now measured by
`scripts/browser-check.ts`, and each check was seen failing before the fix.

## Directing, grounding and correcting

I direct the agent through the decide commits and through what I find by
playing. For larger work I fan out subagents in separate worktrees, each
with a written brief and its own files. Adding three toys at once went that
way: one agent built the plug-in seam, three built a toy each, and I merged
and wrote the one migration. I ground their reports in the running app, not
in what they say. A fix counts once its test has been seen to fail with the
fix removed, and a UI change counts once I've read the screenshots at both
sizes. The agent drafts most of the code and much of the prose; the
decisions in `CLAUDE.md` and the ADRs, and which findings become rules, are
mine.
