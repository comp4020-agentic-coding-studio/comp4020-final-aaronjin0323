# 34. The room editor works like a decorating game

- **Status:** accepted, week 12 (2 Nov). Replaces the panel of ADR 31, keeps
  its ownership rules and ADR 33's view.
- **Decides:** how a room is arranged

## Context

The student pointed at Poki's Cozy Room Design: the room's mechanics should
work like that, with the exhibition art style kept. Playing it showed: a room
beside an editor, icon tabs over a grid of picture tiles, tapping a tile to
place the item selected, on-canvas rotate, delete and confirm, a colour
palette that tints the selected item and recolours the tiles, grid snapping,
stacking with a pointer and floor marker, wallpaper styles, windows, rugs,
pets, a camera, and several rooms per player.

## Decision

- **Copied, as mechanics only:** all of the above but several rooms. No art,
  names or assets come from the game.
- **Items gain optional `rot` and `colour`; a layout gains optional `wallTint`
  and `floorTint`,** all from one table. Saved rooms stay valid.
- **Snapping to a 16 by 16 grid,** on the floor and along the walls.
- **Small things stack** on surfaces: put one over a table, bench or empty
  plinth and it sits on top, worked out from where things are, so nothing new
  is stored.
- **Artifacts have a tab of their own:** tap one with a stand selected to show
  it there, or with nothing selected to place it on a new plinth.
- **Save stays explicit.** The game saves as you go, but a public room should
  change when its owner says so, and ADR 31's revision check depends on it.
- **The picture button saves a PNG** on the visitor's device. Nothing uploads.

## Not copied

- **Several rooms per player:** it reaches the store, the routes and the
  directory, for little gain with the deadline a week away.
- **Video-ad locks,** and the game's bright look: the art style stays.

## Costs

- Older unsnapped positions stay until moved.
- Pets are decoration: they don't move, and a robot walks through nothing
  stacked on a table, but stands aside for a dog on the floor.
