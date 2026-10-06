# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Goal

This project is a multi-user, real-time, persistent game: a shared board of
tiles that people claim, shown as a 3D scene rather than a flat grid. It's
built for a room of strangers at the showcase --- the point is that it gets
more interesting because other people are claiming tiles at the same time, not
just that it remembers input.

**The hook is adjacency.** Each person holds one tile, and a tile rises for
every claimed neighbour. Standing alone keeps you flat; settling next to
strangers builds a skyline. Where you stand matters because of who else is
there, which is what makes it a game for a room rather than a form with a
database behind it.

For crit 8, the working slice is the smallest version of that: a visitor
claims a tile, and it's still theirs when anyone comes back later. Real-time
updates between visitors arrive at crit 9, and logging at crit 10.

## Decisions

Settled; change them here first, then in the code.

- **A person is an anonymous visitor.** A random ID in a cookie (`pid`,
  HttpOnly, `SameSite=Lax`, `Secure` in production, one-year `Max-Age`)
  decides ownership. The typed label is display only and never proves who
  anyone is. No accounts.
- **Labels are 1--24 characters after trimming**, and escaped on every
  output. Anything else is refused with a message, not silently truncated.
- **One tile per person.** Claiming a new tile releases the old one, in the
  same transaction.
- **First claim wins.** Claiming a tile someone else holds fails: the form
  path redirects back with a visible "someone got there first" notice, and a
  script client gets `409`. Nobody can take a held tile.
- **Grid is 12×12 (144 tiles).** `N = 12` is a constant in code, not a config
  table.
- **Height = number of claimed neighbours**, counting the 8 surrounding tiles
  (0--8). It's derived when the page renders, never stored.
- **The 3D board is CSS 3D transforms over real DOM buttons.** The board is
  tilted with `perspective`/`rotateX` and each tile is raised with
  `translateZ` by its height. Three.js/WebGL was the alternative and was
  turned down: the server-rendered form grid below has to exist anyway, and
  CSS 3D makes that grid *the* scene instead of a second copy for a canvas to
  keep in sync. Keyboard focus, screen readers and no-JS all come for free.
  Revisit only if the scene needs something CSS can't do (lighting,
  shadows, anything beyond rotate and tilt).
- **The camera turns.** `public/app.js` drives `--tilt` (clamped 10--75°)
  and `--spin` on `.board`: a drag turns it (touch only turns, so vertical
  swipes still scroll), and Turn/Tilt/Reset buttons do the same from the
  keyboard. A drag that moved never claims a tile. The view is remembered in
  `localStorage`. Without JS the board stays at the default angle and every
  claim still works. Because the camera can face any side, every tile draws
  all four side faces (`::before`/`::after` on the button, plus `.sides`).
- **The board is one Tab stop.** With JS, only one tile is in the tab order
  (your own, else the centre). Arrows or WASD move between tiles *relative
  to the screen*: the spin, rounded to the nearest quarter turn, picks which
  board direction a key means, so W always goes visually up. Enter claims,
  Q/E turn the camera. Keys only act while a tile has focus, so typing a name
  is unaffected. Without JS every tile is tabbable, as before.
- **Claims work without JavaScript.** Each tile is a `<button>` in a form
  that `POST`s to `/claim`, answered with a `303` back to `/`, which renders
  from the database. Script may enhance this; it can't be the only path.
- **Server: bare `node:http`**, TypeScript run directly by Node 24 (type
  stripping, so erasable syntax only: no enums, no namespaces, no parameter
  properties). No framework and no build step.
- **`/readme/` is rendered by `marked`** on each request, so it can't lag
  behind `README.md`.
- **Storage: SQLite through `node:sqlite`**, one file on the `/data` volume.
  It's built in, needs no native compile, and fits a 256 MB machine.

## Build sketch

Schema, one table:

    CREATE TABLE cells (
      id         INTEGER PRIMARY KEY,  -- 0..143, row-major position in the 12×12 grid
      claimer_id TEXT,                 -- the pid cookie of whoever holds it; NULL if free
      label      TEXT,                 -- the name they typed; NULL if free
      claimed_at TEXT                  -- ISO timestamp; NULL if free
    );
    CREATE UNIQUE INDEX one_tile_each ON cells(claimer_id)
      WHERE claimer_id IS NOT NULL;

All 144 rows are created at startup (`INSERT OR IGNORE`), so a claim is always
an `UPDATE ... WHERE claimer_id IS NULL` and "did I win?" is its change count.

Routes for crit 8's slice:

- `GET /`: the board, rendered on the server from current state
- `POST /claim`: fields `cellId`, `label`, form-encoded or JSON. A plain
  form always gets a `303` back to `/?notice=<key>` (`claimed`, `taken`,
  `label`, `cell`), so a no-JS visitor sees what happened. A client sending
  `Accept: application/json` gets real statuses instead: `200`, `409` when it
  lost, `400` for a bad `cellId` or label. A POST whose `Origin` isn't this
  host is refused with a `403`
- Notices are picked by key from a fixed table in `src/board.ts`; nothing
  from the query string is echoed into the page
- `GET /readme/`: `README.md` rendered to HTML (headings intact), replacing
  the placeholder's verbatim copy. `docs/` is served beneath it so the README's
  relative image links resolve there as they do on GitHub

The database path comes from `DB_PATH`: `/data/app.db` in the image,
`./.data/app.db` locally (gitignored).

Deliberately out of scope for this slice: accounts, live updates between
browsers, logging. Those get decided, or arrive, in later crits.

## Open decisions

Named so they're decided on purpose, not by default. Record the answer above
and delete the line when one is settled.

- **Real-time transport** (crit 9): SSE vs WebSockets vs polling. The brief
  wants the choice justified in `PROCESS.md`.
- **Migrations**: `PRAGMA user_version` plus numbered SQL steps run at boot is
  the default unless something better comes up. Decide before the first
  schema change after crit 8 ships.
- **What "good" means**: the README's argument, with sources (small web,
  games for a few friends, single-workshop tools). Every claim in it needs a
  matching rule here or a check in `spec/`, and the README says which claims
  are tested and which are judged.
- **Phone tap size**: at 390px a tile is about 27x22px, under the 44px
  comfortable target. Options: zoom/pan, tap-to-select-then-confirm, or a
  smaller board on phones. Decide before crit 9.
- **Visual direction**: the current warm-paper palette with per-person hues
  is a default, not a decision.
- **Crit 8 cutoff date**: not on the crit page; check the course schedule.

## How to work in here

- Run the app locally and look at it in a browser. The rendered page is the
  truth; your mental model of it isn't.
- Run `pnpm check` before you commit (it needs the app running; `APP_URL`
  says where). Run `pnpm check:evidence` before anything ships.
- When a check fails, read its output before you change anything.
- Never commit a red state.
- **Commit freely; ask before every push and every deploy.** Small commits as
  each piece works are the process record the marker reads against
  `PROCESS.md`, so don't batch them. Pushing and deploying are the
  outward-facing steps: ask each time, and one yes doesn't cover the next.
- **Look at it at both sizes before calling a UI change done.** Screenshot
  1440x900 and 390x844 (mobile emulation) with the Playwright script in
  `/tmp/pw-shot` or equivalent, read the images, and check
  `scrollWidth` equals the viewport width. Then do a keyboard pass: type a
  name, focus a tile, press Enter, and confirm a second browser context sees
  the claim.
- **After a deploy, fetch the URL and read the status.** The deploy command
  finishing is not the site answering.
- **Model the slice, not the system.** Build the one flow the current crit
  names, end to end, before widening anything. A feature not in the slice is
  an open decision or a line in the README's "left out", not a half-finished
  page.

## The database

- **The deployed volume outlives every deploy.** A schema change runs against
  whatever state production already holds, not an empty file. New `NOT NULL`
  columns need a default; renames and drops need a thought about the rows
  already there. The local `.data/` database is not evidence that a change
  is safe.
- **Never hand-edit the database**, locally or on the volume. State changes go
  through the app or a committed script.
- **Tests run against a live app and write to its database.** Point local
  runs at a throwaway `DB_PATH`, never at data you want to keep. A test that
  claims a tile must not depend on the board starting empty, since a second
  run won't find it empty.

## The checks

`spec/invariants.test.ts` ships with the template: `/` answers, and `/readme/`
carries every README heading in order. Keep it. Everything else in `spec/` is
ours, and every rule in **Decisions** that can be checked over HTTP should have
a test: a claim survives a fresh `GET`, a second claim on a held tile loses
with a `409`, claiming again moves your one tile, bad input is a `400`.

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
- **`* { box-sizing: border-box }` doesn't reach `::before`/`::after`.** A
  pseudo-element given the same height and border as its neighbour comes out
  taller by the border. Set `box-sizing` on the pseudo-element itself, and
  compare computed heights rather than trusting the numbers match.
- **A background paints under content, so it can't cover anything.** To mask
  content scrolling beneath a pinned corner, the mask has to be a positioned
  element (e.g. a sticky pseudo-element with a `z-index`), not a background.
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

## Deliverables still owed

- `README.md`: the argument for good, with sources. 400--600 words by
  submission, and the main material at crit 8.
- `PROCESS.md`: rewritten, not appended, at each crit. It must argue for the
  stack and the agent workflow and link commits by hash.
- `reflections/crit-8.md`, `crit-9.md`, `crit-10.md`, each by its cutoff.
- `research-note.md` (COMP8020): 600--800 words, a cited position that a
  durable in-repo harness (rules plus executable checks) beats per-session
  prompting for agentic development. It has to meet the counter-case.
