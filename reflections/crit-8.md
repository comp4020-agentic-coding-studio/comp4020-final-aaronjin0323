# Crit 8 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was deciding *why* anyone would claim a tile before deciding
how it would look. My first idea was a shared grid, which is close to the
obvious answer. Choosing adjacency (a tile rises for every claimed neighbour)
turned "people at the same time" from a slogan into a rule. You can only rise
by standing near strangers. Once that rule existed, the 3D board stopped being
decoration: height is the score, so the skyline shows the game at a glance.
Settling it in `CLAUDE.md` before writing code meant the agent built toward
the idea instead of me fixing a generic grid afterwards.

## What did this work change about who I want to be as a software developer?

I used to treat the harness as setup to rush through. This week, answering
the agent's questions one by one was where the real design happened: what a
person is, what a lost claim looks like, what to leave out. When I asked
whether the harness was enough for a polished result and the answer was no,
the useful move was writing the gaps down as open decisions rather than
hoping the agent would guess well. I want to be a developer who makes
decisions explicit and checkable, and who knows which ones are still open,
instead of one who discovers them in the finished product.
