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

const reorderMock = (failWith?: string) =>
  vi.mocked(api).mockImplementation((_path: string, opts?: { method?: string }) =>
    opts?.method === 'PUT'
      ? failWith
        ? Promise.reject(new Error(failWith))
        : Promise.resolve([])
      : Promise.resolve([{ symbol: 'LMND', name: 'Lemonade' }, { symbol: 'TSLA', name: 'Tesla' }]),
  );
const symbols = () => screen.getAllByTestId(/^holding-/).map((el) => el.getAttribute('data-testid')!.slice(8));
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
  await screen.findByTestId('holding-LMND');
  expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  expect(screen.getByRole('button', { name: 'Reorder LMND' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reorder TSLA' })).toBeInTheDocument();
});

it('saves a keyboard reorder as the full new sequence', async () => {
  reorderMock();
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await moveDown('LMND');
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/order', {
      method: 'PUT',
      body: JSON.stringify({ symbols: ['TSLA', 'LMND'] }),
    }),
  );
});

it('puts the rows back and says why when saving the order fails', async () => {
  reorderMock('Unknown symbol in order: LMND');
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await moveDown('LMND');
  expect(await screen.findByText('Unknown symbol in order: LMND')).toBeInTheDocument();
  await waitFor(() => expect(symbols()).toEqual(['LMND', 'TSLA']));
});

const movesApi = (moves: unknown[]) =>
  vi.mocked(api).mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/market/moves') ? moves : [{ symbol: 'LMND', name: 'Lemonade' }, { symbol: 'TSLA', name: 'Tesla' }]),
  );
const movesCalls = () => vi.mocked(api).mock.calls.filter(([p]) => String(p).startsWith('/market/moves'));

it('shows no ATR columns and fetches no moves until Show ATR is on', async () => {
  window.localStorage.clear();
  movesApi([]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  expect(screen.getByRole('button', { name: 'Show ATR' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText('Ticker')).toBeNull();
  expect(screen.queryByTestId('atr-LMND')).toBeNull();
  expect(movesCalls()).toHaveLength(0);
});

it('Show ATR adds the columns, colours big moves, and is remembered', async () => {
  window.localStorage.clear();
  movesApi([
    { symbol: 'LMND', atrPercent: 3.2, movePercent: 4.1, live: false, asOf: '2026-10-28' },
    { symbol: 'TSLA', atrPercent: null, movePercent: null, live: false, asOf: '2026-10-28' },
  ]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Show ATR' }));
  expect(await screen.findByTestId('atr-LMND')).toHaveTextContent('3.2%');
  expect(screen.getByTestId('today-LMND')).toHaveTextContent('+4.1%');
  expect(screen.getByTestId('today-LMND')).toHaveClass('text-up');
  expect(screen.getByTestId('today-TSLA')).toHaveTextContent('—');
  expect(screen.getByText('Today (close)')).toBeInTheDocument();
  expect(movesCalls()[0][0]).toBe('/market/moves?symbols=LMND,TSLA');
  expect(screen.getByRole('button', { name: 'Hide ATR' })).toHaveAttribute('aria-pressed', 'true');

  cleanup();
  renderIt();
  expect(await screen.findByTestId('atr-LMND')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hide ATR' }));
  expect(screen.queryByTestId('atr-LMND')).toBeNull();
});

it('hides the ATR columns and header while editing, and restores them after', async () => {
  window.localStorage.clear();
  vi.mocked(api).mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith('/market/moves')
        ? [{ symbol: 'LMND', atrPercent: 3, movePercent: 5, live: true, asOf: '2026-10-29' }]
        : [{ symbol: 'LMND', name: 'X' }],
    ),
  );
  renderIt();
  await userEvent.click(await screen.findByRole('button', { name: 'Show ATR' }));
  expect(await screen.findByTestId('today-LMND')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  expect(screen.queryByTestId('atr-LMND')).toBeNull();
  expect(screen.queryByTestId('today-LMND')).toBeNull();
  expect(screen.queryByTestId('moves-header')).toBeNull();
  expect(screen.getByRole('button', { name: 'Hide ATR' })).toBeInTheDocument();
  expect(screen.getByText('LMND')).not.toHaveClass('text-up');
  await userEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.getByTestId('today-LMND')).toBeInTheDocument();
  expect(screen.getByTestId('moves-header')).toBeInTheDocument();
});

it('keeps the bulk-add placeholder in normal case', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  const box = await screen.findByPlaceholderText('Tickers — e.g. GSIT, LMND NVDA');
  expect(box.className).toContain('placeholder:normal-case');
});
