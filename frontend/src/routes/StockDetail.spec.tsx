// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockDetail } from './StockDetail';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const closedTrade = (over: Partial<Record<string, unknown>> = {}) => ({
  symbol: 'NVDA',
  direction: 'LONG',
  quantity: 10,
  remainingQuantity: 0,
  avgEntry: 200,
  avgExit: 220,
  enteredAt: '2026-09-01T14:30:00.000Z',
  exitedAt: '2026-09-02T14:30:00.000Z',
  holdingDays: 1,
  feesPaid: 8,
  realizedPnl: 192,
  isWin: true,
  isOpen: false,
  riskAmount: null,
  riskCoversFullPosition: true,
  rMultiple: null,
  ...over,
});

const summary = (over: Partial<Record<string, unknown>> = {}) => ({
  symbol: 'NVDA',
  closedCount: 1,
  openCount: 0,
  winRate: 1,
  totalPnl: 192,
  avgPositionSize: 2000,
  avgHoldingDays: 1,
  feesPaid: 8,
  trades: [closedTrade()],
  ...over,
});

/** Every test renders the AI pattern card too, so its own GET needs a
 * response distinct from the symbol summary's — a blanket mock would hand
 * it the wrong shape and silently mask a wiring bug behind the card's own
 * "unconfigured" fallback. */
function mockApiFor(symbolSummary: unknown) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.startsWith('/ai/symbol-patterns/')) return Promise.resolve(null);
    return Promise.resolve(symbolSummary);
  });
}

function renderStockDetail(path = '/stocks/NVDA') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/stocks/:symbol" element={<StockDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StockDetail', () => {
  it('shows the summary tiles and the trade list for the default all-time window', async () => {
    mockApiFor(summary());
    renderStockDetail();

    expect(await screen.findByRole('heading', { name: 'NVDA' })).toBeInTheDocument();
    expect(screen.getByText('Total P&L').nextElementSibling).toHaveTextContent(
      '+$192.00',
    );
    expect(screen.getByText('Avg position').nextElementSibling).toHaveTextContent(
      '$2,000.00',
    );
    expect(screen.getByText('Avg hold (days)').nextElementSibling).toHaveTextContent('1.0d');
    expect(screen.getByText('Fees paid').nextElementSibling).toHaveTextContent(
      '$8.00',
    );
  });

  it('offers the AI pattern read below the summary tiles', async () => {
    mockApiFor(summary());
    renderStockDetail();

    expect(
      await screen.findByRole('button', { name: 'Read My Pattern' }),
    ).toBeInTheDocument();
  });

  it('refetches for a different period when the range picker is used', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith('/ai/symbol-patterns/')) return Promise.resolve(null);
      if (path.includes('range=1M')) {
        return Promise.resolve(
          summary({ trades: [closedTrade({ symbol: 'NVDA', realizedPnl: -30 })], totalPnl: -30 }),
        );
      }
      return Promise.resolve(summary());
    });
    const user = userEvent.setup();
    renderStockDetail();

    await screen.findByRole('heading', { name: 'NVDA' });
    await user.click(screen.getByRole('button', { name: '1M' }));

    await waitFor(() => {
      expect(screen.getByText('Total P&L').nextElementSibling).toHaveTextContent(
        '-$30.00',
      );
    });
  });

  it('says plainly when nothing closed in a narrower window', async () => {
    mockApiFor(summary({ closedCount: 0, trades: [], totalPnl: null }));
    renderStockDetail();

    expect(
      await screen.findByText('No trades closed in this period.'),
    ).toBeInTheDocument();
  });

  it('offers a way back when the ticker has no trades at all', async () => {
    const { ApiError } = await vi.importActual<typeof import('../api/client')>(
      '../api/client',
    );
    (api as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('Unknown ticker', 404),
    );
    renderStockDetail('/stocks/ZZZZNOTREAL');

    expect(
      await screen.findByText(/No trades in ZZZZNOTREAL at all/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
