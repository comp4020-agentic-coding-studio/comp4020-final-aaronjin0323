# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.


## Goal

**Impossible Museum** is a small, shared 3D gallery where visitors assemble
impossible sculptures together, exhibit them, and make variations of one
another's work. It's built for a handful of people visiting together for five
to ten minutes, including someone opening the URL with no introduction. It
replaces Skyline ([ADR 11](docs/adr/0011-rebuild-after-skyline.md)); the
museum's own decisions are [ADR 12](docs/adr/0012-impossible-museum.md).

**The loop:** explore, then select a sculpture, change it together, exhibit
it, discover its history, and return later.

**Good, here:** a visitor quickly understands how to contribute, can see
someone else's contribution, and feels free to experiment because their work
is credited and recoverable. Every change answers in the moment you make it.
These are starting decisions: change them when evidence warrants it, with the
reason recorded here and in an ADR.

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

- **One gallery: six plinths and one workbench.** Six exhibition slots,
  numbered 1--6, and a single shared draft on the workbench. No rooms, no
  free-roaming avatars.
- **Three recipes, bounded parts.** A sculpture is a recipe id plus numbers
  for each of its three parts. The recipes and every parameter's range and
  step live in `public/recipes.js`, the one copy, imported by both the
  server (to refuse) and the page (to draw sliders and the sculpture). An
  out-of-range or unknown value is a `400`, never clamped. Nobody draws a
  mesh.
- **Three starters are seeded once** (a numbered migration, so a redeploy
  never re-seeds): the Loop & Lantern (ribbon, glass cube, spheres) in slot
  1, the Arch Totem in slot 2, the Glass Bloom in slot 3. Each is exhibit
  version 1, published by the museum (`publishedBy: null`).

### The workbench (the shared draft)

- **Anyone present can edit the draft.** Every accepted edit is written to
  the database before it's broadcast. Publishing is not the only persistence
  boundary.
- **Transforms and parameters of a part need that part's lease.** A lease is
  per part, held by one visitor, 15 s long, renewed by every accepted edit
  and by `POST /draft/lease` while the slider is held. Different parts are
  editable at the same time; one part can't be silently fought over: an edit
  to a part someone else holds is a `409 lease-held` that names the holder.
  The server enforces leases; the page only mirrors them.
- **Leases end on the clock or on disconnect.** An expired lease is free on
  every read, whether or not a sweep has run. When a visitor's last stream
  closes, their leases are released and broadcast at once.
- **Edits are throttled on the page, not dropped on the server.** Dragging a
  slider redraws locally on every frame; the page sends the latest value at
  most every 100 ms, and always the final value on release. Other viewers see
  an accepted edit within about a second under the test conditions (two
  local streams). No promise is made about arbitrary network failure.
- **Starting a draft:** when the workbench is empty, anyone may start one
  from a recipe's defaults or **remix** an exhibit version into it. Remix
  into a non-empty draft is refused (`409 draft-not-empty`) unless the
  request says `replace: true`, which the page offers only as a separately
  labelled action ("Replace the workbench"). Replacing **archives the
  current draft first**, in the same transaction. **Clearing** the workbench
  archives too. An archived draft can be brought back as a remix source.
  **Every archived draft stays reachable.** The `state` event carries only the
  newest 12 (so it stays small for a busy day) plus `archivedTotal`; the page
  pages back through the rest with `GET /archive?before=<id>`. A cap that
  hid older drafts would make "recoverable" untrue without anyone seeing it.
- **Credit follows the work.** The draft records, per part, who last shaped
  it, and counts each contributor's accepted edits. A remix records the
  version it came from.

### Exhibits and versions

- **Anyone may publish the draft as an exhibit version.** Publishing takes a
  title (1--40 characters) and either a new slot or an existing exhibit to
  add a version to. The draft stays on the workbench after publishing.
- **Versions are immutable.** No route updates or deletes a version row, and
  a database trigger refuses `UPDATE` and `DELETE` on `versions`. Every
  version keeps its contributors (names and colours as they were) and its
  publisher.
- **Restore makes a new version.** Restoring version 2 of an exhibit
  publishes version N+1 with version 2's recipe and numbers and
  `restoredFrom` set. History only grows.
- **Six slots, never silent eviction.** Publishing a new exhibit into a slot
  someone's exhibit already holds is a `409 slot-taken` unless the request
  says `replace: true`; the page shows what's there and asks. Replacing moves
  the old exhibit to the **storeroom**, with all its versions, and it can be
  put back on a free slot later. Taking an exhibit off display does the same.
  Nothing published is ever deleted.

### Live, and leaving

- **SSE, with the whole state in every event.** `GET /events` sends a
  `state` event on connect and after every change, so a reconnecting page is
  right from its first message. A 15 s comment heartbeat keeps Fly's proxy
  from closing an idle stream. On `SIGTERM` every stream ends and the
  database closes.
- **Presence is open streams.** A visitor is present while at least one of
  their streams is open; the event lists who's here and which parts each is
  editing. Presence is never stored.
- **Disconnected means view-only.** When the stream drops, the page keeps
  showing the museum, disables every control, and says so ("Reconnecting...
  you can look, but not edit until we're back"). It re-enables editing only
  after the first `state` event of the new connection has replaced its
  copy.
- **Animation is never a write.** Motion is derived from saved parameters
  and a shared time base (`serverTime` in each event, against the page's
  clock), so two screens show the same sculpture at the same phase. No
  animation frame touches the server.

### Show, don't tell (ADR 13)

The first build spoke in paragraphs: 160 words on the first desktop screen.
A visitor reads the room, not the page, so the sculpture and the controls
carry the meaning and the words are labels. Read
`docs/adr/0013-show-dont-tell.md`.

- **A word budget, held by a check.** The first screen shows at most 40
  visible words on desktop and 30 on the phone, on the bench view and on a
  plinth (`scripts/browser-check.ts`, `words`). Names, titles and numbers
  count. Explanations live in accessible names, `title` tooltips and
  `/readme/`, not on the screen.
- **The room is the menu.** Plinths and the bench are picked in the 3D room;
  the plinth row is a strip of small coloured thumbnails (each sculpture's
  main colour) with the title only as an accessible name and on hover/focus.
- **Icons and colour over sentences.** Every action button is an icon with
  an accessible name and a tooltip; only the doors into making something
  keep a word: Exhibit, "Shape it", Remix, Swap in, Gallery and Done
  (ADR 14). Recipes are picked by a swatch of the
  sculpture, not a blurb. Who you are is your coloured dot; who's here is a
  row of dots. A part someone else is shaping wears their colour ring and
  their name only.
- **History is a strip of versions, not a list of sentences.** Each version
  is a small chip (v1, v2...) in its publisher's colour; picking one shows
  its credits and Restore/Remix as icons.
- **The storeroom and archive are icon drawers**, closed by default, with a
  count badge and no description.
- **Feedback is motion, then a word.** An accepted change pulses the part
  in the editor's colour; a toast is at most four words.
- **Nothing is lost for screen readers or keyboards.** Every hidden word
  still exists as an accessible name, and every action keeps a real button.

### Explore, then create (ADR 14)

Read `docs/adr/0014-explore-then-create.md`.

- **Everyone starts in explore mode.** The panel is a compact selection
  card for what's selected (the bench or a plinth): swatch, title, credits,
  one or two actions, no sliders. Selecting anything, including the bench,
  shows its card in explore mode.
- **The editor opens only on an explicit creative action:** "Shape it" on
  the bench card, a starter, Remix, Swap in, or bringing an archived draft
  back. Focus moves to the editor's heading.
- **Leaving is as plain:** "Done" at the top of the editor, the Gallery
  button, or `Escape` return to explore, focus back on what opened it.
- **Nothing is lost to the keyboard.** In explore the editor's controls are
  `hidden`, not just covered, so they're out of the tab order; in create
  every slider and swatch is a real `<input>` in tab order, as before.
- Held by the browser check (`explore`), at both sizes: first load shows
  the card and no visible editing control, and the card fits in a compact
  height; "Shape it" (by keyboard) reveals every editing control with focus
  on the editor heading; Done, Gallery and `Escape` each return to the
  card with focus on "Shape it"; choosing a plinth never shows the editor.

### Phone and keyboard

- **Every action works from the keyboard and at 390x844.** Plinths and
  workbench parts are real buttons in tab order, sliders are `<input
  type="range">`, and the 3D canvas is decoration over a DOM that holds every
  control. Arrow keys orbit the camera when the canvas has focus.
- **On a phone the sculpture never scrolls away from its controls.** At
  390x844 the page is a fixed `100svh` shell that doesn't scroll: a slim top
  bar, then the live 3D scene (pinned, about 38% of the height), then the
  plinth row, then the panel, which scrolls on its own. When the workbench
  is selected the phone camera frames the bench sculpture itself, not the
  room, so a slider's effect is visible as it moves. Held by the browser
  check (`phone-edit`): for every editing control on the bench, scrolled to
  and focused in turn, the sculpture's canvas stays fully on screen and the
  control is on screen with it; the sculpture's own box is inside the
  uncovered scene, unblocked (under 3% of rays to it hit something else)
  and at least a fifth of its area; and the page itself never scrolls.
- **Scrolling the controls never turns the scene.** In the phone layout the
  camera moves only when the visitor drags it, uses its keys, or picks
  something; the idle drift that circles the room on desktop is off, so a
  sculpture being edited holds its angle however long the panel is
  scrolled. Held by `phone-edit`: the camera's yaw (`data-yaw` on the
  canvas) is the same before and after scrolling the panel end to end for
  longer than the drift's 6 s wait.
- **Without WebGL** the page still lists exhibits, history and the draft's
  numbers, and every control still works.

### The look

- **A warm, immersive gallery floating above sunset clouds.** Warm ivory
  stone, peach light, restrained teal glass, chrome and coral accents, a
  few sculptural plants and warm exhibit lighting. Playful and calm. The
  palette is `PALETTE` in `public/recipes.js`. Held by the browser check
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
  first thing a visitor sees, and the view the workbench returns to, is
  taken from within the ring of arches (camera inside the arch radius) at
  about eye height (camera 1.3 to 2.0 above the floor), looking almost
  level at the workbench sculpture. That sculpture is large in the middle
  of the visible scene; two plinths and the arches with the sky behind
  them frame it. On first load the camera eases in a short way to that
  pose instead of swooping from outside the room. Held by the browser
  check (`opening`), at both sizes: the camera is inside the pavilion and
  at eye height, and the bench sculpture's on-screen box is at least a
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
  selects the workbench and returns the camera to the opening pose;
  `Escape` does the same when focus isn't in a field. Held by `focus`: the
  button shows on a plinth and after a drag, and pressing it restores the
  opening pose.
- **Visitors are coloured markers, never avatars.** A visitor shows as their
  colour and name: a dot in the "here now" strip, a ring on the part they're
  editing, a chip on every credit. Attention stays on the sculpture.
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
| `GET /archive?before=<id>` | | `{ drafts: ArchivedDraftView[], more: boolean }`: the next 12 archived drafts older than `id` (newest first; no `before` starts at the newest) | `400` |
| `POST /me` | `{ name }` | rename yourself | `400` |
| `POST /draft/start` | `{ recipe }` | start a draft from defaults | `409 draft-not-empty`, `400` |
| `POST /draft/remix` | `{ versionId, replace? }` | copy a version into the draft; with `replace`, archive the old draft first | `409 draft-not-empty`, `404`, `400` |
| `POST /draft/restore-archived` | `{ archivedId, replace? }` | bring an archived draft back to the bench | as remix |
| `POST /draft/lease` | `{ part }` | take or renew a part's lease | `409 lease-held`, `409 draft-empty`, `400` |
| `POST /draft/release` | `{ part }` | let go of your lease | `400` |
| `POST /draft/edit` | `{ part, values, revision? }` | set some of a part's numbers; needs the lease (taken implicitly if free) | `409 lease-held`, `409 draft-empty`, `400` |
| `POST /draft/clear` | | archive the draft, empty the bench | `409 draft-empty`, `409 lease-held` if anyone else holds a lease |
| `POST /publish` | `{ title, slot?, exhibitId?, replace? }` | publish the draft as a new exhibit in `slot`, or as the next version of `exhibitId` | `409 draft-empty`, `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/restore` | `{ versionId }` | publish that version again as the newest | `404`, `400` |
| `POST /exhibits/:id/display` | `{ slot, replace? }` | put a storeroom exhibit on a slot | `409 slot-taken`, `404`, `400` |
| `POST /exhibits/:id/store` | | take it off display, into the storeroom | `409 slot-empty`, `404` |
| `GET /readme/` | | README.md rendered with `marked` | |
| `GET /recipes.js`, `/app.js`, `/style.css`, ... | | static files from `public/`, ES modules `no-cache` | |

## Build sketch

- **Server: bare `node:http`**, TypeScript run directly by Node 24 (erasable
  syntax only). No framework and no build step. `src/server.ts` (routes,
  SSE, cookie), `src/db.ts` (the store), `src/log.ts`, `src/readme.ts`,
  `src/types.ts`.
- **Storage: SQLite through `node:sqlite`**, one file on `/data`. The store
  is `openStore(path)` with every time-dependent function taking `now`, so
  tests open `:memory:` with an injected clock.
- **A fresh database file.** Skyline's tables are left alone in the old file;
  the museum opens `museum.db` beside it (`DB_PATH` defaults to
  `/data/museum.db` in the image, `./.data/museum.db` locally). Migrations
  are numbered and tracked with `PRAGMA user_version`; a committed migration
  is never edited.
- **Tables:** `visitors`, `drafts` (one live row; archived rows keep theirs
  with `archived_at`), `draft_credits`, `leases` (part, holder, expires_at),
  `exhibits` (slot nullable, unique when set), `versions` (immutable, with a
  trigger), `version_credits`.
- **Page: Three.js 0.186.1** from a pinned CDN URL (import map), plain ES
  modules in `public/`, no build step. `public/recipes.js` builds nothing 3D;
  `public/sculpture.js` turns a recipe and numbers into a Three.js group, and
  `public/app.js` holds the scene, the UI and the stream.
- **Logs:** one line per event on stdout, `event key=value`, a person as
  their tag, every typed string JSON-quoted.

## Out of scope

Free-roaming characters, chat, accounts and passwords, uploaded assets,
runtime AI models, physics, VR, an infinite world, arbitrary mesh editing,
multiple rooms, leaderboards, economies, rate limiting.

## Open decisions

- **What "good" means, argued with sources**: the README, 400--600 words,
  saying which claims are tested and which are judged.
- **The lease length** (15 s) and the page's send interval (100 ms) are
  first guesses; measure them with two browsers before the showcase.

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
- **Leases, versions and migrations are unit tests over
  `openStore(":memory:")`** with an injected clock.
- **Every access and ownership rule above has an HTTP test**, each seen to
  fail with the rule broken: two cookies are two visitors; a lease held by
  one refuses the other; versions never change; restore adds a version;
  replace archives; a full slot is never silently replaced; bad input is a
  `400`; a cross-site POST is a `403`.
- **The shared module is held by a test.** `spec/recipes.test.ts` checks
  every default is in range and on its step, and that `checkEdit` refuses
  unknown keys (including `constructor`), non-numbers and out-of-range
  values.
- **Spec files run in parallel against one app, and there is one shared
  draft.** Tests that need the workbench run in one file, in sequence, and
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

