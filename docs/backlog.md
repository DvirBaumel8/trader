# Backlog

Current work, not a second implementation history. Newest intake is first in
each section; use `git log` and historical specs/plans for completed detail.

**Read this before picking up work.** `AGENTS.md` says how to work in Trader;
this file says what remains.

## Bugs — correctness

- [ ] **The app's numbers disagree with his broker — balance, returns and
  history, all of it.** Raised 2026-09-12. This is a joint investigation, not
  something to guess at alone.

  Start with a reconciliation for one account and date: put our figure beside
  the broker's, find where they diverge, then ask for the largest-gap ticker.
  Before changing code, check whether the gap is fees (entry defaults versus
  broker per-fill/minimum schedules), cash definitions (settled cash, margin
  interest, or unrecorded dividends), price session (4:30pm extended versus
  4:00pm official close), partial-fill averaging, pre-seed realised history, or
  unhandled corporate actions. The result decides whether this is a bug, a
  definition difference to document, or new modelling work. The read-only IBKR
  work below could make this continuous rather than manual.

- [ ] **Trade chart: shipped, awaiting the owner's eye.** Fills, stops, and
  targets are price-anchored and labelled; `plannedTarget` now reaches
  `DerivedTrade`, and `markerSideForPrice` chooses the emptier side of each
  candle. On a phone, confirm a tightly clustered stop and exit level does not
  crowd the axis and per-fill side selection reads on a tall candle.

## UI

- [ ] **Review the UI as a whole.** Study comparable products and decide which
  conventions or layout changes earn their complexity. In particular, test
  whether chart labels are legible at phone width: current-price labels already
  overlapped nearby grid labels on some charts, and fills/stops/targets add
  more. If unreadable, retain labels only for stop and target; fills keep their
  lines and supporting text.

## Features requested, not yet designed

Each item needs its own brainstorm before a plan unless the item states
otherwise.

- [ ] **A calendar heatmap of daily P&L.** Raised 2026-09-13 from a four-product
  journal scan (Tradervue, TradeZella, Chartlog, Stonk Journal); two lead with
  a month-at-a-glance win/loss calendar. It serves quick daily reading and can
  assemble the existing time-weighted daily series from `performance/series.ts`;
  decide with the owner whether it belongs on Portfolio or Trades.

- [ ] **Broker integration — Interactive Brokers, read-only, through Flex Web
  Service.** The owner uses Handy Trader, an IBKR app via Interactive Israel.
  The proposed free, read-only route is a Client Portal Flex Query for
  executions, positions, cash transactions, commissions, dividends, and margin
  interest; `SendRequest` (token, query ID, `v=3`) returns a reference code and
  `GetStatement` returns the XML report. It needs no order permission, daily
  login, 2FA prompt, or always-running desktop process; its roughly one-request-
  per-second limit is ample for a daily pull.

  Do not use Client Portal Web API (gateway/OAuth plus regular re-authentication),
  TWS API (a machine that never sleeps), or paid aggregators. The feed must
  never write transactions: it reconciles missing broker activity and prefills
  a journal entry, while the owner retains the reason. It is blocked on the
  owner confirming Client Portal → Settings → Account Settings → Flex Web
  Service can issue a token. That token reads full account history and belongs
  only in Render's environment, never the repo or chat.

## Research and working sessions (no code)

These require a sit-down with the owner; they produce decisions or documents,
not independently implemented features.

- [ ] **A working session on how the app uses AI.**

  1. Read `AGENTS.md`, `docs/product-brief.md`, `docs/working-agreement.md`,
     and `docs/trader-profile.md` together; improve them collaboratively.
     `trader-profile.md` is runtime prompt input, so weaknesses affect every
     answer. Pair this with a current online scan of agent-instruction practice
     and recommend only what earns adoption.
  2. Walk `backend/src/llm/` together: portfolio summary, trade review, trade
     idea, and watchlist ranking. Show an assembled prompt for a real case, not
     a template; use [AI Runtime Configuration](ai-configuration.md) for current
     provider/model/thinking facts.

## Resolved notes

- **2026-09-12 — e2e flake:** Closed inconclusively after it appeared only in the full sequential suite (404 after a write, stray 301, or `socket hang up`); re-open only when it recurs, then add a temporary `test/http.ts` response listener recording `pid, method, path, status` before diagnosis.
- **2026-09-13 — chart caveats:** Moved persistent marker-placement caveats into a toggle and kept transient behind-bars warnings visible; re-open only if the explanation again obstructs normal chart reading.
- **2026-09-13 — Journal dates:** Pinned device-locale day headings to `en-US` without merging instant and UTC-date formatting; re-open only if a phone shows a wrong locale or date shift.
- **2026-09-13 — Trade Idea figures:** Replaced model-typed aggregate figures with app-computed placeholders and safe `—` fallback; re-open only if a required computed fact can reach model prose without substitution.
- **2026-09-13 — AI thinking:** Measured Gemini `MINIMAL` as materially faster with no observed quality loss in the tested hard cases; re-open only if a harder real case reads shallower or a provider/model change requires review in [AI Runtime Configuration](ai-configuration.md).
- **2026-09-13 — Trade Idea context size:** Kept the facts snapshot after measurement showed input size was secondary to thinking and context prevented known mistakes; re-open only if fresh measurement shows a smaller prompt preserves the needed position awareness.
- **2026-09-14 — AI streaming:** Portfolio Summary, Trade Review, Symbol Pattern, and Trade Idea stream without leaking metadata or placeholders; re-open only when adding a prose endpoint or when structured Watchlist Ranking needs a different interaction model.
- **2026-09-14 — exit reason default:** New untouched closing entries default to `Stop executed`, while edits and deliberate deselection remain intact; re-open only if defaulting occurs outside that scope.
- **2026-09-14 — sold-out watchlist handoff:** A closing fill that leaves no position best-effort upserts the symbol into the watchlist without making the trade save depend on it; re-open only if this needs durable server-side transactional behavior.
- **2026-09-14 — Trades search:** Added two-character, comma-OR symbol filtering to the existing client-side list; re-open only if the shared search convention or threshold changes.
- **2026-09-13 — Trades totals:** Added a period picker with one shared range rule for totals and lists; re-open only if a new surface needs a different date semantic.
- **2026-09-13 — Trades symbol index:** Shipped period filtering, shared sorting, fees, accessibility fixes, and phone-verified column alignment; re-open only if a real screenshot shows a new layout or accessibility failure.
- **2026-09-13 — symbol patterns:** Shipped per-symbol, per-range historical pattern reads and reset stale mutation state on range changes; re-open only if a range switch shows a prior range's result.
- **2026-09-13 — competitor scan:** Completed a fast public-pages-and-reviews pass for Tradervue, TradeZella, Chartlog, and Stonk Journal; re-open only to go deeper on those four or research the dropped competitors.
- **2026-09-12 — portfolio-service tech debt:** Declined a speculative `getPortfolio` extraction because there was no duplication worth risk near `derive.ts`; re-open only if the method grows materially or real duplication appears.
