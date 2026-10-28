// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Earnings } from './Earnings';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(cleanup);

const week = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-11-02',
  weekEnd: '2026-11-06',
  today: '2026-11-03',
  days: [
    { date: '2026-11-02', entries: [] },
    {
      date: '2026-11-03',
      entries: [
        { symbol: 'AMD', source: 'holding', timing: 'before_open', estimated: false },
        { symbol: 'SMCI', source: 'watchlist', timing: 'after_close', estimated: true },
      ],
    },
    { date: '2026-11-04', entries: [{ symbol: 'UBER', source: 'watchlist', timing: 'during', estimated: false }] },
    { date: '2026-11-05', entries: [{ symbol: 'XYZ', source: 'holding', timing: 'unknown', estimated: false }] },
    { date: '2026-11-06', entries: [] },
  ],
  upcoming: [
    { symbol: 'AMD', source: 'holding', date: '2026-11-03', daysUntil: 0, estimated: false },
    { symbol: 'UBER', source: 'watchlist', date: '2026-11-04', daysUntil: 1, estimated: false },
    { symbol: 'SMCI', source: 'watchlist', date: '2026-11-10', daysUntil: 7, estimated: true },
    { symbol: 'ABC', source: 'holding', date: '2026-11-05', daysUntil: 2, estimated: false },
    { symbol: 'NODATE', source: 'holding', date: null, daysUntil: null, estimated: false },
  ],
  ...over,
});

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Earnings />
    </QueryClientProvider>,
  );

it('titles the page with the week range and shows day headers', async () => {
  vi.mocked(api).mockResolvedValue(week());
  renderIt();
  expect(await screen.findByRole('heading', { name: 'Earnings · Nov 2 – Nov 6' })).toBeInTheDocument();
  expect(screen.getByText('Mon 2')).toBeInTheDocument();
  expect(screen.getByText('Fri 6')).toBeInTheDocument();
});

it('draws timing icons, source marks and the estimated tilde', async () => {
  vi.mocked(api).mockResolvedValue(week());
  renderIt();
  const amd = await screen.findByTestId('earn-AMD');
  expect(amd).toHaveTextContent('AMD');
  expect(amd).toHaveTextContent('☀');
  expect(amd).toHaveTextContent('●');
  const smci = screen.getByTestId('earn-SMCI');
  expect(smci).toHaveTextContent('~SMCI');
  expect(smci).toHaveTextContent('🌙');
  expect(smci).toHaveTextContent('○');
  expect(screen.getByTestId('earn-UBER')).toHaveTextContent('•');
  const xyz = screen.getByTestId('earn-XYZ');
  expect(xyz).not.toHaveTextContent(/[☀🌙•]/u);
  expect(screen.getByText('☀ before open · 🌙 after close · ● holding · ○ watchlist · ~ estimated date')).toBeInTheDocument();
});

it('Holdings hides watchlist entries and Watchlist hides holdings', async () => {
  vi.mocked(api).mockResolvedValue(week());
  renderIt();
  await screen.findByTestId('earn-AMD');
  expect(screen.getByRole('button', { name: 'Both' })).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: 'Holdings' }));
  expect(screen.getByRole('button', { name: 'Holdings' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('earn-AMD')).toBeInTheDocument();
  expect(screen.queryByTestId('earn-SMCI')).toBeNull();
  expect(screen.queryByTestId('next-SMCI')).toBeNull();
  expect(screen.getByTestId('next-AMD')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Watchlist' }));
  expect(screen.queryByTestId('earn-AMD')).toBeNull();
  expect(screen.queryByTestId('next-AMD')).toBeNull();
  expect(screen.getByTestId('earn-SMCI')).toBeInTheDocument();
});

it('remembers the filter', async () => {
  vi.mocked(api).mockResolvedValue(week());
  const first = renderIt();
  await screen.findByTestId('earn-AMD');
  await userEvent.click(screen.getByRole('button', { name: 'Holdings' }));
  expect(JSON.parse(window.localStorage.getItem('trader.earnings.filter.v1')!).v).toBe('holdings');
  first.unmount();
  renderIt();
  await screen.findByTestId('earn-AMD');
  expect(screen.getByRole('button', { name: 'Holdings' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByTestId('earn-SMCI')).toBeNull();
});

it('explains an empty week per filter', async () => {
  const empty = week({
    days: week().days.map((d) => ({ ...d, entries: [] })),
  });
  vi.mocked(api).mockResolvedValue(empty);
  renderIt();
  expect(await screen.findByText('No earnings this week for your holdings or watchlist.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Holdings' }));
  expect(screen.getByText('No earnings this week for your holdings.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Watchlist' }));
  expect(screen.getByText('No earnings this week for your watchlist.')).toBeInTheDocument();
});

it('shows an error message', async () => {
  vi.mocked(api).mockRejectedValue(new Error('boom'));
  renderIt();
  expect(await screen.findByText('Couldn’t load earnings dates right now.')).toBeInTheDocument();
});

it('Next earnings words days as today / 1 day / N days and dashes for no date', async () => {
  vi.mocked(api).mockResolvedValue(week());
  renderIt();
  expect(await screen.findByRole('heading', { name: 'Next earnings' })).toBeInTheDocument();
  const amd = screen.getByTestId('next-AMD');
  expect(amd).toHaveTextContent('Nov 3');
  expect(amd).toHaveTextContent('today');
  expect(screen.getByTestId('next-UBER')).toHaveTextContent('1 day');
  expect(screen.getByTestId('next-UBER')).not.toHaveTextContent('1 days');
  const smci = screen.getByTestId('next-SMCI');
  expect(smci).toHaveTextContent('~Nov 10');
  expect(smci).toHaveTextContent('7 days');
  const none = screen.getByTestId('next-NODATE');
  expect(within(none).getAllByText('—')).toHaveLength(2);
});

const order = () => screen.getAllByTestId(/^next-/).map((el) => el.getAttribute('data-testid')!.slice(5));

it('sorts Soonest (server order) or A–Z, and remembers the choice', async () => {
  vi.mocked(api).mockResolvedValue(week());
  const first = renderIt();
  await screen.findByTestId('next-AMD');
  expect(screen.getByRole('button', { name: 'Soonest' })).toHaveAttribute('aria-pressed', 'true');
  expect(order()).toEqual(['AMD', 'UBER', 'SMCI', 'ABC', 'NODATE']);

  await userEvent.click(screen.getByRole('button', { name: 'A–Z' }));
  expect(screen.getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');
  expect(order()).toEqual(['ABC', 'AMD', 'NODATE', 'SMCI', 'UBER']);

  first.unmount();
  renderIt();
  await screen.findByTestId('next-AMD');
  expect(order()).toEqual(['ABC', 'AMD', 'NODATE', 'SMCI', 'UBER']);
});

it('explains an empty Next earnings list', async () => {
  vi.mocked(api).mockResolvedValue(week({ upcoming: [] }));
  renderIt();
  expect(await screen.findByText('Nothing to show yet — add holdings or watch some tickers.')).toBeInTheDocument();
});
