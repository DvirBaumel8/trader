// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DailyBrief } from './DailyBrief';

vi.mock('../api/client', () => ({
  api: vi.fn(() => Promise.resolve({
    generatedAt: '2026-09-16T08:00:00.000Z',
    refreshAfterSeconds: 300,
    notes: [
      { kind: 'MOMENTUM', source: 'PORTFOLIO', symbol: 'NVDA', title: 'NVDA has good momentum', detail: 'Above rising trend averages.' },
      { kind: 'BREAKOUT', source: 'WATCHLIST', symbol: 'PLTR', title: 'PLTR confirmed a breakout', detail: 'Closed above its prior 20-day high.' },
      { kind: 'ECONOMIC', source: 'MARKET', symbol: null, title: 'CPI', detail: '3.1 actual vs 3.2 expected.' },
    ],
  })),
}));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('DailyBrief', () => {
  it('separates portfolio, watchlist, and market notes', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DailyBrief />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('NVDA has good momentum')).toBeInTheDocument();
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
    expect(screen.getByText('Watchlist')).toBeInTheDocument();
    expect(screen.getByText('Market')).toBeInTheDocument();
    expect(screen.getByText('3.1 actual vs 3.2 expected.')).toBeInTheDocument();
  });
});
