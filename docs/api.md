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
| `GET /holdings` | `[{ symbol, name, direction }]`, sorted by symbol. `direction` is `LONG` or `SHORT`. |
| `PUT /holdings/:symbol` | `{ direction }`. Adds or flips; returns `{ symbol, direction, previous }` (`previous` is `null` for a new holding). An unknown ticker is a 404. |
| `DELETE /holdings/:symbol` | `{ ok: true }`; 404 when not held. |

### Watchlist — `watchlist/`

| Route | Notes |
|---|---|
| `GET /watchlist` | `[{ symbol, name }]`, sorted by symbol. |
| `POST /watchlist` | `{ symbol }` -> `{ added, symbol }`; `added` is `false` when already watched. Unknown ticker is a 404; the 51st symbol is a 400. |
| `DELETE /watchlist/:symbol` | `{ ok: true }`; 404 when not watched. |

### Assistant — `assistant/`

`POST /assistant { text }` (1-2000 characters). A small Gemini model routes the
message to buy, sell, watch, unwatch or none; the backend validates and runs
it, and returns one `AssistantReply` (`assistant.service.ts`). The reply is not
stored.

| `kind` | Fields | Meaning |
|---|---|---|
| `done` | `message` | Multi-line summary, one line per non-empty group, `Label: X, Y`. Groups per action: **buy** `Added (long)`, `Already held`, `Couldn't find`; **sell** `Sold and moved to watchlist`, `Sold (watchlist full, not added)`, `Not held`, `Couldn't find`; **watch** `Watching`, `Already watching`, `Watchlist full, not added`, `Couldn't find`; **unwatch** `Stopped watching`, `Not on watchlist`, `Couldn't find`. `Couldn't find` lists unknown tickers and strings that are not ticker-shaped; on buy and watch it also covers tickers the market-data lookup rejects. |
| `prompt` | `text`, `note?` | A ready-to-paste Gemini prompt. `note` is set when the router failed or is unconfigured. |
| `error` | `message` | An unexpected failure partway through; check Holdings and Watchlist before resending. |

## Things that surprise callers

- **Trader stores no numbers.** No quantities, prices paid or cash; holdings
  are symbol + direction only.
- **No prices are served.** Quotes and price history are parked in
  `backend/lib/market-data`; the API only validates tickers against Yahoo.
- **Chat misses are prompts, not errors.** An unrecognised message, a question
  or a router failure returns `kind: 'prompt'` with status 200.
