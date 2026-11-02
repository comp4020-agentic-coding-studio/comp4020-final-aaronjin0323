# The Arena

A continuously open slingshot arena for two to four players. Drag back and release to launch your robot, grab artifacts, and reach the central vault before anyone hits you. What you bank is yours to show in a public exhibition room.

## What good means here

The arena is good if a stranger can play it within seconds. One attempt shows you what to do, so you learn by trying, not by reading. [CITE: Andersen; Ryan et al.] I replaced guides and on-screen text with interactions that explain themselves, accepting the risk that too few words can leave people unsure. [CITE: Harley]

It is built for intense competition over rare artifacts, between strangers or friends who jump in together. The best moments happen between players: stealing an artifact while two others fight over it, losing one a step from the vault, or finally winning the kind that got away.

I gave up careful strategy to get this. Every collision scatters what both players carry, whoever caused it, so the arena changes in an instant and players stop calculating. Taking whatever is nearby takes seconds; chasing a rare artifact takes longer, because more players want it.

Failure should sting without driving anyone away. Losing cargo hurts, but what you have banked stays yours, so you can try again immediately. [CITE: Kahneman & Tversky; Gal & Rucker]

The rooms keep the rivalry going. Players show off their spoils, and seeing an artifact you want in someone else's room is a reason to return.

The arena plays the same on desktop and mobile: drag and release. A larger screen helps most in the room, where it allows more precise placement.

At least five friends tried an earlier version with the same mechanics, with no hints from me, and picked it up easily. This is informal observation, and nobody has yet tried the current lower-text version.

## What's tested and what's judged

Checked by `spec/` and the scripts:

- changes reach other players within a second;
- an artifact is available, carried or banked, never two at once;
- only a room's owner can change it;
- collections and rooms survive restarts;
- each screen stays within a limit of words and controls.

Judged by people:

- whether strangers understand it unaided;
- whether the scramble is fun;
- whether an empty robot hitting a loaded one, at no risk, feels unfair;
- whether the room brings players back.

## What I left out

- **Accounts:** a cookie lets anyone start at once.
- **Chat and names:** movement is the only voice.
- **Rounds and countdowns:** the arena never closes.
- **Several rooms per player:** one is enough for now.
