# Current State

> Read this when you need to know what is true now before planning, resuming, deploying, or testing work.

**Last verified:** 2026-10-28 against `backend/src/assistant/router.ts`,
`backend/src/assistant/assistant.service.ts`, `backend/src/holdings/`,
`backend/src/watchlist/`, `backend/src/database/data-source.ts`,
`frontend/src/routes/`, `.github/workflows/`, `package.json`,
`backend/package.json`, `render.yaml`, and `docs/DEPLOYMENT.md`.

This is a current-state reference, not a changelog. Follow the linked source
documents for decisions, implementation detail, and history.

## Current product

Trader remembers what the owner holds (symbol + direction) and watches
(symbol), never his numbers. The only in-product AI is a free Gemini model
that routes chat messages. Three screens with a tab bar under the header,
plus Login:

- **Chat** (`/`, home). One input box; the reply to the message just sent
  appears below it. Nothing is stored except the effect on holdings and
  watchlist.
- **Holdings** (`/holdings`). Symbols with a Long/Short label; add, flip and
  remove (removal uses edit mode plus a second tap).
- **Watchlist** (`/watchlist`). Symbols only; add and remove (limit 50).

Chat routing: a free Gemini model (`gemini-3.6-flash`) reads each message and
picks one of buy, sell, watch, unwatch or none; the backend validates and
performs it. The model never writes, and a message containing `?` never
performs an action. Several tickers can be pasted at once (up to 50). The
reply is a short summary, for example `Added (long): NVDA` or `Sold and moved
to watchlist: NVDA`. Anything else gives a Gemini prompt with a Copy button;
so does a failed model call or a missing `GEMINI_API_KEY`, with a note that
it could not be read automatically. The moving-average check was removed from
chat (its code, with quotes and price history, is parked in
`backend/lib/market-data`). Tickers are 1-5 letters (optional `.X` class); an unknown ticker is
reported and nothing is saved. The prompt holds the message, today's date,
holdings and watchlist symbols (`backend/src/assistant/prompt.ts`).

The old journal, transaction, stop, ranking and brief tables and the unused
watchlist columns stay in the database, unread.

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
  app-password path; email/password accounts are supported and signup is
  open; Google sign-in is optional and remains absent until its client ID is
  configured. A token whose user no longer exists is rejected, and production
  refuses app-password sign-in when `APP_PASSWORD_HASH` is unset.
- Nothing gates production on tests: a push to `main` deploys the API and the
  frontend without a CI test run, so run the suites before pushing.
- Treat the local `trader` database as real data: never run destructive test or
  reset work against it. Use `trader_test` for backend verification and the
  disposable `trader_e2e` database for browser runs; production data is kept in
  Neon. See [deployment](DEPLOYMENT.md) for environment and migration detail.
- Temporary: Render is suspended (account-level) until 1 November. Until then
  the API runs on the owner's Mac mini behind a Cloudflare quick tunnel, and
  the repository variable `VITE_API_BASE_URL` points at the tunnel. When
  Render returns, deploy and verify it before pointing the frontend back.

## Active checkpoints

- The owner tries the chat on his phone.
- Hold the prompt-design session: decide what the Gemini prompt should carry.
- Decide which question type to add next (price, earnings date, list scan).
- Decide whether to drop the old tables.

## Update this document when

- A user-visible capability ships, changes materially, or is removed.
- Local run commands, deployment topology, authentication, or database
  separation changes.
- An active checkpoint is completed, reframed, or gains the owner's concrete
  input.

Keep this concise and present-tense. Put history in `git log` or the relevant
source document, rather than extending this reference into a changelog.
