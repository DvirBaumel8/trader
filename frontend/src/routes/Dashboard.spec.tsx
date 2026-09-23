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
  tradeId: null,
  daysUntilEarnings: null,
});
const position = (
  symbol: string,
  quantity: number,
  overrides: Partial<ReturnType<typeof basePosition>> = {},
) => ({ ...basePosition(symbol, quantity), ...overrides });

describe('Dashboard earnings column', () => {
  it('shows days until earnings for a holding', async () => {
    renderDashboard([{ ...position('NVDA', 100), daysUntilEarnings: 7 }]);
    expect(await screen.findByText('7d')).toBeInTheDocument();
  });
});

describe('Dashboard holdings table', () => {
  it('labels an after-hours holding price in the phone row', async () => {
    renderDashboard([position('NVDA', 1, { session: 'POST', extended: true })]);
    expect(await screen.findByTestId('holding-NVDA')).toHaveTextContent('AFTER HOURS');
  });

  it('renders market value, return, and earnings together in a phone holding row', async () => {
    renderDashboard([
      position('AAPL', 1, {
        price: 332.47,
        marketValue: 332.47,
        unrealizedPnl: 132.47,
        unrealizedPct: 0.6624,
        daysUntilEarnings: 43,
      }),
    ]);

    const holding = await screen.findByTestId('holding-AAPL');
    expect(holding).toHaveTextContent('$332.47');
    expect(holding).toHaveTextContent('+66.24%');
    expect(holding).toHaveTextContent('+$132.47');
    expect(holding).toHaveTextContent('43d');
  });

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

  it('shows aligned column headers for holdings', async () => {
    renderDashboard([position('NVDA', 100)]);
    expect(await screen.findByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Qty / Avg')).toBeInTheDocument();
    expect(screen.getByText('Market value')).toBeInTheDocument();
    expect(screen.getByText('P&L')).toBeInTheDocument();
    expect(screen.getByText('Earnings', { selector: 'span.hidden' })).toBeInTheDocument();
  });

  it('sorts by soonest earnings, sinking a ticker with none (an ETF) to the end', async () => {
    renderDashboard([
      position('LATE', 1, { daysUntilEarnings: 30 }),
      position('ETF', 1, { daysUntilEarnings: null }),
      position('SOON', 1, { daysUntilEarnings: 2 }),
    ]);
    const user = userEvent.setup();

    await screen.findByText('SOON');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort holdings' }),
      'daysUntilEarnings:asc',
    );

    const rows = screen
      .getAllByTestId(/^holding-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['holding-SOON', 'holding-LATE', 'holding-ETF']);
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

function renderDashboard(positions: ReturnType<typeof position>[], initialPath = '/') {
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
        },
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
    renderDashboard([]);
    expect(await screen.findByText('0 positions')).toBeInTheDocument();
    expect(screen.getByText('Account value')).toBeInTheDocument();
    expect(screen.queryByText('Seed your portfolio')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset & re-seed portfolio')).not.toBeInTheDocument();
  });
});
