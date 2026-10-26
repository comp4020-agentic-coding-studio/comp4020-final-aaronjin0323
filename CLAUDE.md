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

## Decisions

Settled; change them here first, then in the code. The design is
[ADR 21](docs/adr/0021-one-stage-one-toy.md), the stack
[ADR 22](docs/adr/0022-stack.md).

### Who is who

- **A visitor is a cookie.** A new browser gets a random `pid` (UUID,
  HttpOnly, `SameSite=Lax`, `Secure` in production, one year), and a
  `visitors` row with a generated name ("Coral Heron") and a colour. Two
  browser profiles are two visitors. No accounts.
- **The pid never leaves the server.** Everyone else sees a visitor as
  `{ tag, name, colour }`, `tag` being the first 8 hex of a SHA-256 of the
  pid, in every payload and log line.
- **A name is a label.** Rename to 1--24 characters after trimming;
  anything else is a `400`, never truncated. Names may collide; colour and
  tag tell people apart.

### The room

- **One round gallery: the stage in the middle, six plinths round it.**
  The camera orbits: drag to turn, wheel or pinch to zoom. Clicking a
  plinth flies to it; "Back to the stage" (and `Escape`) flies back.
- **The toy is the Upside-down Fountain:** four balls that fall *up* to a
  glass dome and bounce, and a bell hanging in the middle. Press a ball and
  drag to flick it; let go and it flies the way you dragged. Click the bell
  to ring it: it pushes nearby balls away. A ball hitting the bell rings it.
- **Touch is direct.** The object under the pointer lights up and the
  cursor says it's touchable; your own gesture plays on your screen at
  once, before the server answers.
- **Others are visible.** Each visitor's pointer shows in the room as a
  small orb in their colour, with their name, while it's over the scene.
  Pointers are in memory only: at most 10 a second sent per page, dropped
  after 4 s, never stored.

### The performance

- **A performance is a 20 s loop of gestures.** A gesture is
  `{ kind: "flick", ball, v: [x, y, z] }` or `{ kind: "ring" }`, at a
  moment `at` (0 to 20 s). At most 30 in a loop and 10 from one visitor:
  past 10 your own oldest drops, past 30 the oldest of all.
- **What happens is a rule, not a record.** Every position at every
  moment comes from the gestures alone, by a fixed 60 Hz step from rest
  with no randomness (`simulate` in `public/fountain.js`, shared by the
  server and the page). Every screen shows the same thing.
- **Only arithmetic every engine rounds the same:** + − × ÷ and
  `Math.sqrt` in `public/fountain.js`, never `sin`, `cos`, `pow`, `exp` or
  `**`. Held by a source check in `spec/fountain.test.ts`.
- **The loop comes round gently.** In the last 1 s every ball eases home,
  so the wrap never jumps.
- **The shared clock.** Each state event carries `serverTime`; the loop
  moment is shared time modulo 20 s.
- **Undo is yours alone:** it removes your own newest gesture.
- **Start over archives.** The loop goes to "Cleared loops" (newest 10
  shown, any can be brought back) and a silent one starts.

### Exhibits

- **Leave it** puts the stage's loop on a plinth: a title (1--40
  characters) and either an empty plinth, a taken plinth (the page asks
  first; the old exhibit goes to the storeroom), or a new version of an
  exhibit. The loop stays on the stage.
- **Versions are immutable**, each with its gestures, title, the visitors
  who played in it and who left it. No route changes or deletes one, and a
  trigger refuses `UPDATE` and `DELETE` on `versions`.
- **Restore makes a new version** with an old one's performance.
- **Join in** brings a version to the stage. If the stage has gestures the
  page asks first, and the old loop is archived.
- **Nothing published is deleted.** The storeroom holds exhibits off the
  plinths with every version; any can go back on an empty plinth.

### Live

- **SSE with the whole state in every event**, on connect and after every
  change, plus a 15 s heartbeat. Pointers go in a separate `pointers`
  event.
- **Presence is open streams.** The state lists who's here.
- **Disconnected means watch-only.** The page keeps playing, disables
  every control and says so, until the first state of a new connection.

### The page

- **Words for actions.** Buttons say what they do ("Leave it", "Join in",
  "Undo"); no icon-only control.
- **Every gesture also has a button** in the panel ("Flick teal", "Ring
  the bell"), so the toy works from the keyboard and without WebGL.
- **At 390x844** the scene is pinned on top and the panel scrolls under
  it; nothing scrolls sideways.
- **Every animation has a `prefers-reduced-motion` path.**

## How to work in here

- **Decide before code.** A change starts here (and as an ADR when there
  were real alternatives), then the server and its tests, then the page,
  in separate commits.
- **Red first.** A check counts once it has been seen failing with the rule
  broken.
- Run `pnpm check` against a throwaway local server
  (`DB_PATH=$(mktemp -d)/x.db PORT=8080 node src/server.ts`) before every
  commit. Never commit red.
- Look at the page at 1440x900 and 390x844 before calling a page change
  done.

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
