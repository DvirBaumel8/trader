// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

const basePosition = (symbol: string, quantity: number) => ({
  symbol,
  name: symbol,
  quantity,
  avgCost: 10,
  costBasis: 10 * Math.abs(quantity),
  feesPaid: 0,
  realizedPnl: 0,
  price: 11,
  stale: false,
  session: 'REGULAR' as const,
  extended: false,
  regularPrice: 11,
  marketValue: 11 * quantity,
  unrealizedPnl: 1 * quantity,
  unrealizedPct: 10,
  dayChange: 0.5 as number | null,
  dayChangePct: 0.05 as number | null,
  dayPnl: (0.5 * quantity) as number | null,
  tradeId: null as string | null,
  daysUntilEarnings: null as number | null,
});
const position = (
  symbol: string,
  quantity: number,
  overrides: Partial<ReturnType<typeof basePosition>> = {},
) => ({ ...basePosition(symbol, quantity), ...overrides });


describe('Dashboard holdings table', () => {

  it('focuses and scrolls to a holding linked from Brief', async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderDashboard([position('AAPL', 1)], '/?symbol=AAPL');

      expect(await screen.findByTestId('holding-AAPL')).toHaveAttribute('data-focused', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('keeps the daily brief on its own screen', async () => {
    renderDashboard([position('NVDA', 100)]);
    expect(await screen.findByText('Holdings')).toBeInTheDocument();
    expect(screen.queryByText('Daily brief')).not.toBeInTheDocument();
  });

  it('flags positions with only a partial stop, alongside those with none', async () => {
    renderDashboard([position('NVDA', 100)], '/', {
      positionsWithoutStop: { count: 1, symbols: ['MSFT'] },
      positionsWithPartialStop: {
        count: 1,
        positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
      },
    });

    expect(await screen.findByText(/without a stop/i)).toBeInTheDocument();
    expect(screen.getByText(/with a partial stop/i)).toBeInTheDocument();
  });

  it('remembers when the portfolio overview is minimized', async () => {
    const first = renderDashboard([position('NVDA', 100)]);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Hide overview' });
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Show overview' })).toBeInTheDocument();
    expect(screen.queryByText('Account value')).not.toBeInTheDocument();

    first.unmount();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60 * 60 * 1000);
    renderDashboard([position('NVDA', 100)]);
    expect(await screen.findByRole('button', { name: 'Show overview' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

function renderDashboard(
  positions: ReturnType<typeof position>[],
  initialPath = '/',
  atRiskOverrides: Partial<{
    positionsWithoutStop: { count: number; symbols: string[] };
    positionsWithPartialStop: {
      count: number;
      positions: { symbol: string; coveredQuantity: number; heldQuantity: number }[];
    };
  }> = {},
  portfolioOverrides: Record<string, unknown> = {},
) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.startsWith('/performance'))
      return Promise.resolve({ points: [] });
    if (path === '/portfolio')
      return Promise.resolve({
        positions,
        cash: -5000,
        positionsValue: 1000,
        accountValue: 500,
        hasStalePrices: false,
        pricedAt: '2026-01-05T12:00:00.000Z',
        marketSession: 'REGULAR',
        pricesAreExtended: false,
        atRisk: {
          amount: 100,
          positionsWithoutStop: { count: 0, symbols: [] },
          positionsWithPartialStop: { count: 0, positions: [] },
          ...atRiskOverrides,
        },
        totals: { marketValue: 1000, dayPnl: 12.34, unrealizedPnl: 56.78 },
        ...portfolioOverrides,
      });
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Dashboard position count', () => {
  it('shows the open-position count with the holdings heading', async () => {
    renderDashboard([
      position('NVDA', 100),
      position('PLTR', 50),
      position('LMND', -300),
    ]);
    expect(await screen.findByText('3 positions')).toBeInTheDocument();
    expect(screen.queryByText('Positions')).not.toBeInTheDocument();
    expect(screen.queryByText('Deployed')).not.toBeInTheDocument();
  });

  /** A short is a position he holds and carries risk, so it counts. */
  it('uses the singular position count for one short holding', async () => {
    renderDashboard([position('LMND', -300)]);
    expect(await screen.findByText('1 position')).toBeInTheDocument();
  });

  it('shows the empty holdings count without a seed prompt', async () => {
    renderDashboard([], '/', {}, {
      totals: { marketValue: null, dayPnl: null, unrealizedPnl: null },
    });
    expect(await screen.findByText('0 positions')).toBeInTheDocument();
    expect(screen.getByText('Account value')).toBeInTheDocument();
    expect(screen.queryByText('Seed your portfolio')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset & re-seed portfolio')).not.toBeInTheDocument();
  });
});

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
    expect(screen.getByTestId('holding-NVDA')).not.toHaveTextContent('AFTER HOURS');
    expect(screen.getByText('Holdings').parentElement).toHaveTextContent('AFTER HOURS');
  });

  /**
   * Account value is priced from the same after-hours prints, and it sits
   * screens above the Holdings title. AGENTS.md: extended prices are labeled,
   * never passed off as a regular close.
   */
  it('also labels the account value when prices are extended', async () => {
    renderDashboard([position('NVDA', 1, { session: 'POST', extended: true })], '/', {}, {
      marketSession: 'POST',
      pricesAreExtended: true,
    });
    expect((await screen.findByText('Account value')).parentElement).toHaveTextContent('AFTER HOURS');
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
      // Alphabetical order (what a broken sort key degrades to) is the reverse of value order.
      position('AAA', 1, { marketValue: 10 }),
      position('ZZZ', 1, { marketValue: 1000 }),
    ]);
    await screen.findByTestId('holding-ZZZ');
    const order = screen.getAllByTestId(/^holding-/).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['holding-ZZZ', 'holding-AAA']);
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
