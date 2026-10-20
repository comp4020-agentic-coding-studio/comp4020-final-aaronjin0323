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
  script client gets `409`. Nobody can take a held tile. With JS, clicking a
  tile the page already shows as held never posts: it says whose it is
  ("Ari's Townhouse"), so "got there first" only ever means a real race.
- **Grid is 12×12 (144 tiles).** `N = 12` is a constant in code, not a config
  table.
- **Height = building level + occupied neighbours** (ADR 5), counting the
  8 surrounding tiles. Derived when the page renders, never stored.
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
  `localStorage`. Phones start at 36° tilt and 20° spin on an 80%-wide board:
  with no spin the blocks face away and the board reads flat, and the spin
  swings the corners out, so the board narrows to keep them on a 360px screen
  with tiles no smaller than before. Without JS the board stays at the default angle and every
  claim still works. Because the camera can face any side, every tile draws
  all four side faces (`::before`/`::after` on the button, plus `.sides`).
- **WASD and arrows work anywhere on the page.** Nobody should need to
  discover a Tab stop to play. The only exception is while typing in a text
  field. The first key press from elsewhere lands on the board (your tile,
  else the centre) and shows a focus ring; each press after that moves it.
  Moves are *relative to the screen*: the spin, rounded to the nearest
  quarter turn, picks which board direction a key means, so W is always
  visually up. Enter claims, Q/E turn the camera, and Enter in the name field
  jumps to the board instead of submitting. The board is still a single Tab
  stop (roving tabindex), and without JS every tile is tabbable.
- **Enter in the name field never claims a tile.** Implicit form submission
  uses the form's first submit button, so the form starts with a disabled,
  hidden one, which cancels it. Without that, Enter claims tile 0.
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
- **Schema changes are numbered migrations** run at boot, tracked with
  `PRAGMA user_version`. Each step runs once, in a transaction, against
  whatever production already holds. A committed migration is never edited;
  a fix is a new step.

### The city economy (ADR 5)

Skyline is a city game: land on a lease, buildings that earn coins. Read
`docs/adr/0005-a-city-economy.md`. It replaced crit 9's dormant tiles
(fading, waking by visiting, displacement; ADR 1 and ADR 3) and ADR 4's Wave.

- **Every game number lives in `src/economy.ts`**, nowhere else: starting
  coins 100; base income 10/min; +20% per occupied neighbour; 4 h cap on
  uncollected income; levels 1--5 (Small House, Townhouse, Apartment, Office
  Building, Skyscraper) with upgrade costs 150, 400, 900, 1800; relocation
  50 coins, 30 min cooldown; lease 24 h, renewals 6 h/100, 12 h/180,
  24 h/300, never past 48 h from the ownership start; help +50 to the
  neighbour, +20 to the helper, once an hour; helping back within an hour
  of being helped +30 more to each (ADR 8); a park 60 coins, 2 h, at most
  2 running per player; gold needs 3 distinct people (ADR 7); zones civic
  0/0, market +15% to each adjacent other person's building (at most +30%
  received from markets), factory +35% self and −10% to each adjacent other
  person's building, total bonus never below 0 (the no-neighbour base);
  rezoning 40 coins, 1 h cooldown per player (ADR 9); districts 4×4 (nine),
  a mayor needs Lv2+, the single highest level (a tie is no mayor) and 1
  other Lv2+ building, +8% per other, at most +40% (ADR 10). The one exception:
  `public/diff.js` keeps a mirror (`ECONOMY`) because the browser can't
  import a `.ts` file, and `spec/diff.test.ts` fails if the two differ by a
  single field. Change `src/economy.ts` first, then the mirror.
- **Players are rows.** `players (pid PRIMARY KEY, label, coins INTEGER,
  created_at, last_relocated_at, last_helped_at)`, created on first sight
  with 100 coins. Coins are integers and never negative (a `CHECK`).
- **A plot holds one building.** `cells` gains `level`, `lease_ends_at`,
  `owned_since` (the start of this ownership, which caps renewals),
  `pending_cents` (earned, not yet collected, in hundredths of a coin) and
  `settled_at`. One active plot per player stays a unique index.
- **Income is settled, never guessed.** `settle(now)` brings every building's
  `pending_cents` up to `now` at the rate each one had since `settled_at`,
  stopping at its lease end and at the 4 h cap. Every change that can alter
  any rate (claim, relocate, upgrade, expiry, collect) runs `settle` first,
  in the same `BEGIN IMMEDIATE` transaction, then applies the change. A rate
  is never applied to time before the change that set it.
- **A lease ends on the clock, not on absence.** Expired land is free on
  read: a plot whose `lease_ends_at` is past is free for heights, claims and
  income, whether or not a sweep has run. The sweep clears expired rows
  (after settling them, so their earnings stay collectable on the player) and
  broadcasts. Uncollected earnings from an ended lease move to
  `players.unclaimed_cents`, collectable later.
- **Each action is one POST, checked on the server, one transaction:**
  `/claim` (also relocation, when you already hold land: 50 coins,
  cooldown), `/collect`, `/upgrade`, `/renew` (`hours` 6|12|24), `/help`
  (`cellId` of an adjacent neighbour), `/park` (`cellId` of a free plot,
  ADR 7), `/rezone` (`zone`, ADR 9). Same-origin, `pid` only, JSON or form
  (form gets a `303` with a notice key, as `/claim` does). Refusals are
  specific: `409` taken, `402` not enough coins, `429` cooldown, `400` bad
  input or rule (`max-level`, `max-lease`, `not-neighbour`, `no-land`,
  `park-limit`).
  Nothing the client sends is trusted except the plot and option it picks.
- **The board event carries public state for all, private state for you.**
  Every tile: `{ state, label, hue, level, neighbours, height, rate,
  leaseEndsAt }` (no `pid`). Your stream also gets `me: { coins, pending,
  rate, cellId, level, leaseEndsAt, ownedSince, relocateAt, helpAt,
  welcome? }`. The page counts `pending` up between events from `rate`, for
  display only.
- **The city log** is a table of public events (`type`, text fields, plot,
  time; never a `pid`), the latest 8 sent on each board.
- **Landmarks stay** (ADR 4): a building with all 8 neighbours occupied,
  now the gold tier of three (ADR 6: bronze 3, silver 5, gold 8).
  **Help replaces Wave**: `/wave` is removed.

### Parks (ADR 7): a public good you place for your neighbours

Read `docs/adr/0007-parks.md`. One building per person stays; a park is
not a tile anyone holds.

- **`POST /park {cellId}`**: you must hold land; 60 coins; lasts 2 h from
  placement; never renewed; at most 2 running per player. One `BEGIN
  IMMEDIATE`, settle first. Refusals: `402` coins, `409` plot not free, `400`
  `no-land`, `park-limit`, `cell`.
- **A park is an occupied neighbour for every building except its placer's
  own**: height, the +20% bonus and landmark tiers all count it. It earns
  nothing and blocks building on its plot (a claim on it is `409`).
- **Gold also needs 3 distinct people** among the holder, the neighbours'
  holders and the counted parks' placers. Bronze and silver don't.
- **A park ends on the clock**: an ended park is gone on every read; the
  sweep deletes it, writes the city log, logs `park.end` and broadcasts. Park
  starts and ends are cut points in `integrate()`, like lease ends.
- **Schema: migration 6** adds `parks (cell_id INTEGER PRIMARY KEY,
  placed_by TEXT NOT NULL, label TEXT, placed_at TEXT NOT NULL, ends_at TEXT
  NOT NULL)`. `placed_by` is a `pid` and never leaves the store.
- **Payload:** a park tile is `state: "park"` with the placer's label,
  `endsAt` and `mine` (yours only), never a `pid`; `me` gains `parks` and
  `parkLimit`. The page offers "Place park (60)" on a free plot beside
  someone else's building. Logged as `park who=… at=… label=…`.

### Return the favour (ADR 8): a decision about each other

Read `docs/adr/0008-return-the-favour.md`. Help is unchanged (adjacent only;
help at a distance was turned down).

- **If B helps A within an hour of A helping B, both get +30 more**
  (`RETURN_BONUS`, `RETURN_WINDOW_MS`). Checked and cleared inside `help()`'s
  `BEGIN IMMEDIATE`, so it pays once; a return doesn't open a favour back.
  Only the latest helper counts. **Migration 7** adds `players.helped_by`
  (a `pid`, never leaves the store) and `helped_by_at`, both nullable.
- **`me.returnable: { cellId, until } | null`**, only while the window is
  open and the helper stands beside you, and you can help now. The page
  glows that building green (`data-return`, "+30" over its roof) and its
  Help reads "Help back +30 each". City log: "Kai
  returned Mia's help"; server log: the `help` line with `returned=true`.

### Zoning (ADR 9): what your building does to the people beside it

Read `docs/adr/0009-zoning.md`. The one choice with a cost to someone else
in it, and it's public.

- **Every building has a zone** (`civic` default, `market`, `factory`).
  Income is `10 × level × (100 + 20 × neighbours + zone terms)` cents a
  minute: own zone's self term, plus each adjacent *other person's*
  building's zone effect; market effects received capped at +30%; the
  whole bonus floored at 0. Parks have no zone. `rate(level, n, bonus)`
  takes one summed percentage term, so a later term adds into it.
- **`POST /rezone {zone}`** on your own building: 40 coins, 1 h cooldown,
  one `BEGIN IMMEDIATE`, **settle first** (it changes neighbours' rates, so
  it's a cut point for every adjacent building). Refusals `402`, `429`,
  `400` (`no-land`, `zone`, `same-zone`). A new claim is civic; a freed plot
  goes back to civic; **a move keeps the zone** (part of the building, like
  its level).
- **Migration 8:** `cells.zone TEXT NOT NULL DEFAULT 'civic'`,
  `players.last_rezoned_at TEXT`. Civic is neutral, so the deploy changes
  nobody's income.
- **Payload:** every building tile has `zone` (public); `me.rezoneAt`. The
  page draws a roof icon for market and factory (civic none); your own
  inspector offers the other zones with cost while you can act; the
  preview's `+N/min` and each neighbour's `+N%` include zones. A neighbour
  rezoning is narrated on your page only, one line ("Kai built a factory
  beside you · −10%"). Logged `rezone who=… at=… zone=… from=…`; city log
  "Kai zoned a factory".

### Districts and mayors (ADR 10): a contest that scales to a room

Read `docs/adr/0010-districts-and-mayors.md`. No new action, no schema
change: everything is derived from plots and levels.

- **Nine 4×4 districts**, `district = floor(r/4)*3 + floor(c/4)` (0..8 in
  the payload; people read 1..9, in the page and both logs).
- **Mayor:** the holder of a district's single highest-level building at
  Lv2+, if at least 1 other Lv2+ building there is someone else's. A tie at
  the top is no mayor. Parks never count; the mayor's own buildings are
  never "others". The mayor earns +8% per other (cap +40%), added into
  `rate()`'s summed bonus inside the same floor.
- **Mayors change only at cut points** (claim, move, upgrade, lease end),
  all settle-first already; `integrate()` recomputes them per piece.
  Never stored.
- **Payload:** every tile has `district`; the board has `mayors: [{
  district, cellId, label }]`, labels only. The page draws grid lines every
  4 plots (CSS only), a gold star on the mayor's roof (opposite edge from a
  zone sign), an inspector line, the mayor term in the preview, and one
  line for your own building ("You're mayor! +16%" / "Kai took mayor").
  Logged `mayor district=N who=<tag|none> label=… from=<tag|none>` by
  comparing before and after each broadcast; city log "Kai became mayor of
  district 5".

### Crit 9: real-time and leaving

- **Live updates over SSE** (`GET /events`). Claims stay `POST`s; the server
  pushes the board to every open page after any change. SSE fits bare
  `node:http` with no library, reconnects by itself, and only the server ever
  needs to push. WebSockets would earn their keep only for streaming input
  from clients (live cursors), which this game doesn't have.
- **Streams are expected to drop, so every event carries the whole board.**
  Fly's proxy closes a connection after about 60 s with nothing sent (one
  recent report says about 30 s for a stalled stream), so a comment
  heartbeat goes out every 15 s. Fly can also stop the machine with streams
  open. The client reconnects on its own (`retry: 2000`), and since each
  `board` event is the full state, not a diff, reconnecting resyncs with no
  replay logic. On `SIGTERM` the server ends every stream and closes the
  database before exiting, so clients reconnect at once rather than hanging.
- **Each stream gets its own payload.** "Mine" depends on who's asking, and a
  `pid` is the only thing that proves identity, so it never leaves the
  server: each connection is sent the board with its own tile marked, and
  other people appear only through the public tile fields, never a `pid`.
- **With JS, claiming happens in place.** The form posts with `fetch` and the
  board updates from the response and the stream: no reload, and the camera
  and focus stay put. Without JS it's the `303` reload, as before, and other
  people's claims show on the next load.
- Crit 9's dormant tiles (fading, waking by a visit, displacement) were
  replaced by leases in ADR 5.
- **Losing land is told, not hidden.** When a lease ends, the player's next
  visit says so once, with what's waiting in the same line ("Your lease
  ended. 2880 coins waiting: collect, then pick a new plot."; the figure is
  what Collect pays, so the two never disagree), and their coins and
  uncollected earnings are kept. With no land but earnings waiting, the
  wallet shows coins and Collect only (no income, lease ring, Upgrade or
  Renew). This is the next-day return a marker checks for persistence: an
  empty board with the money hidden reads as data lost. A rule that takes
  something from you has to be readable off the screen.
- **Phones tap to select, then confirm.** On a coarse pointer the first tap
  on a tile selects it and shows a full-width bar; its button ("Build here",
  or "Move here · 50" when you hold land) does the action. Mouse and keyboard
  claim directly. The bar names whose building it is, and for a free plot
  shows what building there would earn and whose income it would lift: on a
  phone it's the only way to learn who you'd stand beside.

### Showing what your choice does to other people

A project review found the game was one decision deep: you claim, and the
page never shows that your position lifts or drops strangers, which is the
whole point. So:

- **Every height change is visible to everyone.** A tile whose height
  changes *while keeping its holder* shows a floating "+1" or "−1" on every
  open screen. A tile that changes hands, or becomes claimed, doesn't: that's
  a new arrival, not a rise.
- **Your own neighbourhood is narrated, and only yours.** Building says
  whose income you lifted ("Your building is up! +14/min · Mia and Kai
  +20%"). Someone building beside you, moving away, or their lease ending
  says so, with what it did to your income ("Mia built beside you · +20%").
  Limiting messages to your own tile keeps a busy room from flooding anyone's
  screen or screen reader. A change of holder shows as a change of hue,
  which comes from the holder.
- **It's all worked out on the page.** Each `board` event is the full board,
  so `public/diff.js` compares consecutive boards; the server sends nothing
  new. The first board to compare against is read from the server-rendered
  HTML, so a claim made before the stream connects still gets its message.
  Your claim's result can arrive by the stream or by the claim's response,
  whichever is first; both go through the same comparison, so the message
  shows exactly once. `diff.js` is a pure module unit-tested in
  `spec/diff.test.ts`.
- **Scripts are ES modules, served `no-cache`,** so an `app.js` and a
  `diff.js` from different deploys can never run together.

### Crit 10: telling people apart, and who did what

- **What each person may see and change is decided on the server, and
  recorded in `docs/adr/0002-who-may-see-and-change-what.md`** with the
  options turned down. The page may hide things as a courtesy; every rule
  has to hold for a client that ignores the page and posts with `curl`.
  Change the ADR's table before changing who may do what.
- **One line per event on stdout, `event key=value`,** so `flyctl logs` is
  the narration at the crit and the first thing read when production
  misbehaves. Events: `start`, `page`, `welcome`, `expired.seen`,
  `stream.open`/`stream.close`; one per successful action from the `action`
  wrapper in `src/server.ts` (`claim` with `from`, `renamed`, `lifted`,
  `dropped`; `relocate`, `collect`, `upgrade`, `renew`, `help`, `park`,
  `rezone`), and `<action>.refused` (status, reason, and `held` on a claim's
  `409`); `expire`, `park.end`, `landmark`, `mayor`, `error`, `shutdown`.
- **A person in the logs is a tag, never their `pid`.** The tag is the first
  6 hex of a SHA-256 of the `pid`: two visitors read apart, and nobody
  reading the logs can turn it back into a cookie. Logs leave the server, and
  the `pid` is the only proof of identity, so a `pid` next to a label would
  let a log reader act as that person.
- **Every typed string is quoted as JSON,** with line separators and format
  characters (bidi overrides) escaped too, so a label can't end the line,
  forge a second one, or hide text. Only tags, tiles, numbers and fixed
  words go in unquoted.
- **Logging lives in `src/log.ts`, called from `src/server.ts`.** `db.ts`
  and `board.ts` stay pure. What a claim did (`lifted`, `dropped`)
  is worked out by comparing the board before and after, the same rule as
  the page's +1/−1.

### A goal for the room, and something to do with your neighbours

Playing it found the game was one action: claim, then wait. Recorded in
`docs/adr/0004-landmarks-and-waves.md`.

- **The goal is landmarks, in tiers on the same spot** (ADR 6, amending
  ADR 4). A tower earns a **bronze** crown at 3 occupied neighbours,
  **silver** at 5 and **gold** at 8 (gold is ADR 4's landmark: nine people).
  The thresholds are game numbers: `LANDMARK_TIERS` in `src/economy.ts`,
  mirrored in `public/diff.js`'s `ECONOMY`. Bronze and silver give a room of
  three or four something to reach; every step is on the way to gold, and
  every gap round a nearly finished tower is still a reason to move. A
  threshold that scales with the number of players was turned down (ADR 6):
  a moving goal, a reason to keep people away, and untestable.
- **Landmarks are stored, permanent, and only ever counted up.** Migration 3
  adds `landmarks (id INTEGER PRIMARY KEY, cell_id INTEGER, label TEXT,
  raisers TEXT, raised_at TEXT)`, with `raisers` a JSON array of the holder
  and the occupied neighbours' labels and no `pid`. Migration 5 adds `tier`
  (`'gold'` by default, which every earlier row was), makes the unique index
  `(cell_id, tier)`, and backfills silver and bronze under every gold row.
  One row per (cell, tier), ever (`INSERT OR IGNORE`): a tower that drops and
  reaches a tier again doesn't record a second. **Reaching a tier records
  every tier below it too**, so a cell's tiers are always a prefix of bronze,
  silver, gold, and its crown is its highest.
  `store.raise(now)` runs inside every `broadcast()`, since every change that
  can lift a tower already broadcasts; it's the same synchronous turn as the
  change, not the same SQL transaction (inside `claim()` it slowed the
  random-board test past its limit). It also runs once at boot, logged but
  not celebrated. They can't be derived,
  because the people who raised one may have left.
- **A landmark is a mark on the spot, not a lock.** Ownership rules are
  unchanged: its holder can move, and its lease can end and the plot be
  settled again. It
  shows as a crown on that cell, coloured by its highest tier.
- **The only room-wide messages are crowns being raised.** Gold is the
  celebration: every open page bursts and names all nine. Bronze and silver
  are a lighter toast ("Silver crown at row 4, column 4: Mia, Kai and 4
  others") and the live region, no burst. Only the highest new tier of a
  change is told; the rest are logged. Everything else is still narrated for
  your own tile only.
- **The page always shows what's next:** crowned cells so far, and the
  tower nearest its next tier ("Closest: Mia's building, 4 of 5 neighbours
  for silver"; fewest neighbours still needed, ties to the higher tier). A
  corner can only ever reach bronze and an edge silver, so neither is ever
  shown chasing a tier it can't reach. Tiles that would bring a tower closer
  glow (`data-helps`), and the preview and inspector say so. This is worked
  out on the page from the board, like the +1/−1, and held equal to the
  server's heights by a test.
- **Each `board` event carries `landmarks`** (count of crowned cells, plus
  per crowned cell its highest `tier`, label and raisers) and, once, a
  `raised` entry (with `tier`) for a crown that just happened, so a
  reconnecting page doesn't replay old celebrations. The log line is
  `landmark at=… tier=… label=… raisers=…`, one per row recorded.
- ADR 4's Wave was replaced by Help in ADR 5; `/wave` is gone.

### Seeing a claim before and while you make it

- **A placement preview, never a change.** Hover, keyboard focus or a phone
  tap on a free plot previews its resulting height and income and marks the
  neighbours it would lift (`data-preview="lift"`) and, on a move, the old
  ones it would drop (`"drop"`). It's computed by `preview()` in
  `public/diff.js`, and `spec/diff.test.ts` holds it equal to the server's
  heights and income on random boards with ended leases, parks, zones and
  mayors in them, so the preview and the real claim can't disagree.
- **"Claimed" only once the server says so.** A claim in flight marks its
  tile `data-pending` and ignores every further claim until it answers. The
  stream may show the new board first; success is still announced only from
  the reply. A network failure says nothing was claimed, rather than falling
  back to a full form post. Each refusal (`403`, `409`, `402`, `429`, `400`,
  network) has its own message, sent through the `[data-announce]` live
  region.
- **Any tile can be inspected,** by hover, focus or tap: whose building,
  income, occupied neighbours, zone, district seat, landmark, and lease left,
  counted down on the page from the server's `leaseEndsAt` (a time, not a
  countdown); a park shows whom it lifts and when it closes. The inspector is
  server-rendered and follows the latest input.
- **Others' claims are marked, never announced.** A tile someone else just
  claimed gets `data-fresh` for about two seconds; focus never moves.
- **The first board after a reconnect is accepted even with a lower
  version,** since a restarted server seeds its version from the clock.
  Within one stream, a lower version is still stale and dropped.
- **The connection line says live, reconnecting or offline,** by shape as
  well as colour, and is hidden without JS.

### Show, don't tell

Playing it cold, the first screen was too complicated to start: a full
dashboard of empty stats, four greyed buttons, a goal line, a key and an
activity list, before the player had done anything. The game is learned by
playing, so the page guides with motion, highlight and numbers on the
board, and as few words as possible.

- **Show only what you can act on now.** Nothing is drawn disabled to
  explain itself. A control appears when it becomes possible and goes when
  it isn't: no land means no dashboard and no action buttons (except
  Collect, for earnings an ended lease left); Upgrade appears
  once you can afford it; Renew once the lease is under 6 h; Relocate and
  Help in the inspector of the plot you picked. The disabled-with-a-reason
  pattern is gone.
- **The first screen is one step.** Logo, a single-line tagline, the name
  field, and the board with free plots gently glowing. Typing a name isn't a
  gate: tapping a plot with no name focuses and pulses the name field, and
  the claim goes through once a name is there. No instruction text beyond
  the tagline and the field's placeholder.
- **The board teaches.** Hovering, focusing or tapping a plot shows, on the
  board itself, what claiming would do: a ghost building, `+N/min` floating
  over it, and `+20%` over each neighbour it would lift. Money is shown as
  coins flying from your building to your wallet when you collect, and a
  `+N` that ticks up over your building while income waits.
- **Numbers and icons over sentences.** The wallet is a coin icon and a
  number. Income is `+12/min`. The lease is a draining ring round your
  building, not "23 h 59 m". Words stay only where an icon would be
  ambiguous, and every icon still has an accessible name.
- **One message at a time, short.** Narration is at most one line of a few
  words ("Kai built beside you, +20%"), shown briefly near the thing it's
  about, and spoken through the live region. No stacked notices, no
  paragraphs.
- **Secondary things are tucked away until asked for.** The map key, the
  city activity list, the camera buttons and the keyboard hint sit behind
  small icon buttons (or appear after your first claim), not on the first
  screen. The landmark goal shows only once a crown stands or some
  building is one neighbour short of its next tier (ADR 6).
- **Accessibility is kept, not traded away.** Every visual cue has a
  text equivalent for screen readers, keyboard and no-JS paths still work,
  and reduced motion replaces motion with a static highlight.

### The look

- **Styled after a GTA title screen.** A framed sunset header over a
  skyline with palms, flat colour with black outlines and hard shadows, and
  the board as a city map at night: the gaps are roads, and every claimed
  tile is a tower with one row of lit windows per floor, so a height reads
  as a count of floors. Each person keeps their own hue; that was the one part of the old warm-paper
  look worth keeping, since it's how you tell people apart.
- **Pricedown is artwork, never a font.** The wordmark is Pricedown (the
  GTA logo face) converted to outlines in `public/art/logo.svg`. Its free
  licence (Typodermic's desktop EULA) allows fixed artwork and logos, and
  forbids a web font or putting the font file anywhere public, so no
  Pricedown file ever enters the repo, and new words in it are new
  artwork, not new text. Live text uses Passion One under the SIL OFL,
  with its licence beside it in `public/fonts/`.
- **Every tile state reads in greyscale.** Free is a flat lot with a kerb,
  taken a lit tower, yours a gold ring with a gold marker, a park a low
  lawn with a hedge and a tree. Focus is one gold outline, selected a double
  cream one, pending moving stripes, a preview a dashed ghost at the
  resulting height, a fresh claim a spreading ring. Ghosts are drawn in each
  tile's `.beacon`, which never takes a click.
- **The board takes the page.** On wide screens the name, map key and
  inspector sit in a narrow column beside it; on phones the board follows
  the name, with the camera buttons under it at thumb height. A small map
  key names each state, instead of any tutorial.
- **One type scale, held in tokens,** with AA contrast measured on the
  rendered pixels over the gradient. Every animation and transition is off
  under `prefers-reduced-motion`, and a style test fails if one is added
  outside that block.
- **The skyline is drawn by a script.** `scripts/draw-skyline.ts` writes
  `public/art/city.svg` from a fixed seed, so it's redrawn, never
  hand-edited. The page shows it as a mask, so its colour is in the CSS.

## Build sketch

The schema is the migrations in `src/db.ts`, 1--8; read them, not a copy
here. `cells` (one row per plot, `id` 0..143 row-major, all 144 created at
startup with `INSERT OR IGNORE`; `one_tile_each` unique on `claimer_id`),
`players`, `events` (the city log), `landmarks`, `parks`. Migration 2's
`cells.last_seen_at` and `displaced` table were crit 9's dormancy (replaced
by ADR 5); migration 4 keeps them unused rather than dropping history.

A claim is one `UPDATE ... WHERE claimer_id IS NULL` (and no running park on
the plot) after `settle(now)` has freed every ended lease, so "did I win?" is
its change count.

**The store takes its database and its clock as arguments.**
`openStore(path)` returns the store, and every function that depends on time
takes `now`. The server opens `DB_PATH`; tests open `:memory:`. That's how
lease ends, income over hours, and each migration (an older database
upgraded with its rows intact) get tested without waiting or touching the
volume.

Routes:

- `GET /`: the board, rendered on the server from current state
- `POST /claim`, `/collect`, `/upgrade`, `/renew`, `/help`, `/park`,
  `/rezone`: see the economy section above. A plain form always gets a `303`
  back to `/?notice=<key>`, so a no-JS visitor sees what happened; a client
  sending `Accept: application/json` gets real statuses instead. A POST whose
  `Origin` isn't this host is refused with a `403`
- Notices are picked by key from a fixed table in `src/board.ts`; nothing
  from the query string is echoed into the page
- `GET /events`: SSE. On connect, and after every change, it sends a `board`
  event (the payload in the economy section). A sweep once a minute settles
  income and ends leases and parks, broadcasting if any ended
- `GET /readme/`: `README.md` rendered to HTML (headings intact), replacing
  the placeholder's verbatim copy. `docs/` is served beneath it so the README's
  relative image links resolve there as they do on GitHub

The database path comes from `DB_PATH`: `/data/app.db` in the image,
`./.data/app.db` locally (gitignored).

Deliberately out of scope so far: accounts, chat, live cursors, and rate
limiting (ADR 0002 says why).

## Open decisions

Named so they're decided on purpose, not by default. Record the answer above
and delete the line when one is settled.

- **What "good" means**: the README's argument, with sources (small web,
  games for a few friends, single-workshop tools). Every claim in it needs a
  matching rule here or a check in `spec/`, and the README says which claims
  are tested and which are judged.
- **The rest of the roadmap (weeks 11--12)**, from the same review:
  "N here now" (a count of open streams); "since you left, 4 people settled
  near you" on return; a "room here" invite marker. The move warning shipped
  as the preview's "drop" marks, the room score became landmarks (ADR 4),
  and the cooldown on moving shipped with the economy (ADR 5: 50 coins,
  30 min).

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
- **Since the repo went public, a push to `main` is a deploy.** CI deploys
  every push once its checks pass, so a half-built feature pushed is a
  half-built feature live. Push only when the slice works end to end.
- **Look at it at both sizes before calling a UI change done.** Run
  `node scripts/browser-check.ts` against the running app (`APP_URL`; it
  drives your installed Chrome through `playwright-core`). It screenshots
  1440x900 and 390x844 into `.shots/` (gitignored), checks `scrollWidth`,
  does the keyboard pass, and opens two browsers to time a claim in one
  appearing in the other. Read the screenshots; the script can't judge them.
  It isn't in CI, which has no Chrome; it's the hands-on check before a
  commit that changes the page.
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
- **Never point `pnpm check` at the live URL.** The spec claims tiles as its
  fixture players, so a run against production leaves Alice, Bob and Fay
  holding tiles on the real board. CI already runs the spec against the
  built image; after a deploy, fetch the URL instead. It did happen once
  before crit 10 (Alice, Bob, Fay and `<b>x</b>` were found on the live
  board), so it's now enforced, not just a rule: `spec/not-production.ts`
  makes both `pnpm check` and `scripts/browser-check.ts` refuse any
  `fly.dev` host before sending a request, held by
  `spec/not-production.test.ts`. Don't weaken it to get a check to run.

## The checks

- **Real-time is a test, not a claim.** A spec test opens two `/events`
  streams as different people, claims from a third, and fails unless both
  receive the change within 1000 ms. It runs in CI against the built image.
- **Leases, income and migrations are unit tests over `openStore(":memory:")`**
  with an injected clock, in `spec/` alongside the HTTP tests.
- **The logs are tested from a server the test starts itself.** The app at
  `APP_URL` is a separate process (a container in CI), so its stdout can't be
  read. `spec/log.test.ts` spawns `node src/server.ts` on `PORT=0` with a
  temp `DB_PATH` and reads what it prints.
- **Every access rule in ADR 0002 has a test in `spec/access.test.ts` or
  `spec/claim.test.ts`,** each seen to fail with the rule broken.
- **Spec files run in parallel against one app.** A test that claims many
  tiles takes them from the far end of the board, so it can't make another
  file's "first free tile" fail for the wrong reason.
- **Only one HTTP spec file takes the first free tile.** That's
  `claim.test.ts`; `access.test.ts` takes from the far end and
  `realtime.test.ts` from row 7 on. Even one claim on the first free tile
  from another file races it (`realtime.test.ts` once failed it ~1 run in 2).

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
- **A reach check followed by a hover races other players' claims.** A
  building can rise between the two. Give the hover a short timeout and
  turn the camera again, rather than waiting out the default on a blocked
  angle.
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
  submission, and the main material at crit 8. It's about 730 words now
  (`wc -w`), so it needs cutting.
- `PROCESS.md`: rewritten, not appended, at each crit. It must argue for the
  stack and the agent workflow and link commits by hash.
- `reflections/crit-8.md`, `crit-9.md`, `crit-10.md`, each by its cutoff.
  `crit-8.md` and `crit-9.md` are in; `crit-10.md` isn't yet.
- `research-note.md` (COMP8020), not started: 600--800 words, a cited
  position that a durable in-repo harness (rules plus executable checks) beats per-session
  prompting for agentic development. It has to meet the counter-case.
