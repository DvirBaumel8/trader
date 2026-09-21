// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WatchlistRanking } from './WatchlistRanking';

vi.mock('../api/client', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderRanking() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WatchlistRanking hasTickers />
    </QueryClientProvider>,
  );
}

function ranking(overrides: { rankedAt: string | null }) {
  return {
    configured: true,
    rankedAt: overrides.rankedAt,
    model: 'stub-model',
    order: [{ symbol: 'NVDA', verdict: 'Stub verdict.', coverage: 'full' as const }],
    reasoning: 'Stub reasoning.',
    missing: [],
    stale: false,
  };
}

describe('WatchlistRanking auto-refresh', () => {
  it('refreshes automatically when the stored ranking is not from today', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const refreshed = ranking({ rankedAt: new Date().toISOString() });
    let refreshCalls = 0;
    (api as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === '/watchlist/ranking' && !init) {
          return Promise.resolve(ranking({ rankedAt: yesterday }));
        }
        if (path === '/watchlist/ranking/refresh' && init?.method === 'POST') {
          refreshCalls++;
          return Promise.resolve(refreshed);
        }
        return Promise.resolve(ranking({ rankedAt: yesterday }));
      },
    );

    renderRanking();

    await waitFor(() => expect(refreshCalls).toBe(1));
  });

  it('does not pop open the reasoning card for an automatic refresh — nobody asked', async () => {
    // The exact regression this guards: an automatic refresh sharing the
    // manual button's mutation must not also share its "open the reasoning"
    // side effect, or opening the page would yank open a card the owner
    // never asked to see.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const refreshed = ranking({
      rankedAt: new Date().toISOString(),
      reasoning: 'Freshly auto-refreshed reasoning.',
    });
    (api as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === '/watchlist/ranking' && !init) {
          return Promise.resolve(ranking({ rankedAt: yesterday }));
        }
        if (path === '/watchlist/ranking/refresh' && init?.method === 'POST') {
          return Promise.resolve(refreshed);
        }
        return Promise.resolve(ranking({ rankedAt: yesterday }));
      },
    );

    renderRanking();

    await screen.findByText('NVDA');
    await waitFor(() =>
      expect(screen.getByText(/ranked just now/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText('Freshly auto-refreshed reasoning.'),
    ).not.toBeInTheDocument();
  });

  it('does not refresh automatically when the stored ranking is already from today', async () => {
    const today = new Date().toISOString();
    let refreshCalls = 0;
    (api as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === '/watchlist/ranking' && !init) {
          return Promise.resolve(ranking({ rankedAt: today }));
        }
        if (path === '/watchlist/ranking/refresh' && init?.method === 'POST') {
          refreshCalls++;
        }
        return Promise.resolve(ranking({ rankedAt: today }));
      },
    );

    renderRanking();

    await screen.findByText('NVDA');
    expect(refreshCalls).toBe(0);
  });
});
