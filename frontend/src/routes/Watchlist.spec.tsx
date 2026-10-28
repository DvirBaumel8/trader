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

it('adds several symbols and summarises the result', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'POST'
      ? Promise.resolve({ added: ['NVDA'], already: ['AMD'], notFound: ['XYZ'], full: ['TSLA'] })
      : Promise.resolve([]),
  );
  renderIt();
  const box = await screen.findByPlaceholderText('Tickers — e.g. GSIT, LMND NVDA');
  await userEvent.type(box, 'nvda, amd xyz');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/watchlist', {
      method: 'POST',
      body: JSON.stringify({ symbols: ['nvda', 'amd', 'xyz'] }),
    }),
  );
  expect(
    await screen.findByText("Added: NVDA · Already watching: AMD · Watchlist full: TSLA · Couldn't find: XYZ"),
  ).toBeInTheDocument();
  expect(box).toHaveValue('');
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

it('shows why a remove failed and returns the row to normal', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'DELETE'
      ? Promise.reject(new Error('Remove failed'))
      : Promise.resolve([{ symbol: 'NVDA', name: 'Nvidia' }]),
  );
  renderIt();
  await screen.findByTestId('watch-NVDA');
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  expect(await screen.findByText('Remove failed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
});

it('leaving edit mode resets a pending remove confirmation', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'NVDA', name: 'Nvidia' }]);
  renderIt();
  await screen.findByTestId('watch-NVDA');
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm remove' })).toBeNull();
});
