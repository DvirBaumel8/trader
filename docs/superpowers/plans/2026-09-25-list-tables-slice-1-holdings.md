# List Tables, Slice 1: DataTable + Holdings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the label-per-row holding cards with a dense, phone-first
4-column table (`SYMBOL · LAST · DAY · P&L`, two-line cells, tap-to-sort
headers, totals row). The backend supplies day change and totals.

**Architecture:** A pure backend helper computes the per-position day change
and the portfolio totals, and `PortfolioService` wires them into
`GET /portfolio`. A generic, display-only `DataTable` component renders one
shared CSS grid (header, rows, totals) from a column list. A
`HoldingsTable` component defines the Holdings columns on top of it and
replaces the old holdings section of `Dashboard.tsx`.

**Tech Stack:** NestJS + Jest (backend), React 19 + Tailwind + Vitest +
Testing Library (frontend), Playwright iPhone-WebKit (browser suite).

**Spec:** `docs/superpowers/specs/2026-09-25-list-tables-design.md`
(this plan covers "Component: DataTable" and "Slice 1: Holdings" only).

## Global Constraints

- The frontend displays and the backend computes. No money arithmetic in
  `frontend/` (AGENTS.md). Day change, day P&L and totals come from the API.
- Percent values are FRACTIONS (0.02 = 2%). `formatPercent` multiplies by
  100.
- A missing value is `null` in the API and renders `—` in the UI. Never 0.
- Extended-hours prices must be labeled. The existing `SessionBadge` sits
  once in the Holdings title line, with no per-row session marker (owner
  decision).
- DAY follows Handy Trader: it is the selected price (including extended
  hours) minus the previous regular close.
- Tests never call Yahoo. Backend e2e uses `backend/test/yahoo-stub.ts`
  (`previousClose = price / 1.02`).
- Never touch the real `trader` database. Unit and e2e tests use
  `trader_test` and `trader_e2e`.
- Do not run a build while the owner's watchers run. Type-check with
  `cd frontend && npx tsc -b` and
  `cd backend && npx tsc --noEmit -p tsconfig.json`.
- Any UI change is inspected in a real browser at iPhone width before
  handoff.
- Commit messages end with the session attribution lines from the system
  reminder. Push each task's commit to `origin/main` after it passes (owner
  preference).

## Review Focus

1. **Short positions:** a rising price must show a negative day P&L for a
   short. Covered in Task 1 (`computeDayChange` short case).
2. **No previous close** (a new listing, or a provider gap): DAY shows `—`
   and the row still renders. Covered in Task 1 (null case) and Task 4
   (`—` render test).
3. **Totals when every position is unpriced:** the totals must be `null`
   (shown as `—`), not `$0.00`. Covered in Task 1 (`sumNullable` all-null
   test).
4. **A saved sort from the old dropdown, or an unknown key in
   localStorage:** it must load the default sort, not crash or sort by
   `undefined`. Covered in Task 2 (`sanitizeSort` test).
5. **A holding with no trade id** (`tradeId: null`): the row is not a link,
   and tapping it must not navigate to `#`. Covered in Task 3 (`rowHref`
   null test).

---

### Task 1: Backend: day change and totals on `GET /portfolio`

**Files:**
- Create: `backend/src/portfolio/day-change.ts`
- Test: `backend/src/portfolio/day-change.spec.ts`
- Modify: `backend/src/portfolio/portfolio.service.ts` (the `positions = derived.map(...)` block around lines 223–259 and the returned object around lines 305–325)
- Modify: `backend/test/portfolio.e2e-spec.ts` (the `'prices seeded positions…'` and `'seeds a short position…'` tests)
- Modify: `docs/api.md` (the `GET /portfolio` row, line 48)

**Interfaces:**
- Produces:
  - `computeDayChange(price: number | null, previousClose: number | null, quantity: number): { dayChange: number | null; dayChangePct: number | null; dayPnl: number | null }`
  - `sumNullable(values: (number | null)[]): number | null`
  - `GET /portfolio` positions gain `dayChange`, `dayChangePct`, `dayPnl` (all `number | null`); the response gains `totals: { marketValue: number | null; dayPnl: number | null; unrealizedPnl: number | null }`.

- [ ] **Step 1: Write the failing unit test**

`backend/src/portfolio/day-change.spec.ts`:

```ts
import { computeDayChange, sumNullable } from './day-change.js';

describe('computeDayChange', () => {
  it('measures a long position from the previous regular close', () => {
    const r = computeDayChange(102, 100, 10);
    expect(r.dayChange).toBeCloseTo(2);
    expect(r.dayChangePct).toBeCloseTo(0.02); // a FRACTION, like unrealizedPct
    expect(r.dayPnl).toBeCloseTo(20);
  });

  /** A short loses when the price rises: the signed quantity carries that. */
  it('makes a rising price a loss for a short', () => {
    const r = computeDayChange(102, 100, -10);
    expect(r.dayChange).toBeCloseTo(2); // per-share move is the market's, not the position's
    expect(r.dayChangePct).toBeCloseTo(0.02);
    expect(r.dayPnl).toBeCloseTo(-20);
  });

  /**
   * An extended-hours price is still the selected price (Handy Trader
   * behavior): the move keeps counting after the close, not frozen at it.
   */
  it('uses whatever price it is given, including an after-hours print', () => {
    expect(computeDayChange(95, 100, 1).dayChange).toBeCloseTo(-5);
  });

  it('is all null without a price or a previous close, never zero', () => {
    const none = { dayChange: null, dayChangePct: null, dayPnl: null };
    expect(computeDayChange(null, 100, 10)).toEqual(none);
    expect(computeDayChange(100, null, 10)).toEqual(none);
  });

  it('is all null rather than dividing by zero when the previous close is zero', () => {
    expect(computeDayChange(100, 0, 10)).toEqual({
      dayChange: null,
      dayChangePct: null,
      dayPnl: null,
    });
  });
});

describe('sumNullable', () => {
  it('sums the priced members and skips nulls', () => {
    expect(sumNullable([1, null, 2.5])).toBeCloseTo(3.5);
  });

  /** "Nothing could be priced" must not read as "$0.00 moved". */
  it('is null when every member is null, or there are none', () => {
    expect(sumNullable([null, null])).toBeNull();
    expect(sumNullable([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/portfolio/day-change.spec.ts`
Expected: FAIL with `Cannot find module './day-change.js'`.

- [ ] **Step 3: Implement**

`backend/src/portfolio/day-change.ts`:

```ts
import { todayChangePercent } from '../watchlist/score.js';

export interface DayChange {
  /** Per-share move since the previous regular close. */
  dayChange: number | null;
  /** The same move as a FRACTION of the previous close. */
  dayChangePct: number | null;
  /** What that move did to this position: signed, so a short loses on a rise. */
  dayPnl: number | null;
}

/**
 * Today's move for one holding, the way Handy Trader's Change column reads.
 * `price` is whichever price select-price.ts picked for the session, so a
 * pre-market or after-hours print moves this the same way it moves the price
 * shown next to it. The Holdings title labels those sessions. Shares the
 * percent convention with the watchlist by reusing `todayChangePercent`, so
 * the two screens can never disagree about the same ticker's move.
 */
export function computeDayChange(
  price: number | null,
  previousClose: number | null,
  quantity: number,
): DayChange {
  const pct = todayChangePercent(price, previousClose);
  if (pct === null || price === null || previousClose === null) {
    return { dayChange: null, dayChangePct: null, dayPnl: null };
  }
  const dayChange = price - previousClose;
  return { dayChange, dayChangePct: pct, dayPnl: dayChange * quantity };
}

/**
 * A total over figures that may be unpriced. Null only when NOTHING could
 * be priced: a portfolio of unpriceable holdings has an unknown total, not a
 * zero one.
 */
export function sumNullable(values: (number | null)[]): number | null {
  const priced = values.filter((v): v is number => v !== null);
  return priced.length === 0 ? null : priced.reduce((s, v) => s + v, 0);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd backend && npx jest src/portfolio/day-change.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the failing e2e assertions**

In `backend/test/portfolio.e2e-spec.ts`, inside `'prices seeded positions and computes account value'`, after `expect(p.unrealizedPnl)…`:

```ts
    // The Yahoo stub quotes previousClose = price / 1.02, so every holding
    // is up exactly 2% on the day.
    expect(p.dayChangePct).toBeCloseTo(0.02, 6);
    expect(p.dayChange).toBeCloseTo(p.price - p.price / 1.02, 6);
    expect(p.dayPnl).toBeCloseTo(p.dayChange * 10, 6);
    expect(res.body.totals).toEqual({
      marketValue: expect.closeTo(p.marketValue, 6),
      dayPnl: expect.closeTo(p.dayPnl, 6),
      unrealizedPnl: expect.closeTo(p.unrealizedPnl, 6),
    });
```

Inside `'seeds a short position with the right sign and cash'`, after its existing assertions on `p`:

```ts
    // Price up 2% on the day: a short position loses on it.
    expect(p.dayPnl).toBeLessThan(0);
```

In `'returns an empty portfolio before seeding'`:

```ts
    expect(res.body.totals).toEqual({ marketValue: null, dayPnl: null, unrealizedPnl: null });
```

Run: `cd backend && npm run test:e2e -- portfolio`
Expected: FAIL (`dayChangePct` is undefined and `totals` is undefined).

- [ ] **Step 6: Wire into `PortfolioService`**

In `backend/src/portfolio/portfolio.service.ts`, add to the imports:

```ts
import { computeDayChange, sumNullable } from './day-change.js';
```

In the `derived.map((p) => { … })` block, after `const marketValue = …;`, add:

```ts
      const day = computeDayChange(price, quote?.previousClose ?? null, p.quantity);
```

and in the returned object, after `unrealizedPct: …,`:

```ts
        // Handy Trader's Change column: the selected price (extended hours
        // included) against the previous regular close. See day-change.ts.
        dayChange: day.dayChange,
        dayChangePct: day.dayChangePct,
        dayPnl: day.dayPnl,
```

In the final `return { positions, cash, …`, after `accountValue: cash + positionsValue,`:

```ts
      // The Holdings table's totals row. The backend computes it, so the
      // screen never sums money itself. Null, not 0, when nothing is priced.
      totals: {
        marketValue: sumNullable(positions.map((p) => p.marketValue)),
        dayPnl: sumNullable(positions.map((p) => p.dayPnl)),
        unrealizedPnl: sumNullable(positions.map((p) => p.unrealizedPnl)),
      },
```

- [ ] **Step 7: Run the tests and type-check**

Run: `cd backend && npx jest src/portfolio && npm run test:e2e -- portfolio && npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, no type errors.

- [ ] **Step 8: Document the API change**

In `docs/api.md` line 48, replace the `GET /portfolio` row's notes with:

```
| `GET /portfolio` | Positions, cash, account value, at-risk, stop tiers. Each position carries `dayChange` / `dayChangePct` / `dayPnl` (selected price, extended hours included, vs the previous regular close; `null` without a previous close), and `totals` sums `marketValue`, `dayPnl`, `unrealizedPnl` (`null` when nothing is priced). Polled every 60s by the dashboard; also the seam that keeps `daily_closes` fresh. |
```

- [ ] **Step 9: Commit and push**

```bash
git add backend/src/portfolio/day-change.ts backend/src/portfolio/day-change.spec.ts backend/src/portfolio/portfolio.service.ts backend/test/portfolio.e2e-spec.ts docs/api.md
git commit -m "feat: day change and totals on GET /portfolio"
git push origin main
```

---

### Task 2: Frontend helpers: day-P&L sort, saved-sort sanitizing, compact money

**Files:**
- Modify: `frontend/src/lib/sortPositions.ts`
- Test: `frontend/src/lib/sortPositions.spec.ts`
- Modify: `frontend/src/components/format.ts`
- Test: `frontend/src/components/format.spec.ts` (create it if it doesn't exist; check with `ls frontend/src/components/format.spec.ts`)

**Interfaces:**
- Produces:
  - `SortKey` gains `'dayPnl'`; `SortablePosition` gains `dayPnl: number | null`.
  - `SORT_KEYS: readonly SortKey[]`
  - `sanitizeSort(s: { key: unknown; dir: unknown }, fallback: { key: SortKey; dir: SortDir }): { key: SortKey; dir: SortDir }`
  - `formatMoneyCompact(value: number | null | undefined): string`, for example `$48.6K`, `$1.25M`, `-$950.00`, `—`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/sortPositions.spec.ts` (keep its existing imports and add `sanitizeSort`):

```ts
describe('dayPnl sort', () => {
  const row = (symbol: string, dayPnl: number | null) => ({
    symbol,
    marketValue: 1,
    unrealizedPct: 0,
    unrealizedPnl: 0,
    daysUntilEarnings: null,
    dayPnl,
  });

  it('sorts by day P&L, sinking an unpriced row in both directions', () => {
    const rows = [row('A', 5), row('B', null), row('C', -3)];
    expect(sortPositions(rows, 'dayPnl', 'desc').map((r) => r.symbol)).toEqual(['A', 'C', 'B']);
    expect(sortPositions(rows, 'dayPnl', 'asc').map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
  });
});

describe('sanitizeSort', () => {
  const fallback = { key: 'marketValue', dir: 'desc' } as const;

  it('keeps a valid saved sort', () => {
    expect(sanitizeSort({ key: 'dayPnl', dir: 'asc' }, fallback)).toEqual({ key: 'dayPnl', dir: 'asc' });
  });

  /** localStorage outlives code: an old or corrupted value must not sort by `undefined`. */
  it('falls back on an unknown key or direction', () => {
    expect(sanitizeSort({ key: 'price', dir: 'asc' }, fallback)).toEqual(fallback);
    expect(sanitizeSort({ key: 'symbol', dir: 'sideways' }, fallback)).toEqual(fallback);
    expect(sanitizeSort({ key: undefined, dir: undefined }, fallback)).toEqual(fallback);
  });
});
```

`frontend/src/components/format.spec.ts` (if the file exists, append the `describe` and add `formatMoneyCompact` to its import):

```ts
import { describe, expect, it } from 'vitest';
import { formatMoneyCompact } from './format';

describe('formatMoneyCompact', () => {
  it('abbreviates thousands and millions to one or two decimals', () => {
    expect(formatMoneyCompact(48_612)).toBe('$48.6K');
    expect(formatMoneyCompact(1_250_000)).toBe('$1.25M');
  });

  it('keeps cents below a thousand, where abbreviation hides nothing', () => {
    expect(formatMoneyCompact(950)).toBe('$950.00');
  });

  it('signs negatives (a short position has negative market value)', () => {
    expect(formatMoneyCompact(-37_600)).toBe('-$37.6K');
  });

  it('shows a dash for a missing value, never $0', () => {
    expect(formatMoneyCompact(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd frontend && npx vitest run src/lib/sortPositions.spec.ts src/components/format.spec.ts`
Expected: FAIL (`sanitizeSort` and `formatMoneyCompact` are not exported, and there's a type error on `dayPnl`).

- [ ] **Step 3: Implement**

In `frontend/src/lib/sortPositions.ts`, replace the `SortKey` type and `SortablePosition`:

```ts
export const SORT_KEYS = [
  'symbol',
  'marketValue',
  'unrealizedPct',
  'unrealizedPnl',
  'daysUntilEarnings',
  'dayPnl',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export interface SortablePosition {
  symbol: string;
  marketValue: number | null;
  unrealizedPct: number | null;
  unrealizedPnl: number | null;
  /** Null for a ticker with no upcoming earnings date (an ETF, say) — always sinks to the end, see below. */
  daysUntilEarnings: number | null;
  /** Null without a previous close. Sinks like any other unpriced metric. */
  dayPnl: number | null;
}
```

Append:

```ts
/**
 * A saved sort comes from localStorage, which outlives the code that wrote
 * it. Anything this version cannot sort by falls back whole, rather than
 * keeping a valid direction on an invalid key.
 */
export function sanitizeSort(
  s: { key: unknown; dir: unknown },
  fallback: { key: SortKey; dir: SortDir },
): { key: SortKey; dir: SortDir } {
  const keyOk = (SORT_KEYS as readonly unknown[]).includes(s.key);
  const dirOk = s.dir === 'asc' || s.dir === 'desc';
  return keyOk && dirOk ? { key: s.key as SortKey, dir: s.dir as SortDir } : fallback;
}
```

In `frontend/src/components/format.ts`, after `formatMoney`:

```ts
/**
 * Money in the fewest characters that still read exactly enough for a
 * secondary line, such as a position's market value under its price. Below
 * $1,000 it is plain `formatMoney`, since abbreviating would hide nothing.
 */
export function formatMoneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return formatMoney(value);
  const [n, suffix] = abs >= 1_000_000 ? [abs / 1_000_000, 'M'] : [abs / 1000, 'K'];
  const digits = suffix === 'M' ? 2 : 1;
  const body = `$${Number(n.toFixed(digits)).toString()}${suffix}`;
  return value < 0 ? `-${body}` : body;
}
```

Note: `Number(n.toFixed(1)).toString()` turns `48.0` into `48`, giving `$48K`, which is intended.

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd frontend && npx vitest run src/lib/sortPositions.spec.ts src/components/format.spec.ts && npx tsc -b`
Expected: PASS. `tsc` may now report that `Dashboard.tsx`'s `Position` lacks `dayPnl`. Task 4 fixes that. If so, add `dayPnl: number | null;` to `Dashboard.tsx`'s `Position` interface now, so this commit type-checks.

- [ ] **Step 5: Commit and push**

```bash
git add frontend/src/lib/sortPositions.ts frontend/src/lib/sortPositions.spec.ts frontend/src/components/format.ts frontend/src/components/format.spec.ts frontend/src/routes/Dashboard.tsx
git commit -m "feat: day-P&L sort, saved-sort sanitizing, compact money format"
git push origin main
```

---

### Task 3: `DataTable` component

**Files:**
- Create: `frontend/src/components/ui/DataTable.tsx`
- Test: `frontend/src/components/ui/DataTable.spec.tsx`

**Interfaces:**
- Produces (exported from `components/ui/DataTable.tsx`):

```ts
export interface TableSort { key: string; dir: 'asc' | 'desc' }
export interface Column<Row> {
  id: string;
  header: string;
  align: 'left' | 'right';
  primary: (row: Row) => ReactNode;
  secondary?: (row: Row) => ReactNode;
  /** When set, the header is a sort button for this key. */
  sortKey?: string;
  /** Direction of the first tap. Default 'desc'; 'asc' suits text like a symbol. */
  firstDir?: 'asc' | 'desc';
}
export function DataTable<Row>(props: {
  title?: ReactNode;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null;
  rowTestId?: (row: Row) => string;
  sort?: TableSort;
  onSortChange?: (s: TableSort) => void;
  moreSorts?: (TableSort & { label: string })[];
  totals?: ReactNode[];
  focusedKey?: string | null;
  focusedRef?: Ref<HTMLSpanElement>;
  renderBelowRow?: (row: Row) => ReactNode;
  empty?: ReactNode;
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

`frontend/src/components/ui/DataTable.spec.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type Column } from './DataTable';

afterEach(cleanup);

interface R { sym: string; px: number; href: string | null }
const rows: R[] = [
  { sym: 'AAPL', px: 1, href: '/a' },
  { sym: 'TSLA', px: 2, href: null },
];
const columns: Column<R>[] = [
  { id: 's', header: 'Symbol', align: 'left', primary: (r) => r.sym, secondary: () => 'sub', sortKey: 'symbol', firstDir: 'asc' },
  { id: 'p', header: 'Last', align: 'right', primary: (r) => `px${r.px}`, sortKey: 'px' },
];

function renderTable(props: Partial<Parameters<typeof DataTable<R>>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DataTable<R>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.sym}
        rowHref={(r) => r.href}
        rowTestId={(r) => `row-${r.sym}`}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('DataTable', () => {
  /** The whole point: a field name appears once, not once per row. */
  it('renders each header exactly once for many rows', () => {
    renderTable();
    expect(screen.getAllByText('Last')).toHaveLength(1);
    expect(screen.getByTestId('row-AAPL')).toHaveTextContent('AAPLsub');
    expect(screen.getByTestId('row-TSLA')).not.toHaveTextContent('Last');
  });

  it('links a row with an href, and leaves a row without one inert', () => {
    renderTable();
    expect(screen.getByTestId('row-AAPL').tagName).toBe('A');
    expect(screen.getByTestId('row-AAPL')).toHaveAttribute('href', '/a');
    expect(screen.getByTestId('row-TSLA').tagName).toBe('DIV');
  });

  it("sorts on a header tap using the column's first direction, then flips", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderTable({ onSortChange });

    await user.click(screen.getByRole('button', { name: /Last/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'px', dir: 'desc' });

    await user.click(screen.getByRole('button', { name: /Symbol/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'symbol', dir: 'asc' });

    rerender(
      <MemoryRouter>
        <DataTable<R> columns={columns} rows={rows} rowKey={(r) => r.sym} sort={{ key: 'px', dir: 'desc' }} onSortChange={onSortChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Last/ })).toHaveTextContent('▼');
    await user.click(screen.getByRole('button', { name: /Last/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'px', dir: 'asc' });
  });

  it('offers sorts no header shows through the ⋯ menu', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    renderTable({
      onSortChange,
      moreSorts: [{ key: 'earn', dir: 'asc', label: 'Earnings — soonest' }],
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'More sorts' }), 'earn:asc');
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'earn', dir: 'asc' });
  });

  it('renders a totals row in the same columns', () => {
    renderTable({ totals: ['Total', 'px3'] });
    const totals = screen.getByTestId('table-totals');
    expect(within(totals).getByText('Total')).toBeInTheDocument();
    expect(within(totals).getByText('px3')).toBeInTheDocument();
  });

  it('marks the focused row and renders content below a row', () => {
    renderTable({ focusedKey: 'TSLA', renderBelowRow: (r) => <p>editor {r.sym}</p> });
    expect(screen.getByTestId('row-TSLA')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('row-AAPL')).not.toHaveAttribute('data-focused');
    expect(screen.getByText('editor AAPL')).toBeInTheDocument();
  });

  it('shows the empty state instead of rows', () => {
    renderTable({ rows: [], empty: <p>Nothing here</p> });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd frontend && npx vitest run src/components/ui/DataTable.spec.tsx`
Expected: FAIL with `Failed to resolve import "./DataTable"`.

- [ ] **Step 3: Implement**

`frontend/src/components/ui/DataTable.tsx`:

```tsx
import { Fragment, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';

export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface Column<Row> {
  id: string;
  header: string;
  align: 'left' | 'right';
  primary: (row: Row) => ReactNode;
  secondary?: (row: Row) => ReactNode;
  /** When set, the header is a sort button for this key. */
  sortKey?: string;
  /** Direction of the first tap. Default 'desc'; 'asc' suits text like a symbol. */
  firstDir?: 'asc' | 'desc';
}

const HEADER = 'text-[10px] font-medium tracking-wide text-muted uppercase';
// Rows use `display: contents`, so the row has no box of its own; hover,
// tap and focus feedback go on every cell through `group`.
const CELL =
  'py-2.5 transition-colors group-hover:bg-surface-1 group-active:bg-surface-2 group-data-[focused=true]:bg-accent/10';

const encode = (s: TableSort) => `${s.key}:${s.dir}`;

/**
 * The app's one table. Header, rows and totals are items of ONE grid, not
 * one grid each: separate grids size their `auto` columns from their own
 * content, so columns drift from row to row (see the note in Stocks.tsx
 * that first hit this). Display only: cells render whatever the screen's
 * columns return, and sorting itself stays with the screen.
 */
export function DataTable<Row>({
  title,
  columns,
  rows,
  rowKey,
  rowHref,
  rowTestId,
  sort,
  onSortChange,
  moreSorts,
  totals,
  focusedKey,
  focusedRef,
  renderBelowRow,
  empty,
}: {
  title?: ReactNode;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null;
  rowTestId?: (row: Row) => string;
  sort?: TableSort;
  onSortChange?: (s: TableSort) => void;
  moreSorts?: (TableSort & { label: string })[];
  totals?: ReactNode[];
  focusedKey?: string | null;
  focusedRef?: Ref<HTMLSpanElement>;
  renderBelowRow?: (row: Row) => ReactNode;
  empty?: ReactNode;
}) {
  const template = columns
    .map((_, i) => (i === 0 ? 'minmax(0,1fr)' : 'auto'))
    .join(' ');
  const alignClass = (c: Column<Row>) => (c.align === 'right' ? 'text-right' : 'text-left');

  function tapHeader(c: Column<Row>) {
    if (!c.sortKey || !onSortChange) return;
    const active = sort?.key === c.sortKey;
    const dir = active
      ? sort!.dir === 'asc' ? 'desc' : 'asc'
      : (c.firstDir ?? 'desc');
    onSortChange({ key: c.sortKey, dir });
  }

  return (
    <section>
      {(title || (moreSorts && moreSorts.length > 0)) && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">{title}</div>
          {moreSorts && moreSorts.length > 0 && (
            // A native select under a ⋯ glyph: iOS shows its picker wheel,
            // and the header row stays one line.
            <label className="relative flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-muted active:bg-surface-2">
              <span aria-hidden="true" className="text-base leading-none">⋯</span>
              <select
                aria-label="More sorts"
                value={sort && moreSorts.some((m) => encode(m) === encode(sort)) ? encode(sort) : ''}
                onChange={(e) => {
                  const found = moreSorts.find((m) => encode(m) === e.target.value);
                  if (found && onSortChange) onSortChange({ key: found.key, dir: found.dir });
                }}
                className="absolute inset-0 appearance-none opacity-0"
              >
                <option value="" disabled>
                  Sort by…
                </option>
                {moreSorts.map((m) => (
                  <option key={encode(m)} value={encode(m)}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {rows.length === 0 && empty ? (
        empty
      ) : (
        <div className="grid items-center gap-x-3" style={{ gridTemplateColumns: template }}>
          {columns.map((c) => {
            const active = c.sortKey !== undefined && sort?.key === c.sortKey;
            const arrow = active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const cls = `sticky top-0 z-10 border-b border-border bg-surface-0 py-1.5 whitespace-nowrap ${HEADER} ${alignClass(c)}`;
            return c.sortKey && onSortChange ? (
              <button
                key={c.id}
                type="button"
                onClick={() => tapHeader(c)}
                className={`${cls} ${active ? 'text-text' : ''}`}
              >
                {c.header}
                {arrow}
              </button>
            ) : (
              <span key={c.id} className={cls}>
                {c.header}
              </span>
            );
          })}

          {rows.map((row, i) => {
            const key = rowKey(row);
            const href = rowHref?.(row) ?? null;
            const focused = focusedKey != null && focusedKey === key;
            const cells = columns.map((c, ci) => (
              <span
                key={c.id}
                ref={ci === 0 && focused ? focusedRef : undefined}
                className={`min-w-0 tabular-nums ${alignClass(c)} ${CELL}`}
              >
                <span className="block truncate text-[15px] leading-5 font-medium">{c.primary(row)}</span>
                {c.secondary && (
                  <span className="block truncate text-[12px] leading-4 text-muted">{c.secondary(row)}</span>
                )}
              </span>
            ));
            const rowProps = {
              className: 'group contents',
              'data-testid': rowTestId?.(row),
              'data-focused': focused ? 'true' : undefined,
            };
            return (
              <Fragment key={key}>
                {href !== null ? (
                  <Link to={href} {...rowProps}>
                    {cells}
                  </Link>
                ) : (
                  <div {...rowProps}>{cells}</div>
                )}
                {renderBelowRow && <div className="col-span-full">{renderBelowRow(row)}</div>}
                {i < rows.length - 1 && <div className="col-span-full border-b border-border/60" />}
              </Fragment>
            );
          })}

          {totals && (
            <div data-testid="table-totals" className="contents">
              <div className="col-span-full border-b border-border" />
              {totals.map((t, ci) => (
                <span
                  key={ci}
                  className={`py-2.5 text-[13px] font-semibold tabular-nums ${alignClass(columns[ci])}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd frontend && npx vitest run src/components/ui/DataTable.spec.tsx && npx tsc -b`
Expected: PASS, 7 tests, no type errors. If `group-data-[focused=true]:` isn't recognized by this Tailwind version (check that the focused row visibly highlights in Task 4's browser check), use `data-[focused=true]:bg-accent/10` on each cell with the attribute copied to the cells instead.

- [ ] **Step 5: Commit and push**

```bash
git add frontend/src/components/ui/DataTable.tsx frontend/src/components/ui/DataTable.spec.tsx
git commit -m "feat: shared DataTable — one grid, tap-to-sort headers, totals row"
git push origin main
```

---

### Task 4: Holdings on `DataTable`

**Files:**
- Create: `frontend/src/components/HoldingsTable.tsx`
- Modify: `frontend/src/routes/Dashboard.tsx` (remove `PositionRow`, `SortPicker`, `SORT_OPTIONS`, `HEADER_CELL` and the holdings `<section>`; move the `SessionBadge` out of the account-value header; drop the `totalUnrealized` sum in favor of `data.totals.unrealizedPnl`)
- Modify: `frontend/src/routes/Dashboard.spec.tsx`
- Modify: `e2e/navigation.spec.ts:64-66`

**Interfaces:**
- Consumes: `DataTable`, `Column`, `TableSort` (Task 3); `sortPositions`, `sanitizeSort`, `SortKey`, `SortDir` (Task 2); `formatMoneyCompact` (Task 2); the API fields `dayChange`, `dayChangePct`, `dayPnl`, `totals` (Task 1).
- Produces: `HoldingsTable({ positions, totals, marketSession, pricesAreExtended, focusedSymbol })` and an exported `Position` type.

- [ ] **Step 1: Update the Dashboard tests (failing)**

In `frontend/src/routes/Dashboard.spec.tsx`:

1. In `basePosition`, add `dayChange: 0.5, dayChangePct: 0.05, dayPnl: 0.5 * quantity,`.
2. In `renderDashboard`'s `/portfolio` response, add
   `totals: { marketValue: 1000, dayPnl: 12.34, unrealizedPnl: 56.78 },`
   and make `marketSession`/`pricesAreExtended` overridable by adding a
   fourth parameter `portfolioOverrides: Record<string, unknown> = {}`,
   spread last into the response object.
3. Replace these tests: `'shows days until earnings for a holding'`,
   `'labels an after-hours holding price in the phone row'`,
   `'renders market value, return, and earnings together in a phone holding row'`,
   `'shows aligned column headers for holdings'` and
   `'sorts by soonest earnings…'`. Use:

```tsx
describe('Holdings table', () => {
  /** The owner's complaint: "Qty" repeated once per ticker. */
  it('shows each column name once, and no labels inside rows', async () => {
    renderDashboard([position('NVDA', 100), position('AAPL', 5), position('TSLA', -3)]);
    await screen.findByTestId('holding-NVDA');
    for (const h of ['Symbol', 'Last', 'Day', 'P&L']) {
      expect(screen.getAllByRole('button', { name: new RegExp(`^${h}`) })).toHaveLength(1);
    }
    for (const label of ['Qty', 'Value', 'Price', 'Earnings']) {
      expect(screen.getByTestId('holding-NVDA')).not.toHaveTextContent(label);
    }
  });

  it('puts price, market value, day move and P&L in one two-line row', async () => {
    renderDashboard([
      position('AAPL', 200, {
        avgCost: 238,
        price: 243.17,
        marketValue: 48_634,
        dayChange: 0.13,
        dayChangePct: 0.0005,
        dayPnl: 26,
        unrealizedPnl: 1026,
        unrealizedPct: 0.021,
      }),
    ]);
    const row = await screen.findByTestId('holding-AAPL');
    expect(row).toHaveTextContent('200 @ $238.00');
    expect(row).toHaveTextContent('$243.17');
    expect(row).toHaveTextContent('$48.6K');
    expect(row).toHaveTextContent('+$0.13');
    expect(row).toHaveTextContent('+0.05%');
    expect(row).toHaveTextContent('+$1,026.00');
    expect(row).toHaveTextContent('+2.10%');
  });

  it('shows a dash, not zero, when there is no previous close', async () => {
    renderDashboard([position('NEW', 1, { dayChange: null, dayChangePct: null, dayPnl: null })]);
    const row = await screen.findByTestId('holding-NEW');
    expect(row).toHaveTextContent('—');
    expect(row).not.toHaveTextContent('+$0.00');
  });

  it('badges earnings only when they are within a week', async () => {
    renderDashboard([
      position('SOON', 1, { daysUntilEarnings: 3 }),
      position('TODAY', 1, { daysUntilEarnings: 0 }),
      position('LATE', 1, { daysUntilEarnings: 30 }),
    ]);
    expect(await screen.findByTestId('holding-SOON')).toHaveTextContent('E·3d');
    expect(screen.getByTestId('holding-TODAY')).toHaveTextContent('E·today');
    expect(screen.getByTestId('holding-LATE')).not.toHaveTextContent('E·');
  });

  /** One label for the whole table: the owner does not want a per-row marker. */
  it('labels an after-hours session once, in the holdings title', async () => {
    renderDashboard([position('NVDA', 1, { session: 'POST', extended: true })], '/', {}, {
      marketSession: 'POST',
      pricesAreExtended: true,
    });
    await screen.findByTestId('holding-NVDA');
    expect(screen.getAllByText('AFTER HOURS')).toHaveLength(1);
    expect(screen.getByTestId('holding-NVDA')).not.toHaveTextContent('AFTER HOURS');
  });

  it('sorts by tapping a header: P&L first tap is biggest first, second tap flips', async () => {
    renderDashboard([
      position('LOW', 1, { unrealizedPnl: -5 }),
      position('HIGH', 1, { unrealizedPnl: 50 }),
    ]);
    const user = userEvent.setup();
    await screen.findByTestId('holding-LOW');
    const order = () => screen.getAllByTestId(/^holding-/).map((el) => el.getAttribute('data-testid'));

    await user.click(screen.getByRole('button', { name: /^P&L/ }));
    expect(order()).toEqual(['holding-HIGH', 'holding-LOW']);
    await user.click(screen.getByRole('button', { name: /^P&L/ }));
    expect(order()).toEqual(['holding-LOW', 'holding-HIGH']);
  });

  it('sorts by soonest earnings from the ⋯ menu, sinking an ETF with none to the end', async () => {
    renderDashboard([
      position('LATE', 1, { daysUntilEarnings: 30 }),
      position('ETF', 1, { daysUntilEarnings: null }),
      position('SOON', 1, { daysUntilEarnings: 2 }),
    ]);
    const user = userEvent.setup();
    await screen.findByTestId('holding-SOON');
    await user.selectOptions(screen.getByRole('combobox', { name: 'More sorts' }), 'daysUntilEarnings:asc');
    const order = screen.getAllByTestId(/^holding-/).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['holding-SOON', 'holding-LATE', 'holding-ETF']);
  });

  it('falls back to the default sort when the saved one is from an older version', async () => {
    window.localStorage.setItem('trader.holdingsSort.v1', JSON.stringify({ key: 'price', dir: 'asc' }));
    renderDashboard([
      position('SMALL', 1, { marketValue: 10 }),
      position('BIG', 1, { marketValue: 1000 }),
    ]);
    await screen.findByTestId('holding-BIG');
    const order = screen.getAllByTestId(/^holding-/).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['holding-BIG', 'holding-SMALL']);
  });

  it('shows backend totals in the totals row', async () => {
    renderDashboard([position('NVDA', 1)]);
    const totals = await screen.findByTestId('table-totals');
    expect(totals).toHaveTextContent('+$12.34');
    expect(totals).toHaveTextContent('+$56.78');
  });

  it('does not link a holding that has no trade', async () => {
    renderDashboard([position('NVDA', 1, { tradeId: null })]);
    expect((await screen.findByTestId('holding-NVDA')).tagName).toBe('DIV');
  });
});
```

Keep the focus/scroll test (`'focuses and scrolls to a holding linked from Brief'`), the count tests and the stop tests. If the focus test asserts on the row element's `data-focused`, it still holds, because `DataTable` sets `data-focused="true"` on the row. `scrollIntoView` is now called on the first cell rather than the row, and the test's prototype spy still sees it.

In the `'shows the empty holdings count…'` test, `positions: []` means `totals` is all null. Set `totals: { marketValue: null, dayPnl: null, unrealizedPnl: null }` through `portfolioOverrides`.

Run: `cd frontend && npx vitest run src/routes/Dashboard.spec.tsx`
Expected: FAIL (no `Last` or `Day` headers, no `More sorts` combobox).

- [ ] **Step 2: Create `HoldingsTable`**

`frontend/src/components/HoldingsTable.tsx`:

```tsx
import { useState, type Ref } from 'react';
import { DataTable, type Column, type TableSort } from './ui/DataTable';
import { Money } from './Money';
import { Percent } from './Percent';
import { SessionBadge } from './SessionBadge';
import { formatMoneyCompact, formatQuantity, formatMoney } from './format';
import { sortPositions, sanitizeSort, type SortDir, type SortKey } from '../lib/sortPositions';
import { loadDraft, saveDraft } from '../lib/draftStorage';

type Session = 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;

export interface Position {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  feesPaid: number;
  realizedPnl: number;
  price: number | null;
  stale: boolean;
  session: Session;
  extended: boolean;
  regularPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  dayPnl: number | null;
  tradeId: string | null;
  daysUntilEarnings: number | null;
}

export interface PortfolioTotals {
  marketValue: number | null;
  dayPnl: number | null;
  unrealizedPnl: number | null;
}

const SORT_KEY = 'trader.holdingsSort.v1';
/** Biggest position first: the most useful default for a working trader. */
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'marketValue', dir: 'desc' };

/** Sorts no header shows. Headers cover symbol, value, day P&L and P&L $. */
const MORE_SORTS: (TableSort & { label: string })[] = [
  { key: 'unrealizedPct', dir: 'desc', label: 'P&L % — best first' },
  { key: 'unrealizedPct', dir: 'asc', label: 'P&L % — worst first' },
  { key: 'marketValue', dir: 'desc', label: 'Value — largest first' },
  { key: 'daysUntilEarnings', dir: 'asc', label: 'Earnings — soonest first' },
  { key: 'symbol', dir: 'asc', label: 'Symbol — A to Z' },
];

const BADGE = 'rounded px-1 py-px text-[9px] font-medium tracking-wide';
/** Earnings are a badge only when close enough to act on; the detail page has the rest. */
const EARNINGS_BADGE_DAYS = 7;

function SymbolCell({ p }: { p: Position }) {
  const e = p.daysUntilEarnings;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="font-semibold">{p.symbol}</span>
      {p.quantity < 0 && <span className={`${BADGE} bg-down/15 text-down`}>SHORT</span>}
      {p.stale && <span className={`${BADGE} text-down`}>STALE</span>}
      {e !== null && e <= EARNINGS_BADGE_DAYS && (
        <span className={`${BADGE} bg-accent/15 text-accent`}>E·{e === 0 ? 'today' : `${e}d`}</span>
      )}
    </span>
  );
}

const COLUMNS: Column<Position>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    align: 'left',
    sortKey: 'symbol',
    firstDir: 'asc',
    primary: (p) => <SymbolCell p={p} />,
    secondary: (p) => `${formatQuantity(p.quantity)} @ ${formatMoney(p.avgCost)}`,
  },
  {
    id: 'last',
    header: 'Last',
    align: 'right',
    sortKey: 'marketValue',
    primary: (p) => <Money value={p.price} />,
    secondary: (p) => formatMoneyCompact(p.marketValue),
  },
  {
    id: 'day',
    header: 'Day',
    align: 'right',
    sortKey: 'dayPnl',
    primary: (p) => <Money value={p.dayChange} signed colored />,
    secondary: (p) => <Percent value={p.dayChangePct} />,
  },
  {
    id: 'pnl',
    header: 'P&L',
    align: 'right',
    sortKey: 'unrealizedPnl',
    primary: (p) => <Money value={p.unrealizedPnl} signed colored />,
    secondary: (p) => <Percent value={p.unrealizedPct} />,
  },
];

/**
 * The portfolio as a table, like a broker's positions screen: one header,
 * two-line cells, and no field names inside rows (the owner's original
 * complaint was "Qty" repeated once per ticker). Extended-hours prices are
 * labeled once in the title, not per row.
 */
export function HoldingsTable({
  positions,
  totals,
  marketSession,
  pricesAreExtended,
  focusedSymbol,
  focusedRef,
}: {
  positions: Position[];
  totals: PortfolioTotals;
  marketSession: Session;
  pricesAreExtended: boolean;
  focusedSymbol: string | null;
  focusedRef?: Ref<HTMLSpanElement>;
}) {
  const [sort, setSort] = useState(() => sanitizeSort(loadDraft(SORT_KEY, DEFAULT_SORT), DEFAULT_SORT));
  const changeSort = (s: TableSort) => {
    const next = sanitizeSort(s, DEFAULT_SORT);
    setSort(next);
    saveDraft(SORT_KEY, next);
  };
  const count = positions.length;

  return (
    <DataTable<Position>
      title={
        <>
          <span className="text-xs tracking-wide text-text/70 uppercase">Holdings</span>
          {/* `GET /portfolio` already filters to open positions; shorts count too. */}
          <span className="text-xs text-muted">
            {count} {count === 1 ? 'position' : 'positions'}
          </span>
          <SessionBadge session={marketSession} extended={pricesAreExtended} />
        </>
      }
      columns={COLUMNS}
      rows={sortPositions(positions, sort.key, sort.dir)}
      rowKey={(p) => p.symbol}
      rowHref={(p) => (p.tradeId !== null ? `/trades/${encodeURIComponent(p.tradeId)}` : null)}
      rowTestId={(p) => `holding-${p.symbol}`}
      sort={sort}
      onSortChange={changeSort}
      moreSorts={MORE_SORTS}
      focusedKey={focusedSymbol}
      focusedRef={focusedRef}
      totals={
        count === 0
          ? undefined
          : [
              <span key="t" className="text-muted">Total</span>,
              formatMoneyCompact(totals.marketValue),
              <Money key="d" value={totals.dayPnl} signed colored />,
              <Money key="p" value={totals.unrealizedPnl} signed colored />,
            ]
      }
    />
  );
}
```

- [ ] **Step 3: Slim `Dashboard.tsx` down to use it**

In `frontend/src/routes/Dashboard.tsx`:

1. Delete the local `Position` interface, `SORT_KEY`, `SortPref`, `defaultSort`, `SORT_OPTIONS`, `encode`, `SortPicker`, `PositionRow` and `HEADER_CELL`. Remove the now-unused imports (`Fragment`, `Ref`, `Link`, `Select`, `Percent`, `formatQuantity`, `sortPositions`, `SortDir`, `SortKey`). Keep `loadDraft`/`saveDraft` for the range.
2. Add `import { HoldingsTable, type Position, type PortfolioTotals } from '../components/HoldingsTable';` and add `totals: PortfolioTotals;` to the `Portfolio` interface.
3. Remove the `sort` state and `changeSort`.
4. Change `focusedRowRef` to `useRef<HTMLSpanElement>(null)`.
5. Replace `totalUnrealized` (the frontend sum) with the backend total. The line under account value becomes:

```tsx
            <div className="mt-1 text-sm">
              <span className={signClass(data.totals.unrealizedPnl)}>
                <Money value={data.totals.unrealizedPnl} signed /> unrealized
              </span>
            </div>
```

6. Remove the `<SessionBadge …/>` next to "Account value". The Holdings title carries it now; the spec says it moves. Remove the `SessionBadge` import if nothing else in `Dashboard.tsx` uses it.
7. Replace the whole holdings `<section>…</section>` with:

```tsx
      <HoldingsTable
        positions={data.positions}
        totals={data.totals}
        marketSession={data.marketSession}
        pricesAreExtended={data.pricesAreExtended}
        focusedSymbol={focusedSymbol}
        focusedRef={focusedRowRef}
      />
```

The existing `useEffect` that calls `focusedRowRef.current?.scrollIntoView?.({ block: 'center' })` stays as it is; it now scrolls the focused row's first cell.

- [ ] **Step 4: Run the tests and type-check**

Run: `cd frontend && npx vitest run src/routes/Dashboard.spec.tsx src/components/ui/DataTable.spec.tsx && npx vitest run && npx tsc -b`
Expected: all PASS, no type errors. Fix any other spec that built a `Position` fixture without the new fields (for example `grep -rln "daysUntilEarnings" frontend/src --include=*.spec.tsx`) by adding `dayChange: null, dayChangePct: null, dayPnl: null`.

- [ ] **Step 5: Fix the browser-suite assertion**

In `e2e/navigation.spec.ts` around line 64–66, the test asserts that the NVDA holding row contains `'Qty'`. That label is removed on purpose. Replace that assertion with:

```ts
    await expect(holding).toContainText('@');
    await expect(page.getByRole('button', { name: /^Last/ })).toHaveCount(1);
```

Run: `npm run test:browser -- navigation`
Expected: PASS.

- [ ] **Step 6: Inspect it in a real browser at iPhone width**

With the owner's watchers already running (`:5173`), or after starting them if they are not running, open `http://localhost:5173/` at a 390×844 viewport, read-only against real data. Check:
- One header row. No `Qty`, `Value` or `Earnings` text inside rows. Columns line up down the whole list, and nothing scrolls sideways.
- Each position fits on two lines. The P&L column's widest value (for example `+$12,345.67`) is not clipped. If it is, report the widest value and stop rather than changing formats on your own.
- The header stays pinned while scrolling 20+ rows.
- Tapping `P&L` toggles ▼/▲ and reorders the rows. `⋯` opens the iOS-style picker.
- A short position shows `SHORT`, earnings within 7 days show `E·Nd`, and the totals row matches the account figures.
- Opening `/?symbol=<a held symbol>` highlights and scrolls to that row.
- Outside regular hours, the Holdings title shows `PRE-MARKET` / `AFTER HOURS` once.

Take a screenshot for the owner.

- [ ] **Step 7: Commit and push**

```bash
git add frontend/src/components/HoldingsTable.tsx frontend/src/routes/Dashboard.tsx frontend/src/routes/Dashboard.spec.tsx e2e/navigation.spec.ts
git commit -m "feat: holdings as a dense phone-first table with day change"
git push origin main
```

- [ ] **Step 8: Owner test checkpoint**

Stop. Tell the owner what to check on the iPhone (the list from Step 6), and do not start slice 2 until they respond.
