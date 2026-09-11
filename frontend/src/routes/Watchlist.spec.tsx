// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  distanceToTarget: 20,
  reached: false,
  alerting: false,
  reachedOn: null,
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
  /**
   * The hit may be history: he asked to be told if the price reached his
   * target at any point since he set it, so a spike that has already pulled
   * back still counts — and the banner has to say WHEN, or the claim cannot
   * be checked against a chart.
   */
  it('names the day the target was hit, not just that it was', async () => {
    renderWatchlist([
      row({ reached: true, alerting: true, reachedOn: '2026-09-09', price: 95 }),
    ]);
    expect(await screen.findByText(/on Sep 9/)).toBeInTheDocument();
  });

  it('keeps showing a hit quietly after it is acknowledged', async () => {
    renderWatchlist([row({ reached: true, alerting: false })]);
    expect(await screen.findByText('target hit')).toBeInTheDocument();
    expect(screen.queryByText(/reached your target/i)).not.toBeInTheDocument();
  });
});

describe('Watchlist rows', () => {
  /**
   * A ticker with no target rendered as a bare symbol and a price, which
   * reads as half-loaded rather than as a deliberate state. The target stays
   * optional; it just says so.
   */
  it('says so when a ticker is watched without a target', async () => {
    renderWatchlist([row({ targetPrice: null, targetDirection: null, distanceToTarget: null })]);
    expect(await screen.findByText('no target set')).toBeInTheDocument();
  });

  it('names the company, so a row is legible without knowing the ticker', async () => {
    renderWatchlist([row({ name: 'NVIDIA' })]);
    expect(await screen.findByText('NVIDIA')).toBeInTheDocument();
  });

  /** Edit was missing entirely: the list was add-and-delete only. */
  it('offers an editor for target, tags and note in edit mode', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit watchlist' }));

    expect(screen.getByPlaceholderText('target (blank to clear)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/tags/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/why you are watching/)).toBeInTheDocument();
  });

  /** Clearing the field must REMOVE the target, not leave the old one. */
  it('sends null when the target field is emptied', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit watchlist' }));
    await user.clear(screen.getByPlaceholderText('target (blank to clear)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/watchlist' && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body).targetPrice).toBeNull();
    });
  });

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
