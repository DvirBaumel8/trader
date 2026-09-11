// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ideas } from './Ideas';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

const row = (id: string, symbol: string) => ({
  id,
  createdAt: '2026-01-05T12:00:00.000Z',
  symbol,
  entryPrice: 100,
  stop: 90,
  target: 120,
  riskReward: 2,
  preview: `thoughts on ${symbol}`,
});

function renderIdeas() {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.startsWith('/ai/trade-ideas'))
      return Promise.resolve([row('a', 'NVDA'), row('b', 'PLTR')]);
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Ideas />
    </QueryClientProvider>,
  );
}

describe('Ideas history, deleting', () => {
  /**
   * A red Delete on every row, permanently, is noise on a phone and a stray
   * tap away from losing a paid-for answer. The list reads clean until edit
   * mode is switched on — the same rule the Journal already followed.
   */
  it('offers no delete until edit mode is on', async () => {
    renderIdeas();
    await screen.findByText('NVDA');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('offers delete on every row once edit mode is on', async () => {
    const user = userEvent.setup();
    renderIdeas();
    await screen.findByText('NVDA');

    await user.click(screen.getByRole('button', { name: 'Edit ideas' }));

    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(2);
  });

  /** Two taps, always — that part was never the problem. */
  it('still confirms before deleting', async () => {
    const user = userEvent.setup();
    renderIdeas();
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit ideas' }));

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    expect(screen.getByText('Delete this idea?')).toBeInTheDocument();

    const calls = (api as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE',
    );
    expect(calls).toHaveLength(0);
  });
});
