# Crit 10 reflection

## What was the breakthrough that moved the work forward?

A rule I wrote down didn't stop the thing it was written to stop.

My spec tests claim tiles as fixture players, and a run pointed at the live
URL left Alice, Bob and Fay holding land on the real board. So I added a rule
to `CLAUDE.md`: never point the checks at production. The next day they were
back.

The rule was there and the agent could read it. Nothing made it hold. So I
turned it into code: the checks now refuse any `fly.dev` address before
sending a single request, and a test guards the guard.

That changed how I build the harness. A rule in `CLAUDE.md` is a request. A
check the agent can't get past is a barrier. When breaking a rule is
expensive, it belongs where it's enforced, not only where it's read.

## What did this work change about who I want to be as a software developer?

Working with agents, writing a good harness and good prompts has turned out
to matter more than writing good code myself. The agent writes most of the
code. What decides whether that code is right is the rules it works inside
and the checks that catch it.

But the engineering process has to stay with me. An agent loses its way in a
long context. I can make a thorough plan before a project starts, but the
plan keeps changing as the work does, and every change confuses an agent
that is still holding the old one. My `CLAUDE.md` filled up with rules the
code no longer followed until I pruned it.

So I want to be the one who holds the whole picture: deciding what changes,
writing it down before any code, and checking the result against the running
app rather than the agent's report.
