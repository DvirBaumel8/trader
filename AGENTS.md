# Trader

Trader is a mobile-first chat for an active trader. It remembers what he
holds (long or short) and watches, and
turns everything else into a prompt for his own Gemini conversation. It is
designed for daily use: honest data, low entry friction, and a
product-quality iPhone experience matter more than a long feature list.

## First read

Read the following as part of this guide:

@docs/product-brief.md
@docs/working-agreement.md
@docs/knowledge-guide.md

Then read only the focused reference matched to the task in
[Find the right document](#find-the-right-document). Do not treat historical
plans as normal onboarding material.

Before editing, read the task brief, inspect `git status --short`, preserve
unrelated work, and state the narrowest testable slice and acceptance criteria.

## Product and data invariants

Trader is a chat, a holdings list and a watchlist. It grows one case at a time.

- Trader knows what you hold (symbol, always long) and watch (symbol), never
  your numbers: no quantities, prices paid, cash, balances, P&L or
  performance. The broker owns those.
- `backend/src/llm/llm.client.ts` is the only AI SDK import boundary; the app
  uses AI only to route chat messages (`assistant/router.ts`), never for
  analysis. Anything Trader can't route becomes a prompt for the owner's
  Gemini conversation (`backend/src/assistant/prompt.ts`).
- The chat routes each message with a small Gemini model to one of buy, sell,
  watch, unwatch or none. The model never writes: its output is validated, a
  message containing `?` never performs an action, and a miss or failure
  becomes a prompt, never a guessed write.
- The frontend displays; the backend computes. Do not put business meaning or
  authoritative vocabulary in `frontend/`. The frontend may parse input, order
  display rows, and persist drafts.
- Every service resolves the request identity through
  `usersService.currentUser()`, not `ensureDefaultUser()`. The latter risks
  serving the owner's data to another user.
- Instruments and market data are shared across users; holdings and watchlist
  rows are not. A query on a per-user table must filter by `userId` even when
  it is keyed on an instrument, including inside write-path validation.
- Quotes, price history, moving averages and the Twelve Data client are parked
  in `backend/lib/market-data` (not built, not tested, not imported by `src/`).
  If revived, price selection must follow the market session and label
  pre-market or after-hours prices rather than presenting them as a close.
- `backend/src/market-data/yahoo.client.ts` is the only Yahoo Finance import
  boundary; it offers ticker lookup and next earnings date only.
- Knowledge graphs are private to the owner: edit them only through `kb`, and
  never commit their content to the repo.
- Schema changes require a TypeORM migration registered in
  `backend/src/database/data-source.ts`. Do not rely on synchronizing a real
  database schema. The old journal, transaction and stop tables remain in the
  database, unused.

Prefer small vertical slices. Resist features that do not earn their complexity
for the owner, and use no paid service while this remains a one-user product.

Use the superpowers process skills (brainstorming, writing-plans) for
multi-slice features. Bug fixes and single-slice changes go straight to
implementation with the verification rules below.

## Safe local workflow

The local `trader` database contains real data. Never reset, seed,
truncate, or run destructive verification against it. Use `trader_test` for
backend tests and the disposable `trader_e2e` database for browser tests.
Manual checks against real data are read-only unless the owner explicitly
authorizes the exact write.

Tests must not call Yahoo or another external service. Stub provider
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
the legacy-path allowlist in `backend/src/legacy-api-prefix.ts`, or unprefixed requests can
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
pure logic (`assistant/router.ts`) pure and
table-tested.

Any UI change must be opened and inspected in a real browser before handoff.
Check the actual flow at iPhone 16 Pro width (402px, Playwright's
`devices['iPhone 16 Pro']`, which the `mobile` project already uses); the
owner also verifies on that phone.
When no data-backed screen exists, make a temporary Vite probe, inspect it,
then remove the probe in the same change.

Reuse the existing UI patterns before inventing another:

- `components/ui/EditModeToggle.tsx` for revealing destructive controls; every
  destructive action needs edit mode and a second confirmation tap.
- `components/ui/Button.tsx` and `components/ui/inputClasses.ts` for controls.

## Architecture map

```text
backend/src/
  assistant/     chat: model routing (router.ts), intent execution, Gemini prompt
  llm/           the only AI SDK client (Gemini), used for chat routing
  holdings/      symbols per user (always long)
  watchlist/     symbols per user
  market-data/   Yahoo client: ticker lookup and next earnings (rest parked in backend/lib/market-data)
  instruments/   ticker validation and persistence
  users/, auth/  request identity and authentication
  database/      TypeORM data source and hand-registered migrations
frontend/src/
  api/           API client
  components/    shared display primitives and feature components
  lib/           display-only pure helpers
  routes/        Chat, Holdings, Watchlist, Login
```

`assistant/router.ts` is pure and table-tested; keep it free of I/O.

## Find the right document

| When the task involves… | Read… |
|---|---|
| current shipped behavior, active work, or operating reality | `docs/current-state.md` |
| starting, handing off, delegating, or selecting a development agent model | `docs/agent-guide.md` |
| the chat router (the only in-product AI) and the Gemini prompt Trader builds | `docs/ai-configuration.md` |
| product intent | `docs/product-brief.md` |
| deployment | `docs/DEPLOYMENT.md` |
| schema changes or migrations | `docs/DEPLOYMENT.md` |
| public API behavior | `docs/api.md` |
| a past design decision or implementation | the matching file under `docs/superpowers/specs/` or `docs/superpowers/plans/` |

Read `docs/working-agreement.md` when planning collaboration checkpoints.
Read `docs/backlog.md` for open work, but do not treat it as a historical log.

## Keep documentation current

Update the focused living reference whenever its stated update trigger occurs.
Keep current facts present-tense and concise; use `git log`, specs, and plans
for history. Do not bulk-edit historical files under `docs/superpowers/`.

A new living document requires a named purpose, update trigger, and routing-table
entry in this guide.
