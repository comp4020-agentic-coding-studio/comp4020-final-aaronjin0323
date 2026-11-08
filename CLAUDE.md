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
  mark, the lowest free slot, for as long as the robot lasts. Your page is
  washed faintly in your slot's colour, so coming back from your room you
  see which robot is yours even if your slot changed.

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
  at safe spots clear of the vault and the robots' starting spots, and only
  with someone playing. Per
  player, both the target and the spawn rate fall as players join, and the
  chance of a rare or mythic rises. Nothing expires; scattered artifacts can
  take the floor over its target.
- **Touching one collects it** once it's ready, seen by the server only.
- **One vault in the middle, the only delivery point.** Moving in it banks
  everything you carry into your permanent collection; standing in it
  doesn't. A contact on the same step comes first. Banked is final.
- **An artifact is available, carried or banked, never two:** one row, one
  `state`, a CHECK and a trigger, and single conditional UPDATEs.
- **Your collection lives in your room:** every artifact you've banked as its
  own card, newest first, with the closed catalog under it: twelve entries,
  silhouettes until found.
- **What persists:** your collection, the floor, and the all-time vault
  total. There are no rounds, countdowns or expiry. Robots
  are presence, in memory only.

### Your room

- **Everyone has an exhibition room** at `/room/<tag>`
  ([ADR 31](docs/adr/0031-exhibition-rooms.md)), `/room/` being your own: a
  isometric room ([ADR 33](docs/adr/0033-walkable-isometric-room.md)), a
  layout of wall, floor, light and at most `ROOM_MAX_ITEMS` items. Everything placeable is in `public/room.js`.
- **Artifacts stand on stands,** one each, once in a room, and only ones the
  room's owner banked. The store checks ownership; nothing else can.
- **Only the owner can edit, and it's enforced by shape:** `POST /room` names
  no room, so it can only change the sender's own. The page shows editing
  only to the owner, but that's manners; the route is the rule.
- **Saves are explicit and revisioned:** a save from an old revision is
  `409 stale-room`. Layouts persist across restarts.
- **No free text in a room.** Names are generated from the tag; no titles or
  captions. Rooms are public, and read-only to everyone but their owner.
- **A room is shared in real time** ([ADR 36](docs/adr/0036-rooms-are-shared-in-real-time.md)):
  everyone with the room open sees everyone else in it walk or sit, within
  about a second, as a robot coloured by their tag (yours ringed white).
  Presence is memory only, never stored, at most `PRESENCE_MAX` walkers a
  room, one per visitor; the server checks a walk's shape and that you're in
  that room, nothing more. An owner's save reaches everyone in the room.
- **Every way out of a room says why** ([ADR 37](docs/adr/0037-every-way-out-says-why.md)):
  in your own room, ← Arena (how many are playing) and Visit rooms (how many are
  in rooms); in anyone else's, Your room (in your colour, with anything new)
  and ← Arena. The list of rooms says how many are in each now. A collection
  shows rarity at a glance: rarest first, each card in its material, with
  no tier word on it.
- **Arranging works like a decorating game** ([ADR 34](docs/adr/0034-room-editor-like-a-decorating-game.md)):
  three tabs over picture tiles ([ADR 35](docs/adr/0035-say-less-show-the-next-thing.md));
  a tile places its item, selected; Turn, Colour and Remove appear on the room
  only for what's selected; a muted palette tints it, or the wall or floor;
  things snap to a grid; small things stack on surfaces; a picture button
  saves a PNG locally. Mechanics are copied, never art.
- **Each kind of control looks like its job:** one filled primary (Done, which
  saves), quiet Cancel, tiles for choosing and adding, a tick on what's chosen,
  and Remove marked as destructive. Done stays in reach.
- **You walk it:** a local robot, by tap or click (routed round things) or
  arrows and WASD, blocked by what's placed, never stored or sent. Near an
  artifact, it stirs and a prompt offers a close look; benches and chairs can
  be sat on. Arranging hides the robot.
- **Close observation:** any exhibited artifact opens large, with a light you
  move and a short wake. The room also lists them as
  buttons, so nothing depends on the canvas.

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

### The journey

- **Grab, deliver, exhibit** ([ADR 32](docs/adr/0032-one-player-journey.md))
  is shown, not listed ([ADR 35](docs/adr/0035-say-less-show-the-next-thing.md)):
  the arena marks the next thing itself, and the Room button glows when
  something of yours isn't on show.
- **At risk is amber and dashed; kept for good is solid gold,** everywhere.
  Never mix them.
- **Weight is felt:** the aim line and the flight show it.
- **Guidance is one mark on the arena, three words at most,** gone once done.
  Words about you only, never about anyone else.
- **Every delivery is an event:** a burst at the vault for everyone, the
  message for the deliverer.

### The page

- **SSE with every robot's snapshot** on every change, plus a heartbeat. A
  refused stream is opened again, 1 s doubling to 15 s. Disconnected means
  watch-only, and the page says so.
- **Silence counts as lost.** A network can vanish without a stream ever
  closing, so a `beat` event goes out every `BEAT_MS`, and a page that hears
  nothing for `BEAT_MISS_MS` drops the stream, says so and reconnects.
- **Each screen has a budget of words and controls,** enforced by
  `browser-check`'s `budget` section. Add to a screen only by removing
  something, or by raising the budget with a reason.
- **At 390x844** the arena fills the width, a pull pad fills the rest, and
  nothing scrolls sideways; at 844x390 the arena fills the height.
- **Every animation has a `prefers-reduced-motion` path.**

## The contract

Every `POST` takes and answers JSON, refuses a body over 4 KB with `413
too-large` and a cross-site `Origin` with `403 cross-origin`; every refusal
is `{ error, message }`.

| Route | Body | Does | Refusals |
|---|---|---|---|
| `GET /` | | the arena | |
| `GET /readme/` | | README.md rendered | |
| `GET /events` | | SSE: `arena`, every robot, the floor, `hits`, `deliveries`, `mine`, `you`, `serverTime` (ms) | `429` over 4 streams |
| `GET /collection` | | your newest 60 banked artifacts and your catalog counts | |
| `GET /room/`, `GET /room/:tag` | | the room page, yours or theirs | |
| `GET /rooms/me` | | your room, your `shelf` for editing, `mine: true` | |
| `GET /rooms/:tag` | | a room: `layout`, `rev`, `name`, its `artifacts`, and `mine` | `404` |
| `GET /rooms?before=<cursor>` | | 12 rooms with something on show, newest change first, each with `here` (how many are in it now), the next cursor, and `playing` (robots in the arena) | `400` |
| `POST /room` | `{ layout, was }` | save your own room, from revision `was` | `400`, `409 stale-room`, `409 not-owned` |
| `GET /rooms/:tag/live` | | SSE in that room: `room`, every `walkers` entry `{ tag, x, y, face, moving, sitting, seat }`, `you`, `rev`, `serverTime` | `404`, `429` over 4 streams |
| `POST /rooms/:tag/walk` | `{ x, y, face: [x, y], moving, sitting, seat }` | where you are in a room you have open | `400`, `404`, `409 not-in-room`, `429 too-fast` |
| `POST /launch` | `{ dir: [x, y], power, seq }` | launch your robot; answers its snapshot | `409 no-robot`, `409 stale-launch`, `400` |

Held by `spec/arena-rule.test.ts`, `spec/arena.test.ts` (the real arena and
store with a test clock), `spec/room.test.ts`, `spec/store.test.ts` and `spec/http.test.ts`
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
  line for a robot, a refused stream, no script, a room edited, saved and
  visited, two people in one room seeing each other walk) and screenshots into `.shots/`. Read the shots; it isn't in CI,
  which has no Chrome.
- Before calling multiplayer behaviour done, run
  `node scripts/session-check.ts`: 2 to 5 independent sessions on throwaway
  databases, checking every event each one receives and auditing the
  database (sync, scatter, settling, contested pickups, a 40 s four-way soak,
  spawning, ownership, refreshes, restarts). Not in CI; about 4 minutes.
- Before a change to the store, the arena or the server is done, run
  `node scripts/restart-check.ts`: it starts and kills its own servers on
  a throwaway database and plays a visitor through a graceful restart, a
  crash, and a new session with the same cookie. Not in CI either. A
  redeploy on Fly is the same restart, but is untested there.

## Out of scope

Accounts, names, chat, emotes, avatars, uploaded assets, runtime AI models,
a physics library, more arenas, bots, leaderboards of people, free text
in rooms, a 3D renderer, rounds,
countdowns, upgrades, elimination, rate limiting.

## The live arena is not a test fixture

- **Never point `pnpm check` at the live URL.** The checks act as visitors
  and would leave their data on the arena the marker sees. It's enforced:
  `spec/not-production.ts` makes the spec refuse any `fly.dev` host before
  it sends a request, held by `spec/not-production.test.ts`. Don't weaken it
  to get a check to run.
- **Anything sent to the live site by hand is read-only: `GET` only.** The
  guard above covers the checks, not a one-off request, and any request can
  create a visitor. A `POST` to confirm a deploy once left a stray visitor in
  the live database (22 Oct). Confirm a deploy by fetching pages and files;
  drive the live page in a browser only with every non-`GET` request blocked.
- **Ask before every push.** The repo is public, so a push to `main` is a
  deploy. One yes doesn't cover the next.
