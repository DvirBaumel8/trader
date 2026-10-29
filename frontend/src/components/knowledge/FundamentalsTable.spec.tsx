// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import type { Fundamentals } from '../../api/knowledge';
import { FundamentalsTable } from './FundamentalsTable';
import { formatMoney } from '../../lib/money';
import { NodeSheet } from './NodeSheet';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const B = 1_000_000_000;
const q = (over: Partial<Fundamentals['quarters'][number]>) => ({
  label: 'Q2 FY27',
  periodEnd: '2026-07-31',
  reportedAt: '2026-08-26T20:20:00.000Z',
  revenue: 96.2 * B,
  revenueEstimate: 92.2 * B,
  revenueSurprisePct: 4.3,
  revenueYoY: 105.3,
  eps: 2.22,
  epsEstimate: 2.09,
  epsSurprisePct: 6.2,
  fcf: 45.1 * B,
  ...over,
});
const data: Fundamentals = {
  fetchedAt: '2026-10-29T15:00:00.000Z',
  currency: 'USD',
  quarters: [
    q({}),
    q({ label: 'Q1 FY27', periodEnd: '2026-04-30', reportedAt: '2026-05-27T20:20:00.000Z', eps: 1.8, epsEstimate: 1.95, revenue: 80 * B, revenueEstimate: 80 * B, revenueYoY: -12.4, fcf: -1.5 * B }),
    q({ label: 'Q4 FY26', periodEnd: '2026-01-31', eps: 1.5, epsEstimate: null, revenue: null, revenueEstimate: 66 * B, revenueYoY: null, fcf: null }),
  ],
  next: { label: 'Q3 FY27', periodEnd: '2026-10-31', reportAt: '2026-11-17T21:20:00.000Z', epsEstimate: 2.47, revenueEstimate: 109 * B },
  cash: 62.5 * B,
  debt: 38.9 * B,
  netCash: 23.6 * B,
};

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FundamentalsTable symbol="NVDA" />
    </QueryClientProvider>,
  );

it('formats money', () => {
  expect(formatMoney(1.2e12)).toBe('$1.2T');
  expect(formatMoney(96.2e9)).toBe('$96.2B');
  expect(formatMoney(850e6)).toBe('$850M');
  expect(formatMoney(999.7e6)).toBe('$1.0B');
  expect(formatMoney(-1.5e9)).toBe('−$1.5B');
  expect(formatMoney(null)).toBe('—');
});

it('shows the next report with expectations only, then past quarters newest first', async () => {
  vi.mocked(api).mockResolvedValue(data);
  renderIt();
  const next = await screen.findByTestId('fundamentals-next');
  expect(next).toHaveTextContent('Nov 17, 2026');
  expect(next).toHaveTextContent('Q3 FY27');
  expect(next).toHaveTextContent('2.47');
  expect(next).toHaveTextContent('$109.0B');
  expect(vi.mocked(api)).toHaveBeenCalledWith('/knowledge/NVDA/fundamentals');

  const row = screen.getByTestId('fundamentals-q-2026-07-31');
  expect(row).toHaveTextContent('Aug 26, 2026');
  expect(row).toHaveTextContent('Q2 FY27');
  expect(row).toHaveTextContent('2.09');
  expect(row).toHaveTextContent('$92.2B');
  expect(row).toHaveTextContent('+105% YoY');
  const order = screen.getAllByTestId(/fundamentals-q-/).map((r) => r.getAttribute('data-testid'));
  expect(order).toEqual(['fundamentals-q-2026-07-31', 'fundamentals-q-2026-04-30', 'fundamentals-q-2026-01-31']);
});

it('colours a beat green, a miss red, and equal or unestimated plain', async () => {
  vi.mocked(api).mockResolvedValue(data);
  renderIt();
  const beat = await screen.findByTestId('fundamentals-q-2026-07-31');
  expect(within(beat).getByText('2.22')).toHaveClass('text-up');
  expect(within(beat).getByText('$96.2B')).toHaveClass('text-up');

  const mixed = screen.getByTestId('fundamentals-q-2026-04-30');
  expect(within(mixed).getByText('1.80')).toHaveClass('text-down');
  const equal = within(mixed).getAllByText('$80.0B')[1]; // expected, then actual
  expect(equal).not.toHaveClass('text-up');
  expect(equal).not.toHaveClass('text-down');
  expect(within(mixed).getByText('−12% YoY')).toBeInTheDocument();

  const none = screen.getByTestId('fundamentals-q-2026-01-31');
  expect(within(none).getByText('1.50')).not.toHaveClass('text-up');
  expect(within(none).getByText('1.50')).not.toHaveClass('text-down');
});

it('shows a dash for nulls and no YoY line without one', async () => {
  vi.mocked(api).mockResolvedValue(data);
  renderIt();
  const none = await screen.findByTestId('fundamentals-q-2026-01-31');
  // expected EPS and actual revenue are both null
  expect(within(none).getAllByText('—')).toHaveLength(2);
  expect(none).not.toHaveTextContent('YoY');
});

it('shows free cash flow, balance sheet and the update line', async () => {
  vi.mocked(api).mockResolvedValue(data);
  renderIt();
  expect(await screen.findByText('Free cash flow')).toBeInTheDocument();
  expect(screen.getByText('$45.1B')).toBeInTheDocument();
  expect(screen.getByText('−$1.5B')).toBeInTheDocument();
  expect(screen.getByTestId('fundamentals-balance')).toHaveTextContent('Cash $62.5B · Debt $38.9B · Net cash $23.6B');
  expect(screen.getByText('Updated Oct 29 · expectations: Alpha Vantage')).toBeInTheDocument();
});

it('shows a skeleton while loading', () => {
  vi.mocked(api).mockReturnValue(new Promise(() => {}));
  renderIt();
  expect(screen.getByTestId('fundamentals-loading')).toBeInTheDocument();
});

it('says so when the numbers cannot be loaded', async () => {
  vi.mocked(api).mockRejectedValue(new ApiError("Couldn't load the numbers right now.", 503));
  renderIt();
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the numbers right now.");
});

it('only fetches for a fundamentals node, not a text node', async () => {
  const base = { id: 'n', title: 'T', text: 'Made-up words.', createdAt: '2026-10-29T15:00:00.000Z', updatedAt: '2026-10-29T15:00:00.000Z' };
  const props = { symbol: 'NVDA', neighbours: [], onSelect: () => {}, onClose: () => {} };
  vi.mocked(api).mockResolvedValue(data);
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <NodeSheet {...props} node={base} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Made-up words.')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
  rerender(
    <QueryClientProvider client={client}>
      <NodeSheet {...props} node={{ ...base, type: 'fundamentals' }} />
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('fundamentals')).toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(1);
});
