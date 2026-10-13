# 1. A tile goes dormant after a day away, and anyone may settle there

- **Status:** accepted, crit 9 (week 10)
- **Decides:** what happens to someone's tile when they leave

## Context

Skyline's board has 144 tiles and everyone holds one. The README says the
game is good when the people in the room matter to each other, and promises
that your mark stays. Real-time makes the tension sharp: the board now shows
who is here *right now*, yet nothing about a tile says whether its holder is.

Two audiences pull in different directions:

- **The showcase** brings a room of strangers, possibly more than 144 over
  two hours, plus every tile left behind by testing, crits and marking. If
  tiles are permanent, latecomers find a full board of people who went home.
- **Markers** use the app, close it, and come back the next day expecting
  their claim to be there.

## Options considered

1. **Permanent.** A tile is yours until you move. The simplest rule, and the
   most honest reading of "your mark stays". It fails the showcase: the board
   fills with absent people, newcomers can't join, and the heights everyone
   sees are set by people who left.
2. **Lease expires.** After N hours unvisited the tile is freed and vanishes.
   It keeps the board open, but it erases people. The skyline drops whenever
   someone goes home, and a marker returning the next day finds nothing, not
   even a sign they were there.
3. **Fade out of heights only.** The tile stays yours forever but stops
   raising its neighbours after N hours away, so the skyline reflects who is
   around. It frees no space, so the showcase problem remains.
4. **Dormant, then claimable (chosen).** After 24 hours with no visit the
   tile fades to grey. It stays where it is, still counts toward its
   neighbours' heights, and is still yours, until someone new settles on it.
   Opening the page, or keeping it open, wakes it.

## Decision

Option 4, with a 24-hour threshold. Your mark stays for as long as nobody
needs the room. Absence is shown, not hidden: a faded tile tells the room
someone was here and isn't now. The skyline doesn't collapse when people go
home, because dormant tiles still stand. And when space runs out, the faded
tiles are where newcomers settle first.

Someone whose dormant tile is taken is told once, on their next visit:
"Your tile went quiet after a day away, and someone else settled there." A
rule that takes something from you has to be readable off the screen
(README commitment 4).

## Consequences

- **The cost:** someone who stays away for more than a day may come back to
  find their tile taken. That includes a marker who returns just over 24
  hours later, though only if someone else settled there in between. I
  accept this because the alternative, a showcase board full of absent
  people, fails the game's whole point. Three days would remove the marker
  risk and was considered; 24 hours frees the board before the showcase
  rather than after it.
- **On deploy,** the four tiles claimed at crit 8 were about six days old, so
  they went dormant the moment the migration ran. That is the rule working,
  not a bug.
- **An open page counts as a visit,** refreshed once a minute, so nobody who
  is actually playing ever goes dormant.
- **"Your mark stays" in the README now carries a condition,** and says so.

## How it's held

- `spec/store.test.ts` moves a fake clock 25 hours forward: a tile is safe at
  23:59:59, claimable after 24 hours, woken by a visit, still counted in its
  neighbours' heights, and its holder is told once and only once.
- The same file upgrades a crit-8 database and checks no claim is lost.
- `scripts/browser-check.ts` settles on a faded tile in one browser and
  watches the new holder appear in another.
