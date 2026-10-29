# ATR and today's-move columns on Holdings and Watchlist

**Date:** 2026-10-29
**Status:** Awaiting owner review.
**Amends:** `2026-10-29-earnings-week-and-slim-market-data-design.md` Part A. It brings back the small part of the parked market-data code that this feature needs.

## What the owner asked

> "In holdings and watch list give me a button that once I clicked on two columns are added to the table — ATR DAILY, today's movement … For each record if daily move > ATR mark this as green. Let me sort by columns somehow."

Decisions:
- **Colour:** an up move larger than ATR is green, and a down move larger than ATR is red.
- **Units:** percent of price.
- **Pre-market and after-hours:** follow the same logic as the ATR calculation.

## Behaviour

- **The toggle.** Holdings and Watchlist each get a `Show ATR` toggle button next to the edit pencil. When it is on, the list becomes a table with two extra columns:
  - **ATR**: the 14-day Average True Range as a percent of the close before the session whose move is shown (so ATR and the move share one base), e.g. `3.2%`.
  - **Today**: today's regular-session move in percent, e.g. `+4.1%` or `−2.3%`.

  The toggle state is remembered on the device, separately per screen.
- **Colour per row.** When `|Today| > ATR`, the Today cell and the ticker are green if the move is up and red if it is down. Otherwise there is no colour.
- **Sessions, matching the ATR's source data.** ATR is built from Yahoo's daily bars, which cover the regular session only (true range = max(high − low, |high − prev close|, |low − prev close|), Wilder's 14-day smoothing). So **Today** is also regular-session:
  - During market hours (09:30–16:00 ET, trading days): live price vs the previous regular close.
  - Before the open, after the close, on weekends and on holidays: the last completed session's close vs the close before it. The column header then reads `Today (close)`, so it isn't mistaken for a live number.
  - Pre-market and after-hours prices are not used. ATR uses the last completed daily bars and never includes today's partial bar.
- **No data** (crypto without daily bars, a new listing with fewer than 15 bars, Yahoo unavailable): the cell shows `—`, with no colour.
- **Sorting.** In table mode the column headers `Ticker`, `ATR` and `Today` are tappable.
  - The first tap sorts descending. Ticker sorts A–Z on its first tap instead.
  - The second tap sorts ascending.
  - The third tap returns to **My order**, the owner's drag order from the custom-order feature.

  The active sort shows ▲ or ▼ on its header, and `—` rows always sort last. Dragging to reorder is only available in My order; edit mode switches back to My order. The sort choice is remembered on the device.
- **When toggled off,** the screen looks exactly as it does today.

## Data and backend

- **Endpoint:** `GET /api/market/moves?symbols=A,B,C` (1–60 symbols) returns:

  ```json
  [
    { "symbol": "AAPL", "atrPercent": 3.2, "movePercent": 4.1, "live": true, "asOf": "2026-10-29" }
  ]
  ```

  The values are rounded to 1 decimal. `live` is false outside market hours. Either number is null when it can't be computed. The backend computes ATR, the move, the session rule and the rounding. The frontend only displays, colours and sorts.
- **Sources:** two Yahoo calls, both added back to the slim `YahooClient`:
  - **daily bars** (the chart endpoint, about 30 calendar days, regular session), cached per symbol for the ET trading day
  - **quote** (regular-market price, previous close and market state), cached for 60 seconds
- **Code revived from `backend/lib/market-data/`**, as needed and adapted: the ATR computation from `indicators.ts`, the parts of the trading-day / market-session helpers needed for the session rule, and the Yahoo `dailyBars` and `quote` methods. They return to `src/` as small focused modules, with their specs restored. Nothing else comes back. In particular, the Twelve Data extended-hours code stays parked.
- **Database:** no stored price history and no migration. The caches are in memory, which is fine for one owner on one server.
- **Load:** the toggle fetches moves only when it is on. While it is on, it refreshes every 60 seconds during market hours and not at all outside them.

## Testing

- Unit tests:
  - ATR on fixed bars, including a gap day (where true range uses the previous close)
  - fewer than 15 bars gives null
  - the session rule: live during hours; the last completed session pre-market, after-hours and on a weekend; a holiday
  - rounding
  - the colour threshold: up and down past ATR, and exactly equal, which gets no colour
- E2E: the endpoint with stubbed Yahoo bars and quote.
- Frontend specs:
  - the toggle shows and hides the columns and is remembered
  - colours
  - the header-tap sort cycle and `—` rows last
  - edit mode resets to My order
- Browser test at 402px: the table with both columns fits without horizontal overflow, and a sort works.

## Out of scope

Configurable ATR period, dollar values, extended-hours moves, intraday charts, and alerts.
