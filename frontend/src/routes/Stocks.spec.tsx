// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stocks } from './Stocks';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderStocks() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Stocks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Stocks', () => {
  it('says so when nothing has ever closed', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderStocks();
    expect(
      await screen.findByText(/No closed trades yet/),
    ).toBeInTheDocument();
  });

  it('lists each symbol with its closed count and total P&L', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      { symbol: 'NVDA', closedCount: 3, totalPnl: 450 },
      { symbol: 'LMND', closedCount: 1, totalPnl: -20 },
    ]);
    renderStocks();

    expect(await screen.findByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('3 closed')).toBeInTheDocument();
    expect(screen.getByText('+$450.00')).toBeInTheDocument();
    expect(screen.getByText('LMND')).toBeInTheDocument();
    expect(screen.getByText('-$20.00')).toBeInTheDocument();
  });

  it('links each row to its symbol page', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      { symbol: 'NVDA', closedCount: 3, totalPnl: 450 },
    ]);
    renderStocks();

    const link = (await screen.findByText('NVDA')).closest('a');
    expect(link).toHaveAttribute('href', '/stocks/NVDA');
  });
});
