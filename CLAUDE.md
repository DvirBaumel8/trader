# Trader

A portfolio and trading journal for one active trader. Mobile-first dark web app,
installable to the iPhone home screen, running locally.

## The core idea

**Seed the portfolio once. From then on, the diary maintains it.**

There is no separate "add transaction" screen. You write a journal entry about a
trade, and the portfolio updates as a consequence. This is the product's central
design decision — it collapses two features into one and makes the journal
self-sustaining. Preserve it.

## Stack

- **Backend**: NestJS 12 + TypeORM + PostgreSQL 18 (local Homebrew, no Docker)
- **Frontend**: React 19 + Vite 8 + Tailwind v4 + TanStack Query + React Router
- **Market data**: `yahoo-finance2` v4 (free, no API key)
- **Tests**: Vitest on both sides

## Running it

```bash
npm run dev          # both apps; backend :3000, frontend :5173
npm test             # backend unit + e2e, then frontend
npm run build        # production build of both
```

The dev server binds to `0.0.0.0` and Vite runs with `host: true`, so the phone on
the same Wi-Fi can load it. The frontend only ever calls **relative** `/api/...`
paths, which Vite proxies to the backend — so the identical build works from
`localhost` and from a LAN address. **Never hardcode a host in frontend code.**

## Invariants — do not break these

1. **Positions are derived, never stored.** `portfolio/derive.ts` computes them
   from the immutable transaction log. This is why they cannot drift out of sync
   with the journal.
2. **Transactions are only ever written through a journal entry.** Seeding obeys
   this too. One write path into the portfolio.
3. **Buys and sells are NOT cash flows.** Only deposits and withdrawals are. This
   is what will make the Phase 3 benchmark comparison honest — a deposit must
   never register as a gain.
4. **Cash may be negative.** That is margin, a legitimate state. Never block it,
   never warn about it.
5. **`yahoo.client.ts` is the only file allowed to import `yahoo-finance2`.**
   Swapping data providers should touch one file.
6. **Never show a stale price as if it were fresh.** On provider failure, serve
   the cached quote flagged `stale` and surface that in the UI.

## Testing conventions

- **`derive.ts` is the highest-risk code in the repo** — a bug there produces
  plausible-looking wrong numbers. It is pure functions with no database and no
  network, covered by fixture-driven tests. Keep it that way.
- **e2e tests run against `trader_test`**, never `trader`. When verifying by hand
  with curl, use the test database or read-only calls — do not run seed/reset
  against the database the user's real portfolio lives in.

## Layout

```
backend/src/
  market-data/   Yahoo adapter + quote cache (in memory, 60s TTL, force-refreshable)
  instruments/   ticker validation and storage
  journal/       journal entry entity
  transactions/  transaction + cash flow entities
  portfolio/     derive.ts (pure), service, controller
frontend/src/
  api/           fetch wrapper over /api
  components/    formatters and display primitives
  lib/           pure logic (sorting, draft persistence)
  routes/        Dashboard, Seed, TickerProbe (dev only, not in nav)
```

## Mobile gotchas learned the hard way

- **The iOS decimal keypad has no minus key.** Never require a typed `-`; use an
  explicit toggle. This made margin and shorts unenterable once already.
- **iOS Safari discards backgrounded tabs.** Any multi-field form must persist its
  draft to `localStorage` (`lib/draftStorage.ts`) or users lose their work
  switching to their broker app.
- **Verify UI on the phone, not just via typecheck.** Several bugs existed only
  there.

## Phase status

- **Phase 1 — portfolio, live**: complete. Seed, derived positions, live pricing,
  cash and account value, sorting, manual refresh, PWA install.
- **Phase 2 — the diary**: not started. Journal UI, notes, cash entries, tags,
  position detail. Entities already exist and are used by seeding.
- **Phase 3 — vs the market**: not started. `daily_closes` backfill, TWR series,
  the three-line benchmark chart.

Design spec: `docs/superpowers/specs/2026-08-28-trader-design.md`
Phase 1 plan and its recorded deviations:
`docs/superpowers/plans/2026-08-28-trader-phase-1-portfolio.md`

## Known shortcuts

- `synchronize: true` — no migrations yet. Fine while the data is one local user's.
- No service worker, so no offline support. The manifest gives home-screen install.
- Reset-and-re-seed is the only way to correct a position. Real editing arrives
  with the diary in Phase 2 — do not build a competing position-editing UI.
