# Backlog

Current work, not a second implementation history. Newest intake is first in
each section; use `git log` and historical specs/plans for completed detail.

**Read this before picking up work.** `AGENTS.md` says how to work in Trader;
this file says what remains.

## Safety and operations

- [ ] **Gate production on tests.** Pushing `main` deploys Render and
  Cloudflare with no test run. Proposed, free: a GitHub Actions workflow
  running `npm test` (and backend e2e against a service Postgres) on every
  push, plus Render's "auto-deploy after CI checks pass". Needs the owner's
  decision because it changes how production deploys.
- [ ] **Decide who may sign up.** `POST /auth/signup` is open to anyone who
  finds the API. Whether strangers may create accounts — versus an invite code
  or allowlist — is the owner's call.
- [ ] **Decide whether to drop the old tables.** The journal, transaction,
  stop, ranking and brief tables, and the unused watchlist and user columns,
  stay in the database after the rebuild. Dropping them is a separate
  migration and the owner's decision.

## Features requested, not yet designed

Each item needs its own brainstorm before a plan unless the item states
otherwise.

- [ ] **Next chat question types (price, earnings date, list scan)** — add one
  at a time as the owner asks.

## Research and working sessions (no code)

These require a sit-down with the owner; they produce decisions or documents,
not independently implemented features.

- [ ] **A prompt-design session.** Decide what the Gemini prompt should carry
  beyond the message, date, holdings and watchlist, and how it is formatted.
  Walk `backend/src/assistant/prompt.ts` together with a real assembled prompt.
  `docs/trader-profile.md` is a leftover from the old in-product AI and is
  not read by the code; decide whether any of it belongs in the prompt.
