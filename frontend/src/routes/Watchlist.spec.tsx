// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Watchlist } from './Watchlist';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Watchlist />
    </QueryClientProvider>,
  );

it('lists watched symbols', async () => {
  vi.mocked(api).mockResolvedValue([
    { symbol: 'NVDA', name: 'Nvidia' },
    { symbol: 'AMD', name: null },
  ]);
  renderIt();
  expect(await screen.findByTestId('watch-NVDA')).toHaveTextContent('NVDA');
  expect(screen.getByTestId('watch-AMD')).toHaveTextContent('AMD');
});

it('explains an empty list', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  expect(await screen.findByText(/Nothing watched yet/)).toBeInTheDocument();
});

it('adds a symbol to the watchlist', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  await userEvent.type(await screen.findByPlaceholderText('Ticker'), 'nvda');
  await userEvent.click(screen.getByRole('button', { name: 'Watch' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/watchlist', { method: 'POST', body: JSON.stringify({ symbol: 'nvda' }) }),
  );
});

it('removes only after edit mode and a second tap', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'NVDA', name: 'Nvidia' }]);
  renderIt();
  await screen.findByTestId('watch-NVDA');
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(api).not.toHaveBeenCalledWith('/watchlist/NVDA', { method: 'DELETE' });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/watchlist/NVDA', { method: 'DELETE' }));
});
