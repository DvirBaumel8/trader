// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Brief } from './Brief';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

const initialBrief = {
  generatedAt: '2026-09-17T08:00:00.000Z',
  refreshAfterSeconds: 300,
  marketDataAvailable: true,
  coverage: [
    { source: 'PORTFOLIO', symbol: 'NVDA', price: 102, regularPrice: 100, stale: false, session: 'POST', extended: true },
    { source: 'WATCHLIST', symbol: 'FSLR', price: 155, regularPrice: 155, stale: true, session: 'CLOSED', extended: false },
  ],
  notes: [
    { kind: 'MOMENTUM', source: 'PORTFOLIO', symbol: 'NVDA', title: 'NVDA has momentum', detail: 'Above rising averages.' },
    { kind: 'ATR_MOVE', source: 'WATCHLIST', symbol: 'FSLR', title: 'FSLR moved 1.4 ATR', detail: 'A large daily move.' },
    { kind: 'ECONOMIC', source: 'MARKET', symbol: null, title: 'Fed rate decision', detail: 'Fed raised rates 25 bp to 3.75–4.00%.' },
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderBrief() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Brief />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('Brief', () => {
  it('keeps notable events ahead of long ticker coverage', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();

    const events = await screen.findByRole('region', { name: 'Notable events' });
    const coverage = screen.getByRole('region', { name: 'Current coverage' });
    expect(events.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows current session coverage and links each ticker to its owning list', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();

    const coverage = await screen.findByRole('region', { name: 'Current coverage' });
    expect(within(coverage).getByRole('link', { name: /NVDA/ })).toHaveAttribute('href', '/?symbol=NVDA');
    expect(within(coverage).getByRole('link', { name: /FSLR/ })).toHaveAttribute('href', '/watchlist?symbol=FSLR');
    expect(within(coverage).getByText('$102.00')).toBeInTheDocument();
    expect(within(coverage).getByText('AFTER HOURS')).toBeInTheDocument();
    expect(within(coverage).getByText('STALE')).toBeInTheDocument();
    expect(within(coverage).getByText(/Regular close/)).toBeInTheDocument();
  });

  it('groups notable notes and links stock events without inventing a market destination', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();

    const events = await screen.findByRole('region', { name: 'Notable events' });
    expect(within(events).getByRole('link', { name: /NVDA has momentum/ })).toHaveAttribute('href', '/?symbol=NVDA');
    expect(within(events).getByRole('link', { name: /FSLR moved 1.4 ATR/ })).toHaveAttribute('href', '/watchlist?symbol=FSLR');
    expect(within(events).getByText('Fed raised rates 25 bp to 3.75–4.00%.')).toBeInTheDocument();
    expect(within(events).queryByRole('link', { name: /Fed rate decision/ })).not.toBeInTheDocument();
  });

  it('surfaces the macro decision before per-ticker signals', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();

    const marketNote = await screen.findByText('Fed rate decision');
    const stockNote = screen.getByText('NVDA has momentum');
    expect(marketNote.compareDocumentPosition(stockNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('forces a fresh Brief and replaces coverage when a watched ticker was added', async () => {
    const fresh = {
      ...initialBrief,
      coverage: [
        ...initialBrief.coverage,
        { source: 'WATCHLIST', symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false },
      ],
    };
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.includes('refresh=1') ? fresh : initialBrief),
    );
    renderBrief();
    const coverage = await screen.findByRole('region', { name: 'Current coverage' });
    expect(within(coverage).getByRole('link', { name: /FSLR/ })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/watchlist/daily-brief?refresh=1'));
    expect(await within(coverage).findByRole('link', { name: /PLTR/ })).toHaveAttribute('href', '/watchlist?symbol=PLTR');
  });

  it('keeps the forced Brief when an earlier normal request settles afterward', async () => {
    let resolveNormal!: (value: typeof initialBrief) => void;
    const pendingNormal = new Promise<typeof initialBrief>((resolve) => {
      resolveNormal = resolve;
    });
    const forced = {
      ...initialBrief,
      coverage: [
        ...initialBrief.coverage,
        { source: 'WATCHLIST', symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false },
      ],
    };
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path === '/watchlist/daily-brief' ? pendingNormal : Promise.resolve(forced),
    );
    const { client } = renderBrief();
    await waitFor(() => expect(api).toHaveBeenCalledWith('/watchlist/daily-brief'));
    expect(client.getQueryState(['daily-brief'])?.fetchStatus).toBe('fetching');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    const coverage = await screen.findByRole('region', { name: 'Current coverage' });
    expect(within(coverage).getByRole('link', { name: /PLTR/ })).toBeInTheDocument();

    await act(async () => {
      resolveNormal(initialBrief);
      await pendingNormal;
    });
    await waitFor(() => expect(client.getQueryState(['daily-brief'])?.fetchStatus).toBe('idle'));
    expect(within(coverage).getByRole('link', { name: /PLTR/ })).toBeInTheDocument();
  });

  it('keeps completed coverage visible while a manual refresh is pending and after it fails', async () => {
    let rejectRefresh!: (reason: Error) => void;
    const pending = new Promise((_, reject) => { rejectRefresh = reject; });
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes('refresh=1') ? pending : Promise.resolve(initialBrief),
    );
    renderBrief();
    const coverage = await screen.findByRole('region', { name: 'Current coverage' });
    expect(within(coverage).getByRole('link', { name: /FSLR/ })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    expect(within(coverage).getByRole('link', { name: /FSLR/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh brief' })).toBeDisabled();

    rejectRefresh(new Error('provider unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh did not complete');
    expect(within(coverage).getByRole('link', { name: /FSLR/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh brief' })).toBeEnabled();
  });

  it('does not claim to show a completed brief if the first load and refresh both fail', async () => {
    (api as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('provider unavailable'));
    renderBrief();
    expect(await screen.findByText('Daily brief unavailable right now.')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    expect(await screen.findByText('Refresh did not complete. Try again.')).toBeInTheDocument();
  });

  it('calls out unavailable Federal Reserve updates instead of implying a quiet day', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      marketDataAvailable: false,
      notes: [],
    });
    renderBrief();

    expect(await screen.findByRole('alert')).toHaveTextContent('Federal Reserve updates unavailable');
    expect(screen.queryByText('No notable moves or events right now.')).not.toBeInTheDocument();
  });
});
