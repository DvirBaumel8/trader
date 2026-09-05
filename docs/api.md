# The HTTP API

The surface an agent (or any client) works against. `CLAUDE.md` says how to
work in the codebase; this says what the running app exposes and how to talk
to it.

**This file is a map, not a schema.** Response shapes live in the controllers
and change with them — read the controller when you need a field. What is
recorded here is the part that is not obvious from reading one file: what
exists, what is public, what writes, and how to authenticate.

## Authentication

Every route needs a bearer token except two: `POST /auth/login` and
`GET /health/ping` (both marked `@Public()`).

```
POST /auth/login  { "password": "..." }  ->  { "accessToken": "..." }
```

Then `Authorization: Bearer <token>` on everything else. The password is
checked against the bcrypt hash in `APP_PASSWORD_HASH`; `JWT_SECRET` signs
the token and is mandatory in production.

**An agent cannot verify against the owner's real data unaided, and should
not try.** The password is the owner's. Do not guess it, and do not read it
out of the environment to work around this. Two supported routes instead:

- **Exercise the API in tests** — `test/http.ts` exports `login(app)` and an
  `http(app, token)` helper that attaches the token. This runs against
  `trader_test`, which is what e2e specs use.
- **Ask the owner to drive it** — a `!` prefixed command in Claude Code runs
  in his session, so `! curl ...` puts the output in the conversation without
  the token ever passing through the agent.

Unauthenticated calls return 401, which is easy to mistake for a broken
route. `GET /health` requires a token; `GET /health/ping` does not.

## Routes

Grouped by module. `:id` is a UUID except on trades, where it is a composite
`SYMBOL:ISO_ENTERED_AT` (see `trade-window.ts`).

### Portfolio — `portfolio/`

| Route | Notes |
|---|---|
| `GET /portfolio` | Positions, cash, account value, at-risk, stop tiers. Polled every 60s by the dashboard; also the seam that keeps `daily_closes` fresh. |
| `GET /portfolio/stats` | Round-trip trades plus win rate / expectancy. Aggregates are over every trade, deliberately not the filtered subset. |
| `GET /portfolio/trades/:id` | One trade with its fills, bars, stop levels, `currentPrice` and `highWaterPrice`. |
| `GET /portfolio/fees` | Fees bucketed by `?period=DAY\|WEEK\|MONTH\|YEAR`. |
| `GET /portfolio/status` | Whether the portfolio has been seeded. |
| `POST /portfolio/stop-risk` | Prices a stop plan being typed. Stateless — writes nothing. Omit `currentPrice` for risk-at-entry, supply it for give-back-from-here. |
| `PATCH /portfolio/trades/:id/stops` | Appends a stop revision. Never edits a revision in place. |
| `POST /portfolio/seed` | One-time seed. Refuses a second run. |
| `DELETE /portfolio/reset` | **Destructive.** Wipes the book. Never run this against the `trader` database — it destroyed the owner's real portfolio once. |

### Journal — `journal/`

The **only** write path into transactions and cash flows. A position moves
because an entry was written, never through a "add transaction" endpoint.

| Route | Notes |
|---|---|
| `GET /journal` | Filters: `symbol`, `kind`, `tagId`, `search`, `from`, `to`. Dates are inclusive `YYYY-MM-DD` and validated — a malformed one is a 400, not an empty list. |
| `GET /journal/tags` | Declared before `:id` routes so "tags" is never read as an id. |
| `POST /journal` | Creates an entry, and with it any transaction / cash flow / dividend / stop levels it implies. |
| `PATCH /journal/:id` | Full replace. No optimistic locking — two concurrent edits both return 200 and the last commit wins (see `docs/backlog.md`). |
| `DELETE /journal/:id` | Removes the entry and everything it owned. |

### Market data & history

| Route | Notes |
|---|---|
| `GET /instruments/lookup?symbol=` | Validates a ticker against the provider and stores it. |
| `GET /market-data/ticker-facts/:symbol` | Facts for the trade-idea prompt. |
| `POST /history/backfill` | Manual `daily_closes` backfill for held instruments plus SPY/QQQ. Read paths top themselves up via `HistoryService.ensureFresh`; this is the full-runway version. |

### Performance, AI, settings, health

| Route | Notes |
|---|---|
| `GET /performance?range=1W\|1M\|6M\|YTD\|1Y\|ALL` | Time-weighted return vs SPY and QQQ. Deposits never register as gains. |
| `POST /ai/trade-idea` | A pre-trade opinion. Persists the idea. |
| `GET`/`DELETE /ai/trade-ideas`, `/ai/trade-ideas/:id` | History of those opinions. |
| `POST /ai/portfolio-summary` | Returns `configured: false` and persists nothing when no provider key is set. |
| `GET`/`DELETE /ai/summaries`, `/ai/summaries/:id` | History of those summaries. |
| `GET`/`PATCH /settings` | Currently just `defaultFee`. |
| `GET /health` | Status plus a database check. Needs a token. |
| `GET /health/ping` | Public and deliberately DB-free — the keep-warm pinger hits it every 5 minutes. |

## Things that surprise callers

- **Buys and sells are not cash flows.** Only deposits and withdrawals are.
  A deposit must never read as a gain.
- **Cash may be negative.** That is margin, not an error state.
- **Prices carry a session.** A quote is labelled `PRE`/`REGULAR`/`POST`/
  `CLOSED` and flagged `stale` on provider failure. Never present a stale or
  extended-hours price as a regular close.
- **Positions are derived.** Nothing stores them; they are computed from the
  transaction log on every read, so they cannot drift from the journal.
