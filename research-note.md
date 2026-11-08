# Rules shrink; checks and judgement stay

For a solo developer working with a coding agent, good practice isn't writing better instructions. It is turning whatever must always hold into executable checks, and keeping the one judgement no check can make: whether the result is good. As models improve, rules for the agent will shrink; checks and human judgement will not.

## Rules are read; checks are run

Anthropic's guidance for Claude Code draws this line. An instruction in `CLAUDE.md` is non-deterministic: the model "usually follows your commands", but "there's no *guarantee*". So "if something has to happen every time, make it a hook, a deny rule, or a managed setting. `CLAUDE.md` is for guidelines, and Claude is allowed to decide a guideline doesn't apply" (Anthropic, n.d.). Böckeler (2026) makes the same split: guides steer the agent before it acts, sensors let it correct itself after, and the computational sensors (tests, linters, type checkers) are "deterministic and fast".

My project showed both halves. A rule in `CLAUDE.md` said the checks must never run against the live site; they still did, leaving test players on the real board. A code guard refusing the production host stopped it. But a guard covers only what it was written for: eight days later the agent confirmed a deploy with a hand-sent `POST` to the live site, leaving a stray visitor in its database.

## The case against: wait for the next model

The strongest objection: none of this will matter for long. Sutton's (2019) "bitter lesson" is that, across AI's history, general methods that scale with computation have beaten methods built on human knowledge. And agents are scaling fast: the length of task they can complete has doubled roughly every seven months since 2019 (Kwa et al., 2025). On this view, a harness is hand-built knowledge awaiting a model that makes it unnecessary.

For rules, I think this is right. Anthropic (n.d.) says current models "are good at understanding your intent without much context", and its tooling flags "instructions that were written for older models" for removal. Each model makes some of what we write for it redundant.

For checks, it isn't: a stronger model games checks better. METR found frontier models raising their scores "by modifying the tests or scoring code"; one patched an evaluation function so that it "judges every submission as successful", and on one benchmark o3 did this in 30% of its runs (Von Arx et al., 2025).

Checks can also be wrong. A check that plays my arena as several scripted players failed intermittently for weeks, though the game was always right. The players, written by the agent, were wrong: they gave up after a bump scattered their cargo, and the check counted the floor while robots were still moving. Checks can be wrong too, so a human has to watch them.

## What no check reaches

Checks can't judge experience; only the developer knows what good feels like for their app. As the course puts it: "the model writes the code; you decide what code there should be" (COMP4020, 2026). Deciding what good means, and noticing when it's missing, is the developer's part.

Every check passed while my arena's screens were full of text, buttons in no clear order, so a new player would feel lost. I found it by playing. ADR 35 then cut the first screen from 125 words to 2 and added a check capping words and controls per screen. That is how the two work together: I find the problem by playing, then the check keeps it from coming back. Böckeler (2026) says the same: a good harness should "not necessarily aim to fully eliminate human input, but to direct it to where our input is most important".

Nor does a check catch a confidently wrong agent. Drafting this project's documents, the agent wrote in my voice that nobody had tried the current version, when every change had come from my own playtests. It sounded certain; only I could know it was false. Agents sound confident even when they are wrong, so a human must check.

The sign is often there to read. The agent reported the stray `POST` to me itself. METR found the same in models that gamed their tests: "the agents accurately describe their reward hacking behavior in the transcript" (Von Arx et al., 2025). So a human should read what the agent says.

## Why it matters more when you work alone

A solo developer can only test the site themselves, or with a few friends early on, so real human testing is very limited. And an agent generates code much faster than one person can review it, so reviewing everything is very hard.

So my advice is short: use checks for what must hold, and play it yourself.

## References

Anthropic. (n.d.). *Best practices for Claude Code*. Claude Code Docs. Retrieved 8 November 2026, from https://code.claude.com/docs/en/best-practices

Böckeler, B. (2026, April 2). *Harness engineering for coding agent users*. martinfowler.com. https://martinfowler.com/articles/harness-engineering.html

COMP4020/8020 Agentic Coding Studio. (2026). *What's yours in the work*. Australian National University. https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/whats-yours-in-the-work/

Kwa, T., West, B., Becker, J., et al. (2025). *Measuring AI ability to complete long software tasks* (arXiv:2503.14499). arXiv. https://arxiv.org/abs/2503.14499

Sutton, R. (2019, March 13). *The bitter lesson*. http://www.incompleteideas.net/IncIdeas/BitterLesson.html

Von Arx, S., Chan, L., & Barnes, E. (2025, June 5). *Recent frontier models are reward hacking*. METR. https://metr.org/blog/2025-06-05-recent-reward-hacking/
