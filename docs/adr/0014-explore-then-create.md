# 14. Explore first; the editor opens on a creative action

- **Status:** accepted, week 11
- **Decides:** what a visitor sees on arrival and whenever they look at
  something, and what opens the workbench editor

## Context

After [ADR 13](0013-show-dont-tell.md) the first screen was under its word
budget, but it still opened on the editor: 46 sliders and swatches for the
bench sculpture were the first thing in the panel, before a visitor had
looked round the room. On a phone the editor took the whole lower half.
The museum's loop starts with *explore* (CLAUDE.md, "Goal"); the first
screen started with *edit*. A panel full of controls tells a visitor the
page is a tool to operate before it tells them it's a room to look at.

## Decision

The page has two modes.

- **Explore** (where everyone starts, and where looking at anything
  returns): the panel is a compact **selection card** for whatever is
  selected (the workbench sculpture or a plinth's exhibit). The card shows
  its swatch, title, who shaped it, and one or two actions. No sliders.
- **Create**: the full editor for the workbench, with every part's sliders
  and swatches, Exhibit and Clear. It opens **only on an explicit creative
  action**, a button whose name says it changes something: "Shape it" on
  the bench card, a starter recipe, Remix or Swap in on an exhibit, or
  bringing an archived draft back. Each of these puts the visitor at the
  bench in create mode, with focus on the editor's heading.

Leaving create mode is as plain as entering it: a "Done" button at the top
of the editor, the Gallery button and `Escape` all return to explore, with
focus on the button that opened the editor. Choosing a plinth always shows
its card in explore mode.

Selecting the bench, by its plinth-row button or in the 3D room, shows the
bench card, not the editor: looking isn't editing.

Turned down:

- **Editor in a bottom sheet over the scene.** The phone layout already
  pins the scene above a scrolling panel (CLAUDE.md, "Phone and keyboard");
  a sheet would cover the sculpture the controls change.
- **Hiding the controls behind a disclosure in the same panel.** It would
  still be the first thing in the panel, and "expand" isn't a creative
  action, so it doesn't say what pressing it means.
- **Create mode on first edit (any slider touch).** There'd be no slider to
  touch until the editor is shown.

## Consequences

- Every editing control stays a real HTML control in tab order once the
  editor is open; in explore mode they're not rendered visible (`hidden`),
  so the tab order isn't padded with 46 controls nobody can see.
- Checks that drive the editor (the word budget's bench view, phone-edit,
  dragging, keyboard, real time) open it first with "Shape it", the way a
  visitor does.
- Explore's word budget is lower: the card is a handful of words.
