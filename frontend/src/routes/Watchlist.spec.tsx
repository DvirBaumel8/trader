// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Watchlist } from './Watchlist';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'w1',
  symbol: 'NVDA',
  name: 'NVIDIA',
  price: 100,
  stale: false,
  targetPrice: 120,
  targetDirection: 'ABOVE',
  distancePercent: 20,
  reached: false,
  alerting: false,
  note: '',
  tags: [],
  ...over,
});

function renderWatchlist(rows: ReturnType<typeof row>[]) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/watchlist') return Promise.resolve(rows);
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Watchlist />
    </QueryClientProvider>,
  );
}

describe('Watchlist target alerts', () => {
  /** The feature he called super important: tell me what hit, when I arrive. */
  it('announces a ticker that reached its target', async () => {
    renderWatchlist([row({ reached: true, alerting: true, price: 121 })]);
    expect(
      await screen.findByText(/A ticker reached your target/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/rose to/)).toBeInTheDocument();
  });

  it('says which way it went for a wait-for-the-dip target', async () => {
    renderWatchlist([
      row({ reached: true, alerting: true, targetDirection: 'BELOW', price: 79 }),
    ]);
    expect(await screen.findByText(/fell to/)).toBeInTheDocument();
  });

  it('stays quiet about a target still out of reach', async () => {
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    expect(screen.queryByText(/reached your target/i)).not.toBeInTheDocument();
  });

  /** Hit but acknowledged: the row still says so, the banner does not shout. */
  it('keeps showing a hit quietly after it is acknowledged', async () => {
    renderWatchlist([row({ reached: true, alerting: false })]);
    expect(await screen.findByText('target hit')).toBeInTheDocument();
    expect(screen.queryByText(/reached your target/i)).not.toBeInTheDocument();
  });
});

describe('Watchlist rows', () => {
  it('shows how far the price still has to travel', async () => {
    renderWatchlist([row()]);
    expect(await screen.findByText(/away/)).toBeInTheDocument();
  });

  /** Same rule as every other list in the app — delete is never ambient. */
  it('offers no delete until edit mode is on', async () => {
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();

    await userEvent.setup().click(
      screen.getByRole('button', { name: 'Edit watchlist' }),
    );
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('filters by a tag when one is picked', async () => {
    const user = userEvent.setup();
    renderWatchlist([
      row({ id: 'a', symbol: 'NVDA', tags: [{ id: 't1', label: 'semis' }] }),
      row({ id: 'b', symbol: 'LMND', tags: [{ id: 't2', label: 'insurtech' }] }),
    ]);
    await screen.findByText('NVDA');

    await user.click(screen.getByRole('button', { name: 'semis' }));

    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('LMND')).not.toBeInTheDocument();
  });
});
