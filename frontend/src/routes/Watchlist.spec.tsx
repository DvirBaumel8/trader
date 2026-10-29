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

const reorderMock = (failWith?: string) =>
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'PUT'
      ? failWith
        ? Promise.reject(new Error(failWith))
        : Promise.resolve([])
      : Promise.resolve([{ symbol: 'LMND', name: 'Lemonade' }, { symbol: 'TSLA', name: 'Tesla' }]),
  );
const symbols = () => screen.getAllByTestId(/^watch-/).map((el) => el.getAttribute('data-testid')!.slice(6));
// jsdom has no layout; give each row a distinct box so dnd-kit can find its neighbour.
const layoutRows = () => {
  const rows = screen.getAllByTestId(/^(holding|watch)-/);
  rows.forEach((el, i) => {
    const rect = { x: 0, y: i * 50, top: i * 50, bottom: i * 50 + 50, left: 0, right: 300, width: 300, height: 50 };
    el.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  });
};
const moveDown = async (symbol: string) => {
  layoutRows();
  screen.getByRole('button', { name: `Reorder ${symbol}` }).focus();
  await userEvent.keyboard(' ');
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard(' ');
};

it('shows drag handles only in edit mode', async () => {
  reorderMock();
  renderIt();
  await screen.findByTestId('watch-LMND');
  expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  expect(screen.getByRole('button', { name: 'Reorder LMND' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reorder TSLA' })).toBeInTheDocument();
});

it('saves a keyboard reorder as the full new sequence', async () => {
  reorderMock();
  renderIt();
  await screen.findByTestId('watch-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  await moveDown('LMND');
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/watchlist/order', {
      method: 'PUT',
      body: JSON.stringify({ symbols: ['TSLA', 'LMND'] }),
    }),
  );
});

it('puts the rows back and says why when saving the order fails', async () => {
  reorderMock('Unknown symbol in order: LMND');
  renderIt();
  await screen.findByTestId('watch-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  await moveDown('LMND');
  expect(await screen.findByText('Unknown symbol in order: LMND')).toBeInTheDocument();
  await waitFor(() => expect(symbols()).toEqual(['LMND', 'TSLA']));
});

it('Show ATR adds the columns on the watchlist and is remembered', async () => {
  window.localStorage.clear();
  vi.mocked(api).mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith('/market/moves')
        ? [{ symbol: 'NVDA', atrPercent: 3, movePercent: -3.5, live: true, asOf: '2026-10-29' }]
        : [{ symbol: 'NVDA', name: 'Nvidia' }],
    ),
  );
  renderIt();
  await screen.findByTestId('watch-NVDA');
  expect(vi.mocked(api).mock.calls.some(([p]) => String(p).startsWith('/market/moves'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Show ATR' }));
  expect(await screen.findByTestId('today-NVDA')).toHaveTextContent('−3.5%');
  expect(screen.getByTestId('today-NVDA')).toHaveClass('text-down');
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(window.localStorage.getItem('trader.watchlist.atr.v1')).toContain('true');
});

it('hides the ATR columns and header while editing, and restores them after', async () => {
  window.localStorage.clear();
  vi.mocked(api).mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith('/market/moves')
        ? [{ symbol: 'NVDA', atrPercent: 3, movePercent: 5, live: true, asOf: '2026-10-29' }]
        : [{ symbol: 'NVDA', name: 'X' }],
    ),
  );
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'Show ATR' }));
  expect(await screen.findByTestId('today-NVDA')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit watchlist' }));
  expect(screen.queryByTestId('atr-NVDA')).toBeNull();
  expect(screen.queryByTestId('today-NVDA')).toBeNull();
  expect(screen.queryByTestId('moves-header')).toBeNull();
  expect(screen.getByRole('button', { name: 'Hide ATR' })).toBeInTheDocument();
  expect(screen.getByText('NVDA')).not.toHaveClass('text-up');
  await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.getByTestId('today-NVDA')).toBeInTheDocument();
  expect(screen.getByTestId('moves-header')).toBeInTheDocument();
});

it('keeps the bulk-add placeholder in normal case', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  const box = await screen.findByPlaceholderText('Tickers — e.g. GSIT, LMND NVDA');
  expect(box.className).toContain('placeholder:normal-case');
});
