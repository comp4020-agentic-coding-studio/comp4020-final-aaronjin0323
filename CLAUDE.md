# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Goal

**The arena** is a continuously open top-down arena for 2 to 4 strangers,
about chaotic collisions, chases and opportunistic steals
([ADR 28](docs/adr/0028-the-arena.md)). Open the URL and you're in.

**The loop:** grab what's lying around, get greedy, get slow, try to reach
the vault while everyone else tries to hit you.

**Good, here:** the fun is what strangers do to each other in the moment.
Every launch answers at once, and a hit always means something. Being
loaded is a choice you feel. Nothing needs reading first, and nobody says
a word: chasing, circling and backing off are the conversation. These are
starting decisions: change them when evidence warrants it, with the reason
recorded here and in an ADR.

## Decisions

Settled; change them here first, then in the code. Earlier ADRs are history:
ADR 28 says which still stand.

### Who is who

- **A visitor is a cookie.** A new browser gets a random `pid` (UUID,
  HttpOnly, `SameSite=Lax`, `Secure` in production, one year). No accounts.
- **The pid never leaves the server.** Everyone else sees a `tag`, the
  first 8 hex of its SHA-256, in every payload and log line.
- **Movement is the only voice.** No names, chat, emotes, or words about
  other players. Your aim is private until you let go.
- **A robot's slot (0 to 3) is its identity on screen:** a colour and a
  mark, the lowest free slot, for as long as the robot lasts.

### One rule

- **`public/arena.js` is shared by the server and the page.** Every number
  lives there. `advance` steps at 50 Hz with + − × ÷ and `Math.sqrt` only,
  held by a source check.
- **The server says where every robot is.** A page sends only a launch
  (`dir`, `power` 0 to 1, `seq`), never a position. Robots are snapshots
  (position, velocity, server time) on a shared 20 ms grid, stepped
  together. Your own launch is predicted at once and eased onto the
  server's snapshot.

### Moving

- **Slingshot only.** Press anywhere, drag back, let go: the robot goes
  opposite the drag, harder the further you pull, full power at `PULL_MAX`.
  Shorter than `MIN_PULL` cancels. There is no other movement.
- **A launch works at any moment**, moving or not, with no cooldown.
- **While you aim you see the path it will take** from where you are now,
  with your load. Keys do the same: arrows aim, Enter or Space launches,
  Escape cancels. Touch is a drag.
- **Load:** each carried artifact lowers the launch cap
  (`loadCap(n)`) and keeps more of your old velocity (`loadKeep(n)`), so
  loaded robots are slower and harder to turn. At most `CARRY_MAX`.
- **Speed is bounded:** no launch beats `loadCap`, nothing beats
  `SPEED_MAX`, a collision included.
- Robots slow to a stop and rebound off walls.

### Contact

- **Every contact scatters both robots' entire cargo**
  ([ADR 29](docs/adr/0029-every-contact-scatters.md)), whatever the speed
  and whoever started it. A contact is any step on which two robots
  overlap and are closing. Robots bounce as equal masses. No striker, no
  shield.
- **Artifacts fan outward,** away from the other robot, to spots the server
  picks on that step, inside the walls and out of the vault. After
  `SETTLE_MS` anyone can take them, their previous owner included; before
  that, nobody can.

### Artifacts and the vault

- **An artifact is a kind, a material and a seed** ([ADR 30](docs/adr/0030-supply-and-collecting.md)):
  a flying fish, a rain cloud or a door onto stars, in tin (common), glass
  or gold (rare), or starlight (mythic). The seed varies its details. All
  weigh the same; rarity shows as a halo.
- **`SPAWN` in `public/arena.js` holds every spawn and rarity parameter,**
  by active players (robots not ghosts, 0 to 4), and `createArena` accepts
  another table.
- **One artifact appears each `everyMs` while the floor is under `target`,**
  at safe spots clear of the vault, and only with someone playing. Per
  player, both the target and the spawn rate fall as players join, and the
  chance of a rare or mythic rises. Nothing expires; scattered artifacts can
  take the floor over its target.
- **Touching one collects it** once it's ready, seen by the server only.
- **One vault in the middle, the only delivery point.** Moving in it banks
  everything you carry into your permanent collection; standing in it
  doesn't. A contact on the same step comes first. Banked is final.
- **An artifact is available, carried or banked, never two:** one row, one
  `state`, a CHECK and a trigger, and single conditional UPDATEs.
- **Your collection comes first:** every artifact you've banked as its own
  card, newest first. The catalog is a closed section under it: twelve
  entries, silhouettes until found.
- **What persists:** your collection, the floor, and the all-time vault
  total. There are no rounds, countdowns or expiry. Robots
  are presence, in memory only.

### Staying and leaving

- **Four robots at most** (`MAX_PLAYERS`). Anyone else watches, sees their
  place in line, and gets the next free robot in order.
- **A grace of `GRACE_MS` (10 s)** after your last stream closes: your
  robot is a ghost, faded, touching nothing, and keeps its slot. Back in
  time: the same robot. Not: its cargo returns to the free spots nearest
  it and it leaves.
- **Restarts:** everyone carrying gets the grace from the start; a sweep
  every second releases cargo held by anyone with no robot and no grace.
- **Identity is the cookie.** Cleared data or another device is a new
  visitor, and the page says so.
- **The store migrates safely:** numbered migrations, a copy beside the
  file first, each in a transaction.

### The page

- **SSE with every robot's snapshot** on every change, plus a heartbeat. A
  refused stream is opened again, 1 s doubling to 15 s. Disconnected means
  watch-only, and the page says so.
- **Nothing is explained by a wall of text:** one short line of how to
  play, your cargo, your collection under the arena. At 390x844 the arena fills the width and
  nothing scrolls sideways.
- **Every animation has a `prefers-reduced-motion` path.**

## The contract

`POST /launch` takes and answers JSON, refuses a body over 4 KB with `413
too-large` and a cross-site `Origin` with `403 cross-origin`; every refusal
is `{ error, message }`.

| Route | Body | Does | Refusals |
|---|---|---|---|
| `GET /` | | the arena | |
| `GET /readme/` | | README.md rendered | |
| `GET /events` | | SSE: `arena`, every robot, the floor, `mine`, `you`, `serverTime` (ms) | `429` over 4 streams |
| `GET /collection` | | your newest 60 banked artifacts and your catalog counts | |
| `POST /launch` | `{ dir: [x, y], power, seq }` | launch your robot; answers its snapshot | `409 no-robot`, `409 stale-launch`, `400` |

Held by `spec/arena-rule.test.ts`, `spec/arena.test.ts` (the real arena and
store with a test clock), `spec/store.test.ts` and `spec/http.test.ts`
(against the running app, including a launch reaching another stream within
1000 ms). Logs are one line per event, `event key=value`, a person as a tag.

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
  done: `node scripts/browser-check.ts` against the local app plays it as
  several visitors (launching, a launch while moving, keys, a scatter, the
  line for a robot, a refused stream, no script) and screenshots into `.shots/`. Read the shots; it isn't in CI,
  which has no Chrome.
- Before a change to the store, the arena or the server is done, run
  `node scripts/restart-check.ts`: it starts and kills its own servers on
  a throwaway database and plays a visitor through a graceful restart, a
  crash, and a new session with the same cookie. Not in CI either. A
  redeploy on Fly is the same restart, but is untested there.

## Out of scope

Accounts, names, chat, emotes, avatars, uploaded assets, runtime AI models,
a physics library, more arenas, bots, leaderboards of people, rounds,
countdowns, upgrades, elimination, rate limiting.

## The live arena is not a test fixture

- **Never point `pnpm check` at the live URL.** The checks act as visitors
  and would leave their data on the arena the marker sees. It's enforced:
  `spec/not-production.ts` makes the spec refuse any `fly.dev` host before
  it sends a request, held by `spec/not-production.test.ts`. Don't weaken it
  to get a check to run.
- **Ask before every push.** The repo is public, so a push to `main` is a
  deploy. One yes doesn't cover the next.
