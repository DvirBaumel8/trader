# Daily Brief Implementation Plan

**Goal:** Add a live, backend-computed Daily Brief for portfolio and watchlist symbols, with intraday technical signals and week-aware earnings/economic notes.

**Architecture:** The backend computes notes and labels each one as `PORTFOLIO`, `WATCHLIST`, or `MARKET`. The Portfolio page renders a persistent collapsible brief, refreshes it on open/manual refresh, and polls while visible. Market data remains cached and all tests use stubs.

## Tasks

1. **Pure signal rules**
   - Test and implement ATR move, good momentum, and confirmed breakout in `backend/src/market-data/daily-brief.ts`.
   - Momentum requires price above a rising 20-day EMA, 20-day EMA above the 50-day SMA, and 20-day outperformance versus SPY.
   - Breakout requires a close above the prior 20-day high and at least 1.5× relative volume.

2. **Backend brief endpoint**
   - Add a read-only service and `GET /watchlist/daily-brief` endpoint.
   - Gather authenticated holdings and watchlist rows, deduplicate symbols, and label their origin.
   - Include current-week earnings and economic calendar notes; replace released events with actual-versus-expected values when available.
   - Return `generatedAt` and a refresh hint so the UI can poll efficiently.
   - Keep provider failures explicit and never fabricate missing values.

3. **Portfolio UI**
   - Add a persistent `Daily Brief` section above Holdings using the existing minimization pattern.
   - Group notes under Portfolio, Watchlist, and Market headings with no artificial note-count cap.
   - Poll while visible and refetch on mount/manual refresh.

4. **Verification and delivery**
   - Add backend and frontend tests for source labels, event transitions, momentum/breakout rules, empty states, and refresh behavior.
   - Inspect the rendered Portfolio screen at desktop and phone width.
   - Run full tests, production build, diff check, then commit and push to `origin/main`.
