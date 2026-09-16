# Mobile-first Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Trader phone-first while moving Ideas under Watch and turning Daily Brief into a live, refreshable screen.

**Architecture:** The backend owns forced quote refresh, current ticker coverage, and official Fed rate-decision parsing. The frontend adds a Brief route, URL-driven source links, Watch-owned Ideas, and responsive rows; 390px is the acceptance gate and desktop expands from that layout.

**Tech Stack:** NestJS 12, TypeORM, React 19, React Router, TanStack Query, Tailwind v4, Vitest, Playwright WebKit.

**Spec:** `docs/superpowers/specs/2026-09-17-mobile-first-brief-design.md`

## Global Constraints

- Do not compute market meaning, rates, or money arithmetic in the frontend.
- No paid provider, model call, Yahoo import outside `yahoo.client.ts`, or changes to portfolio derivation.
- Stub every network request in tests; never touch the real `trader` database.
- No Portfolio or Watch fact may require horizontal scrolling at 390px.
- Do not build while a backend watcher is running.

---

## File map

| File | Responsibility |
|---|---|
| `backend/src/market-data/economic-calendar.client.ts` | Normalize official FOMC decisions and availability. |
| `backend/src/market-data/economic-calendar.client.spec.ts` | Offline official-statement parser tests. |
| `backend/src/market-data/daily-brief.service.ts` | Current coverage, technical notes, macro notes, refresh behavior. |
| `backend/src/market-data/daily-brief.service.spec.ts` | Forced refresh, new ticker, outage behavior. |
| `backend/src/watchlist/watchlist.service.ts` | Quote-force option and session fields for Watch rows. |
| `frontend/src/routes/Brief.tsx` | Dedicated Brief screen, refresh, coverage, note links. |
| `frontend/src/routes/Brief.spec.tsx` | Brief interaction and link tests. |
| `frontend/src/components/AppShell.tsx` / `frontend/src/main.tsx` | Brief navigation and Watch-owned Ideas routes. |
| `frontend/src/routes/{Dashboard,Watchlist,Ideas}.tsx` | Responsive rows, focus, Ideas back/stream behavior. |
| `frontend/src/routes/{Dashboard,Watchlist,Ideas}.spec.tsx` | Regression tests for those routes. |
| `e2e/{navigation,watchlist}.spec.ts` | Mobile browser flows. |

---

### Task 1: Build an honest, refreshable Brief response

**Files:**
- Create: `backend/src/market-data/economic-calendar.client.spec.ts`
- Modify: `backend/src/market-data/economic-calendar.client.ts`
- Modify: `backend/src/market-data/daily-brief.service.ts`
- Modify: `backend/src/market-data/daily-brief.service.spec.ts`
- Modify: `backend/src/watchlist/watchlist.service.ts`
- Modify: `backend/src/watchlist/watchlist.controller.ts`

**Interfaces:**
- Produces `DailyBriefService.get({ refresh?: boolean; now?: Date })`.
- Produces `{ coverage, notes, marketDataAvailable, generatedAt, refreshAfterSeconds }`.
- `coverage` is `{ source, symbol, price, regularPrice, stale, session, extended }`; source is `PORTFOLIO` or `WATCHLIST`.

- [ ] **Step 1: Write the failing official-Fed adapter tests**

```ts
it('normalizes an official 25bp FOMC increase', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(
    'The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.',
  )));
  await expect(client.week('2026-09-14', '2026-09-20')).resolves.toEqual({
    available: true,
    events: [expect.objectContaining({
      kind: 'RATE_DECISION',
      title: 'Fed raised rates 25 bp',
      detail: 'Target range is now 3.75–4.00%.',
    })],
  });
});

it('reports an outage but treats a 404 statement as an ordinary non-event', async () => {});
```

- [ ] **Step 2: Run the adapter test to prove it fails**

Run: `npm run test --prefix backend -- economic-calendar.client.spec.ts`

Expected: FAIL because the retired Trading Economics client has no official-statement parser or availability state.

- [ ] **Step 3: Implement the official FOMC adapter**

Replace the HTTP-410 guest endpoint. For each weekday in the requested week,
fetch `https://www.federalreserve.gov/newsevents/pressreleases/monetaryYYYYMMDDa.htm`.
Return 404 as no event; return a thrown/other non-OK request as unavailable.
Parse only the phrase `target range for the federal funds rate`; normalize the
action, fractional-point move, and fractional range. Cache the weekly result
for five minutes. The exact public contract is:

```ts
export interface EconomicCalendarResult { available: boolean; events: EconomicEvent[] }
export interface EconomicEvent {
  kind: 'RATE_DECISION'; name: string; date: string; title: string; detail: string;
}
```

- [ ] **Step 4: Write failing Brief-service tests**

```ts
it('forces portfolio and watch quotes and covers a new watched ticker', async () => {
  const result = await service.get({ refresh: true, now: new Date('2026-09-16T16:00:00Z') });
  expect(portfolio.getPortfolio).toHaveBeenCalledWith({ refresh: true });
  expect(watchlist.list).toHaveBeenCalledWith({ refresh: true });
  expect(result.coverage).toContainEqual(expect.objectContaining({ source: 'WATCHLIST', symbol: 'FSLR' }));
});

it('surfaces an unavailable macro provider instead of claiming a quiet market day', async () => {
  calendar.week.mockResolvedValue({ available: false, events: [] });
  await expect(service.get()).resolves.toMatchObject({ marketDataAvailable: false });
});
```

- [ ] **Step 5: Run the service test to prove it fails**

Run: `npm run test --prefix backend -- daily-brief.service.spec.ts`

Expected: FAIL because `get()` takes only a Date, Watch always uses cached quotes, and the response has neither coverage nor availability.

- [ ] **Step 6: Implement forced coverage through one quote path**

```ts
async list(options: { refresh?: boolean } = {}): Promise<WatchlistRow[]> {
  const quotes = await this.marketData.getQuotes(symbols, options.refresh === true);
  // Return price, regularPrice, stale, session, and extended on each row.
}

async get(options: { refresh?: boolean; now?: Date } = {}): Promise<DailyBriefResponse> {
  const refresh = options.refresh === true;
  const [portfolio, watched, calendar] = await Promise.all([
    this.portfolio.getPortfolio({ refresh }), this.watchlist.list({ refresh }), this.calendar.week(weekStart, weekEnd),
  ]);
  // Build all current coverage, preserving Portfolio ownership over Watch.
}
```

Keep `buildDailyBriefNotes` pure. Add normalized FOMC decisions as Market notes;
include every watched ticker in coverage even with too little history for a
technical note. Parse only `refresh=1` and `refresh=true` in the controller.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test --prefix backend -- economic-calendar.client.spec.ts daily-brief.service.spec.ts
npx tsc --noEmit -p tsconfig.json
git add backend/src/market-data/economic-calendar.client.ts backend/src/market-data/economic-calendar.client.spec.ts backend/src/market-data/daily-brief.service.ts backend/src/market-data/daily-brief.service.spec.ts backend/src/watchlist/watchlist.service.ts backend/src/watchlist/watchlist.controller.ts
git commit -m "feat: refresh daily brief with current coverage"
```

Expected: PASS with all fetches mocked and no Yahoo import outside its adapter.

### Task 2: Add the Brief route and actionable source links

**Files:**
- Create: `frontend/src/routes/Brief.tsx`
- Create: `frontend/src/routes/Brief.spec.tsx`
- Create: `frontend/src/components/AppShell.spec.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/routes/Dashboard.tsx`
- Delete: `frontend/src/components/DailyBrief.tsx`
- Delete: `frontend/src/components/DailyBrief.spec.tsx`

**Interfaces:**
- Consumes Task 1’s response and `GET /watchlist/daily-brief?refresh=1`.
- Produces `/brief`, `Brief` in the top navigation, and source destinations `/?symbol=X` and `/watchlist?symbol=X`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('puts Brief in navigation and removes Ideas', () => {
  renderShell();
  expect(screen.getByRole('link', { name: 'Brief' })).toHaveAttribute('href', '/brief');
  expect(screen.queryByRole('link', { name: 'Ideas' })).not.toBeInTheDocument();
});

it('forces Brief refresh and links a watched symbol to Watch', async () => {
  renderBrief(withCoverage('FSLR'));
  await user.click(screen.getByRole('button', { name: 'Refresh brief' }));
  expect(api).toHaveBeenLastCalledWith('/watchlist/daily-brief?refresh=1');
  expect(screen.getByRole('link', { name: /FSLR/ })).toHaveAttribute('href', '/watchlist?symbol=FSLR');
});

it('keeps completed coverage visible when a manual refresh fails', async () => {});
```

- [ ] **Step 2: Run the tests to prove they fail**

Run: `npm run test --prefix frontend -- Brief.spec.tsx AppShell.spec.tsx`

Expected: FAIL because Daily Brief is still a collapsible Dashboard component.

- [ ] **Step 3: Implement the standalone Brief page**

Use a `Daily brief` page header and the shared `Button` component labelled
`Refresh brief`. The normal query loads the cache-friendly endpoint; refresh
calls `?refresh=1` and never clears successful data before its replacement
arrives. Render distinct sections:

```tsx
<section aria-label="Current coverage">{/* every Portfolio/Watch ticker and labelled session/staleness */}</section>
<section aria-label="Notable events">{/* technical, earnings, FOMC notes grouped by source */}</section>
```

Use `<Link>` only for portfolio/watch symbols. Market cards remain articles.
Show an explicit macro-source warning when `marketDataAvailable` is false.
Add `/brief`, replace AppShell’s Ideas link, remove Dashboard’s embedded Brief,
and delete the obsolete component/tests.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test --prefix frontend -- Brief.spec.tsx AppShell.spec.tsx Dashboard.spec.tsx
npx tsc -b
git add frontend/src/routes/Brief.tsx frontend/src/routes/Brief.spec.tsx frontend/src/components/AppShell.tsx frontend/src/components/AppShell.spec.tsx frontend/src/main.tsx frontend/src/routes/Dashboard.tsx frontend/src/components/DailyBrief.tsx frontend/src/components/DailyBrief.spec.tsx
git commit -m "feat: move daily brief into its own screen"
```

Expected: PASS; Dashboard has no Daily Brief heading and `/brief` is direct-load safe.

### Task 3: Make Ideas Watch-owned and preserve the completed stream

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/routes/Watchlist.tsx`
- Modify: `frontend/src/routes/Watchlist.spec.tsx`
- Modify: `frontend/src/routes/Ideas.tsx`
- Modify: `frontend/src/routes/Ideas.spec.tsx`

**Interfaces:**
- Produces `/watchlist/ideas` as the real route and `/ideas` as a safe redirect.
- Produces controlled `resultReasoningOpen` state only for the just-completed result.

- [ ] **Step 1: Write failing navigation and stream tests**

```tsx
it('opens Ideas from Watch', () => {
  renderWatchlist([]);
  expect(screen.getByRole('link', { name: 'Ideas' })).toHaveAttribute('href', '/watchlist/ideas');
});

it('keeps the final streamed reasoning open', async () => {
  mockIdeaStream(deltaThenDone('This looks like a solid breakout.'));
  renderIdeas(); await askFor('NVDA');
  expect(await screen.findByText('This looks like a solid breakout.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Hide reasoning' })).toBeInTheDocument();
});

it('uses Watch as Back fallback for a direct Ideas URL', async () => {});
```

- [ ] **Step 2: Run tests to prove they fail**

Run: `npm run test --prefix frontend -- Ideas.spec.tsx Watchlist.spec.tsx`

Expected: FAIL because Ideas has no Back control and the result reasoning starts closed.

- [ ] **Step 3: Implement the route and controlled fresh-result reasoning**

Add `/watchlist/ideas` and make `/ideas` render `<Navigate replace to="/watchlist/ideas" />`.
Add an Ideas link beside Watch’s heading. Use the TradeDetail back pattern:
`navigate(-1)` normally and `navigate('/watchlist')` when `location.key === 'default'`.

```tsx
const [resultReasoningOpen, setResultReasoningOpen] = useState(false);
// stream done line:
setLastResult({ ...result, opinion: text });
setResultReasoningOpen(true);
// ResultCard passes controlled open/onOpenChange to Reasoning.
```

Extend `Reasoning` to support controlled props while retaining persisted,
uncontrolled behavior for saved history.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test --prefix frontend -- Ideas.spec.tsx Watchlist.spec.tsx
npx tsc -b
git add frontend/src/main.tsx frontend/src/routes/Watchlist.tsx frontend/src/routes/Watchlist.spec.tsx frontend/src/routes/Ideas.tsx frontend/src/routes/Ideas.spec.tsx
git commit -m "feat: nest ideas under watch"
```

Expected: PASS; a just-finished answer stays open and Back never dead-ends.

### Task 4: Replace clipped phone tables with responsive focused rows

**Files:**
- Modify: `frontend/src/routes/Dashboard.tsx`
- Modify: `frontend/src/routes/Dashboard.spec.tsx`
- Modify: `frontend/src/routes/Watchlist.tsx`
- Modify: `frontend/src/routes/Watchlist.spec.tsx`

**Interfaces:**
- Consumes `?symbol=<ticker>` from Task 2.
- Produces `data-testid="holding-X"` and `data-testid="watch-X"`, each with `data-focused` when linked from Brief.

- [ ] **Step 1: Write failing mobile-row and focus tests**

First extend the local `position()` and `row()` test fixtures to accept a
partial override object, so each assertion states the exact values it needs:

```ts
const position = (symbol: string, quantity: number, overrides = {}) => ({
  symbol, quantity, avgCost: 10, marketValue: 11 * quantity,
  unrealizedPnl: quantity, unrealizedPct: 10, daysUntilEarnings: null,
  ...overrides,
});
```

```tsx
it('renders all holding facts in a phone row', async () => {
  renderDashboard([position('AAPL', 1, { marketValue: 332.47, unrealizedPnl: 132.47, unrealizedPct: 66.24, daysUntilEarnings: 43 })]);
  expect(await screen.findByTestId('holding-AAPL')).toHaveTextContent('$332.47');
  expect(screen.getByTestId('holding-AAPL')).toHaveTextContent('+66.24%');
  expect(screen.getByTestId('holding-AAPL')).toHaveTextContent('+$132.47');
  expect(screen.getByTestId('holding-AAPL')).toHaveTextContent('43d');
});

it('marks a Brief-linked watch symbol current', async () => {
  renderWatchlist([row({ symbol: 'FSLR' })], '/watchlist?symbol=FSLR');
  expect(await screen.findByTestId('watch-FSLR')).toHaveAttribute('data-focused', 'true');
});
```

- [ ] **Step 2: Run the tests to prove the focus assertion fails**

Run: `npm run test --prefix frontend -- Dashboard.spec.tsx Watchlist.spec.tsx`

Expected: FAIL because only the fixed 34rem/30rem desktop grids exist.

- [ ] **Step 3: Implement one-screen mobile rows plus desktop expansion**

Below `md`, render a full-width row: identity and live price first, then
quantity/cost, return, target, and earnings as compact supporting facts. At
`md` and above, retain the aligned grid. Do not calculate values in either
markup path; use `Money`, `Percent`, `formatQuantity`, and `formatMoney`.

```tsx
<Link data-testid={`holding-${p.symbol}`} data-focused={focused} className="block rounded-lg px-3 py-3 md:hidden">
  <div className="flex justify-between"><strong>{p.symbol}</strong><Money value={p.marketValue} /></div>
  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
    <span>{formatQuantity(p.quantity)} @ <Money value={p.avgCost} /></span>
    <Percent value={p.unrealizedPct} /><Money value={p.unrealizedPnl} signed />
    <span>Earnings {earningsLabel(p.daysUntilEarnings)}</span>
  </div>
</Link>
```

Remove phone-path `overflow-x-auto` and `min-w-*`. Read `symbol` through
`useSearchParams`, apply accent focus, and call `scrollIntoView({ block: 'center' })`
after data renders. This is display state only; it cannot affect sort or math.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test --prefix frontend -- Dashboard.spec.tsx Watchlist.spec.tsx
npx tsc -b
git add frontend/src/routes/Dashboard.tsx frontend/src/routes/Dashboard.spec.tsx frontend/src/routes/Watchlist.tsx frontend/src/routes/Watchlist.spec.tsx
git commit -m "fix: make portfolio and watch rows phone-first"
```

Expected: PASS; all facts exist in one row before any sideways gesture.

### Task 5: Prove the actual mobile flows and repair stale browser coverage

**Files:**
- Modify: `e2e/navigation.spec.ts`
- Modify: `e2e/watchlist.spec.ts`

- [ ] **Step 1: Write failing WebKit browser tests**

```ts
test('opens Brief from top navigation and Ideas from Watch', async ({ page }) => {
  await page.goto('/brief');
  await expect(page.getByRole('heading', { name: 'Daily brief' })).toBeVisible();
  await page.getByRole('link', { name: 'Watch' }).click();
  await page.getByRole('link', { name: 'Ideas' }).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
});

test('shows Watch facts on the iPhone screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Add stocks' }).click();
  await page.getByPlaceholder('NVDA, AMD, TSLA').fill('NVDA');
  await page.getByRole('button', { name: 'Watch 1 stock' }).click();
  await expect(page.getByTestId('watch-NVDA')).toContainText('$200.00');
  await expect(page.getByTestId('watch-NVDA')).toContainText('no target set');
});
```

- [ ] **Step 2: Run targeted browser tests to prove they fail**

Run: `npm run test:browser -- --grep "opens Brief|shows Watch facts"`

Expected: FAIL before Tasks 2–4. The old Watch browser setup also fails because
it assumes the composer is permanently open.

- [ ] **Step 3: Update the existing Watch setups and add the new assertions**

Every Watch e2e setup must click `Add stocks`, fill the composer, and submit
the real `Watch N stock(s)` button. Do not add arbitrary waits or loosen
selectors.

- [ ] **Step 4: Run full automated verification**

Run:

```bash
npm test
npm run test:e2e --prefix backend
npm run test:browser
npm run build
```

Expected: PASS. If anything fails, use systematic debugging before modifying another behavior.

- [ ] **Step 5: Inspect production manually at 390px and commit**

Confirm in the real browser: Brief replaces Ideas in navigation; Brief refresh
shows coverage, links, and honest provider state; Watch opens Ideas and Back
returns; a finished idea remains open; Portfolio and Watch show every row fact
without clipping. Then run:

```bash
git add e2e/navigation.spec.ts e2e/watchlist.spec.ts
git commit -m "test: cover mobile brief workflows"
git push origin main
```

## Plan self-review

- **Spec coverage:** Task 1 covers the rate decision, forced refresh, coverage, and failure state. Task 2 covers dedicated Brief/navigation/links. Task 3 covers Ideas ownership and streaming. Task 4 covers both mobile tables and focus. Task 5 covers actual WebKit and 390px production acceptance.
- **Placeholder scan:** Every task names files, interfaces, failing tests, commands, expected outcomes, and a commit.
- **Type consistency:** `refresh` is a boolean from controller to Brief service, Portfolio service, and Watch service; all ownership is `PORTFOLIO`, `WATCHLIST`, or `MARKET`; all focused destinations use `symbol`.
