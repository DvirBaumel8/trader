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

it('lists holdings by symbol and name, with no direction', async () => {
  vi.mocked(api).mockResolvedValue([
    { symbol: 'LMND', name: 'Lemonade' },
    { symbol: 'TSLA', name: 'Tesla' },
  ]);
  renderIt();
  expect(await screen.findByTestId('holding-LMND')).toHaveTextContent('LMNDLemonade');
  expect(screen.queryByText(/Long|Short/)).toBeNull();
});

it('explains an empty list and points at the chat', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  expect(await screen.findByText(/No holdings yet/)).toBeInTheDocument();
});

it('adds several tickers at once and summarises the result', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'POST'
      ? Promise.resolve({ added: ['GSIT', 'USAR'], already: ['NVDA'], notFound: ['XYZ'] })
      : Promise.resolve([]),
  );
  renderIt();
  const box = await screen.findByPlaceholderText('Tickers — e.g. GSIT, LMND NVDA');
  await userEvent.type(box, '1. gsit, usar; NVDA 2) xyz');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings', {
      method: 'POST',
      body: JSON.stringify({ symbols: ['gsit', 'usar', 'NVDA', 'xyz'] }),
    }),
  );
  expect(await screen.findByText("Added: GSIT, USAR · Already held: NVDA · Couldn't find: XYZ")).toBeInTheDocument();
  expect(box).toHaveValue('');
});

it('removes only after edit mode and a second tap', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(api).not.toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' }));
});

it('shows why a remove failed and returns the row to normal', async () => {
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'DELETE'
      ? Promise.reject(new Error("You don't hold LMND"))
      : Promise.resolve([{ symbol: 'LMND', name: null }]),
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

it('leaving edit mode resets a pending remove confirmation', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm remove' })).toBeNull();
});

it('keeps Add disabled and calls nothing for input with no tickers', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  await userEvent.type(await screen.findByPlaceholderText('Tickers — e.g. GSIT, LMND NVDA'), ' , ; 1.');
  expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  expect(api).not.toHaveBeenCalledWith('/holdings', expect.anything());
});
