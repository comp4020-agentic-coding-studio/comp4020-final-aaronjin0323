# 22. Stack: Node's own HTTP and SQLite, server-sent events, Three.js

- **Status:** accepted, week 12
- **Decides:** what the rebuilt museum runs on

## Context

Fixed by the template: one 256 MB shared-cpu machine, one `/data` volume,
HTTP on `0.0.0.0:$PORT`. The brief needs several visitors, changes seen in
about a second, and state that survives restarts.

## Decision

- **Server: `node:http`, TypeScript run directly by Node 24.** No framework
  and no build step: a dozen routes don't need one, and nothing to build
  means the image is what's in the repo.
- **Storage: `node:sqlite`, one file on `/data`.** Transactions for the
  moves that touch two rows (replace a plinth, archive a loop), a trigger
  to make versions immutable, and numbered migrations.
- **Live: server-sent events.** The writes are a few discrete POSTs and the
  reads are a stream; SSE does that over plain HTTP with reconnects built
  into the browser.
- **Page: Three.js from a pinned CDN URL, plain ES modules.** The toy's
  rules are one module the server imports too.

Turned down:

- **WebSockets.** Two-way, but the writes don't need it, and it means a
  library or a hand-rolled protocol.
- **A framework (Express, Next).** More to load into 256 MB and more to
  learn than the routes need.
- **Postgres.** A second app outside the course's setup.
- **A physics library.** Out of scope, and none promises the same result
  on every screen.

## Consequences

- No ORM: the SQL is in `src/db.ts`, tested over `:memory:`.
- The pinned CDN is a runtime dependency of the page; without it (or
  without WebGL) the page still lists exhibits and every gesture button
  works.
