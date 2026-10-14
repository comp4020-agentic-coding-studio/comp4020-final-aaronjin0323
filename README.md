# Skyline

Skyline is a 12×12 board that a room of people share. Everyone holds exactly
one tile, and a tile rises one level for every claimed tile around it. If you
stand alone you stay flat. If you settle next to strangers, you build a skyline
together.

## What good means here

Skyline is good if it makes the people in the room matter to each other: more
interesting with twenty people on it than with one. From that, four
commitments:

1. **Where you stand depends on who else is there, and you can see it.**
   Your height comes only from your neighbours, and every claim reaches every
   open screen within a second. When you settle, the tiles you lift show +1
   and you're told whose they were; when someone settles beside you, you're
   told who. Every neighbour also adds a fifth to your building's income,
   so standing beside strangers pays. The room's goal is landmarks: a
   building ringed by eight others. It takes nine of you, and you can help
   whoever's beside you.
2. **Land is borrowed; what you build with it is yours.** A plot is a
   24-hour lease you can renew with coins, up to two days, then it returns
   to the room. Your coins survive the tab closing, a restart, a redeploy
   and losing your land, so you can always build again.
   [Why leases, and what they cost](docs/adr/0005-a-city-economy.md).
3. **Anyone can join in seconds.** No account and no install: type a name,
   pick a tile. Drag the board to turn it, or play from the keyboard (WASD or
   arrows to move, Enter to claim). On a phone, tap a tile, then confirm.
   It works without JavaScript too.
4. **The board is fair and legible.** One tile each, first claim wins, and
   nobody can take a tile from someone who's still around. Every rule can be
   read off the screen.

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
- **Robin Sloan, "An app can be a home-cooked meal" (2020)** argues small,
  personal software is worth making for its own sake.

## What's tested and what's judged

Checked by `spec/` on every run, against the running app: a claim reaches two
other open sessions within one second; it persists; the first claim wins;
one person holds one plot; a lease ends on time and its land comes back
free, even if the server was off (on a simulated clock); income is paid at
the rate each building really had, minute by minute, as neighbours come and
go, never more than once and never past 4 hours; coins never go negative;
upgrades, moves, renewals and help follow their costs, limits and cooldowns;
upgrading the database loses no claim; heights are level plus neighbours;
names render as text; no one's identity cookie, coins or income is ever sent
to anyone else.

Judged by people, not tests: whether rising beside strangers actually feels
rewarding, whether the economy's numbers make choices feel worth making,
whether a newcomer understands the rules without reading this page, and
whether the board looks good at a glance.

## What I left out

- **Accounts.** They'd stop a stranger joining in seconds. A cookie tells
  people apart well enough for one room.
- **Taking tiles from people who are here.** It would make the game about
  aggression rather than proximity. Land only comes back when a lease runs
  out.
- **Chat and live cursors.** The board is the conversation; chat would turn
  it into a chat room with a grid attached. Helping a neighbour carries no
  words, so it stays a gesture.
