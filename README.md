# Skyline

Skyline is a 12×12 board that a room of people share. Everyone holds exactly
one tile, and a tile rises one level for every claimed tile around it. If you
stand alone you stay flat. If you settle next to strangers, you build a skyline
together.

## What good means here

Skyline is good if it makes the people in the room matter to each other. A
board that only remembers what you clicked is a form with a database behind
it; this one should be more interesting with twenty people on it than with
one. From that, four commitments:

1. **Where you stand depends on who else is there.** Your height comes only
   from your neighbours, so the only way to rise is to be near other people.
2. **Your mark stays.** A claim survives closing the tab, a server restart and
   a redeploy. Come back tomorrow and your tile is still yours.
3. **Anyone can join in seconds.** No account and no install: type a name,
   pick a tile. Drag the board to turn it, or play from the keyboard (WASD or
   arrows to move, Enter to claim). It works on a phone, and without
   JavaScript.
4. **The board is fair and legible.** One tile each, first claim wins, and
   nobody can take a tile someone else holds. Every rule can be read off the
   screen.

## Where this came from

- **r/place** (Reddit, 2017 and 2022) showed how a shared grid with a scarce
  resource turns strangers into neighbours, rivals and collaborators. Skyline
  keeps the shared grid but makes one tile per person the whole budget, so the
  game is about *where* you go rather than how much you can paint.
- **The Million Dollar Homepage** (Alex Tew, 2005) is the other half: a grid
  where a claim is permanent and the page becomes a record of who was there.
- **Clay Shirky, "Situated Software" (2004)** argues for software built for a
  specific group at a specific time rather than for everyone. Skyline is built
  for one room at the showcase, not for scale.
- **Robin Sloan, "An app can be a home-cooked meal" (2020)** frames small,
  personal software as worth making for its own sake, which is the scale this
  project aims for.

## What's tested and what's judged

Checked by `spec/` on every run, against the running app: a claim persists
and is shown to everyone; the first claim wins and a second one is refused;
one person holds one tile and claiming again moves it; bad input is refused;
names are shown as text, never markup; every tile's height equals its claimed
neighbours; pressing Enter in the name field can't claim a tile by accident.

Judged by people, not tests: whether rising beside strangers actually feels
rewarding, whether a newcomer understands the rules without reading this page,
and whether the board looks good at a glance.

## What I left out

- **Accounts.** They'd stop a stranger joining in seconds. A cookie tells
  people apart well enough for one room.
- **Stealing tiles.** It would make the game about aggression rather than
  proximity, and a refused claim is easier to read than a lost one.
- **Chat.** The board is the conversation; adding chat would turn it into a
  chat room with a grid attached.
- **Live updates, for now.** Other people's claims appear when you reload.
  Real-time updates arrive at crit 9.
