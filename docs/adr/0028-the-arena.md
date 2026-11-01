# 28. The arena replaces the museum

- **Status:** accepted, week 12 (2 Nov). Supersedes ADRs 20, 21, 23, 25
  and 27's displays, and ADR 24 and 26's zones.
- **Decides:** what the app is, what's cleared, and what's kept

## Context

The student asked for a continuously open arena for 2 to 4 strangers,
about chaotic collisions, chases and opportunistic steals: slingshot
movement only (drag back, release, launch again while moving), several
artifacts carried at once with heavier loads less mobile, responsive
bounded movement, and communication through movement alone.

They first asked to clear everything and start from zero. The hall
(ADRs 24 to 27) was a side room of the museum, but it already held the
hard parts of this brief: a shared rule for drag-back launches, a server
stepping every robot together, knocks, atomic artifact states, and a
grace for leaving, each with tests seen red. One week remained.

## Options

- **Delete everything and rewrite.** Clean, but spends the week
  re-earning a tested core, and a fresh repo would lose the history that
  process is marked from.
- **Add to the museum.** Keeps two apps, and the arena stays a side room.
- **Make the hall the whole app and clear the rest.** Chosen.

## Decision

- **Cleared:** the stage, exhibits, 3D scene, pointers, displays, the
  directory, names, and personal zones.
- **Kept:** the shared rule, the 20 ms stepping, conditional artifact
  changes, the grace, SSE snapshots and the live-URL guard.
- **A fresh database, `arena.db`.** The arena's schema is one clean set
  of migrations. The old `gallery.db` stays on the volume, unread, rather
  than being migrated or deleted.
- **One vault in the middle, not personal zones.** Everyone banks in the
  same place, so every chase ends in one crowded spot, and carrying
  home is the riskiest moment. Personal zones were safe and solid: right
  for a calm collection, wrong for steals.
- **Load changes launches, two ways.** Each artifact lowers your speed
  cap, and keeps more of your old velocity in a launch, so a loaded robot
  is slower and harder to turn. A launch still works at any moment.
- **`SPEED_MAX` holds everywhere.** Launches respect the load's cap, and
  a collision can't push a robot past `SPEED_MAX`.
- **A pull starts anywhere.** You can't press a moving robot reliably,
  and launching while moving is the point, so the pull is measured from
  where the press began, not from the robot.
- **A loose artifact is free sooner** (350 ms, shield 1.2 s, down from 1 s
  and 3 s), so a third robot can steal it.
- **Four robots at most.** A fifth visitor watches, in line, and gets the
  next free robot. A slot is held through the grace.
- **Movement is the only voice.** No names, chat, emotes or text about
  other players, and your aim is private until you let go. A robot is
  told apart by colour alone.

## Costs

- The museum's work no longer runs; it stays in the history and the
  ADRs, and `PROCESS.md` has to tell that second pivot.
- Colour alone identifies a robot, so slots also differ by a mark inside
  the robot for players who can't separate the colours.
- A camper can wait at the vault. That's accepted as part of the chaos:
  they carry nothing while they wait, and playtests can change it.
- Numbers are first guesses, not tuned by play with strangers yet.
