# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

The museum is being rebuilt from zero ([ADR 20](docs/adr/0020-rebuild-the-museum-from-zero.md)).
Only the idea and its scope carry over; every other decision is made again
below, as it's needed.

## Goal

**Impossible Museum** is a small, shared 3D gallery where visitors play
impossible objects together on one stage, improvising short absurd
performances, and leave them on plinths for the next visitors to find and
join. It's built for a handful of people visiting together for five to ten
minutes, including someone opening the URL with no introduction.

**The loop:** wander and watch what others left, join in on one, take it
somewhere unexpected together, leave it, come back.

**Good, here:** the fun is between people: reading each other's gestures,
playing along, cutting in, being surprised. No puzzle and no right answer;
the same performance carries different stories. Touching an object feels
like touching a real one and it answers with movement at once. Nothing
needs reading first. Work is credited and recoverable, so playing never
costs anyone their creation. These are starting decisions: change them
when evidence warrants it, with the reason recorded here and in an ADR.

## Out of scope

Bodies, faces or customisable avatars, chat, accounts and passwords,
uploaded assets, runtime AI models, a physics library, VR, an infinite
world, sliders or parameter panels, multiple rooms, leaderboards,
economies, puzzles or goals, rate limiting.

## The live museum is not a test fixture

- **Never point `pnpm check` at the live URL.** The checks act as visitors
  and would leave their data on the museum the marker sees. It's enforced:
  `spec/not-production.ts` makes the spec refuse any `fly.dev` host before
  it sends a request, held by `spec/not-production.test.ts`. Don't weaken it
  to get a check to run.
- **Ask before every push.** The repo is public, so a push to `main` is a
  deploy. One yes doesn't cover the next.
