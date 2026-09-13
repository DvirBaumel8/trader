// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  symbol: 'NVDA',
  closedCount: 3,
  totalPnl: 450,
  feesPaid: 12,
  latestExit: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('Stocks', () => {
  it('says so when nothing has ever closed, at the default all-time window', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderStocks();
    expect(
      await screen.findByText(/No closed trades yet/),
    ).toBeInTheDocument();
  });

  it('lists each symbol with its closed count, fees and total P&L as columns under one header', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ symbol: 'NVDA', closedCount: 3, totalPnl: 450, feesPaid: 12 }),
      row({ symbol: 'LMND', closedCount: 1, totalPnl: -20, feesPaid: 4 }),
    ]);
    renderStocks();

    // "Closed" and "Fees" are named once, in the header — not repeated
    // as a word on every row.
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Fees')).toBeInTheDocument();
    expect(screen.queryAllByText(/closed/i)).toHaveLength(1);

    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('+$450.00')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expect(screen.getByText('LMND')).toBeInTheDocument();
    expect(screen.getByText('-$20.00')).toBeInTheDocument();
    expect(screen.getByText('$4.00')).toBeInTheDocument();
  });

  it('keeps the header and every row in one shared grid, so columns cannot drift row to row', async () => {
    // A header and each row built as SEPARATE grids each auto-size their
    // columns from their own content only — this is what let the header
    // line up with one row's figures and drift from the next the moment
    // fee/P&L strings differed in width. Sharing one parent grid element is
    // what makes the browser size every column from the widest value across
    // the whole table, header included.
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ symbol: 'NVDA', totalPnl: 450, feesPaid: 12 }),
      row({ symbol: 'LMND', totalPnl: -20, feesPaid: 4 }),
    ]);
    renderStocks();

    // A row's own <a> is `display: contents`, which the browser skips when
    // building the grid's box tree — its cells become items of whichever
    // grid ancestor is next, exactly like the header's. `.closest('.grid')`
    // walks the DOM the same way, so this is true precisely when the fix
    // holds: one grid, not one link-shaped grid per row.
    const header = await screen.findByText('Closed');
    const firstRowCell = screen.getByText('NVDA');
    const secondRowCell = screen.getByText('LMND');
    expect(header.closest('.grid')).toBe(firstRowCell.closest('.grid'));
    expect(header.closest('.grid')).toBe(secondRowCell.closest('.grid'));
  });

  it('links each row to its symbol page', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([row()]);
    renderStocks();

    const link = (await screen.findByText('NVDA')).closest('a');
    expect(link).toHaveAttribute('href', '/stocks/NVDA');
  });

  it('refetches with the picked range and shows the narrower result', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes('range=1M')) return Promise.resolve([]);
      return Promise.resolve([row()]);
    });
    const user = userEvent.setup();
    renderStocks();

    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: '1M' }));

    expect(
      await screen.findByText('No trades closed in this period.'),
    ).toBeInTheDocument();
  });

  it('reorders the list by the picked sort', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ symbol: 'SMALL', totalPnl: 50, latestExit: '2026-09-01T00:00:00.000Z' }),
      row({ symbol: 'BIG', totalPnl: 900, latestExit: '2026-08-01T00:00:00.000Z' }),
    ]);
    const user = userEvent.setup();
    renderStocks();

    await screen.findByText('SMALL');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'LARGEST');

    const symbols = screen.getAllByText(/^(SMALL|BIG)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['BIG', 'SMALL']);
  });

  it('reorders the list by fees paid', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ symbol: 'LOW', feesPaid: 4 }),
      row({ symbol: 'HIGH', feesPaid: 40 }),
    ]);
    const user = userEvent.setup();
    renderStocks();

    await screen.findByText('LOW');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'FEES_HIGH');

    const symbols = screen.getAllByText(/^(LOW|HIGH)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['HIGH', 'LOW']);
  });

  it('reorders the list by number of trades', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ symbol: 'FEW', closedCount: 1 }),
      row({ symbol: 'MANY', closedCount: 10 }),
    ]);
    const user = userEvent.setup();
    renderStocks();

    await screen.findByText('FEW');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'TRADES_MOST');

    const symbols = screen.getAllByText(/^(FEW|MANY)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['MANY', 'FEW']);
  });
});
