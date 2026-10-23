# Impossible Museum

<!--
DRAFT by Claude, to be rewritten in your own words (the course asks you
to write README.md yourself). The factual sections are checked against
the code and spec/ as of commit 68b1be6. "What good means here" is notes
and sources only: write that argument yourself. Target: 400-600 words.
Delete this comment when it's yours.
-->

A small shared 3D gallery floating above the clouds. Everyone who opens it
stands in the same room, in first person, and sees the others there. In
the middle is a stage of impossible toys that anyone can play, and round it
six plinths hold performances people left behind.

There are four toys:

- **Orbit stage:** spheres that fall upward, a ribbon that catches them,
  and a bell.
- **Chime Tree:** six tuned chimes and a striker on a cord.
- **Swap Doors:** two door frames joined to each other, so a ball thrown
  into one comes out of the other.
- **Tipping Point:** a seesaw that catapults stones.

Whatever anyone does on the stage replays in a 30-second loop. You can
answer what someone did a minute ago, cut across it, or leave the loop on a
plinth for the next visitor to find and join.

## What good means here

<!--
YOUR ARGUMENT. Notes to work from:
- Your claim (CLAUDE.md, "Goal"): the fun is between people. That means
  reading each other's gestures, playing along, cutting in and being
  surprised, with no puzzle and no right answer. Touching an object answers
  at once. Nothing needs reading first. Work is credited and recoverable.
- Possible sources (check them before you cite them):
  - Johan Huizinga, "Homo Ludens" (1938): play as free, bounded and
    unproductive. Supports "no puzzle, no goal".
  - Roger Caillois, "Man, Play and Games" (1958): paidia (free improvised
    play) versus ludus (rule-bound). The stage is deliberately paidia.
  - Keith Johnstone, "Impro" (1979): accept and build on an offer.
    The 30 s loop makes every gesture an offer that the next person answers.
  - Bret Victor, "Inventing on Principle" (2012): immediate feedback.
    Supports "it answers with movement at once".
  - Counter-source: Jesse Schell, "The Art of Game Design" (2008), or
    Raph Koster, "A Theory of Fun" (2004). Fun comes from learning
    patterns and mastering goals, so a toy with no goal gets boring once
    explored. Your answer: four toys, plinths that keep changing, and
    other people as the source of novelty. And you haven't watched a group
    play it yet.
-->

## What's tested and what's judged

Checked by `spec/` on every run against the running app:

- **Real time:** a gesture from one visitor reaches another's stream within
  1000 ms.
- **Visitors:**
  - two cookies are two visitors;
  - the pid never leaves the server;
  - names are escaped.
- **Shared play:**
  - grabbing takes a sphere from whoever held it, and the throw that lost it
    is refused;
  - Undo removes only your own gesture;
  - the loop keeps 40 gestures, at most 12 from anyone.
- **Nothing is lost:**
  - versions never change, enforced by a database trigger;
  - restore adds a version;
  - replacing a loop or a plinth archives it, never deletes it.
- **Input:** bad input is a `400` and a cross-site POST is a `403`.
- **Every toy:**
  - the same gestures always give the same performance, and only with
    arithmetic every browser rounds alike;
  - each rule that sets one object off another has its own test.
- **Presence:** where others stand is live and never stored.

Checked by `scripts/browser-check.ts` on a local copy:

- two visitors see each other move and play;
- the four toys play bit for bit the same in Safari's engine and in Chrome;
- the page draws nothing while nothing moves;
- the first screen holds at most 40 words;
- every action works by keyboard and on a phone.

Judged by people, not tests:

- whether playing together is actually fun;
- whether a stranger understands the toys without reading anything;
- whether the sounds are pleasant;
- whether the room looks good.

## What I left out

- **Accounts.** A cookie tells a handful of visitors apart, and a stranger
  can start playing at once.
- **Goals, scores and puzzles.** They would give the stage a right answer.
- **Chat.** Gestures are the conversation.
- **Customisable avatars.** A floating head shows where someone looks,
  which is all you need to read what they're about to do.
- **A physics library.** It wouldn't play the same in every browser.
