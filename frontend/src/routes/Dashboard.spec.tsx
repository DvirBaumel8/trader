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

const position = (symbol: string, quantity: number) => ({
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

describe('Dashboard earnings column', () => {
  it('shows days until earnings for a holding', async () => {
    renderDashboard([{ ...position('NVDA', 100), daysUntilEarnings: 7 }]);
    expect(await screen.findByText('7d')).toBeInTheDocument();
  });
});

describe('Dashboard holdings table', () => {
  it('shows aligned column headers for holdings', async () => {
    renderDashboard([position('NVDA', 100)]);
    expect(await screen.findByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Qty / Avg')).toBeInTheDocument();
    expect(screen.getByText('Market value')).toBeInTheDocument();
    expect(screen.getByText('P&L')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();
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

function renderDashboard(positions: ReturnType<typeof position>[]) {
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
      <MemoryRouter>
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

  /**
   * There is no zero case to show: an empty portfolio short-circuits to the
   * seed prompt before the tiles render at all. Pinned here so the count is
   * never "fixed" later by reaching for a 0 that has nowhere to appear.
   */
  it('has no tiles to count in when the portfolio is empty', async () => {
    renderDashboard([]);
    expect(await screen.findByText('Seed your portfolio')).toBeInTheDocument();
    expect(screen.queryByText(/position$/i)).not.toBeInTheDocument();
  });
});
