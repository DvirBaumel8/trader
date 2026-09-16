# Mobile-first navigation and Daily Brief

## Goal

Make Trader work from the phone out. The portfolio and watchlist must expose
their essential row data without horizontal clipping. Daily Brief becomes an
actionable destination rather than a collapsed dashboard section, and Ideas
becomes a Watch action instead of a competing top-level destination.

## Decisions

### Navigation

- The top navigation is `Portfolio`, `Journal`, `Stops`, `Trades`, `Watch`,
  and `Brief`. `Ideas` leaves the top navigation.
- `Brief` is a dedicated `/brief` route. The Portfolio dashboard no longer
  renders Daily Brief.
- Watch gains an `Ideas` action. It opens the existing Ideas experience from a
  Watch-owned route and the Ideas screen has `Back` behaviour that returns to
  Watch, including when it was opened directly or restored by the PWA.
- Existing `/ideas` links remain safe: they redirect to the new Watch-owned
  destination rather than becoming dead bookmarks.

### Phone-first rows

Portfolio and Watch currently force fixed, desktop-width grids (34rem and
30rem) into a narrow viewport. At 390px that cuts Portfolio off after Market
value, hiding P&L and earnings. This is a defect, not an invitation to
horizontal-scroll a table.

- Below the desktop breakpoint, every holding and watched ticker is a
  full-width, tappable two-level row. Its identity and live price are visible
  first; quantity/cost, return, target, and earnings appear as compact support
  facts beneath. No financial fact is reachable only by sideways scrolling.
- At wider widths, retain an aligned tabular presentation using the same data
  and row destination. The responsive markup must not duplicate or compute
  portfolio values in the frontend.
- A source ticker reached from Brief is visibly brought into view and
  highlighted on its destination list. This is display state encoded in the
  URL; its source of truth remains the backend response.

### Idea streaming

The stream itself is open, but its final result mounts a separate Reasoning
component whose persisted default is closed. The completed text therefore
looks as though it vanished.

- The reasoning for the result that has just completed remains open.
- A saved idea and a later visit preserve the existing compact reading
  behaviour. Generating a new answer does not overwrite a prior answer until
  its final successful line arrives.

### Daily Brief

Brief is the trader's live starting point for the day, not a generic list of
technical labels.

- It displays portfolio, watchlist, and market notes in their existing source
  groups, without a collapse control because it is already its own screen.
- A manual refresh bypasses the quote cache, reloads the current portfolio and
  watchlist, and rebuilds the response from those inputs. A ticker just added
  to Watch is therefore part of the request rather than waiting for the next
  five-minute polling interval.
- Symbol cards link by ownership: portfolio notes lead to the highlighted
  Portfolio holding; watchlist notes lead to the highlighted Watch row. Market
  notes are informational and have no invented destination.
- The response includes enough current-session data to say what a mentioned
  ticker is doing now, not only that its prior daily move exceeded an ATR
  threshold. Stale and extended-hours status stays labelled.
- The existing Trading Economics guest endpoint now returns HTTP 410. It must
  not fail silently. Replace the rate-decision path with a free official
  Federal Reserve adapter that reads an FOMC decision and normalizes the
  decision into plain text, for example: `Fed raised rates 25 bp to
  3.75–4.00%.` Other calendar signals remain best-effort; an unavailable
  provider is surfaced as unavailable rather than masquerading as a quiet day.
- Data-provider parsing, rate arithmetic, and the decision wording live on the
  backend. The frontend only renders the normalized note and its destinations.

## API shape

`GET /watchlist/daily-brief` remains the normal, cache-friendly read.
`GET /watchlist/daily-brief?refresh=1` is the explicit refresh contract. It
requests fresh quotes and waits within the existing bounded-history policy; it
never leaves the page indefinitely waiting on Yahoo or an economic provider.

The Brief response adds display-safe fields for a symbol's current status,
source destination, and market-data availability. Values that decide money,
session, staleness, rate moves, or event meaning are calculated by the backend.

## Failure behaviour

- A failed manual refresh keeps the last completed Brief on screen and reports
  that the refresh did not complete.
- A temporary quote or economic-calendar failure is labelled at the affected
  note/source. It is never presented as current data or as "no events."
- A new ticker with insufficient historical bars is still included in current
  coverage; technical signals that cannot be computed are explicitly absent,
  not manufactured.

## Verification

- Backend tests cover forced Brief refresh, newly added watch symbols, an
  official FOMC decision, and provider failure.
- Frontend tests cover top navigation, Watch-to-Ideas/back navigation, the
  stream-to-open-result transition, Brief refresh/error behaviour, and ticker
  destinations.
- Responsive tests cover all facts in Portfolio and Watch rows at 390px.
- Before handoff, inspect the real app in a 390px browser viewport, then check
  the desktop expansion. The phone check is the release gate.

## Out of scope

- No new paid market-data or calendar service.
- No model call for Daily Brief.
- No change to portfolio derivation, transactions, or risk arithmetic.
