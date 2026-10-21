# 13. Show, don't tell: a word budget for the museum

- **Status:** accepted, week 11, after the first deploy of [ADR 12](0012-impossible-museum.md)
- **Decides:** how much text the museum's first screen may show, and what carries the meaning instead

## Context

Looking at the first deploy, the page was full of text, and a visitor
arriving without an introduction was overwhelmed. Measured on the rendered
page: 160 visible words on the first desktop screen (bench view), 142 on a
plinth, 75 and 63 on the phone. Most were explanations (what the bench is,
what each recipe is, what the storeroom keeps, "version 1 of 1 · one of
the museum's starters"), not things anyone acts on. Skyline's crit 10
found the same: a first screen that explains itself is harder to start than
one that shows you what to touch.

## Decision

The sculpture and the room carry the meaning; words are labels. The first
screen shows at most 40 words on desktop and 30 on the phone, held by a
browser check that counts them. Actions are icons with accessible names and
tooltips, recipes are swatches, people are coloured dots, history is a strip
of coloured version chips, and drawers are closed icons with counts.

Turned down:

- **A tutorial overlay or onboarding steps.** More text, shown at the moment
  someone wants to start.
- **Removing text without a budget.** Text grows back one helpful sentence
  at a time; a number a check holds doesn't.
- **Icons with no words anywhere.** Screen readers and keyboard users would
  lose the meaning; every icon keeps an accessible name and a tooltip.

## Consequences

- Some meaning moves into hover and focus, which a phone doesn't have; on
  the phone the sculpture preview and colour do more of the work, and the
  budget is lower.
- The README carries the explanation of the museum for anyone who wants it.
