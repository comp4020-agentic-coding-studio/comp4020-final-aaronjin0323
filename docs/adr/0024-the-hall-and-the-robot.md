# 24. The hall: a robot you launch, moved by the server

- **Status:** accepted, week 12
- **Decides:** what the hall is, how a robot moves, and who decides where
  it is

## Context

The student asked (26 Oct) for a compact top-down 2D museum hall with a
round player robot: drag back from the robot to aim, let go to launch,
with a preview of direction and strength, capped power, deceleration and
rebounds off the walls; mouse, touch and keyboard; movement numbers in one
place. It must be built on a server-authoritative model suitable for
multiplayer: a client may predict, but never says where a robot is. No
artifacts, trading, upgrades or decoration yet.

Two lines of Out of scope stood against this ("bodies ... or avatars",
"multiple rooms"). The request decides it: a robot is a plain round token
in your colour, not customisable, and the hall is one more page.

## Decision

- **The hall is its own page, `/hall/`.** The fountain stage at `/` is
  unchanged. Whether the hall replaces it later is still open.
- **One shared rule, `public/hall.js`**, like the fountain's: every
  movement number, the launch check, and `advance`, which steps a robot at
  a fixed 60 Hz with + − × ÷ and `Math.sqrt` only. The server and the page
  import the same file, so the same snapshot gives the same path on both.
- **The server owns every robot.** It keeps each one as a snapshot:
  position, velocity and the server time they hold for. A client sends
  only a launch (`dir`, `power` 0–1); the server advances that robot to
  now, sets its velocity, and sends everyone the new snapshot. Between
  snapshots, every screen works out where a robot is by advancing it to
  the shared clock: no stream of positions, and walls and slowing down
  come out the same everywhere.
- **A launch replaces the velocity, never adds to it**, at most
  `LAUNCH_MAX` m/s. Ten launches in a row are as fast as one.
- **Your own launch is predicted.** The page moves your robot at once by
  the same rule, then takes the server's snapshot when it comes, easing
  out any difference rather than jumping.
- **Robots are presence**, like pointers: one per visitor while a hall
  stream is open, kept in memory, gone when the visitor leaves. Nothing
  is stored, so there is no migration.

Turned down:

- **The client sends its position.** Simple, but anyone could put a robot
  anywhere; the brief rules it out.
- **A server tick broadcasting positions 20 times a second.** Needed once
  robots collide with each other; until then, snapshots on change and a
  shared rule send far less and show the same thing.
- **A launch adds to the velocity, clamped.** Lets you steer a moving
  robot, but makes the cap the only limit; replacing is simpler to read.
- **Storing robots.** Nothing about a robot needs to survive a restart
  yet; artifacts or progress will, and they get a table and a migration
  then.

## Consequences

- Robots pass through each other. Collisions mean the server has to step
  all robots together on a tick; `advance` is already per-step, so the
  change is where it's called, not the rule.
- A restart puts every robot back at a spawn point.
- The rule's arithmetic must round the same in every engine; a source
  check holds it, as for the fountain.
