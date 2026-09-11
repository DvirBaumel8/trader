// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
  it('counts the tickers held', async () => {
    renderDashboard([
      position('NVDA', 100),
      position('PLTR', 50),
      position('LMND', -300),
    ]);
    const tile = (await screen.findByText('Positions')).parentElement!;
    expect(tile).toHaveTextContent('3');
  });

  /** A short is a position he holds and carries risk, so it counts. */
  it('counts a short the same as a long', async () => {
    renderDashboard([position('LMND', -300)]);
    const tile = (await screen.findByText('Positions')).parentElement!;
    expect(tile).toHaveTextContent('1');
  });

  /**
   * There is no zero case to show: an empty portfolio short-circuits to the
   * seed prompt before the tiles render at all. Pinned here so the count is
   * never "fixed" later by reaching for a 0 that has nowhere to appear.
   */
  it('has no tiles to count in when the portfolio is empty', async () => {
    renderDashboard([]);
    expect(await screen.findByText('Seed your portfolio')).toBeInTheDocument();
    expect(screen.queryByText('Positions')).not.toBeInTheDocument();
  });
});
