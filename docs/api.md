# The HTTP API

The surface an agent (or any client) works against. `AGENTS.md` says how to
work in the codebase; this says what the running app exposes and how to talk
to it.

**This file is a map, not a schema.** Response shapes live in the controllers
and change with them — read the controller when you need a field. What is
recorded here is the part that is not obvious from reading one file: what
exists, what is public, what writes, and how to authenticate.

## Authentication

Every route needs a bearer token except those marked `@Public()`: the
`/auth/*` routes below, `GET /health` and `GET /health/ping`.

```
POST /auth/login  { "password": "..." }  ->  { "accessToken": "...", "user": { ... } }
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
route.

## Routes

Symbols are tickers, case-insensitive in paths and bodies. All data routes act
on the signed-in user.

### Auth, health

| Route | Notes |
|---|---|
| `GET /auth/config` | `{ google }`: whether Google sign-in is configured. |
| `POST /auth/login` | `{ password }` -> `{ accessToken, user }`. The owner's shared-password sign-in. |
| `POST /auth/signup` | `{ email, password, displayName? }` -> session. |
| `POST /auth/signin` | `{ email, password }` -> session. |
| `POST /auth/google` | `{ idToken }` -> session. |
| `GET /health` | `{ status, database, userId }`; checks the database. |
| `GET /health/ping` | Public and deliberately DB-free — the keep-warm pinger hits it every 5 minutes. Returns `{ status, version }`, where `version` is the first 7 characters of the deployed commit (`RENDER_GIT_COMMIT`), or `null` locally. |

### Holdings — `holdings/`

| Route | Notes |
|---|---|
| `GET /holdings` | `[{ symbol, name }]` in the user's saved order (position, ties by symbol). Holdings are always long; there is no direction. |
| `POST /holdings` | Bulk add: `{ symbols: string[] }` (1 to 50) -> `{ added, already, notFound }` (arrays of symbols). Symbols are trimmed, upper-cased, `$` stripped and de-duplicated; each is validated against the market-data lookup. An unknown ticker lands in `notFound` rather than failing the batch. |
| `PUT /holdings/order` | `{ symbols: string[] }` (1 to 500) -> the new list. The listed symbols take the first positions in the order given; the user's other symbols follow in their old order. 400 `Unknown symbol in order: X` for a symbol not held. New holdings are appended last. |
| `DELETE /holdings/:symbol` | `{ ok: true }`; 404 when not held. |

### Knowledge — `knowledge/`

Per-ticker knowledge graphs, private to the user. Accepts a login or an API key (`Authorization: Bearer kb_...`, made with `npm run kb:key -- <email> <name>` in `backend`, or `npm run kb:key -- --owner <name>` for the default owner, whose password account has no email). A key is accepted on these routes only; on any other route it is a 401 `API key not allowed here`. Every write carries `baseVersion` (the version it was based on, `0` to create) and a `message` (1 to 120 characters); a stale `baseVersion` is a 409 and nothing is saved. Limits: 300 nodes, 600 edges.

| Route | Notes |
|---|---|
| `GET /knowledge` | `[{ symbol, nodeCount, updatedAt, hasNew }]`, most recently updated first; deleted graphs are left out. |
| `GET /knowledge/:symbol` | `{ symbol, version, updatedAt, lastViewedAt, nodes, edges }`; 404 when there is none or it was deleted. |
| `GET /knowledge/:symbol/fundamentals` | Live table for a company, shared cache refreshed once per ET day: `{ fetchedAt, currency (the financials' reporting currency; revenue estimates are null unless USD), quarters[≤4, newest first: label, periodEnd, reportedAt, revenue, revenueEstimate, revenueSurprisePct, revenueYoY, eps, epsEstimate, epsSurprisePct, fcf], next, cash, debt, netCash }`; any field can be null (expectations come from Alpha Vantage and are null when it fails). 404 `NVDA is not a company` when not an `EQUITY`; 503 `Couldn't load the numbers right now.` when Yahoo fails with nothing cached (otherwise the last cached data is served). |
| `POST /knowledge/:symbol/viewed` | Sets `lastViewedAt` to now -> `{ ok: true }`; 404 when none. |
| `PUT /knowledge/:symbol` | `{ baseVersion, message, nodes, edges }` -> the graph as above. Creates it at `baseVersion: 0` (the ticker must pass the market-data lookup, else 404; it need not be on any list). Server-owned `createdAt`/`updatedAt` per node. 400 with `message` naming each problem, e.g. `edge revenue→gaming: unknown node "gaming"`. A `PUT` at the current version also un-deletes. |
| `GET /knowledge/:symbol/versions` | `[{ version, message, createdAt }]`, newest first; also works for a deleted graph. |
| `POST /knowledge/:symbol/revert` | `{ baseVersion, version, message }` -> the graph; saves the old version's content as a new version and un-deletes. 404 for an unknown version. |
| `DELETE /knowledge/:symbol` | Body `{ baseVersion, message }` -> `{ ok: true }`. Hides the graph, saved as a version. |

A node is `{ id, title, text, type?, asOf?, question?, sources? }`; an edge is `{ from, to, label }`. Every node must be reachable from the `summary` node.

### Watchlist — `watchlist/`

| Route | Notes |
|---|---|
| `GET /watchlist` | `[{ symbol, name }]` in the user's saved order (position, ties by symbol). |
| `POST /watchlist` | Bulk add: `{ symbols: string[] }` (1 to 50) -> `{ added, already, notFound, full }`. Same normalisation as holdings. `full` lists symbols that did not fit under the 50-ticker limit. |
| `PUT /watchlist/order` | Same as `PUT /holdings/order`, for the watchlist. |
| `DELETE /watchlist/:symbol` | `{ ok: true }`; 404 when not watched. |

### Earnings — `earnings/`

| Route | Notes |
|---|---|
| `GET /earnings/week` | `{ weekStart, weekEnd, today, days, upcoming }`. `days` is always five entries (Mon-Fri, America/New_York; the coming week on Sat/Sun), each `{ date, entries: [{ symbol, source: 'holding'\|'watchlist', timing: 'before_open'\|'during'\|'after_close'\|'unknown', estimated }] }`. `upcoming` is `[{ symbol, source, date, daysUntil, estimated }]`, soonest first, undated last. A symbol can appear twice in one week (a past report and the next one). |

### Market — `market/`

| Route | Notes |
|---|---|
| `GET /market/moves?symbols=A,B` | 1 to 60 symbols (trimmed, upper-cased, de-duplicated; otherwise 400) -> `[{ symbol, atrPercent, movePercent, live, asOf }]` in request order. `atrPercent` is Wilder's 14-day ATR over completed regular-session daily bars as a percent of the reference close; `movePercent` is the regular-session move (live price vs previous close while the market is open, otherwise the last completed session vs the one before). Both rounded to 1 decimal, either `null` when it cannot be computed (fewer than 15 bars, missing quote, provider failure). `asOf` is the ET date of the session the move belongs to. Pre-market and after-hours prices are never used. Behind the global auth guard; the data is not per-user. |

### Assistant — `assistant/`

`POST /assistant { text }` (1-2000 characters). A small Gemini model routes the
message to buy, sell, watch, unwatch or none; the backend validates and runs
it, and returns one `AssistantReply` (`assistant.service.ts`). The reply is not
stored.

| `kind` | Fields | Meaning |
|---|---|---|
| `done` | `message` | Multi-line summary, one line per non-empty group, `Label: X, Y`. Groups per action: **buy** `Added`, `Already held`, `Couldn't find`; **sell** `Sold and moved to watchlist`, `Sold (watchlist full, not added)`, `Not held`, `Couldn't find`; **watch** `Watching`, `Already watching`, `Watchlist full, not added`, `Couldn't find`; **unwatch** `Stopped watching`, `Not on watchlist`, `Couldn't find`. `Couldn't find` lists unknown tickers and strings that are not ticker-shaped; on buy and watch it also covers tickers the market-data lookup rejects. |
| `prompt` | `text`, `note?` | A ready-to-paste Gemini prompt. `note` is set when the router failed or is unconfigured. |
| `error` | `message` | An unexpected failure partway through; check Holdings and Watchlist before resending. |

## Things that surprise callers

- **Trader stores no numbers.** No quantities, prices paid or cash; holdings
  are symbols only, always long.
- **No prices are served.** Quotes and price history are parked in
  `backend/lib/market-data`; the API only validates tickers against Yahoo.
- **Chat misses are prompts, not errors.** An unrecognised message, a question
  or a router failure returns `kind: 'prompt'` with status 200.
