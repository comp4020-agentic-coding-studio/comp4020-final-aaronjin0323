# 27. Leaving and coming back: grace, release, restarts, and who you are

- **Status:** accepted, week 12. Supersedes ADR 25's "cargo waits while
  you're away" and its delivery on arrival.
- **Decides:** what happens to a robot and its cargo when its player
  disconnects, comes back, or doesn't; what a server restart does; what
  identity can and can't promise; the directory of displays; request
  limits and stale actions

## Context

The student asked (27 Oct) for the whole disconnect lifecycle: a brief
grace period; no attacking, collecting or rewards while disconnected;
leaving never delivers; coming back in time restores the robot; after
the grace, cargo returns to the hall and the robot leaves play; no race
between coming back and timing out may duplicate, lose or double-release
an artifact. Restarts must recover or release carried cargo, and nothing
may stay locked to someone absent. Collections and displays must survive
refreshes, new sessions, restarts and redeploys, with anything untested
in production said plainly. Offline collections stay findable through a
bounded directory; offline robots don't obstruct; requests are validated
and limited; stale actions and reconnects are handled.

ADR 25 kept cargo with an absent player indefinitely and delivered it
when they came back (their robot appeared in their zone). Both now go.

## Decision

- **Grace: `GRACE_MS` (10 s)** from a visitor's last hall stream closing.
  Their robot stays, gliding to a stop, as a **ghost**: drawn faded, it
  collides with nobody, picks up nothing, delivers nothing and can't be
  knocked. Its cargo is untouchable.
- **Back in time:** the same robot carries on, where it is, with what it
  carries. Nothing is delivered for being back.
- **Not back:** at the deadline, everything it carries returns to the
  floor, ready to pick up, at the free safe spots nearest where it was,
  and the robot leaves. The player is told when they next come back.
- **Delivery needs a moving robot** in its zone. A robot standing in its
  zone (a fresh one, or one restored after a restart) delivers nothing
  until it moves.
- **One order, one clock:** a join first steps the hall up to now, so a
  deadline that has passed fires before the join sees it; one that
  hasn't, doesn't. The store's release is a conditional UPDATE per
  artifact: releasing twice changes nothing, and an artifact is released
  only from `carried` by its holder.
- **Restarts:** robots are memory; carried rows are not. On start, every
  holder of carried cargo gets the same grace from the start. Coming back
  in it: a robot in their zone, still carrying. Not: the cargo returns to
  the floor. A sweep every second releases cargo held by anyone with no
  robot and no grace, so nothing stays locked to someone absent.
- **Identity is a cookie, and that's all.** The same browser keeps its
  visitor, collection and display across refreshes, new tabs, restarts
  and redeploys. Clearing that browser's data, a private window, or
  another browser or device is a new visitor: the old collection stays
  on the server, shown in the directory, but nobody can claim it. The
  page says so where the collection is. There is no recovery.
- **A directory of displays:** every visitor who has arranged a display,
  present or not, newest change first, 12 a page, by a keyset cursor.
  Absent visitors appear only here, never as robots.
- **Limits on size and shape** (rate limiting stays out of scope):
  bodies over 4 KB are `413`; at most 4 hall streams per visitor (`429`);
  pages are bounded; every field is checked and unknown ones refused.
- **Stale actions:** a launch whose `seq` isn't newer than the robot's is
  `409 stale-launch` (a delayed or duplicated request), answered with the
  robot so the page can resync; a display change carries the layout it
  was based on (`was`) and is `409 stale-display` if that's no longer
  current, answered with the current one.
- **Reconnecting resyncs:** the first event of a new stream is the whole
  hall; the page drops its prediction and aim and takes the server's word.

Turned down:

- **Keeping cargo forever** (ADR 25). It locks artifacts to people who
  may never return.
- **Releasing at once on disconnect.** A dropped Wi-Fi would cost a run.
- **Persisting robot positions** to restore them after a restart. Robots
  are presence; a restart puts you in your zone, with your cargo if you
  come back in time.
- **A recovery code or account.** Out of scope (no accounts); claiming
  otherwise would be dishonest.
- **Rate limiting.** Out of scope in CLAUDE.md; a launch replaces the
  velocity, so spamming one gains nothing.

## Consequences

- Migration 4 adds when each display last changed, for the directory.
- A redeploy is a restart: the same grace applies. This is tested by
  restarting the server locally; it has **not** been tested on Fly.
