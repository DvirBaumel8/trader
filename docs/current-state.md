# Current State

> Read this when you need to know what is true now before planning, resuming, deploying, or testing work.

**Last verified:** 2026-09-16 against `package.json`, `backend/package.json`,
`render.yaml`, `docs/DEPLOYMENT.md`, `docs/backlog.md`,
`backend/src/auth/auth.module.ts`, and `backend/src/main.ts`.

This is a current-state reference, not a changelog. Follow the linked source
documents for decisions, implementation detail, and history.

## Current product

- The app is a mobile-first portfolio and trading diary: seed a portfolio once,
  then journal trade, note, and cash entries to maintain it. Positions and
  account figures are derived from that journal-backed transaction history.
- Portfolio performance includes a time-weighted return chart against SPY and
  QQQ, so deposits and withdrawals do not read as gains or losses.
- Closed trades can be replayed on an annotated daily candle chart with fills,
  stops, and planned targets. The Trades screen also offers period totals and
  symbol search; Stocks summarizes each traded symbol, including fees and
  history.
- AI features include streamed portfolio summaries, trade reviews, trade ideas,
  and per-symbol pattern reads. They use app-computed facts; model prose is not
  the source of portfolio numbers.
- The watchlist supports targets and a cached AI ranking of the whole list.
  See [the backlog](backlog.md) for feature-level context and open work.

## Operating facts

- For local iteration, run `npm run start:dev --prefix backend` and
  `npm run dev --prefix frontend` in separate terminals. The frontend proxies
  API requests to the backend. Root `npm run dev` is production-shaped: it
  builds the backend, then serves the API and `frontend/dist` from one process.
- Production is Cloudflare Pages for the frontend, Render for the API, and Neon
  for PostgreSQL. Render runs compiled migrations before starting the API.
  `main` is production; there is deliberately no staging environment, while
  pushed branches receive Cloudflare previews.
- The API uses a global JWT bearer-token guard. The owner can use the shared
  app-password path; email/password accounts are supported; Google sign-in is
  optional and remains absent until its client ID is configured.
- Treat the local `trader` database as real data: never run destructive test or
  reset work against it. Use `trader_test` for backend verification and the
  disposable `trader_e2e` database for browser runs; production data is kept in
  Neon. See [deployment](DEPLOYMENT.md) for environment and migration detail.

## Active checkpoints

- Reconcile the app's figures with the broker only after the owner provides one
  date, account screenshot, and ticker with the largest discrepancy.
- The owner needs to inspect the trade chart on a phone: confirm close axis
  labels do not crowd and that per-fill marker placement reads well.
- Review the UI as a whole and decide which remaining conventions or layout
  changes are worth pursuing after comparison with established products.
- Choose where a daily P&L calendar heatmap belongs: Portfolio or Trades.
- Confirm that this Interactive Brokers account can enable Flex Web Service and
  issue a token before planning the read-only reconciliation integration.
- Hold the collaborative AI working session: improve the project instructions
  and trader profile together, then inspect the assembled AI prompts together.

## Update this document when

- A user-visible capability ships, changes materially, or is removed.
- Local run commands, deployment topology, authentication, or database
  separation changes.
- An active checkpoint is completed, reframed, or gains the owner's concrete
  input.

Keep this concise and present-tense. Put history in `git log` or the relevant
source document, rather than extending this reference into a changelog.
