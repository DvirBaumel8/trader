# Trader

Trader is a mobile-first portfolio and trading diary for an active trader.
It is designed for daily use: honest numbers, low entry friction, and a
product-quality iPhone experience matter more than a long feature list.

## First read

Read the following as part of this guide:

@docs/product-brief.md
@docs/working-agreement.md

Then read only the focused reference matched to the task in
[Find the right document](#find-the-right-document). Do not treat historical
plans as normal onboarding material.

Before editing, read the task brief, inspect `git status --short`, preserve
unrelated work, and state the narrowest testable slice and acceptance criteria.

## Product and data invariants

The core product decision is non-negotiable: seed the portfolio once, then the
diary maintains it. There is no separate transaction-entry workflow.

- Positions are derived from the immutable transaction log; never store or
  independently mutate them.
- Journal entries are the only write path for transactions and cash flows,
  including seeding. Correct a record by editing its journal entry.
- Buys and sells are not cash flows. Only deposits and withdrawals are; a
  deposit must never become performance. Negative cash is valid margin.
- The frontend displays; the backend computes. Do not put business meaning,
  money arithmetic, risk rules, or authoritative vocabulary in `frontend/`.
  The frontend may parse input, order display rows, draw charts, and persist
  drafts.
- Every service resolves the request identity through
  `usersService.currentUser()`, not `ensureDefaultUser()`. The latter risks
  serving the owner's data to another user.
- Price selection follows the market session. Surface `stale` quotes as stale,
  and label pre-market or after-hours prices rather than presenting them as a
  regular close.
- Stop-level revisions are append-only. Clearing a stop plan writes the
  revision tombstone through `transactions/stop-revisions.ts`; never represent
  a cleared revision as zero rows.
- `backend/src/market-data/yahoo.client.ts` is the only Yahoo Finance import
  boundary. `backend/src/llm/llm.client.ts` is the only in-product AI provider
  SDK import boundary.
- Schema changes require a TypeORM migration registered in
  `backend/src/database/data-source.ts`. Do not rely on synchronizing a real
  database schema.

Prefer small vertical slices. Resist features that do not earn their complexity
for the owner, and use no paid service while this remains a one-user product.

## Safe local workflow

The local `trader` database contains real portfolio data. Never reset, seed,
truncate, or run destructive verification against it. Use `trader_test` for
backend tests and the disposable `trader_e2e` database for browser tests.
Manual checks against real data are read-only unless the owner explicitly
authorizes the exact write.

Tests must not call Yahoo, an LLM, or another external service. Stub provider
clients; every e2e test that boots `AppModule` must override `YahooClient` with
the shared test stub.

Install workspace dependencies with:

```bash
npm run install:all
```

For normal iteration, use two terminals with hot reload:

```bash
npm run start:dev --prefix backend   # Nest watch, :3000
npm run dev --prefix frontend        # Vite, :5173
```

Open Vite on port 5173. It proxies `/api/*` to the backend and uses `host: true`,
so the phone can reach it on the Mac's LAN IP. Never hardcode an API
host in frontend code; `frontend/src/api/client.ts` owns URL construction.

Root `npm run dev` is production-shaped, not the hot-reload command: it builds
the backend and serves the API plus `frontend/dist` on port 3000. Do not run a
build, root `npm run dev`, or `nest build` while the backend watcher runs;
those commands replace `backend/dist` underneath it.

Backend routes use `/api`. When adding a new top-level controller path, update
the legacy-path allowlist in `backend/src/main.ts`, or unprefixed requests can
fall through to the SPA and look like JSON parsing failures.

Do not expose the app, deploy, or send data to an external service without the
owner's explicit decision. Do not edit files while the owner is actively
testing a hot-reloaded page.

## Verification rules

Use the smallest verification that proves the slice, then read the full result.
Never call a change complete based only on a diff or a typecheck.

```bash
npm test                              # workspace unit suites; not e2e
npm run test:e2e --prefix backend     # backend e2e, against trader_test
npm run test:browser                  # iPhone-WebKit browser suite
```

Run `npm run test:cov:all` from `backend/` only when coverage is relevant; it
merges unit and e2e coverage. For type checks that do not disturb a watcher:

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
cd backend && npx tsc -p tsconfig.build.json --noEmit
cd frontend && npx tsc -b
```

For a bug: fix it, add a behavior-focused regression test, identify why the
old test coverage missed it, and sweep for the same shape elsewhere. Keep the
pure portfolio derivation logic pure and fixture-tested.

Any UI change must be opened and inspected in a real browser before handoff.
Check the actual flow at phone width; the owner also verifies on the iPhone.
When no data-backed screen exists, make a temporary Vite probe, inspect it,
then remove the probe in the same change.

Reuse the existing UI patterns before inventing another:

- `components/ui/EditModeToggle.tsx` for revealing destructive controls; every
  destructive action needs edit mode and a second confirmation tap.
- `components/ui/CollapsibleCard.tsx` for long AI output; collapsed is one
  header line, with all answer content in the collapsible body.
- `components/ui/Button.tsx` and `components/ui/inputClasses.ts` for controls.

## Architecture map

```text
backend/src/
  journal/       only portfolio write path; entries, tags, stop levels
  transactions/  immutable transactions, cash flows, stop revisions
  portfolio/     derived positions, trades, risk, portfolio endpoints
  performance/   time-weighted return and benchmark series
  market-data/   Yahoo adapter, quotes, cached daily closes
  instruments/   ticker validation and persistence
  watchlist/     watchlist items, tags, cached ranking
  llm/           provider-neutral AI client and feature services
  users/, auth/  request identity and authentication
  database/      TypeORM data source and hand-registered migrations
frontend/src/
  api/           API client and server-provided settings
  components/    shared display primitives and feature components
  lib/           display-only pure helpers and draft persistence
  routes/        screens and navigation
```

`portfolio/derive.ts`, `portfolio/derive-trades.ts`, `portfolio/risk.ts`, and
`performance/series.ts` are high-risk pure business logic. Keep their
calculation semantics on the backend and test them with fixtures.

## Find the right document

| When the task involves… | Read… |
|---|---|
| current shipped behavior, active work, or operating reality | `docs/current-state.md` |
| starting, handing off, delegating, or selecting a development agent model | `docs/agent-guide.md` |
| Trader's in-product AI model/provider/configuration | `docs/ai-configuration.md` |
| product intent | `docs/product-brief.md` |
| deployment | `docs/DEPLOYMENT.md` |
| schema changes or migrations | `docs/DEPLOYMENT.md` |
| public API behavior | `docs/api.md` |
| a past design decision or implementation | the matching file under `docs/superpowers/specs/` or `docs/superpowers/plans/` |

Read `docs/trader-profile.md` when changing in-product AI judgment or prompts.
Read `docs/working-agreement.md` when planning collaboration checkpoints.
Read `docs/backlog.md` for open work, but do not treat it as a historical log.

## Keep documentation current

Update the focused living reference whenever its stated update trigger occurs.
Keep current facts present-tense and concise; use `git log`, specs, and plans
for history. Do not bulk-edit historical files under `docs/superpowers/`.

A new living document requires a named purpose, update trigger, and routing-table
entry in this guide.
