# 25. Collecting artifacts in the hall, kept on the server

- **Status:** accepted, week 12
- **Decides:** how artifacts appear, are carried and are kept; the
  personal display; how the store changes safely

## Context

The student asked (26 Oct) for the solo collection loop in the hall:
artifacts in safe public places, picked up by touching them, at most
three carried, shown behind the robot, delivered by entering your own
zone, and kept for good only once the server says so. Three kinds, a
luminous flying fish, a rain-filled cloud and a small door onto stars,
with identical rules. A personal display of a few fixed slots, counting
duplicates by kind. Ownership, collections and layouts on the server's
volume; states that can't overlap; pickups and deposits atomic and
idempotent; nothing trusted from the page. No rounds, countdowns,
offline penalties, expiry or combat.

## Decision

- **One row per artifact, one `state` column**: `available`, `carried`
  (with a `holder`) or `deposited` (with an `owner`). A CHECK makes the
  three mutually exclusive, and a trigger allows only `available →
  carried → deposited`, so a kept artifact can never be lost or carried
  again. IDs are random UUIDs.
- **The server sees the touch.** It already decides where robots are
  (ADR 24); a 50 ms tick walks each moving robot along its 20 ms steps
  and checks every step against the artifacts and its home zone, so a
  fast robot can't skip through one. Pages never send a pickup, a
  deposit, a player ID or a count.
- **Pickup and deposit are single conditional UPDATEs** in a
  transaction: a pickup succeeds only if the artifact is still available
  and the robot carries fewer than three; a deposit turns everything the
  visitor carries into theirs. Doing either twice changes nothing.
- **A bounded number available:** the server keeps six on the floor,
  topping up from a fixed list of safe spots (inside the walls, clear of
  every delivery zone and of each other) whenever one is picked up. No
  timers.
- **Each visitor gets a delivery zone**, one of eight pads round the
  walls, assigned once and stored. Their robot starts there. Zones can be
  shared when more than eight visitors have come; a deposit only ever
  moves your own cargo.
- **Cargo is presence, kept on the server**: what you carry stays yours
  to deliver if you close the page, with nothing lost while you're away.
- **The page shows what the server confirms**: cargo, counts and the
  display come only from the stream; nothing is predicted past the
  robot's movement.
- **The display is four fixed slots**, each empty or one kind you own,
  each kind in at most one slot, shown with its count. Saved per visitor.
- **Migrations are recoverable**: before applying any to an existing
  database file, the server copies it beside itself (`VACUUM INTO
  gallery.db.before-v<n>-<time>`), and each migration runs in a
  transaction that rolls back whole if any statement fails.

Turned down:

- **The page reports a pickup.** Simpler, but a page could collect
  anything from anywhere; it contradicts ADR 24's authority.
- **Counting collections in a separate table.** A count beside the rows
  can drift from them; counting deposited rows can't.
- **localStorage for the display.** Lost with the browser, and not the
  server's word.
- **Respawning on a timer.** A countdown in all but name; topping up on
  pickup keeps the floor full without one.

## Consequences

- Deposited rows grow with play. At a handful of visitors that's
  thousands of rows, well inside SQLite's comfort.
- Robots still pass through each other (ADR 24); two robots can race for
  one artifact, and whichever the tick reaches first gets it.
- The live volume gets the new tables on the first start of this
  version, after a backup copy.
