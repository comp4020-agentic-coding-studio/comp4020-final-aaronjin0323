# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.


## Goal

**Impossible Museum** is a small, shared 3D gallery where visitors play
impossible objects together on one stage, improvising short absurd
performances, and leave them on plinths for the next visitors to find and
join. It's built for a handful of people visiting together for five to ten
minutes, including someone opening the URL with no introduction. It
replaces Skyline ([ADR 11](docs/adr/0011-rebuild-after-skyline.md)); the
museum is [ADR 12](docs/adr/0012-impossible-museum.md), and what visitors
do in it is [ADR 16](docs/adr/0016-loop-stage.md).

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

Settled; change them here first, then in the code.

### Who is who

- **A visitor is a cookie.** A new browser gets a random `pid` (UUID v4,
  HttpOnly, `SameSite=Lax`, `Secure` in production, one-year `Max-Age`), and
  the server creates a `visitors` row for it on first sight, with a generated
  display name ("Coral Heron") and a colour index. Two browser profiles are
  two visitors. No accounts, passwords or email.
- **A name is a label, never proof.** A visitor may rename themselves (1--24
  characters after trimming, escaped on every output; anything else is a
  `400`, never truncated). Names may collide; the colour and tag tell people
  apart. Nothing the page sends is trusted as identity except the cookie.
- **The pid never leaves the server.** Everyone else sees a visitor as
  `{ tag, name, colour }`, where `tag` is the first 6 hex of a SHA-256 of the
  pid: in every payload, in the logs, and in attribution.

### The museum

- **One gallery: six plinths round one stage.** Six exhibition slots,
  numbered 1--6, each playing a saved performance on a loop, and the stage
  at the centre holding the live one. No rooms, no free-roaming avatars.
- **A performance is a set and a loop of gestures** (ADR 16). The set
  names the objects; the loop is up to 40 gestures, each at a moment (0 to
  30 s) of a 30 s loop. What every set shares (the loop, caps, checking,
  runs) lives in `public/stage.js` with the registry `SETS`; each set's
  objects, gesture shapes, bounds and step live in `public/sets/<id>.js`,
  the one copy, imported by the server (to refuse) and the page (to play).
  An out-of-range or unknown value is a `400`, never clamped.
- **Four sets, each a plug-in** (ADR 18): `orbit` (four spheres that fall
  upward, a ribbon, a bell), `chimes` (a ring of tuned chimes and a
  striker on a cord), `doors` (two door frames joined to each other, three
  bouncy balls) and `seesaw` (a plank on a pivot, three stones). A set's
  look, touch, buttons and sounds live in `public/sets/<id>-view.js`; the
  scene, page and server ask the set and never name an object. The stage
  card's set row starts a silent loop on another set, asking first and
  archiving a loop with gestures (`POST /stage/clear` with `set`). Each new
  set has one starter performance (migration 4), on a free plinth or in
  the storeroom.
- **What happens on the stage is a rule, not a record.** The objects' every
  position at every moment comes from the set, the gestures and the shared
  clock alone, by a fixed 60 Hz step from the start of the loop with no
  randomness (`simulate` in `public/stage.js`). Every screen computes the
  same performance; no frame writes to the server. Held by
  `spec/stage.test.ts`.
- **The rules use only arithmetic every engine rounds the same.** In
  `public/stage.js` and every rules file in `public/sets/`: + − × ÷ and
  `Math.sqrt` (exactly rounded by IEEE 754 in every browser), never `Math.sin`, `cos`, `pow`, `exp` or `**`, which
  JavaScript lets each engine approximate differently in the last digit,
  enough for Safari and Chrome to disagree about a collision a few seconds
  in. The ribbon's curve uses a fixed polynomial sine of its own. Held by a
  source check in `spec/stage.test.ts`, by a fingerprint of a busy
  performance's exact positions, and by the browser check's `engines`
  section, which plays stage.js in macOS's JavaScriptCore (Safari's
  engine) and in Node (Chrome's) and compares every position bit for bit
  (seen red against the old Math.sin rules: 4 s in, a sphere a last digit
  apart).
- **Every set looks the same in Safari's engine as in Chrome.** The
  browser check's `webkit` section opens each set in Playwright's WebKit
  beside Chrome, needs no script errors and the same rules to the bit on
  the page's own modules, and compares the stage's pixels: no speckle where
  Chrome is smooth (the doors' membrane glow, a 2D-canvas texture,
  uploaded as coloured noise in WebKit on a real Apple GPU, with or
  without mipmaps; it is computed bytes, a `DataTexture`, now). The
  section skips with a notice
  when the matching WebKit isn't installed (`npx playwright-core install
  webkit`).
- **The loop comes round gently, never with a jump.** In the last
  `GLIDE` (1.2 s) of each loop every sphere eases back to where it rests,
  so the first frame of the next loop is where the last one ended; a soft
  chime and a ring of light across the stage floor mark "from the top".
  The easing is a pure function of the loop moment (`shownAt` in
  `public/stage.js`), so every screen still shows the same thing. Held by
  `spec/stage.test.ts` (no sphere moves further between two frames across
  the wrap than a thrown one does in flight) and the browser check's `wrap`
  section. (At 12 s with a hard reset, the spheres visibly snapped back,
  which read as the sculpture glitching.)
- **A gesture made during the glide plays at the top of the next loop.**
  Everything is easing home in the last `GLIDE`, so a throw made then
  barely moved and only really played 30 s later: a button press that
  seemed to do nothing. The page records such a gesture at moment 0
  (`gestureMoment` in `public/stage.js`), so it plays as the loop comes
  round, within 1.2 s. Held by `spec/stage.test.ts` and by the browser
  check's seesaw section, which failed whenever its drop landed in the
  glide (at 29.4 to 29.6 s, every full run).
- **The objects set each other off.** A thrown sphere floats upward,
  bounces off the ceiling and other spheres; passing close to the ribbon
  it's caught and rides it. Plucking the ribbon sends a pulse round it that
  flings riders off. Tapping the bell, or a sphere hitting it, rings it,
  and spheres near it hop away. The tuning numbers live in one place in
  `public/stage.js`.
- **Three starter performances are seeded once** (a numbered migration),
  on plinths 1--3, published by the museum. Exhibits made with the old
  sculpture recipes moved to the storeroom in the same migration, every
  version kept.

### The stage (the shared loop)

- **Anyone present can play.** Every accepted gesture is written to the
  database before it's broadcast. The stage is never empty: "Start over"
  archives the loop and leaves a silent one.
- **A gesture is the only write.** `POST /stage/gesture` adds one gesture
  at the loop moment the page says it happened. The loop holds at most 40,
  and at most 12 from any one visitor: past 12 your own oldest drops, past
  40 the oldest of all. So nobody can crowd others out by mashing a button.
  Other viewers see a gesture within about a second.
- **Grabbing takes it.** Picking up a holdable object (a sphere, the
  striker, a ball, a stone: the set says which) claims it for 10 s
  (`POST /stage/grab`), shown to everyone as the holder's colour ring.
  Anyone may grab a sphere someone else holds: the claim moves to them and
  the answer names who lost it, so both screens can show the tug. A throw
  needs the claim and ends it; a throw of a sphere someone has since
  grabbed is `409 taken`, naming the taker. Plucks and taps need no claim.
  Claims end on the clock or on disconnect, like the old leases, and are
  never fought over in silence.
- **Undo is yours alone.** `POST /stage/undo` removes your own newest
  gesture still in the loop, never anyone else's.
- **Replacing the loop archives it.** "Join in" on a plinth brings that
  performance to the stage; if the stage has gestures, the request has to
  say `replace: true`, which the page asks for first, and the old loop is
  archived in the same transaction. Every archived loop stays reachable
  (the newest 12 in the state, the rest by `GET /archive?before=`), and
  any can be brought back.
- **Credit follows the gestures.** A loop's credits are everyone with a
  gesture in it, counted per gesture; a performance joined from a plinth
  records the version it came from.

### Exhibits and versions

- **Anyone may leave the live loop as an exhibit version.** "Leave it"
  takes a title (1--40 characters, a playful one suggested) and either a
  new slot or an existing exhibit to add a version to. The loop stays on
  the stage after.
- **Versions are immutable.** No route updates or deletes a version row,
  and a database trigger refuses `UPDATE` and `DELETE` on `versions`. Every
  version keeps its contributors (names and colours as they were) and its
  publisher.
- **Restore makes a new version.** Restoring version 2 publishes version
  N+1 with version 2's performance and `restoredFrom` set.
- **Six slots, never silent eviction.** Leaving a new exhibit on a slot
  someone's exhibit holds is a `409 slot-taken` unless the request says
  `replace: true`; the page shows what's there and asks. The old exhibit
  goes to the **storeroom** with all its versions. Nothing published is
  ever deleted.

### Live, and leaving

- **SSE, with the whole state in every event.** `GET /events` sends a
  `state` event on connect and after every change, so a reconnecting page is
  right from its first message. A 15 s comment heartbeat keeps Fly's proxy
  from closing an idle stream. On `SIGTERM` every stream ends and the
  database closes.
- **Presence is open streams.** A visitor is present while at least one of
  their streams is open; the event lists who's here and what each holds.
  Presence is never stored.
- **Disconnected means watch-only.** When the stream drops, the page keeps
  playing the museum, disables every control, and says so. It re-enables
  play only after the first `state` event of the new connection.
- **The shared clock.** Each event carries `serverTime`; the page keeps an
  offset against its own clock, and the loop's moment is the shared time
  modulo 30 s, so two screens show the same moment of the same performance.

### Show, don't tell (ADR 13)

A visitor reads the room, not the page. The objects carry the meaning and
words are labels. Read `docs/adr/0013-show-dont-tell.md`.

- **A word budget, held by a check.** The first screen shows at most 40
  visible words on desktop and 30 on the phone, on the stage view and on a
  plinth (`scripts/browser-check.ts`, `words`). Names, titles and numbers
  count. Explanations live in accessible names, `title` tooltips and
  `/readme/`.
- **The room is the menu.** Plinths and the stage are picked in the 3D
  room; the plinth row is a strip of small thumbnails with the title only as
  an accessible name and on hover/focus.
- **Icons and colour over sentences.** Every action button is an icon with
  an accessible name and a tooltip; only the doors keep a word: Leave it,
  Join in, Undo, Gallery. The words for touching an object are the
  reticle's hint (ADR 19), not the panel's. Who you are is your coloured dot; who's here is a
  row of dots; what someone holds wears their colour ring.
- **No parameter panels.** Nothing on the stage is set with a slider or a
  number field. Objects are changed by touching them.
- **History is a strip of versions**, chips in each publisher's colour.
  The storeroom and archive are icon drawers, closed by default.
- **Feedback is motion and sound, then a word.** Every catch, ring, pluck
  and collision shows on the object and plays a short sound; a toast is at
  most four words.
- **Nothing is lost for screen readers or keyboards.** Every hidden word
  still exists as an accessible name, and every gesture keeps a real button.

### Explore and play are one motion (ADR 14, 16)

- **Everyone starts watching the stage.** The panel is a compact card for
  what's selected: the stage (its credits, Undo, Leave it) or a plinth (its
  title, credits, versions, Join in). No editor to open: touching an object
  on the stage is playing.
- **The gesture buttons are on the stage card but out of sight** (ADR 19),
  one per object, in tab order, each an ordinary gesture. They're visually
  hidden until one has keyboard focus, when the row shows; without WebGL
  they always show. The card on screen is the title, credits, sound, the
  loop strip, Leave it, Undo, Start over and a set-picker button that
  opens the set row (closed by default). Held by the browser check's
  `controls` section.
- **Escape and the Gallery button** return to the stage view, focus on
  the card's heading.

### First person (ADR 17)

Read `docs/adr/0017-first-person.md`.

- **The view is your eyes.** Eye height 1.62, inside the ring of arches.
  Walk with WASD or arrows (a thumb joystick on the phone), look with the
  mouse under pointer lock (a drag on the phone). You can't walk through
  the stage, plinths or arches, or off the floor. The movement rules are
  pure functions in `public/walk.js`, held by `spec/walk.test.ts`.
- **A reticle is your hand.** What it rests on within 3.2 m lights up.
  Hold to pick up a sphere, release to throw it where you look, harder the
  longer you held; click a sphere to hop it, the ribbon to pluck it, the
  bell to ring it. On the phone a round hand button does hold and release.
- **Others' poses are live and never stored.** `POST /pose` at most 8 a
  second per page; the server keeps the newest per visitor in memory and
  sends a `poses` event to every stream at most 10 a second; a pose older
  than 5 s is dropped. Poses never reach the database or the `state` event.
  Held by `spec/poses.test.ts`.
- **The room teaches the controls (ADR 19).** When the reticle rests on
  something, a hint beside it says how and what, in at most four words:
  "Hold to throw", "Click to ring", "Let go to throw" while holding, "Tap"
  on a touch screen. The verb is the set view's (`verb` on each button);
  the wording is `aimHint` in `public/ui-logic.js`, held by
  `spec/ui-logic.test.ts`.
- **Every gesture keeps its button** in the panel (hidden until focused),
  so playing never needs walking. "Back to the stage" walks you back to your starting spot;
  choosing a plinth from the row walks you in front of it.

### Phone and keyboard

- **Every action works from the keyboard and at 390x844.** Plinths, the
  stage and every gesture are real buttons in tab order, and the 3D canvas
  is decoration over a DOM that holds every control. Arrow keys orbit the
  camera when the canvas has focus.
- **On a phone the stage never scrolls away from its controls.** At 390x844
  the page is a fixed `100svh` shell that doesn't scroll: a slim top bar,
  then the live 3D scene (pinned), then the plinth row, then the panel,
  which scrolls on its own. The phone camera frames the stage itself. Held
  by the browser check (`phone-edit`): for every control on the stage card,
  scrolled to and focused in turn, the canvas stays on screen with it, and
  the stage's own box is inside the uncovered scene and unblocked; and the
  page itself never scrolls.
- **Scrolling the controls never turns the scene.** In the phone layout the
  camera moves only when the visitor drags it, uses its keys, or picks
  something.
- **Touch is the gesture.** Dragging a sphere picks it up and letting go
  throws it, at the speed the finger was moving; a tap on a sphere makes it
  hop. A tap on the ribbon plucks it there; a tap on the bell rings it. A
  drag that starts on nothing turns the camera. Your own gesture plays at
  once on your screen, before the server answers; everyone else sees it
  within a second.
- **Sound follows what's in view**: the stage's events when the stage is
  selected, a plinth's when it is. Silent until the visitor first touches
  something; one icon button mutes it.
- **Without WebGL** the page still lists exhibits and their history, and
  every gesture button still works.


### The look

- **A warm, immersive gallery floating above sunset clouds.** Warm ivory
  stone, peach light, restrained teal glass, chrome and coral accents, a
  few sculptural plants and warm exhibit lighting. Playful and calm. The
  palette is `PALETTE` in `public/stage.js`. Held by the browser check
  (`look`), on the opening view at both sizes:
  - **The sky is a soft peach-to-lavender sunset**, never saturated
    orange or dark purple: of the sky pixels above the horizon, the 90th
    percentile chroma (max minus min channel) is under 100 of 255 and the
    median lightness is over 0.6.
  - **The arches are stone, standing on their pillars.** Sixteen stone
    pillars round the rim; each neighbouring pair carries a solid arch at
    least 0.3 thick spanning between them along the ring (never sticking
    out from it), and both of an arch's feet rest on pillar tops (the
    probe's `archGap`, the furthest foot from its pillar top, under 0.1).
  - **Depth behind the room:** at least three cloud layers at different
    heights and distances, a hazy horizon, and at least three floating
    islands, one of them in the opening view. All of it is backdrop,
    never counted as being in the way.
  - **Light that tells the materials apart:** a warm low sun from the
    side, a cool ambient fill, soft shadows, and a soft contact shadow
    on the floor under every plinth, the bench and each pillar, so stone
    reads matte, chrome reflects and glass shows through.
- **The opening view stands inside the pavilion, at visitor height.** The
  first thing a visitor sees, and the view the Gallery button returns to, is
  taken from within the ring of arches (camera inside the arch radius) at
  about eye height (camera 1.3 to 2.0 above the floor), looking almost
  level at the stage. The stage is large in the middle
  of the visible scene; two plinths and the arches with the sky behind
  them frame it. On first load the camera eases in a short way to that
  pose instead of swooping from outside the room. Held by the browser
  check (`opening`), at both sizes: the camera is inside the pavilion and
  at eye height, and the stage's on-screen box is at least a
  quarter of the uncovered scene's area and centred in it.
- **A plinth close-up is composed, not just aimed.** Choosing a plinth
  moves the camera to a pose picked by scoring candidates round the
  plinth (angle, height, distance), all inside the pavilion. A pose loses
  for each thing in front of the exhibit (another plinth, the bench, a
  plant, a pillar), for large objects close to the lens, for an arch cut
  part-way through its curve by the top of the frame, and for any part of
  the exhibit under a panel. The picture is centred in the **clear
  rectangle**: the canvas minus the side panel, the header pills and the
  plinth row (`clearFrame` in `public/ui-logic.js`), so a fitted sculpture
  never sits under them. Held by the browser check (`focus`), at both
  sizes and for every plinth: the exhibit's on-screen box meets none of
  the panels as the DOM measures them; under 3% of rays to it hit
  something else first; under 3% of the clear view is a near foreground
  object; no arch is cut through its curve.
- **Back to the gallery is one obvious button.** Whenever the view isn't
  the opening view (a plinth is chosen, or the camera was dragged, zoomed
  or turned), a "Gallery" button sits in the scene's top-left corner. It
  selects the stage and returns the camera to the opening pose;
  `Escape` does the same when focus isn't in a field. Held by `focus`: the
  button shows on a plinth and after a drag, and pressing it restores the
  opening pose.
- **Visitors are there with you, in first person (ADR 17).** Each is a soft
  floating head in their colour with their name above it and a hand orb
  where they reach; a sphere they hold floats in front of them. In the
  panel they're still a dot in the "here now" strip and a chip on every
  credit.
  A head closer than 0.9 m to your eye fades out (and is gone under
  0.45 m), so someone standing where you stand, such as two visitors who
  just arrived at the same spot, never fills your view. Held by the browser
  check (`crowd`): two visitors on the start spot each see the stage, not
  the other's head.
- **Live text is a system font stack or an SIL OFL face** with its licence
  beside it. AA contrast is measured on the rendered pixels over the sky,
  by the `contrast` section of `scripts/browser-check.ts` (seen failing with
  the title scrim removed).
- **Every animation and transition has a `prefers-reduced-motion` path**:
  sculptures hold still at their saved pose, the camera stops drifting.

## The contract

`src/types.ts` holds the payload shapes; this is the prose for them.

Routes (every `POST` takes JSON, answers JSON, and refuses a cross-site
`Origin` with `403 cross-origin`; every refusal is
`{ error: ErrorCode, message }`):

| Route | Body | Does | Refusals |
|---|---|---|---|
| `GET /` | | the museum page, server-rendered with the current exhibits so it reads without JS | |
| `GET /events` | | SSE `state` events | |
| `GET /exhibits/:id` | | `ExhibitHistory`: every version, newest first | `404` |
| `GET /archive?before=<id>` | | `{ drafts: ArchivedDraftView[], more: boolean }`: the next 12 archived loops older than `id` | `400` |
| `POST /me` | `{ name }` | rename yourself | `400` |
| `POST /pose` | `{ at, look, reach?, holding? }` | where you stand and look, in memory only; sent on as a `poses` event | `400` |
| `POST /stage/grab` | `{ object }` | claim a sphere (taking it from whoever held it) | `400` |
| `POST /stage/gesture` | `{ gesture }` | add one gesture to the loop (a throw needs your claim and ends it) | `409 taken`, `400` |
| `POST /stage/drop` | `{ object }` | let go of a sphere without throwing | `400` |
| `POST /stage/undo` | | remove your own newest gesture from the loop | `409 nothing-to-undo` |
| `POST /stage/clear` | `{ set? }` | archive the loop, start a silent one (on `set`, or the same set) | `409 stage-empty` (same set, no gestures), `400` |
| `POST /stage/join` | `{ versionId, replace? }` | bring a version's performance to the stage; with `replace`, archive the loop first | `409 stage-busy`, `404`, `400` |
| `POST /stage/restore-archived` | `{ archivedId, replace? }` | bring an archived loop back | as join |
| `POST /publish` | `{ title, slot?, exhibitId?, replace? }` | leave the loop as a new exhibit in `slot`, or the next version of `exhibitId` | `409 stage-empty`, `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/restore` | `{ versionId }` | publish that version again as the newest | `404`, `400` |
| `POST /exhibits/:id/display` | `{ slot, replace? }` | put a storeroom exhibit on a slot | `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/store` | | take it off display, into the storeroom | `409 slot-empty`, `404` |
| `GET /readme/` | | README.md rendered with `marked` | |
| `GET /stage.js`, `/app.js`, `/style.css`, ... | | static files from `public/`, ES modules `no-cache` | |

## Build sketch

- **Server: bare `node:http`**, TypeScript run directly by Node 24 (erasable
  syntax only). No framework and no build step. `src/server.ts` (routes,
  SSE, cookie), `src/db.ts` (the store), `src/log.ts`, `src/readme.ts`,
  `src/types.ts`.
- **Storage: SQLite through `node:sqlite`**, one file on `/data`. The store
  is `openStore(path)` with every time-dependent function taking `now`, so
  tests open `:memory:` with an injected clock. Migrations are numbered and
  tracked with `PRAGMA user_version`; a committed migration is never
  edited.
- **Tables:** `visitors`, `drafts` (the live loop is the one row with
  `archived_at` null; `recipe` is `stage`, `parts` is the performance JSON),
  `draft_credits`, `leases` (now sphere claims: part = sphere id),
  `exhibits`, `versions` (immutable, with a trigger), `version_credits`.
- **Page: Three.js 0.186.1** from a pinned CDN URL (import map), plain ES
  modules in `public/`, no build step. `public/stage.js` is the shared
  rules and builds nothing 3D; each set is `public/sets/<id>.js` (rules)
  and `public/sets/<id>-view.js` (look, touch, buttons, sounds), described
  in `public/sets/README.md`; `public/stageview.js` draws a performance
  through its set's view;
  `public/scene.js` is the room and the touch; `public/app.js` holds the
  UI and the stream. Sound is Web Audio, synthesized, no files.
- **Logs:** one line per event on stdout, `event key=value`, a person as
  their tag, every typed string JSON-quoted.

## Out of scope

Bodies, faces or customisable avatars (a head and a hand only), chat, accounts and passwords, uploaded assets,
runtime AI models, a physics library, VR, an infinite world, sliders or
parameter panels, multiple rooms, leaderboards, economies, puzzles or
goals, rate limiting.

## Open decisions

- **What "good" means, argued with sources**: the README, 400--600 words,
  saying which claims are tested and which are judged.
- **The loop length** (30 s), the gesture cap (40) and the claim (10 s) are
  first guesses; watch two or three people play before the showcase.
- **More sets** beyond the four of ADR 18 (glass that tints what passes
  behind it) once people have played these.


## How to work in here

- **Decide before code.** A change starts as a decision in this file (and an
  ADR in `docs/adr/` for any decision with real alternatives), then the
  server with its tests, then the page: separate commits.
- **Red first.** A check counts only once it has been seen to fail with the
  rule broken. Write the failing test, run it, then make it pass.
- Run the app locally and look at it in a browser. The rendered page is the
  truth; your mental model of it isn't.
- Run `pnpm check` before you commit, against a throwaway local server:
  `DB_PATH=$(mktemp -d)/x.db PORT=8080 node src/server.ts`. Run
  `pnpm check:evidence` before anything ships.
- When a check fails, read its output before you change anything.
- Never commit a red state.
- **Commit freely; ask before every push and every deploy.** Since the repo
  is public, a push to `main` is a deploy (CI deploys every push once its
  checks pass), so a half-built feature pushed is a half-built feature live.
  Ask each time; one yes doesn't cover the next.
- **Look at it at both sizes before calling a UI change done.** Run
  `node scripts/browser-check.ts` against the running local app. It
  screenshots 1440x900 and 390x844 into `.shots/` (gitignored), checks
  `scrollWidth`, does a keyboard pass, and opens two separate browser
  contexts to time an edit in one appearing in the other. Read the
  screenshots; the script can't judge them. It isn't in CI, which has no
  Chrome.
- **After a deploy, confirm CI is green, the Fly image matches the commit,
  and the URL answers 200.** The deploy command finishing is not the site
  answering.
- **Model the slice, not the system.** Build one flow end to end before
  widening anything. A feature not in the slice is an open decision or a
  line in "Out of scope".

## The database

- **The deployed volume outlives every deploy.** A schema change runs against
  whatever production holds. New `NOT NULL` columns need a default.
- **Never hand-edit the database**, locally or on the volume. State changes go
  through the app or a committed script.
- **Tests write to the app's database.** Point local runs at a throwaway
  `DB_PATH`. A test must not depend on the museum starting empty, since a
  second run won't find it empty.
- **Never point `pnpm check` or the browser check at the live URL.** They act
  as fixture visitors and would leave drafts and exhibits on the museum the
  marker sees. It's enforced: `spec/not-production.ts` makes both refuse any
  `fly.dev` host before sending a request, held by
  `spec/not-production.test.ts`. Don't weaken it to get a check to run.

## The checks

- **Real-time is a test, not a claim.** A spec test opens two `/events`
  streams as different visitors, edits from one, and fails unless the other
  receives the change within 1000 ms. It runs in CI against the built image.
- **Claims, versions and migrations are unit tests over
  `openStore(":memory:")`** with an injected clock.
- **The stage's rules are unit tests** (`spec/stage.test.ts`): bounds,
  determinism, and every way objects set each other off, each seen to fail
  with its rule broken. Test at a real clock time, never only at t = 0.
- **Every access and ownership rule above has an HTTP test**, each seen to
  fail with the rule broken: two cookies are two visitors; a grab takes a
  sphere and the throw that lost it is refused; undo removes only your own; versions never change; restore adds a version;
  replace archives; a full slot is never silently replaced; bad input is a
  `400`; a cross-site POST is a `403`.
- **The shared module is held by a test.** `spec/stage.test.ts` checks
  that `checkGesture` and `checkPerformance` refuse unknown keys (including
  `constructor`), non-numbers and out-of-range values.
- **Spec files run in parallel against one app, and there is one shared
  stage.** Tests that need the stage run in one file, in sequence, and
  never assume it starts empty: they clear it first. Vitest 5 dropped
  `describe.sequential`; tests in one file already run in order, so the
  file's `describe`s pin `{ concurrent: false }` to keep it that way.
- **The logs are tested from a server the test starts itself**
  (`PORT=0`, temp `DB_PATH`), since the app under `APP_URL` is a separate
  process.

`spec/invariants.test.ts` ships with the template: `/` answers, and `/readme/`
carries every README heading in order. Keep it.

## Things this stack keeps getting wrong

Carried forward from previous weeks: general lessons about web work with
these tools, not tied to any one prototype's content.

- **axe reports contrast over a gradient as "incomplete", not "pass".** Don't
  read a low/zero violation count as real coverage; measure the rendered pixel
  directly when the background isn't flat.
- `agent-browser`'s `is visible` is an in-viewport check, not a
  `display`/`visibility` check --- a perfectly visible element below the fold
  reads as `false`. Assert on `getComputedStyle(...).display` via `eval`
  instead.
- `agent-browser batch` takes an array of *arg arrays* on stdin
  (`["set","viewport","1920","1080"]`, not `"set viewport 1920 1080"`), and
  there's no `--file` flag --- generate the JSON and pipe it.
- **Reusing a port serves the browser a stale page.** Append a
  `?v=<timestamp>` cache-buster to the URL, or a previous run on that port will
  happily confirm a version of the page you deleted.
- **`[].every()` is `true`, so a probe over an empty list is a false pass.**
  Any "all of them are fine" assertion has to assert a non-zero count first
  (`items.length > 0 && …`).
- **A CSS `transform` overrides an SVG `transform` attribute on the same
  element** --- it doesn't compose with it. Put a static transform on an outer
  `<g>` and animate a child inside it instead.
- **A flex `flex-basis` is a width in a row layout and a height once a media
  query stacks it into a column.** Reset it to `flex: 0 0 auto` in the stacked
  layout rather than letting the row value leak through.
- **A sticky bar above a `100svh` hero overflows the first screen by exactly
  the bar's height.** Hold the bar height in one custom property and use it
  both to shrink the hero (`calc(100svh - var(--nav-h))`) and to offset anchor
  targets (`scroll-margin-top`), so overriding it once at a breakpoint updates
  every use.
- **Measure the phone fold; don't reason about it.** Check where a control and
  the thing it changes actually land at 390x844 before redesigning around a
  problem that measuring might show doesn't exist.
- **`transform: scale(var(--x))` transitions fine with an *unregistered*
  custom property** --- the transition is declared on `transform`, and `var()`
  is substituted at computed-value time. `@property` is only needed to
  transition the custom property itself.
- **Gradients don't interpolate.** A transition can't animate
  `background-image`; crossfade stacked layers on `opacity` instead.
- **Position and size have to live on separate elements when scaling
  something.** `translate()` then `scale()` on one element means the *size*
  decides where it lands. Split into a positioning wrapper and a scaling
  child.
- **A dimension in `vw` with an offset in `vh` (or vice versa) needs a
  separate override per viewport shape** --- it can't be derived once and
  reused, because the two units don't track each other across aspect ratios.
- **A fully green browser suite says nothing about whether the page looks
  right.** Assertions cover behaviour; only reading the screenshot covers
  design. Budget a look at the image as a separate step, not as a formality
  after the checks pass.
- **You cannot judge small artwork in a full-page screenshot.** Screenshot the
  *element* with `deviceScaleFactor: 4` (and `reducedMotion: "reduce"`, or an
  opacity animation captures mid-fade) when the detail is the thing being
  checked, and budget several look-fix rounds, not one.
- **`visibility: hidden` takes an element out of hit-testing**, so a harness
  that hides the page before capturing it can't also click a control hidden
  that way. Interact first, then hide, then capture --- and hash output files
  before trusting a sweep that looks suspiciously uniform.
- **A suite of rules can be green while the rules add up to something
  impossible.** When the artefact has a success condition --- a game to win, a
  flow to complete, a form to get to the end of --- attempt the whole thing end
  to end and *measure* it. Assertions cover rules; only an end-to-end attempt
  covers whether the rules compose.
- **Attribute a symptom before tuning anything.** Log which specific source
  causes each instance of the problem before changing numbers. One diagnostic
  pass beats three rounds of guessing.
- **Two files agreeing on a string is a fact a test can hold, even when the
  thing it controls isn't testable.** A stylesheet selecting `[x="lost"]` and
  the code writing `"loss"` is a bug no assertion about colour could ever
  catch --- but "every value the CSS selects is a value the code writes" is
  mechanical. Same shape for routes and links, or a data attribute and its
  consumer.
- **A regression test written after the fix has never been seen to fail.**
  Reintroduce the bug, watch it go red, then restore.
- **`toContain` on a string is a substring check, and it makes a regression
  test toothless.** Assert the *shape* you actually care about (a regex, a
  parsed DOM query) and prove it fails both ways.
- **Any CSS rule that sets `display` overrides the `hidden` attribute.** The
  browser's own `[hidden] { display: none }` has the lowest priority, so a
  `.confirm { display: flex }` keeps a "hidden" bar on screen. Keep a global
  `[hidden] { display: none !important }`, and check visibility in the
  browser, not by reading `el.hidden`.
- **Two elements in the same 3D plane fight over clicks, and the browser
  can pick either.** A flat tile (`translateZ(0)`) lies exactly in its
  board's plane, so about a third of free tiles lost the click to the board
  behind them, and this had been live since crit 8 unnoticed: clicking a
  tile in a screenshot-driven check found it. Give the container
  `pointer-events: none` and the interactive children `pointer-events: auto`,
  and measure with `elementFromPoint` over every target, not one.
- **In 3D a tall block can hide a shorter one behind it from the click.**
  A browser test that clicks a tile has to check what `elementFromPoint` hits
  at the tile's centre, and turn the camera when it's covered, the way a
  player would.
- **Two single-class CSS rules have equal specificity, so the later one wins
  silently.** When a class is meant for one context, scope it to that context
  (`.actor .fig`) rather than relying on where it happens to sit in the file.
- **A state-modifier class that shares a name with a component inherits the
  component's layout.** Namespace modifiers (`.is-boss`), and check every
  class the code toggles against the bare component selectors in the
  stylesheet.
- **A re-export nothing imports is dead weight, and its comment is often
  wrong.** Grep the symbol before believing the comment justifying it.
- **A fix can remove the symptom by adding an exception the user cannot see.**
  Ask of any rule change: *can the person using this read it off the screen?*
  If not, fix the composition instead of the rule.
- **Scraped text carries characters that look like ASCII and aren't.** A
  non-breaking hyphen (U+2011) in `32‑36` splits on nothing a plain `-` split
  finds. Normalise scraped input at the boundary and test the parser on the
  raw bytes, not a retyped sample.
- **A flex column shrinks an `overflow: hidden` child to nothing.** Its
  automatic minimum size drops to zero, so the one line a small box must
  never lose disappears first. Give children `flex: none` (or `min-height`)
  when the box is fixed-height.
- **Headless Chrome's `--window-size` has a minimum width**, so a "390px"
  screenshot is really wider and reports overflow that isn't there. Emulate
  the viewport through CDP (`Emulation.setDeviceMetricsOverride`, `mobile`
  on) and check `scrollWidth` against it.
- **Playwright's `fullPage` screenshot turns an emulated phone into a mouse
  device while it captures.** `(hover: none) and (pointer: coarse)` stops
  matching, so the "phone" shot shows the desktop styles, and checking the
  query before the capture passes anyway. Grow the viewport to the page's
  height and take a normal screenshot, and prove it with a `change`
  listener on the query that records any flip during the capture.
- **A capture straight after a viewport resize can catch a half-drawn
  page,** with its top tiled down the image. It looks like a layout bug
  and isn't. Wait two `requestAnimationFrame`s after resizing.
- **A free font download isn't necessarily free for the web.** Its licence
  can cover desktop use and fixed artwork only (Pricedown's does): no web
  font, no font file in a public repo. Read the licence before the file
  goes anywhere near `public/`, convert text to outlines when only artwork
  is allowed, and prefer SIL OFL faces for live text.
- **A missing font or image fails silently,** as a fallback that still
  looks like a page. Fetch every `url()` the stylesheet names in a test.
- **Judge display type on every glyph it can show, not the ones the test
  data happens to produce.** A local board showing "21" hid that a heavy
  face with a thick outline turns "9" and "0" into blobs; production showed
  9. Set the text to its worst cases (every digit, the longest message)
  and look at 1x as well as 2x, where small holes close first.
- **`* { box-sizing: border-box }` doesn't reach `::before`/`::after`.** A
  pseudo-element given the same height and border as its neighbour comes out
  taller by the border. Set `box-sizing` on the pseudo-element itself, and
  compare computed heights rather than trusting the numbers match.
- **A background paints under content, so it can't cover anything.** To mask
  content scrolling beneath a pinned corner, the mask has to be a positioned
  element (e.g. a sticky pseudo-element with a `z-index`), not a background.
- **A "never prints X" assertion only covers what was actually printed.**
  A leak on a path the test never exercised passes. Drive every path that
  logs, assert each expected line exists, and only then assert the secret
  is absent.
- **`key in obj` finds inherited names.** A lookup table keyed by user
  input (`?notice=constructor`) needs `Object.hasOwn`, or it serves
  `Object.prototype`.
- **The Write tool can turn `\u` escapes into the raw characters.** A test
  meant to hold a bidi override or line separator may end up holding the
  invisible character itself. Grep new files for non-ASCII after writing
  escapes.
- **A server that only broadcasts on "big" changes leaves pages counting
  down to a stale time.** If the page derives anything from a field (a
  lease end), every change to that field has to broadcast, including a
  quiet one.
- **`server.close()` waits for idle keep-alive sockets.** On `SIGTERM` call
  `closeAllConnections()` too, or exit takes seconds and the platform may
  kill the process before the database closes.
- **A keyboard step-and-back that "returns to the same tile" fails at a
  board edge,** where the first step can't move. Try both orders.
- **`clip-path` on a 3D-rotated element costs a mask layer about 1000 px
  bigger than the element on every side.** Seventy clipped roofs came to
  1.1 GB of compositor memory; the GPU dropped layers and buildings drew as
  hollow shells. Draw shapes on 3D faces with gradients or borders, never
  `clip-path`, and check the layer bill (`LayerTree` over CDP), because every
  DOM box still measures right while it's broken.
- **Headless Chrome hides GPU failures.** A screenshot with pieces missing
  is a bug until a headed, GPU-on run (`HEADED=1`) shows otherwise; never
  write it off as a capture artefact.
- **A recorded "source" field is not necessarily a bare URL.** Notes get
  appended to it. Anything that turns data into an `href` extracts and tests
  the URL shape, or the link checker finds it after the deploy.

## Shell

- **zsh does not word-split unquoted parameter expansions.** `set -- $CFG` and
  `for x in $LIST` silently see one word, so a sweep written the bash way runs
  once with a corrupted argument instead of failing. Use a zsh array
  (`arr=(${=CFG})`) or drive the loop from `python3`/a heredoc.
- **`===` is not a separator in zsh** --- `echo ===` tries to expand `==` as a
  command lookup and fails the whole line. Quote decorative separators.

## Working style

- **A re-theme is CSS-only, not a rewrite.** When asked to restyle or re-theme
  a page, change presentation (styles, and only the markup needed to carry new
  classes/structure) and leave existing body text exactly as written. If a
  style genuinely can't be expressed without a structural change, raise that
  as a separate call-out rather than folding a silent content edit into the
  restyle.

