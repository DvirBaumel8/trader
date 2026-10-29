// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Knowledge } from './Knowledge';

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
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const rows = [
  { symbol: 'NVDA', nodeCount: 12, updatedAt: '2026-10-29T15:00:00.000Z', hasNew: true },
  { symbol: 'AMD', nodeCount: 1, updatedAt: '2026-10-20T15:00:00.000Z', hasNew: false },
];

it('explains an empty list', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  expect(await screen.findByText(/No knowledge yet — ask Claude to start one/)).toBeInTheDocument();
});

it('lists tickers with count, date and a dot only where there is something new', async () => {
  vi.mocked(api).mockResolvedValue(rows);
  renderIt();
  const nvda = await screen.findByTestId('know-row-NVDA');
  expect(within(nvda).getByText('12 nodes')).toBeInTheDocument();
  expect(within(nvda).getByText('updated Oct 29')).toBeInTheDocument();
  expect(within(nvda).getByLabelText('new')).toBeInTheDocument();
  const amd = screen.getByTestId('know-row-AMD');
  expect(within(amd).getByText('1 node')).toBeInTheDocument();
  expect(within(amd).queryByLabelText('new')).not.toBeInTheDocument();
});

it('filters by ticker, case-insensitively', async () => {
  vi.mocked(api).mockResolvedValue(rows);
  renderIt();
  await screen.findByTestId('know-row-NVDA');
  await userEvent.type(screen.getByLabelText('Search tickers'), 'vd');
  expect(screen.getByTestId('know-row-NVDA')).toBeInTheDocument();
  expect(screen.queryByTestId('know-row-AMD')).not.toBeInTheDocument();
});

it('links a row to its graph', async () => {
  vi.mocked(api).mockResolvedValue(rows);
  renderIt();
  expect(await screen.findByTestId('know-row-NVDA')).toHaveAttribute('href', '/knowledge/NVDA');
});

it('URL-encodes symbols such as ^GSPC and CL=F in row links', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: '^GSPC', nodeCount: 2, updatedAt: '2026-10-29T15:00:00.000Z', hasNew: false }]);
  renderIt();
  expect(await screen.findByTestId('know-row-^GSPC')).toHaveAttribute('href', `/knowledge/${encodeURIComponent('^GSPC')}`);
});

it('shows an error', async () => {
  vi.mocked(api).mockRejectedValue(new Error('boom'));
  renderIt();
  expect(await screen.findByText('Couldn’t load knowledge right now.')).toBeInTheDocument();
});
