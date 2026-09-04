# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Items are removed only when the work is committed, not when it is started.

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [x] **Trailing stop on BITX read 17.17 against the broker's 17.32.** Root
  cause: `daily_closes` had stopped refreshing entirely, so the high-water mark
  was two days stale. `HistoryService.ensureFresh` now tops up on the portfolio
  read path. Fixed in `5f56434`.
- [ ] **"+8% today but still behind the Nasdaq."** Probably the same stale
  bars — the benchmark was comparing a live portfolio against a two-day-old
  S&P — but that is a hypothesis, not a confirmed fix. **Re-check now the
  history refreshes itself**, and if it still reads wrong, reproduce against
  `performance/series.ts` with a fixture.
- [ ] **Trade chart shows prices that are visibly wrong.** Called out as a basic
  feature that must be right. Needs its own investigation; do not patch symptoms.
  Worth re-checking after the freshness fix, for the same reason.

## Bugs — behaviour on the phone

- [x] **Scroll position lost on return** — `RestoreScroll`, per path, flushed on
  backgrounding. `19525ed`.
- [x] **Zoomed in on return** — iOS auto-zoom on sub-16px inputs. `19525ed`.
- [x] **New journal entry opened pre-populated** — the draft had no expiry.
  `19525ed`. **Read as "do not resurrect a stale draft" rather than "never
  restore one"**, since removing draft persistence would reintroduce the data
  loss it exists to prevent. Confirm that reading is what was meant.

## UI

- [x] **Swap the Stops and Journal tabs.** `19525ed`
- [x] **"After hours" repeated on every Stops row** — said once in the header;
  `STALE` stays per row. `19525ed`
- [x] **Average risk in dollars on the Stops page** — averaged over positions
  that actually have a stop. `19525ed`
- [x] **Refresh button on the Stops page** — shared with the Dashboard's, so
  the two cannot disagree about what "refreshed" means. **Not** hidden outside
  market hours: an extended-hours price is exactly when a refresh is most
  worth having, and the session badge already says which session it is. Say
  if you wanted it hidden anyway.
- [x] **Stops header redesign** — header row, headline number, then figures as
  tiles matching the Portfolio tab, plus "positions with a stop", red when any
  are uncovered. **Unverified visually** — it needs a login to view.
- [x] **Dates on the benchmark chart under the finger**, with the range's own
  span shown when nothing is held.
- [ ] **19 frontend lint warnings**, mostly `react(refs)` in `Journal.tsx`
  from reading a ref during render, plus a few `set-state-in-effect`. Nearly
  all pre-existing. The backend is at zero; the frontend has never been swept.
- [x] **Filter trades by ticker, including several at once** — a comma means
  "any of these": `NVDA, META`. Comma rather than whitespace, so an ordinary
  text search still works. Only the Trades tab; the journal's server-side
  search still takes one term.
- [ ] **The trade-idea result buries its numbers** under ~400 words of prose.
  A compact verdict strip above the writing, prose collapsible below.
- [x] **Trailing stop traceable on the Stops row** — now shows `trails 9.8%
  from $19.58` beneath the stop, so a derived number is checkable rather than
  asking for trust.
- [ ] **Look hard at the UI as a whole.** More conventional components? Study
  comparable products and decide what the right shape actually is.

## The trade-idea prompt (design agreed, not built)

Approved in conversation, no code yet. The failure that motivated it: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

- [x] **Full book in the prompt** — `1e9168b`
- [x] **Trading record**, tags included. Fills now carry their `entryId`, so
  a trade's tags are the union of the labels on every entry that composed it —
  a setup named at entry, a mistake often only named at the exit, both
  belonging to the same trade. Mistakes are prefixed `!` in the prompt so the
  model cannot read "chased" as a setup used on purpose.
- [x] **Recent price action** — `8103b46`
- [x] **Treat an existing holding as an add/trim decision** — `1e9168b`
- [ ] **Check the enlarged prompt actually improved the answer.** It is
  materially longer now; re-ask BITX and confirm it reads as an add/trim
  decision, and that the extra context sharpened rather than diluted it.
- [ ] **Ideas answers are slow.** Look at streaming, a smaller model for the
  first pass, or cutting prompt size.

## Tech debt

Raised as a block; each needs its own slice.

- [x] Remove duplicated code. The known instance — `computeRisk` and
  `draftRisk` implementing one rule twice — is gone with `draftRisk` itself
  (`59dcbf9`). Keep looking; that one was found only because it produced a
  wrong number.
- [ ] Replace hand-rolled code where a library does it properly. Check what is
  actually maintained before adopting anything.
- [ ] Remove duplicated tests — an e2e test may already cover what a unit test
  asserts.
- [x] Raise coverage to at least 80%. **Already met, and the naive measurement
  says otherwise.** Unit-only coverage reads ~59% because services covered by
  the e2e suite look untested; merged it is 91.6% of statements and 92.9% of
  lines. `npm run test:cov:all` (from `backend/`) reports the real figure.
- [x] Upgrade dependencies (minor/patch). `0e2cb55` — including a moderate
  `qs` advisory reachable in production through express. Zero vulnerabilities
  now. Majors are the separate item below.
- [ ] **Major dependency upgrades.** Wanted, but deliberately not bundled with
  the security patch in `0e2cb55` — a green suite after six majors at once
  proves nothing about any one of them. Take them in separate commits, in
  roughly this order, easiest to hairiest:

  | Upgrade | From → to | What to watch |
  |---|---|---|
  | `@types/node` | 24 → 26 | Types only. Should be noise; if it is not, that is informative. |
  | `@testing-library/jest-dom` | 6 → 7 | Matcher signatures. Test-only. |
  | `jsdom` | 27 → 30 | The DOM tests lean on it (`EntrySheet`, `Journal`, `persistentState`). Watch `localStorage` and timer behaviour. |
  | `vite-tsconfig-paths` | 5 → 6 | Path alias resolution; both vitest configs load it. Vite 8 may resolve paths natively now — the plugin already prints a deprecation notice, so this may be a deletion rather than an upgrade. |
  | `vitest` + `@vitest/coverage-v8` | 4 → 5 | Must move together. The blob-report merge behind `test:cov:all` is the fragile part, along with `--merge-reports`. |
  | `typescript` | 6 → 7 | Last and alone. New inference and stricter checks reach every file, and both packages compile with different strictness. |

  Do not run `nest build` while `npm run dev` is running while doing this —
  it wipes `dist` under the watcher and looks like an upgrade breaking the app
  when it is not.

- [x] Manual QA hunt (first pass, `8f0…`). Probed the API with hostile input
  rather than re-testing features. Two real bugs, both fixed and pinned:
  a negative trade price was accepted and stored (201), and a quantity past
  `numeric(20,8)`'s limit came back as a 500 quoting Postgres at the caller.
  Pure functions came through clean on every edge case tried (empty book,
  zero account value, no trades, zero quantity, single bar, no history).
- [ ] **Second QA pass, on the areas the first did not reach**: date-range
  validation (`?from=hello` is accepted and silently returns nothing rather
  than 400), concurrent edits to the same journal entry, and behaviour when
  Yahoo returns a partial or malformed payload rather than failing outright.
- [ ] A pass for best practices — interfaces, generics, inheritance where they
  genuinely earn their place.
- [x] Remove dead code — for now. `oxlint` reports nothing across `src` and
  `test`, down from five warnings. That only catches what a linter can see;
  unreferenced exports and unreachable branches are still worth a deliberate
  sweep.
- [x] Break up oversized methods and classes. `portfolio.service.ts` 857 → 439
  lines, split into `TradesService` (`82011d8`) and `SeedService` (`6cad60a`)
  by question rather than by size. **`getPortfolio` is still ~240 lines** and
  is the next candidate — it fetches, derives, prices, resolves trailing stops
  and assembles a response in one method.
- [ ] Loosen tight coupling.
- [x] Add database indexes where they are needed. **Measured 2026-09-04:
  none are.** The largest table is `daily_closes` at 1,176 rows / 488 kB; the
  hot lookup (`instrumentId` + `date >=`) runs in 0.107ms on the existing
  unique index, and Postgres correctly sequential-scans the rest because at
  this size that is faster than an index. Adding any today would be
  cargo-cult. **Re-measure when a table passes roughly 100k rows** — on
  current growth `daily_closes` reaches that in about a decade, so the
  trigger is more instruments or intraday bars, not time.

  The measurement did find a real problem, fixed separately: the performance
  series loaded `daily_closes` unfiltered on every request.
- [ ] Documentation and `.md` files aimed at agent integration.
- [ ] Review sync vs async boundaries.
- [ ] **The frontend is for display. Calculation and business logic belong in
  the backend.** Audited 2026-09-04:

  **All three breaches are closed** (`59dcbf9`, `4440579`, `dcf118f`):
  - `lib/stopRisk.ts` — deleted; `POST /portfolio/stop-risk` prices a plan
    being typed, debounced at 250ms. Confirmed fast on the phone.
  - `lib/feeBuckets.ts` — deleted; `GET /portfolio/fees` buckets and totals.
  - `lib/entryFilters.ts` — `filterEntries` deleted; `GET /journal` takes
    `search`, `from` and `to`.

  **One deliberate exception, not an oversight:** `filterTrades` stays in the
  frontend. Its data comes from `/portfolio/stats`, whose aggregates must be
  computed over every trade rather than the filtered subset — filtering it
  server-side would mean a second request, or a win rate that changes as you
  type. Sorting stays client-side throughout, for the same reason it does for
  positions and stop tiers: ordering rows is display.

  **Legitimately client-side, not to be moved:** `auth.ts`,
  `draftStorage.ts`, `persistentState.ts`, `uiState.ts` (browser storage);
  `candleScale.ts`, `tradeReplay.ts`, `stopSummary.ts`, `fillsSummary.ts`
  (chart rendering mechanics); `markdown.ts` (rendering); `sortPositions.ts`,
  `sortStopTiers.ts` (display ordering); `entryDraft.ts` (form shaping).

  **Live risk feedback**, the open question when this was written, was
  settled: backend, debounced. Confirmed fast enough in use.
