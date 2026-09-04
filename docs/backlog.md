# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Items are removed only when the work is committed, not when it is started.

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [ ] **Trailing stop on BITX reads 17.17, the broker says 17.32.** A stop the
  owner acts on must match his broker or the app is worse than useless. Suspect
  the high-water mark: `computeFavorablePrice` takes the max of daily bar highs
  since entry plus the current price, so an extended-hours high that Yahoo puts
  in the daily bar (or omits from it) moves the trail. Reproduce against the
  real position before changing anything.
- [ ] **"+8% today but still behind the Nasdaq."** Either the benchmark series
  or the time-weighted return is wrong, or the comparison window is not the one
  the owner thinks he is reading. `performance/series.ts` is pure — reproduce
  with a fixture first.
- [ ] **Trade chart shows prices that are visibly wrong.** Called out as a basic
  feature that must be right. Needs its own investigation; do not patch symptoms.

## Bugs — behaviour on the phone

- [ ] **Scroll position is lost when returning to the app.** Wanted everywhere,
  not just one screen. `usePersistentState` now exists and is the obvious tool.
- [ ] **The app is zoomed in on return.** Almost certainly iOS auto-zoom on
  focusing an input under 16px — the app's inputs are `text-sm` (14px). Check
  the viewport meta and the input font sizes together.
- [ ] **A new activity/journal entry opens pre-populated.** It must always start
  empty. The `EntrySheet` draft has no expiry, so an abandoned draft is
  restored forever; `usePersistentState` already applies a one-hour window.

## UI

- [ ] **Swap the Stops and Journal tabs.**
- [ ] **"After hours" is repeated on every row of the Stops page.** Say it once.
- [ ] **Show average risk in dollars on the Stops page.**
- [ ] **Refresh button for current prices on the Stops page** — and consider
  hiding it outside regular, pre- and after-hours sessions.
- [ ] **Put dates on the benchmark comparison chart.**
- [ ] **Filter trades by ticker** (possibly multiple tickers at once).
- [ ] **The trade-idea result buries its numbers** under ~400 words of prose.
  A compact verdict strip above the writing, prose collapsible below.
- [ ] **Make a trailing stop traceable on the Stops row** — `Stop $24.48 ·
  11.48% from $27.66`. The figures are right but the row invites a subtraction
  of two separately-rounded numbers and appears wrong. Trust problem, not maths.
- [ ] **Look hard at the UI as a whole.** More conventional components? Study
  comparable products and decide what the right shape actually is.

## The trade-idea prompt (design agreed, not built)

Approved in conversation, no code yet. The failure that motivated it: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

- [ ] **Full book in the prompt** — every position (symbol, shares, avg entry,
  current, unrealised, % of account), cash/margin, and total dollars at risk.
- [ ] **Trading record** — win rate, avg win/loss, expectancy in R, avg risk;
  every past round-trip in the ticker being asked about; the last ~15 closed
  trades with their setup/mistake tags.
- [ ] **Recent price action** — today's change against the previous close,
  today's open/high/low, the 5-day change and range, then the last 10 daily
  bars as a compact table. `TickerFactsService` already holds these bars, so
  this costs no extra Yahoo call.
- [ ] **Tell the model to treat an existing holding as an add/trim decision.**
  This is the actual fix for the BITX answer.
- [ ] **Ideas answers are slow.** Look at streaming, a smaller model for the
  first pass, or cutting prompt size.

## Tech debt

Raised as a block; each needs its own slice.

- [ ] Remove duplicated code. Known instance: `computeRisk` (backend) and
  `draftRisk` (frontend) implement the same rule twice and have already drifted
  apart once.
- [ ] Replace hand-rolled code where a library does it properly. Check what is
  actually maintained before adopting anything.
- [ ] Remove duplicated tests — an e2e test may already cover what a unit test
  asserts.
- [ ] Raise coverage to at least 80%, prioritising by risk rather than by file.
- [ ] Upgrade dependencies.
- [ ] Manual QA by the agent, hunting for bugs rather than confirming features.
- [ ] A pass for best practices — interfaces, generics, inheritance where they
  genuinely earn their place.
- [ ] Remove dead code.
- [ ] Break up oversized methods and classes. `portfolio.service.ts` is ~9k
  tokens and the obvious first candidate.
- [ ] Loosen tight coupling.
- [ ] Add database indexes where they are needed.
- [ ] Documentation and `.md` files aimed at agent integration.
- [ ] Review sync vs async boundaries.
