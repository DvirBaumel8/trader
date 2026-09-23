// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Stops } from './Stops';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const basePosition = (symbol: string) => ({
  symbol,
  quantity: 100,
  price: 110,
  stale: false,
  session: 'REGULAR' as const,
  extended: false,
  marketValue: 11000,
  tradeId: null,
});

function renderStops(portfolio: {
  positions: ReturnType<typeof basePosition>[];
  accountValue: number;
  atRisk: {
    amount: number;
    positionsWithoutStop: { count: number; symbols: string[] };
    positionsWithPartialStop: {
      count: number;
      positions: { symbol: string; coveredQuantity: number; heldQuantity: number }[];
    };
  };
  stopTiers: unknown[];
}) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/portfolio') return Promise.resolve(portfolio);
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Stops />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Stops page — partial coverage', () => {
  it('flags a position whose stop covers only part of it', async () => {
    renderStops({
      positions: [basePosition('NVDA')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 0, symbols: [] },
        positionsWithPartialStop: {
          count: 1,
          positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
        },
      },
      stopTiers: [],
    });

    expect(await screen.findByText(/partial stop/i)).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText(/40 of 100 sh covered/i)).toBeInTheDocument();
    expect(screen.getByText(/60 sh unprotected/i)).toBeInTheDocument();
  });

  it('says nothing about partial stops when every plan is fully covered', async () => {
    renderStops({
      positions: [basePosition('NVDA')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 0, symbols: [] },
        positionsWithPartialStop: { count: 0, positions: [] },
      },
      stopTiers: [],
    });

    await screen.findByText('No stops recorded yet.');
    expect(screen.queryByText(/partial stop/i)).not.toBeInTheDocument();
  });

  it('shows both the no-stop and partial-stop sections together when both apply', async () => {
    renderStops({
      positions: [basePosition('NVDA'), basePosition('PLTR')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 1, symbols: ['PLTR'] },
        positionsWithPartialStop: {
          count: 1,
          positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
        },
      },
      stopTiers: [],
    });

    expect(await screen.findByText(/no stop ·/i)).toBeInTheDocument();
    expect(screen.getByText(/partial stop ·/i)).toBeInTheDocument();
  });
});
