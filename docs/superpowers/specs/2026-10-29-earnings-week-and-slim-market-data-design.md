# Earnings week screen, and slimming market data out of the app

**Date:** 2026-10-29
**Status:** Awaiting owner review.

Two changes ship together because both touch the same Yahoo code.

## Part A: Slim the app; park unused market-data code in a library

The owner: "we currently don't need any price, SMA, any details on a stock … move things we don't need to lib and do not put it in the app."

- **The running app keeps only two Yahoo calls:** "does this ticker exist" (used when adding a holding or watched symbol) and "next earnings date" (Part B). `backend/src/market-data/yahoo.client.ts` is slimmed to those two methods and stays the only Yahoo import.
- **Moved out of the app** to `backend/lib/market-data/`, with their specs and a README saying the app doesn't load this code and it is kept for later:
  - quotes and caching (`market-data.service.ts`)
  - the Twelve Data client and the extended-hours code
  - market sessions and price selection
  - trading days
  - daily-close history (`history.service.ts`, `daily-close.entity.ts`)
  - moving averages and indicators
  - the full Yahoo client as it is today

  `backend/lib/` is excluded from the backend build and the test runs. It is not imported anywhere in `src/`. Its imports may point at paths that no longer exist; it is parked, not maintained.
- **Adding a holding or watched symbol no longer downloads price history.** This was the 22-second paste.
- **Database unchanged:** `daily_closes` and every other table stays. No migration drops anything.
- **Config:** `TWELVEDATA_API_KEY` is no longer read. It is removed from `.env.example` and the docs, and left alone in Render and the Mac env.

## Part A2: Chat model and rate-limit error

- **The router model becomes `gemini-3.5-flash-lite`**, both as the code default and as `LLM_MODEL` on the Mac host. Measured 2026-10-29 on 12 routing test messages: 12/12 correct, median 0.7 s, free tier 15 requests/minute. The previous model, `gemini-3.6-flash`, was overloaded (503) on 2 of 6 calls, took 5.5 s, and allows 5 requests/minute.
- **When Gemini returns 429 (free limit reached)** the chat replies `{ kind: 'error', message: "Gemini's free limit is reached — try again in a minute." }` and gives no prompt. Other model failures (timeout, 5xx, bad output, no key) keep the prompt fallback with its note. `LlmClient` signals the 429 case with a distinct error type, so the assistant can tell it apart.

## Part B: Earnings this week

A new fourth tab, **Earnings**, shows the current week as a calendar of earnings reports for the owner's holdings and watchlist.

### What it shows

- **The week** is Monday to Friday of the current US-market week, in America/New_York time. On Saturday and Sunday it shows the coming week. Title: `Earnings · Nov 2 – Nov 6`.
- **A filter** with three options, `Both` (default), `Holdings` and `Watchlist`. The choice is remembered on the device.
- **Layout:** a 5-column grid, Mon–Fri, with the day name and date in each column header. Today's column is highlighted. Each report is a small cell with:
  - **the ticker**
  - **timing**, as `☀` before the open (report time before 9:30 ET) or `🌙` after the close (16:00 ET or later). Any other time is during market hours, shown as `•`. With no time known, the cell shows no icon.
  - **list membership**, as a filled dot `●` for a holding or a hollow dot `○` for watchlist only. A symbol on both lists counts as a holding.
  - **an estimate mark**, as `~` before the ticker when Yahoo marks the date as estimated.
- **A legend** under the grid explains `☀ 🌙 ● ○ ~`.
- **Empty week:** "No earnings this week for your holdings or watchlist." The empty message names whichever list the filter selects.
- **Tickers without earnings** (ETFs, no date known) never appear.
- **Loading:** a skeleton grid. **Error:** "Couldn't load earnings dates right now."
- Tapping a ticker does nothing in phase 1.

### Data

- **Endpoint:** `GET /api/earnings/week` returns:

  ```json
  {
    "weekStart": "2026-11-02",
    "weekEnd": "2026-11-06",
    "today": "2026-10-29",
    "days": [
      {
        "date": "2026-11-02",
        "entries": [
          { "symbol": "AAPL", "source": "holding", "timing": "after_close", "estimated": false }
        ]
      }
    ]
  }
  ```

  - `days` always has 5 entries, Mon–Fri.
  - `source` is `holding` or `watchlist`.
  - `timing` is `before_open`, `after_close`, `during` or `unknown`.
  - Entries are sorted by timing (before open, during, after close, unknown), then by symbol.
  - The backend computes the week, the timing and the de-duplication. The frontend only filters by `source` and draws the grid.
- **Source:** Yahoo `quoteSummary` `calendarEvents.earnings` gives `earningsDate[0]` (a timestamp) and `isEarningsDateEstimate`.
- **Cache on the shared `instruments` row**, with one migration that adds two columns:
  - `nextEarningsAt timestamptz null`
  - `nextEarningsEstimated boolean not null default false`
  - the existing `earningsCheckedAt` is reused

  A symbol is re-fetched when it wasn't checked today (ET date), or when its stored report time has passed. The fetch runs for at most 5 symbols at a time.
- **On failure:** a Yahoo failure for one symbol keeps that symbol's previous cached value and still counts as checked, so Yahoo isn't called again on every load. A failure for every symbol with nothing cached returns 503, which the screen shows as the error.
- **Speed:** the first load of the day for about 25 symbols takes a few seconds; later loads read only the database.

### Known limitation

Yahoo's `quoteSummary` was blocked from Render's servers in the past (see `docs/DEPLOYMENT.md`). It works from the Mac host. If the API returns to Render, the earnings source may need to change, for example to Finnhub's free earnings calendar. That decision is deferred until then.

## Testing

- Unit tests:
  - the week computation (weekday, Saturday, Sunday, the ET date boundary, DST)
  - timing classification (8:30 ET, 16:00 ET, 12:00 ET, no time)
  - de-duplication when a symbol is on both lists
  - the cache-refresh rules
- E2E: the earnings endpoint, with a Yahoo stub providing earnings data.
- Frontend: specs for the grid, the filter, the empty state and the legend.
- Browser test at iPhone 16 Pro width:
  - all 5 columns are visible
  - a 5-letter ticker fits in its cell
  - nothing overflows horizontally
  - the filter works
- Live check signed in as the dedicated test user.

## Out of scope

Other weeks, tapping a ticker, EPS estimates or results, notifications, and earnings for symbols on neither list.
