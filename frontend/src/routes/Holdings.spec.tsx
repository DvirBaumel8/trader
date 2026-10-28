// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Holdings } from './Holdings';

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
      <Holdings />
    </QueryClientProvider>,
  );

it('lists holdings with their direction', async () => {
  vi.mocked(api).mockResolvedValue([
    { symbol: 'LMND', name: 'Lemonade', direction: 'LONG' },
    { symbol: 'TSLA', name: 'Tesla', direction: 'SHORT' },
  ]);
  renderIt();
  expect(await screen.findByTestId('holding-LMND')).toHaveTextContent('Long');
  expect(screen.getByTestId('holding-TSLA')).toHaveTextContent('Short');
});

it('explains an empty list and points at the chat', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  expect(await screen.findByText(/No holdings yet/)).toBeInTheDocument();
});

it('adds a holding as long or short', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  await userEvent.type(await screen.findByPlaceholderText('Ticker'), 'lmnd');
  await userEvent.click(screen.getByRole('button', { name: 'Add short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
});

it('removes only after edit mode and a second tap', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null, direction: 'LONG' }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(api).not.toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' }));
});

it('flips direction in edit mode', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null, direction: 'LONG' }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Flip to short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
});

it('shows why a remove failed and returns the row to normal', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'DELETE'
      ? Promise.reject(new Error("You don't hold LMND"))
      : Promise.resolve([{ symbol: 'LMND', name: null, direction: 'LONG' }]),
  );
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  expect(await screen.findByText("You don't hold LMND")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm remove' })).toBeNull();
});

it('shows why a flip failed', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'PUT'
      ? Promise.reject(new Error('Flip failed'))
      : Promise.resolve([{ symbol: 'LMND', name: null, direction: 'LONG' }]),
  );
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Flip to short' }));
  expect(await screen.findByText('Flip failed')).toBeInTheDocument();
});

it('leaving edit mode resets a pending remove confirmation', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null, direction: 'LONG' }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm remove' })).toBeNull();
});
