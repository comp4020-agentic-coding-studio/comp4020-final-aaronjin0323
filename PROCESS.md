# Process overview

How I got from the brief to a slingshot arena for strangers, by way of two games I abandoned. Every link is a commit in this repo; the tags `crit-8` and `crit-9` mark what those crits saw.

## Three games, one lesson

Crits 8 to 10 built Skyline, a shared board where each player's building rose with its neighbours. It met the requirements, but it was boring in a short session, and nothing answered you in the moment you acted. Each crit added mechanics to fix the last one's thinness, which made it deeper but not more fun. I recorded the decision to rebuild in ADR 11 [`b1d3558`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/b1d3558), as an exploration rather than a failure.

The museum [`8347666`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/8347666) came next: a shared 3D gallery where visitors build impossible sculptures together. It didn't hold players either. Its interaction was the product of too many compromises, and I couldn't balance keeping it simple with letting people make something creative together. Without text, players spent too long working out what was going on and what to do, which is bad UX.

So I came up with the arena [`5970a1f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/5970a1f). It is easy to pick up: players know what to do and dive straight in. I kept the idea of exhibition, though. The rooms let players show off their spoils, and seeing an artifact you want in someone else's room is a reason to go back for another round.

Looking back, Skyline and the museum began from a setting or concept and kept adjusting the interaction to fit, while the arena began from the interaction itself: drag back, launch, collide. If I started again tomorrow, I would settle on a specific interaction first, then apply a theme that makes it fun.

## Deciding before code

The habit that helped me most was deciding in `CLAUDE.md` before any code. Each change starts as a decision there, plus an ADR when there were real alternatives, then the server with its tests, then the page, as separate commits. The rule that every collision scatters both players' cargo shows the rhythm: the decision [`283caef`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/283caef), the server [`12906b9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/12906b9), the page [`65bbd31`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/65bbd31).

This is what let me survive the pivots. When I changed games, the written decisions said what was being thrown away and what was kept. ADR 28 records that the arena kept the hall's tested core instead of starting from zero. It also let me correct the agent: when something went wrong, I could point at what had been decided rather than argue with the code.

I used subagents only for complex tasks that could be split up and built in parallel, as in the museum. The arena's development was linear, each step depending on the last, so subagents didn't fit.

## Why this stack

The agent suggested bare `node:http`, `node:sqlite` and server-sent events, and I approved them. They worked well through all three games, on one 256 MB machine, without a framework or a build step. They also serve what I care about: there are no accounts, so a player opens the URL and plays without a registration step in the way. Each visitor is anonymous, shown only as a robot with a colour and a mark, which makes playing against strangers fun, because anyone can join the scramble at any moment. One rule file, `public/arena.js`, runs on both server and page, and the server alone decides who hit whom [`dc50000`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/dc50000).

## When something went wrong

**A rule the agent could get round.** During crit 10, checks pointed at the live URL left test players on the real board. A rule in `CLAUDE.md` [`05a68ca`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/05a68ca) didn't stop it, so the checks now refuse the production host in code [`2fb2b6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2fb2b6f). Even so, on 22 October the agent confirmed a museum deploy [`2e3ce32`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/2e3ce32) by sending a `POST` to the live site by hand. That request left a stray visitor in the live database, because the guard only covers the checks. The agent reported it itself. I have since added a rule to `CLAUDE.md` that anything sent to the live site by hand must be a `GET` [`adb1ec8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/adb1ec8). It is a written rule, so it is weaker than the guard, and I know that.

**A design that passed every test and still felt wrong.** Playing the museum, I asked why the sculpture kept resetting. The agent explained that the reset was deliberate: every 12 seconds the stage replayed everyone's gestures, so later visitors could respond to earlier ones. But the instant snap looked like a glitch. I chose a 30-second loop where the spheres glide home [`01c16c4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/01c16c4). The agent then turned my judgement into a check: the spheres jumped at 20 m/s under the old rule, failing it, and peak at 1.9 m/s now.

**Too many words.** Playing the arena, I found the screens full of text, and buttons with no hierarchy, so users would feel lost. All the checks passed. ADR 35 [`f0466f2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/f0466f2) cut the first arena screen from 125 words to 2 [`1cec600`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/1cec600), and added a check that limits words and controls on each screen so the clutter can't creep back.

These taught me that passing checks doesn't mean the app is good. User experience needs a person to try it, play around and feel what's good or bad.

## Where it stands

`README.md` argues what good means here [`50feaf2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/50feaf2). At least five friends tried an earlier version of the arena with the same mechanics and picked it up without hints from me; nobody has yet tried the current version. `session-check` fails intermittently, including on an earlier commit [`0379730`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aaronjin0323/commit/0379730), and I haven't found why.

I made the decisions and the agent wrote the code, sometimes after I asked for its suggestions. The agent found problems through checks; I found them by trying the game, playing it and feeling it.
