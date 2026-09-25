# List Tables — Design

Date: 2026-09-25
Status: approved in conversation, awaiting spec review

## Problem

On the iPhone, Holdings and Watchlist are not tables. Below the `md:`
breakpoint every row is a bordered card with its own inline labels
(`Price`, `Qty`, `Value`, `Earnings`, `Target`), so the same words repeat
once per ticker, rows wrap to about three lines, and the screen reads as a
stack of boxes rather than a table. The real header row only exists on
desktop. Holdings also lacks a daily-change figure, which is the first
thing a daily trader looks for.

Reference products (Handy Trader / IBKR Mobile, investing.com,
TradingView, Robinhood) share one pattern: a single header row, no labels
inside rows, dense rows, right-aligned tabular numbers, color only on
change and P&L, and sorting by tapping headers.

## Goal and success criteria

One reusable, phone-first table used by every numeric list, starting with
Holdings. Success means that on the owner's iPhone:

- Each field name appears once, in a header, never inside a row.
- It is obviously a table: columns line up across every row.
- A position takes one compact two-line row (about 48px), not a card.
- Day change is visible for every holding, and behaves like Handy Trader's
  Change column outside regular hours.

## Decisions made with the owner

| Question | Decision |
|---|---|
| Fitting about 7 facts per position on a phone | 4 columns, two-line cells: main value on top, muted secondary value below |
| Scope and order | Shared `DataTable` first, applied to Holdings; then Watchlist, Stocks, Stops, one slice each. App-wide polish is a separate later spec |
| Sorting | Tap headers; drop the sort dropdowns |
| Day change outside regular hours | Like Handy Trader: moves with extended-hours prices, measured from the previous regular close |
| Per-row session dot | Not wanted. The session is labeled once, in the table's title line |

## Component: `components/ui/DataTable.tsx`

A display-only component driven by a column list. It owns layout,
interaction and look; screens own their columns.

```ts
interface Column<Row> {
  id: string;
  header: string;
  align: 'left' | 'right';
  primary: (row: Row) => ReactNode;   // top line, 15px, text color
  secondary?: (row: Row) => ReactNode; // second line, 12px, muted
  sortKey?: string;                   // header is tappable when present
  width?: string;                     // grid track, default 'auto'; first column minmax(0,1fr)
}

interface DataTableProps<Row> {
  title?: ReactNode;                  // e.g. "HOLDINGS · 14" + SessionBadge
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null;   // whole-row link; null = not tappable
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  moreSorts?: { key: string; dir: 'asc' | 'desc'; label: string }[]; // header ⋯ menu
  totals?: ReactNode[];                    // optional footer row, one cell per column
  focusedKey?: string | null;              // highlighted + scrolled into view
  renderBelowRow?: (row: Row) => ReactNode; // e.g. Watchlist edit-mode editor, spans all columns
  empty?: ReactNode;
}
```

Behavior:

- **One grid for header, rows and totals**, as `Stocks.tsx` already does:
  separate grids per row size their `auto` columns independently and drift
  apart. Rows use `display: contents` links, so hover and tap feedback go on
  the cells and dividers are full-width grid items.
- **Header** is sticky at the top of the scroll area: 10px, uppercase, muted.
  The active sort column shows ▼ or ▲.
- **Tap-to-sort:** the first tap on a column sorts descending (symbol:
  ascending), a second tap flips the direction. A `⋯` at the end of the
  header opens the existing `Select` with `moreSorts` for sorts no header
  shows (such as %, value or earnings). The component reports sort changes;
  sorting and persistence stay with the screen (`sortPositions`,
  `loadDraft`/`saveDraft`), so nulls still sink to the bottom.
- **Rows:** no borders or boxes, a hairline divider between rows, and about
  12px vertical padding. Numbers use `tabular-nums` and are right-aligned.
  Color comes from the cell renderer (`signClass`) and is used only on
  change and P&L values.
- **Null values render `—`** by convention in cell renderers. The component
  never computes a value.
- **Totals row**, when given, sits under a stronger divider in the same
  columns.

No business meaning lives in the component (see AGENTS.md: the frontend
displays, the backend computes).

## Slice 1: Holdings (Dashboard)

```
HOLDINGS · 14   AFTER HOURS          ⋯
SYMBOL         LAST      DAY     P&L ▼
AAPL        243.17     +0.13    +1,026
200 @ 238   $48.6K    +0.05%     +2.1%
TSLA SHORT  376.00     +6.51      -650
-100 @ 382  $37.6K    +1.76%     -1.7%
NVDA E·3d   181.20     -2.10    +3,140
150 @ 160   $27.2K    -1.15%    +13.1%
─────────────────────────────────────
TOTAL       $182.4K     +412    +8,930
```

| Column | Top line | Second line | Header sort |
|---|---|---|---|
| SYMBOL | symbol + badges | `qty @ avgCost` | symbol |
| LAST | price | market value | market value |
| DAY | per-share day change (signed, colored) | day change % (colored) | day P&L |
| P&L | unrealized $ (signed, colored) | unrealized % (colored) | unrealized $ |

- **Badges next to the symbol:** `SHORT` (existing style), `STALE`
  (existing), and `E·Nd` when earnings are within 7 days (`E·today` on the
  day). Earnings further away are shown on the detail page and in the
  earnings sort.
- **Session:** the existing `SessionBadge`, driven by the portfolio's
  `marketSession` and `pricesAreExtended`, moves into the table title line.
  There is no per-row session marker; rows keep only `STALE`, which is
  specific to one position.
- **`⋯` sorts:** % best/worst, value, earnings soonest, symbol.
- **Totals:** market value, day P&L and unrealized P&L, all from the
  backend (below).
- **Unchanged:** a row tap opens `/trades/:tradeId`, `?symbol=` focus and
  scroll still work, and the saved sort still loads. Sort values saved
  before this change that no longer exist fall back to the default.
- The old `SortPicker` above the list is removed.

### Backend: day change on positions

`GET /portfolio` positions gain:

- `dayChange`: `price − previousClose` per share, or `null`.
- `dayChangePct`: `dayChange / previousClose`, or `null`.
- `dayPnl`: `dayChange × quantity` (a short position's signed quantity
  makes a rising price a loss), or `null`.

The response gains `totals: { marketValue, dayPnl, unrealizedPnl }`. Each
sum skips `null` members and is itself `null` when every member is `null`.
This also replaces the frontend's current `totalUnrealized` sum in
`Dashboard.tsx`.

**Semantics (Handy Trader):** `price` is the session-appropriate price
already chosen by market data, including pre-market, after-hours and
overnight. `previousClose` is the last regular-session close, which
`market-data.service.ts` already carries. Outside regular hours the change
therefore keeps moving with extended prices, and the table's title badge
labels them. When `previousClose` is missing, all three fields are `null`
and the cells show `—`. A stale quote keeps its `STALE` badge; its change
is still computed from the stale price rather than hidden, as with P&L
today.

The calculation lives in pure portfolio code with fixture tests: a long
position, a short position, no previous close, and extended-hours pricing.

## Slice 2: Watchlist

| Column | Top line | Second line | Header sort |
|---|---|---|---|
| SYMBOL | symbol + badges (`TARGET HIT`, `STALE`, `E·Nd`) | company name, or tags when there is no name | symbol |
| LAST | price | — | — |
| DAY | today change % (existing `todayChangePercent`) | — | day % |
| TARGET | target price, or `—` | `x% away` | distance to target |

- The title line carries the session badge, taken from the rows' shared
  session. All rows come from the same quote clock; if they ever disagree,
  the badge shows the first extended session found.
- Edit mode keeps the existing `RowEditor` through `renderBelowRow`,
  spanning all columns.
- The inline `Target ` and `Earnings ` labels are removed.
- Whether DAY also shows a per-share change is decided in this slice. The
  backend already returns `todayChangePercent` only.

## Slice 3: Stocks

This screen is already a single-header grid. It moves onto `DataTable`
(`SYMBOL · CLOSED · FEES · P&L`) with header sorting, and the `SORTS`
dropdown goes, with newest/oldest moving to `⋯`. The ticker picker, the
period selector and the total tiles are unchanged.

## Slice 4: Stops

Proposed columns, to confirm with the owner when this slice starts:

| Column | Top line | Second line |
|---|---|---|
| SYMBOL | symbol + direction | covered quantity |
| LAST | current price | — |
| STOP | stop price | distance % |
| RISK | amount at risk | trailing info when trailing |

Existing stop editing controls must keep working inside the table
(`renderBelowRow` or the existing edit flow). The exact fit is resolved in
this slice's own plan.

## Out of scope

- Journal, Trades and Ideas stay card lists: their content is mostly text.
  They are covered by the later app-wide polish spec.
- Column customization, horizontal scrolling and a $/% toggle. These can be
  reconsidered after real use.
- New colors or a new theme. This spec uses the existing tokens in
  `index.css`.

## Testing and verification

- `DataTable.spec.tsx`: a single header, no labels in rows, header tap
  sorts and flips direction, `⋯` sorts, the totals row, `renderBelowRow`,
  focused-row highlighting, and whole-row links.
- A backend fixture test for `dayChange`, `dayChangePct`, `dayPnl` and
  `totals`, and a `GET /portfolio` e2e test with the Yahoo stub.
- Updates to the existing `Dashboard`, `Watchlist` and `Stocks` specs that
  assert inline labels or the removed sort `Select`.
- Every slice is inspected in a real browser at iPhone width, with 20+
  rows, a short position, a stale quote, and extended-hours session data,
  before handoff. The owner then checks it on the iPhone before the next
  slice starts.
- `docs/api.md` is updated for the new position fields and `totals`.
