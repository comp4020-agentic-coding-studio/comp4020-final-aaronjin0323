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
[ADR 22](docs/adr/0022-stack.md), seeing each other play
[ADR 23](docs/adr/0023-aim-and-whose-ball.md), the hall
[ADR 24](docs/adr/0024-the-hall-and-the-robot.md), collecting
[ADR 25](docs/adr/0025-collecting-artifacts.md), playing together
[ADR 26](docs/adr/0026-playing-together-in-the-hall.md), leaving and coming
back [ADR 27](docs/adr/0027-leaving-and-coming-back.md).

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
- **Aim is live** ([ADR 23](docs/adr/0023-aim-and-whose-ball.md)). While
  someone drags a ball, everyone else sees a line in their colour from it,
  the way it will go, and a halo round it. The aim rides on the pointer
  and is held the same way: in memory only, checked like a flick.

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
- **A ball carries who last moved it** (ADR 23). A flick makes it yours,
  a ring makes every ball it pushes the ringer's, and a ball that knocks
  another passes its mover on; a ring by a ball is credited to that
  mover. For 1.5 s after, the ball trails and glows in their colour, and
  the stage card says the latest chain in words. Part of the rule, so it
  changes no position.
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

- **The store migrates safely.** Migrations are numbered (`user_version`);
  before applying any to an existing file the server copies it beside
  itself (`VACUUM INTO <db>.before-v<n>-<time>`), and each runs in a
  transaction that rolls back whole on any failure. Existing tables are
  never dropped or rewritten.
- **SSE with the whole state in every event**, on connect and after every
  change, plus a 15 s heartbeat. Pointers go in a separate `pointers`
  event.
- **Presence is open streams.** The state lists who's here.
- **Disconnected means watch-only.** The page keeps playing, disables
  every control and says so, until the first state of a new connection.
- **A refused stream is opened again by the page.** A browser gives up for
  good on an answer that isn't a stream (Fly's proxy answers 502 during a
  deploy or a cold start), so the page opens a new one: 1 s, doubling, at
  most 15 s apart. Held by the browser check's `reconnect`.

### The hall

- **A compact top-down 2D hall at `/hall/`**, beside the stage, not
  instead of it ([ADR 24](docs/adr/0024-the-hall-and-the-robot.md)). Each
  visitor with the hall open has a round robot in their colour.
- **Drag back from your robot to aim, let go to launch.** It goes the
  opposite way to the pull, harder the further you pull, up to full power.
  While you aim, the hall shows the path it will take, bounces included,
  and the power. A pull shorter than `MIN_PULL` cancels. The keyboard does
  the same: arrows turn the aim and change the power, Enter or Space
  launches, Escape cancels. Touch is a drag like the mouse.
- **The server says where every robot is.** A client sends only a launch
  (`dir`, `power` 0--1), never a position. The server keeps each robot as
  a snapshot (position, velocity, server time) and sends it on every
  change; every screen advances snapshots on the shared clock with the
  same rule. Your own launch is predicted at once and eased onto the
  server's snapshot.
- **One rule, `public/hall.js`**, shared by the server and the page: every
  movement number lives there (hall size, robot radius, `LAUNCH_MAX`,
  `PULL_MAX`, slowing down, wall bounce), and `advance` steps at 50 Hz (20 ms,
  so snapshot times stay whole milliseconds) with
  + − × ÷ and `Math.sqrt` only, held by a source check.
- **A launch replaces the velocity**, at most `LAUNCH_MAX`, so repeated
  launches never add up. Robots slow to a stop and rebound off the walls,
  losing some speed; they pass through each other for now.
- **Robots are presence:** in memory while a hall stream is open, never
  stored. What they carry and what's been collected is stored (below).

### Leaving and coming back

- **A grace of `GRACE_MS` (10 s)** after a visitor's last hall stream
  closes ([ADR 27](docs/adr/0027-leaving-and-coming-back.md)). Their robot
  is a ghost: faded, colliding with nobody, collecting, delivering and
  knocking nothing, and unknockable. Back in time: the same robot, where
  it is, with its cargo. Not: its cargo returns to the free safe spots
  nearest it, ready, and it leaves; they're told when they return.
- **Leaving never delivers**, and nor does coming back.
- **No race:** a join steps the hall to now first, so a passed deadline
  fires before it; releases are conditional per artifact, so twice is
  once.
- **Restarts:** every holder of carried cargo gets the grace from the
  start (back in time: in their zone, still carrying). A sweep every
  second releases cargo held by anyone with no robot and no grace.
- **Identity is the cookie, nothing more.** The same browser keeps its
  collection across refreshes, tabs, restarts and redeploys. Cleared
  data, a private window or another device is a new visitor, with no way
  to claim the old collection; the page says so. Never claim otherwise.
- **The directory of displays**: everyone who has arranged one, present
  or not, newest change first, 12 a page by a keyset cursor. Absent
  visitors appear only there, never as robots.
- **Limits on size and shape**: bodies over 4 KB `413`, at most 4 hall
  streams per visitor `429`, bounded pages, unknown fields refused.
- **Stale actions:** a launch whose `seq` isn't newer is `409
  stale-launch`; a display change sends the layout it was based on
  (`was`), `409 stale-display` if that changed. Both answer with the
  current state, and a new stream's first event resyncs the page.

### Together in the hall

- **One clock for every robot** ([ADR 26](docs/adr/0026-playing-together-in-the-hall.md)):
  snapshot times sit on a shared 20 ms grid and the tick steps every
  robot together. Changes go out on the step they happen, so other
  sessions see them well within a second; screens ease any correction.
- **Robots bounce off each other** as equal masses. A **knock** needs a
  closing speed of at least `KNOCK_SPEED`; the struck robot is the one
  clearly (`KNOCK_CLEAR`) moving less towards the other, and a tie drops
  nothing. The struck robot drops its newest carried artifact just
  beyond it, away from the striker, unless it carries nothing, is
  protected, or is within `SAFE_R` of its own zone. Strikers never drop.
- **A dropped artifact waits `PICKUP_DELAY_MS`** before anyone can pick it
  up (faded, a ring filling); **the robot that dropped it is protected
  `DROP_PROTECT_MS`** (a fading shield). No numbers counting down.
- **Zones are fair:** all drawn, yours solid in your colour, others' in
  theirs; a zone that isn't yours is solid to your robot (in the shared
  rule), and nothing is knocked loose near its owner's zone.
- **Deposited is final**: no route, rule or trigger takes it back.
- **Displays are public, read-only**: each robot carries its owner's real
  display; "Here now" has a button to look at each. Only people with the
  hall open appear; nobody is invented, and alone it plays the same.

### Collecting

- **Three kinds of artifact, one set of rules** ([ADR 25](docs/adr/0025-collecting-artifacts.md)):
  a luminous flying fish, a rain-filled cloud, a small door onto stars.
- **New ones keep six on the floor**, in safe public spots (a fixed list in
  `public/hall.js`: inside the walls, clear of every zone and of each
  other), topped up whenever one is picked up. Each has a UUID. Knocked
  and returned cargo comes back on top of the six, so the floor holds at
  most six plus whatever players carry.
- **Touching one collects it** once it's ready, up to three carried. The server sees the
  touch: a 50 ms tick walks each moving robot along its 20 ms steps
  against the artifacts. Pages never send a pickup, a deposit, a player ID
  or a count.
- **Your delivery zone** is one of eight pads round the walls, assigned
  when you first enter the hall and stored. Your robot starts there.
  Moving in it delivers everything you carry; standing in it doesn't.
- **An artifact is available, carried or deposited, never two**: one row,
  one `state`, a CHECK, and a trigger allowing only available → carried →
  deposited. Pickup and deposit are single conditional UPDATEs in a
  transaction, so they're atomic, and doing either twice changes nothing.
- **Cargo shows behind the robot**: what it carries, and the room left,
  for everyone to see. Counts and cargo come only from the server's
  stream; nothing past movement is predicted.
- **Collections never expire**, and there are no rounds or countdowns.
  Cargo is another matter (below).
- **Your display** is four fixed slots, each empty or one kind you own,
  each kind once, shown with how many you have. Saved on the server.

### The page

- **Words for actions.** Buttons say what they do ("Leave it", "Join in",
  "Undo"); no icon-only control.
- **Every gesture also has a button** in the panel ("Flick teal", "Ring
  the bell"), so the toy works from the keyboard and without WebGL.
- **At 390x844** the scene is pinned on top and the panel scrolls under
  it; nothing scrolls sideways.
- **Every animation has a `prefers-reduced-motion` path.**

## The contract

Every `POST` takes and answers JSON, refuses a body over 4 KB with `413
too-large` and a cross-site `Origin` with `403 cross-origin`; every refusal is `{ error, message }`. A `state` event
is the whole museum plus `you` and `serverTime`.

| Route | Body | Does | Refusals |
|---|---|---|---|
| `GET /` | | the page, with the plinths listed in HTML | |
| `GET /readme/` | | README.md rendered | |
| `GET /me` | | `{ tag, name, colour }` | |
| `GET /events` | | SSE: `state`, `pointers` | |
| `GET /hall/` | | the hall | |
| `GET /hall/events` | | SSE: `hall`, every robot's snapshot plus `you` and `serverTime` (ms) | |
| `GET /exhibits/:id` | | every version, newest first | `404` |
| `GET /archive?before=<id>` | | the next 10 cleared loops older than `id` | `400` |
| `POST /me` | `{ name }` | rename | `400` |
| `POST /pointer` | `{ p: [x, y, z] \| null, aim?: { ball, v } }` | where your pointer is in the room, and the flick you're aiming, in memory only | `400` |
| `POST /stage/gesture` | `{ gesture }` | add a gesture | `400` |
| `POST /stage/undo` | | remove your newest gesture | `409 nothing-to-undo` |
| `POST /stage/clear` | | archive the loop, start a silent one | `409 stage-empty` |
| `POST /stage/bring-back` | `{ archivedId, replace? }` | a cleared loop back on the stage | `409 stage-busy`, `404`, `400` |
| `POST /stage/join` | `{ versionId, replace? }` | a version onto the stage | `409 stage-busy`, `404`, `400` |
| `POST /publish` | `{ title, slot \| exhibitId, replace? }` | leave the loop on a plinth | `409 stage-empty`, `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/restore` | `{ versionId }` | an old version again, as the newest | `404`, `400` |
| `POST /exhibits/:id/display` | `{ slot, replace? }` | a storeroom exhibit onto a plinth | `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/store` | | off its plinth, into the storeroom | `409 slot-empty`, `404` |
| `POST /hall/launch` | `{ dir: [x, y], power, seq }` | launch your robot; answers its snapshot | `409 no-robot` (no hall open), `409 stale-launch`, `400` |
| `POST /hall/display` | `{ slots: [kind \| null, ×4], was }` | arrange your display, from the layout you saw | `409 not-owned`, `409 stale-display`, `400` |
| `GET /hall/displays?before=<cursor>` | | the directory: 12 displays, newest change first, and the next cursor | `400` |

Held by `spec/store.test.ts` (over `:memory:`) and `spec/http.test.ts`
(against the running app, including a gesture reaching another visitor's
stream within 1000 ms). Logs are one line per event, `event key=value`,
a person as their tag.

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
  two visitors (drag a ball, ring the bell, pointers, aim, keyboard, Leave
  it, a refused stream, the hall, collecting, together, no WebGL, no
  script) and screenshots into `.shots/`. Read the shots; it isn't in CI,
  which has no Chrome.
- Before a change to the store, the hall or the server is done, run
  `node scripts/restart-check.ts`: it starts and kills its own servers on
  a throwaway database and plays a visitor through a graceful restart, a
  crash, and a new session with the same cookie. Not in CI either. A
  redeploy on Fly is the same restart, but is untested there.

## Out of scope

Faces or customisable avatars (the hall's robot is a plain round token in
your colour, ADR 24), chat, accounts and passwords,
uploaded assets, runtime AI models, a physics library, VR, an infinite
world, sliders or parameter panels, more rooms than the stage and the
hall, leaderboards, rate limiting; puzzles, and goals beyond the
collection loop the student asked for (ADR 25); in the hall, for now,
trading, upgrades, elimination or combat upgrades (knocks, ADR 26, are
the only contest), rounds, countdowns, expiry and decoration.

## The live museum is not a test fixture

- **Never point `pnpm check` at the live URL.** The checks act as visitors
  and would leave their data on the museum the marker sees. It's enforced:
  `spec/not-production.ts` makes the spec refuse any `fly.dev` host before
  it sends a request, held by `spec/not-production.test.ts`. Don't weaken it
  to get a check to run.
- **Ask before every push.** The repo is public, so a push to `main` is a
  deploy. One yes doesn't cover the next.
