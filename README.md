# The Arena

A continuously open slingshot arena for two to four players. Drag back and release to launch your robot, grab artifacts, and reach the central vault before anyone hits you. What you bank is yours to show in a public exhibition room.

## What good means here

The arena is good if a stranger can play it within seconds. One attempt shows you what to do, so you learn by trying, not by reading. In a study of over 45,000 players, tutorials did not significantly improve engagement in simpler games (Andersen et al., 2012), and intuitive controls relate to the competence and autonomy associated with enjoyment (Ryan et al., 2006). I replaced guides and on-screen text with interactions that explain themselves, accepting the risk that too few words can leave people unsure: Harley (2014) advises always including a visible text label. That is why Room keeps its word, although the "?" button does not follow this advice.

It is built for intense competition over rare artifacts, between strangers or friends who jump in together. The best moments happen between players: stealing an artifact while two others fight over it, losing one a step from the vault, or finally winning the kind that got away.

I gave up careful strategy to get this. Every collision scatters what both players carry, whoever caused it, so the arena changes in an instant and players stop calculating. Taking whatever is nearby takes seconds; chasing a rare artifact takes longer, because more players want it.

Failure should sting without driving anyone away. Losing cargo hurts, because losses can weigh more than equal gains (Kahneman & Tversky, 1979), but what you have banked stays yours, so you can try again immediately. Loss aversion may be overgeneralised (Gal & Rucker, 2018), so this is a design bet for playtests to settle.

The rooms keep the rivalry going. Players show off their spoils, and seeing an artifact you want in someone else's room is a reason to return.

The arena plays the same on desktop and mobile: drag and release. A larger screen helps most in the room, where it allows more precise placement.

At least five friends tried an earlier version with the same mechanics, with no hints from me, and picked it up easily. I played every version myself, and each change, including the cut to fewer words, came from that play. This is informal observation, not a study.

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

## References

- Andersen, E., O'Rourke, E., Liu, Y.-E., Snider, R., Lowdermilk, J., Truong, D., Cooper, S., & Popović, Z. (2012). The impact of tutorials on games of varying complexity. *Proceedings of CHI 2012*, 59–68.
- Gal, D., & Rucker, D. D. (2018). The loss of loss aversion: Will it loom larger than its gain? *Journal of Consumer Psychology*, 28(3), 497–516.
- Harley, A. (2014). *Icon usability*. Nielsen Norman Group. https://www.nngroup.com/articles/icon-usability/
- Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. *Econometrica*, 47(2), 263–291.
- Ryan, R. M., Rigby, C. S., & Przybylski, A. (2006). The motivational pull of video games: A self-determination theory approach. *Motivation and Emotion*, 30(4), 347–363. https://doi.org/10.1007/s11031-006-9051-8
