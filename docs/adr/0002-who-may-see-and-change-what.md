# 2. A cookie is the only proof of who you are, and the server checks every change against it

- **Status:** accepted, crit 10 (week 11)
- **Decides:** what an anonymous visitor may see and change, and where that's enforced

## Context

Skyline has no accounts. Anyone who opens the page gets a random `pid` in an
HttpOnly cookie, and that is all the server ever knows about them. The page
hides some things (with JS, clicking a tile someone holds never posts), but
anything the page hides can still be sent with `curl`. So every rule that
matters has to hold on the server, for a client that ignores the page
entirely.

The state is small: one row per tile (`claimer_id`, `label`, `claimed_at`,
`last_seen_at`), and a `displaced` row per person whose dormant tile was
taken. The routes are `GET /`, `POST /claim`, `GET /events`, and read-only
files (`/readme/`, `/readme/docs/…`, `/style.css`, `/app.js`, `/diff.js`,
`/art/`, `/fonts/`).

## Decision

A well-formed `pid` cookie is who you are; anything else gets a fresh one. A
visitor sees everyone's tiles but nobody's `pid`, and can change only the one
row their `pid` holds, or a row nobody is still around for.

| Who | May see | May change | Enforced on the server |
|---|---|---|---|
| Anyone | Every tile's state (free, held, dormant), label, hue, height; the claimed count; when a held tile stops being safe (`safeUntil`: a day after its holder was last here, so it reveals that time and nothing else) | Nothing, by looking | `boardView` in `src/board.ts` builds each tile from label, hue, height and state only, and both the HTML and every `/events` payload are made from it |
| Anyone | Never another person's `pid` | | `pid` never enters `TileView`; hue is a one-way hash of it (`hue`, `src/board.ts`); the cookie is `HttpOnly` (`identify`, `src/server.ts`) |
| You | Your own tile as "mine", your status line, your one-time displacement notice | | Per request and per stream: `boardView(tiles, pid)`; each `/events` connection holds its own `pid` (`openStream`); `takeDisplacement(pid)` |
| You | | Claim a free tile | `take`'s `WHERE claimer_id IS NULL …` in `claim`, `src/db.ts`; the change count decides who won |
| You | | Claim a plot whose lease has ended | Expired is free: the same `WHERE` treats `lease_ends_at < now` as unheld ([ADR 5](0005-a-city-economy.md)) |
| You | | Collect your own income, upgrade, renew or move your own building; help one neighbour an hour | Each POST settles income then changes only rows keyed by your `pid`, in one `BEGIN IMMEDIATE`; coins can't go below 0 (a `CHECK`), and costs and limits come from `src/economy.ts`, never the request |
| Anyone | Every building's level, neighbour count, height, income rate and lease end; the latest public city events | | Your coins, uncollected income and cooldowns go only to your own stream (`me`) |
| You | | Rename yourself, by claiming your own tile again | `relabel`'s `WHERE id = ? AND claimer_id = ?`, in `claim` |
| You | | Move, which releases your old tile | `release` then `take` in one `BEGIN IMMEDIATE` transaction; a lost move rolls back and you keep your tile |
| You | | Keep your tile awake, by visiting | `touch(pid)` on `GET /` and `/events`; it only ever updates the row your `pid` holds |
| Anyone | Every landmark the room has raised, and the names of the nine people who raised it | | `raise` in `src/db.ts` stores labels only, never a `pid`, when a tower reaches a tier: 3, 5 or 8 occupied neighbours ([ADR 4](0004-landmarks-and-waves.md), [ADR 6](0006-landmark-tiers.md)) |
| You | | Help a neighbour (their building is next to yours), once an hour: +50 to them, +20 to you | `/help` checks same-origin, your active land, adjacency and `last_helped_at` inside one transaction, so a repeated or simultaneous request can't pay twice (Help replaced Wave, ADR 5) |
| Nobody | | Take a held tile that isn't dormant | The same `WHERE`: `409` (JSON) or `303 /?notice=taken` (form) |
| Nobody | | Hold two tiles | The move transaction, and the unique index `one_tile_each` on `claimer_id` as a backstop |
| Nobody | | Change another person's label or wake their tile | Every write is keyed by the requester's own `pid` |
| Nobody | | Post a label outside 1–24 characters, or with control characters | `validLabel` (`400`, or `/?notice=label`); every output goes through `escapeHtml` or `textContent` |
| Nobody | | Claim from another site's page | `sameOrigin`: a POST with a foreign `Origin` is a `403`; `SameSite=Lax` keeps the cookie off cross-site POSTs anyway |

## Why

- **Anyone can join in seconds** (README commitment 3). The server mints a
  `pid` for any request without a valid one, so the first click works with
  no sign-up, and works without JavaScript.
- **First claim wins, and nobody takes a tile from someone still around**
  (commitment 4). That has to hold against a crafted POST, not only a polite
  page, so the rule lives in one SQL `WHERE`. Node runs claims one at a
  time on a synchronous database, inside an immediate transaction, so two
  requests can't both see a tile free.
- **The `pid` is the only proof of identity**, so it never leaves the server
  except in your own `Set-Cookie`. Showing it to anyone else would let them
  move or rename you. Labels are display only: two people may both be
  "Sam", and neither can act as the other.

## Options considered

1. **Accounts (email, OAuth).** Real identity and one tile per human. Turned
   down: they break "joins in seconds" for a room of strangers at a
   showcase, and storing emails creates data I'd have to protect.
2. **Signed tokens (an HMAC'd `pid`).** A secret-signed cookie can't be made
   up. Turned down: making one up gains nothing. A self-chosen `pid` is just
   a new anonymous person, which omitting the cookie already gives you. The
   thing worth protecting, guessing someone *else's* `pid`, is already out
   of reach at 122 random bits.
3. **IP-based identity, or one tile per IP.** Turned down: a showcase room
   shares one NAT address, so it would make the whole room one person.
4. **Rate limiting claims or new `pid`s.** Would slow a script that fills
   the board. Turned down for now: per-IP limits hit the shared room
   address first, and a 144-tile board in one room is easy to watch and
   undo by moving. Revisit if it happens.
5. **Server checks only what matters; the page hides the rest (chosen).**
   The UI's "Ari holds this" refusal is a courtesy that saves a round trip.
   The server never relies on it.

## Consequences

- **One tile per person means one tile per browser profile.** Two browsers,
  a private window or cleared cookies make you a new person, and your old
  tile goes dormant after a day. A script that sends no cookie gets a new
  `pid` per request, so it could claim every free and dormant tile. It
  can't take a held tile that's awake. I accept this for one room.
- **Losing the cookie loses the tile.** There is no recovery, by design: a
  label proves nothing, so nothing could prove the tile was yours.
- **A POST with no `Origin` is allowed,** so `curl` and old clients work.
  Current browsers always send it on a POST, and `SameSite=Lax` already keeps
  the cookie off a cross-site form post.
- **Visiting has small side effects.** `GET /` wakes your tile and uses up
  your displacement notice. Only your own row is touched, so a page that
  links here can't affect anyone but the person who clicks.
- **Hue comes from the `pid`.** It tells people apart on the board, and as a
  0–359 hash it gives nothing back about the `pid`.
- **The server's logs must never print a `pid` next to a label.** That
  would let anyone reading them act as someone else.

## How it's held

- `spec/claim.test.ts`: a second claim on a held tile is a `409` and the
  holder's name stays; moving leaves one tile, not two; a foreign `Origin`
  is a `403`; bad tiles and labels are `400`; a name renders as text; a new
  visitor gets an `HttpOnly`, `SameSite=Lax` cookie.
- `spec/realtime.test.ts`: "mine" appears only in the holder's stream, and
  no `pid` is ever sent down any stream.
- `spec/store.test.ts`: a dormant tile can be claimed and a fresh one can't;
  only the displaced person is told; a refused move keeps the loser's tile.
- `spec/access.test.ts`: ten concurrent claims by one person leave one tile;
  no `pid` appears in the HTML for another visitor or for nobody; a malformed
  cookie gets a fresh one; a cookieless POST can't take a held tile; renaming
  keeps your tile; a foreign or `null` `Origin` is a `403` and the tile stays
  free; `?notice=` only shows the fixed notices, never inherited names like
  `constructor`.
- `spec/log.test.ts`: the logs name each person by a tag that tells them
  apart, never print a `pid`, and a label can't forge a line.
