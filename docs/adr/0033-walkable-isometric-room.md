# 33. The room is a walkable isometric space

- **Status:** accepted, week 12 (2 Nov). Supersedes ADR 31's one fixed view.
- **Decides:** how a room is seen and played

## Context

The student asked for the exhibition room as a 2.5D playable, interactive
room. ADR 31 chose a frontal picture, which is lovely to look at and
impossible to be inside.

## Options

- **Real 3D (Three.js).** Free camera, but a second renderer and new
  artifact models. The museum's scene was cleared for that cost.
- **Isometric canvas, with a walking robot.** Chosen: keeps the 2D artifacts,
  depth comes from drawing order, and it stays simple on a phone.

## Decision

- **Same layout, new view.** x and y are still fractions of the floor, now
  seen as a diamond with two back walls, and a wall item's x runs along both
  walls. Saved rooms need no migration.
- **Everyone walks a local robot:** tap or click to walk, routed round
  furniture; arrows or WASD to steer. Stands, furniture and decor block it.
  It isn't stored or sent anywhere, so a room remains one person's visit.
- **Going near things answers:** a nearby artifact stirs, and a prompt offers
  a close look. Benches and chairs can be sat on.
- **Editing is unchanged in purpose:** while arranging, the robot steps
  aside. Arrow buttons now move things as they appear on screen.
- **The picture behind the room is cached,** since materials are costly.

## Costs

- Visitors can't see each other in a room. Shared presence would need
  another stream, and rooms are for looking.
- One viewing angle: things in front can hide things behind.
- Tall items near the front corner can cover the robot, by design.
