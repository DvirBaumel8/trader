# Trader — Deployment Design

**Date:** 2026-09-01
**Status:** Approved, ready for implementation planning

## Purpose

Trader currently runs only on the owner's Mac: `npm run dev`, reached from his
phone at the Mac's LAN IP. Two problems with that, raised directly by the owner:

1. The LAN IP changes on reboot, so the phone loses the app until he re-finds
   and re-enters a new address.
2. The app depends entirely on his personal computer being on and running the
   dev server. He wants it reachable independent of that.

He wants this fixed **without paying for hosting** — the product brief's "free
while it serves one user" principle stands, and this deployment does not
change that, it just relocates where "free" runs.

## Precedent: sapako

The owner has already solved "free and always-warm" for a sibling project,
`sapako` (`docs/DEPLOYMENT.md` there). This design reuses that combination
rather than re-deriving it — it is proven in production, not theoretical.

| Piece | Host | Why |
|---|---|---|
| Frontend (static build) | Cloudflare Pages | Free, static, never sleeps. |
| Backend (API) | Render, free web service | Free; sleeps after ~15 min idle otherwise. |
| Postgres | Neon, free tier | Render's free Postgres expires after a fixed window; Neon's does not. Neon forces scale-to-zero on the free tier (cannot be disabled) but wakes in well under a second — unnoticeable. |
| Keep-warm | UptimeRobot (free), pinging a DB-free endpoint | Render's own 750 free instance-hours/month exactly covers one service kept awake 24/7. A ping that touched the database would also keep re-waking Neon continuously and blow its separate CU-hour cap — this is why the ping target must not query Postgres. |

Ruled out during discussion, for the record:

- **Fly.io** — no longer has a free tier (removed 2024); pay-as-you-go now.
- **Oracle Cloud Always-Free VM** — genuinely free and always-warm, but adds
  real ongoing Linux sysadmin (patches, restarts, disk) the owner decided he
  didn't want, and requires a credit card at signup for identity verification.
- **Render free tier alone, no keep-warm** — the actual free-tier default:
  cold starts (~30-50s) after ~15 min idle. Ruled out because the owner wants
  always-warm, not because Render itself is wrong — the keep-warm ping is what
  makes it viable.

## Non-goals

- No change to the core product (portfolio/diary/benchmark). This is
  infrastructure only.
- No multi-user support. Auth is a single shared password, not accounts.
- No staging environment, deliberately (matches sapako) — `main` is
  production; local development is where work happens before it's pushed.

## Topology & data flow

```
Phone / browser
      |
      v
Cloudflare Pages  (frontend build; API_BASE_URL baked in at build time)
      |
      v  HTTPS, CORS via WEB_ORIGINS
Render free web service  (NestJS API)
      |
      v  TLS (DATABASE_SSL=true)
Neon free Postgres
```

- Frontend and backend become different origins in production (they are the
  same origin today, via Vite's dev proxy). The frontend needs a build-time
  `API_BASE_URL` env var: empty in local/dev builds (falls back to today's
  relative `/api/...` behavior, unchanged), set to the Render URL in the
  Cloudflare Pages build. This does not violate the "never hardcode a host in
  frontend code" rule in `CLAUDE.md` — it's a configured build input, not a
  literal in source, and it's the same mechanism already proven in sapako.
- The backend needs a `WEB_ORIGINS` env var (comma-separated allowed origins)
  to configure CORS, since it will now be called cross-origin.
- Deploys are push-to-`main`: Render reads `render.yaml` (a blueprint,
  analogous to sapako's) and redeploys automatically; Cloudflare Pages
  redeploys via a GitHub Actions workflow, mirroring
  `sapako/.github/workflows/deploy-web.yml`.

## Auth

The app currently has **no authentication at all** — that's fine on a home
LAN, not fine on the public internet, where a stray URL means anyone can see
real positions and P&L.

- One password, not accounts. Stored as a bcrypt hash in a Render env var
  (`APP_PASSWORD_HASH`) — never in the repo.
- `POST /auth/login` checks the submitted password against the hash and, on
  success, sets a JWT in an `httpOnly` cookie. `JWT_SECRET` is Render-generated
  (matches sapako's `generateValue: true` pattern).
- A global guard requires that cookie on every route except `/auth/login` and
  the new keep-warm ping endpoint. This includes `TickerProbe` — today it's
  kept out of the nav as its only protection, which stops being adequate once
  the app is reachable from anywhere.
- Session length: long-lived (30 days). This is one person on their own
  devices; the bar is "keep strangers out," not enterprise session hygiene.
- Frontend: a login screen; any `401` from the API redirects there. No change
  to `lib/draftStorage.ts` — drafts are local to the device regardless of
  session state.

## Data safety: migrations replace `synchronize: true`

`CLAUDE.md` already flags `synchronize: true` as a known shortcut, "fine while
the data is one local, disposable Postgres." That stops being true once the
database is a persistent, shared, always-on Neon instance holding the owner's
real trading history:

- TypeORM's `synchronize` auto-alters the live schema to match the entities on
  **every boot**. Render's free tier is documented (in sapako's own deployment
  notes) to restart under memory pressure. An unexpected schema sync during a
  restart loop, or a stray entity change deployed by mistake, could silently
  alter or drop columns holding real trade data. This is exactly the class of
  problem `working-agreement.md` calls out from the `DELETE /portfolio/reset`
  incident — this design avoids repeating it in a new shape.
- Fix: generate one initial TypeORM migration from the current schema (a
  no-op against the existing local database, since it already matches the
  entities), then change the startup command to run migrations before `main`
  boots — `node dist/database/migrate.js && node dist/main`, the same
  two-step sapako uses and for the same reason (compiling TypeScript
  in-process via `ts-node` on every boot caused a restart loop there under the
  512MB free-tier limit; running from compiled output avoids it here too).
- This changes local development too: schema changes after this point require
  `npm run migration:generate`, not just editing an entity and restarting.
  Worth stating plainly since it's a workflow change, not only a deploy
  detail.

## Moving the real data

The owner's actual portfolio lives only in his local `trader` database today.
Per his decision, production starts from that same data, not empty:

- One-time, by hand: `pg_dump` the local `trader` database, restore it into
  Neon once migrations have created the matching schema there.
- Verified by comparing row counts before and after, not assumed correct.
- Not scripted as a repeatable/automated step — it must not be possible to run
  it twice by accident.
- `trader_test` is unaffected — it stays local-only, e2e tests never touch
  Neon, per the existing testing convention.

## Keep-warm

- Trader's existing `/health` endpoint queries the database (`SELECT 1` +
  `ensureDefaultUser()`), unlike sapako's deliberately DB-free one. Pinging it
  every 5 minutes would keep re-waking Neon continuously, risking its 100
  CU-hour/month free cap.
- Add `GET /health/ping` — no database access, just a static `{ status: 'ok' }`
  — as the target for the external monitor. The existing `/health` remains as
  Render's own `healthCheckPath` (used at deploy-verification time, not every
  five minutes, so its DB check is fine to keep).
- A free UptimeRobot account, one HTTP monitor, 5-minute interval, no
  repository changes required — identical setup to sapako's.
- Not a GitHub Actions cron: per sapako's own documented reasoning, Actions
  `schedule` timing is unreliable (10-30 min delays under load) and gets
  auto-disabled after 60 days of repository inactivity — both worse than the
  15-minute sleep window this exists to prevent.

## Rollout — small verified slices

Per `working-agreement.md`, this ships as checkpointed slices, not one deploy:

1. **Migrations, locally.** Convert off `synchronize: true`, generate the
   initial migration, confirm the app boots and the full test suite passes
   locally against `trader_test`. Checkpoint before anything touches the
   cloud.
2. **Auth, locally.** Add the login endpoint and guard, verify on the phone
   against the LAN as usual — login screen, `401` without a session, normal
   use with one.
3. **Empty skeleton deployed.** Stand up Neon + Render + Cloudflare Pages,
   wired together, pointed at a **fresh, empty** Neon database — not real
   data yet. Checkpoint: the owner logs into the empty production app from his
   phone **off Wi-Fi** (cellular), proving it's reachable from outside his
   house, not merely working because he's on the same network.
4. **Migrate real data.** Only after step 3 is verified: `pg_dump`/restore
   the real local data into Neon. Checkpoint: the owner confirms his actual
   positions and journal look right in production.
5. **Cutover.** Production becomes daily-use. Local `npm run dev` remains for
   future feature development against local/`trader_test` data — never again
   against the owner's live data.

## Open items for the implementation plan

- Exact TypeORM migration tooling/scripts (mirroring sapako's
  `database/migrate.ts` shape).
- Whether `render.yaml` needs a Frankfurt-equivalent region pairing between
  Render and Neon (sapako co-locates them; same reasoning applies here).
- The precise env var list per service (this doc names the important ones —
  `APP_PASSWORD_HASH`, `JWT_SECRET`, `DATABASE_URL`, `DATABASE_SSL`,
  `WEB_ORIGINS`, `API_BASE_URL` — the plan should enumerate all of them per
  service, `sync: false` where secret).
