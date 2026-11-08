# 41. Music, not noise

- **Status:** accepted, week 12 (9 Nov). Builds on ADR 38 (one gallery).
- **Decides:** what the site sounds like

## Context

The site was silent. The student asked for proper sound and music, and
not noise: nothing harsh, nothing that just clicks or buzzes. Uploaded
assets are out of scope, so whatever plays is made in the page.

## Decision

- **Everything is played on Web Audio from one small instrument**
  (`public/sound.js`): soft sine and triangle voices, a low-pass filter,
  slow attacks, long releases and a gentle room reverb. No noise sources
  and no recorded samples.
- **Everything is in one key,** D major pentatonic, so any sound that lands
  over the music or over another sound still harmonises.
- **The music is generative and quiet:** in the arena, a slow pad with a
  few notes drifting over it; in a room, sparser, like a gallery at night.
  It sits well under the sounds.
- **Sounds answer what you do and what happens to you,** never anyone
  else's chatter: your launch (a soft pluck, higher the harder you pull),
  a pickup (a rising bell), a contact that scatters your cargo (a falling
  phrase, low and soft), a delivery (a warm arpeggio, yours fuller; anyone's
  a faint chime), going through a door (a rising chime). In a room: sitting,
  a close look, and someone arriving.
- **Nothing plays before you touch the page,** as browsers require, and
  **one sound button is always in reach,** on the arena and in every room.
  Off stays off, remembered in this browser.
- With `prefers-reduced-motion`, nothing changes: sound is not motion.

## Consequences

- The budget of controls rises by one on the arena (2 to 3), in a room
  (4 to 5) and while decorating (6 to 7): turning sound off must never be
  more than one tap away.
  The button is an icon, so the word budget is unchanged.
- `browser-check`'s `sound` section checks that nothing plays before a
  gesture, the sounds follow the events, and off means silence, remembered.
