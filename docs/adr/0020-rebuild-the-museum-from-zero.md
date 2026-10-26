# 20. Rebuild the museum from zero, keeping only the idea

- **Status:** accepted, week 12 (26 Oct 2026)
- **Decides:** what of the first Impossible Museum build survives into the
  second
- **Keeps:** the idea, CLAUDE.md's Goal and Out of scope, the template's
  fixed parts, the live-URL guard, ADRs 2--11 and the crit reflections

## Context

The first museum build ran from ADR 12 to ADR 19, about 96 commits after
Skyline was dropped (ADR 11), ending at `2ec9012`. Looking at the deployed
page in week 12, the stage card read as broken: a grid of unlabeled icons
beside a 3D room that did the same things. ADR 19 moved control into the
room, but the build had grown by layering one decision on another (sets,
first person, a word budget, a hidden button row), each patching the last.

<!-- AUTHOR: say in your own words why you chose to start over rather than
keep fixing. -->

## Decision

Start the app again from an empty `src/` and `public/`, on a `rebuild`
branch, merged to `main` only once it meets the brief.

- **Carried over:** the Goal (what the museum is, the loop, what good means)
  and the Out of scope list, word for word except for dropping a
  first-build detail; the template (`Dockerfile`, `fly.toml`, CI,
  `spec/invariants.test.ts`, `scripts/check-evidence.ts`); the live-URL guard
  (`spec/not-production.ts` and its test) and the ask-before-push rule.
- **Not carried over:** every other decision, the code, the checks, and
  ADRs 12--19. They stay in the history (last at `2ec9012`) and aren't
  consulted: each decision is made again when the new build needs it.
- **A fresh database file** (`/data/gallery.db`). The first build's
  `museum.db` stays on the volume untouched, so nothing anyone made is
  destroyed, but the new schema doesn't inherit it.
- **History isn't rewritten.** The wipe is an ordinary commit, so every
  hash `PROCESS.md` and the reflections cite still resolves.

Turned down:

- **Keep fixing the first build.** <!-- AUTHOR: your reason -->
- **Reset to the commit that dropped Skyline (`b1d3558`).** That tree still
  held Skyline's code; it isn't zero.
- **A new repository.** The course provisioned this one for A3, and the
  crit history lives here.

## Consequences

- Until the merge, `main` and the live site keep the first build.
- Two weeks remain before A3 is due (9 Nov). The rebuild has to reach the
  three fixed requirements (multi-user, real-time, persists) first, and add
  only what the Goal argues for.
- `PROCESS.md` has to tell this second restart, through this ADR, as well as
  ADR 11's.
