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
  session: 'PRE',
  marketDataAvailable: true,
  mood: {
    indices: [
      { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: true, session: 'PRE' },
      { symbol: 'QQQ', trend: 'mixed', changePct: -0.002, stale: true, extended: false, session: 'PRE' },
    ],
    vix: { level: 17.8, change: 1.1, stale: false },
    leader: { symbol: 'XLE', name: 'Energy', changePct: 0.012 },
    laggard: { symbol: 'XLK', name: 'Technology', changePct: -0.009 },
  },
  events: [{ title: 'Fed rate decision', detail: 'Fed raised rates 25 bp to 3.75–4.00%.', eventAt: '2026-09-17' }],
  holdingNotes: [{ kind: 'MOMENTUM', symbol: 'NVDA', title: 'NVDA has good momentum', detail: 'Above rising averages.' }],
  watchTriggers: [],
  queue: [],
  narrative: null,
  narrativeAt: null,
};

const fslrTrigger = { kind: 'BREAKOUT', symbol: 'FSLR', title: 'FSLR confirmed a breakout', detail: 'd' };

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
  it('puts what needs a decision in its own section, each item linking to the holding', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      queue: [
        { kind: 'STOP_CROSSED', symbol: 'NVDA', title: 'NVDA is through its stop at $95.00', detail: 'Last $93.00. If the stop has not filled, act on it now.' },
        { kind: 'NO_STOP', symbol: 'PLTR', title: 'PLTR has no stop', detail: 'Nothing limits the loss on this position.' },
      ],
    });
    renderBrief();
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    const links = within(section).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/?symbol=NVDA', '/?symbol=PLTR']);
    expect(links[0]).toHaveTextContent('NVDA is through its stop at $95.00');
  });

  it('says when nothing needs a decision, rather than hiding the section', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    expect(section).toHaveTextContent('Nothing needs a decision today.');
  });

  it('shows the queue after the market line and before holdings', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    const queue = await screen.findByRole('region', { name: 'Needs attention' });
    const market = screen.getByRole('region', { name: 'Market' });
    const holdings = screen.getByRole('region', { name: 'Holdings' });
    expect(market.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queue.compareDocumentPosition(holdings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** A reused take's figures are older than the notes under it; say so. */
  it('labels an AI take older than the brief with its own time', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      narrative: 'IONQ is the one to watch.',
      narrativeAt: '2026-09-17T07:40:00.000Z',
    });
    renderBrief();

    const take = await screen.findByRole('region', { name: 'AI take' });
    expect(within(take).getByText(/^AI take as of /)).toBeInTheDocument();
  });

  it('does not label a take written with this brief', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      narrative: 'IONQ is the one to watch.',
      narrativeAt: initialBrief.generatedAt,
    });
    renderBrief();

    const take = await screen.findByRole('region', { name: 'AI take' });
    expect(within(take).queryByText(/as of/)).not.toBeInTheDocument();
  });

  it('shows the AI take above the market mood when one was given', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      narrative: 'Nothing urgent — FSLR is the one to watch.',
    });
    renderBrief();

    const take = await screen.findByRole('region', { name: 'AI take' });
    expect(take).toHaveTextContent('Nothing urgent — FSLR is the one to watch.');
    const market = screen.getByRole('region', { name: 'Market' });
    expect(take.compareDocumentPosition(market) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows nothing extra when there is no AI take, rather than an empty box', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      narrative: null,
    });
    renderBrief();

    await screen.findByRole('region', { name: 'Market' });
    expect(screen.queryByRole('region', { name: 'AI take' })).not.toBeInTheDocument();
  });

  it('reads the market mood as one line, every figure from the server', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    const market = await screen.findByRole('region', { name: 'Market' });
    expect(market).toHaveTextContent('SPY uptrend +0.40%');
    expect(market).toHaveTextContent('QQQ mixed -0.20%');
    expect(market).toHaveTextContent('VIX 17.80 (+1.10)');
    expect(market).toHaveTextContent('Leading Energy +1.20%');
    expect(market).toHaveTextContent('Lagging Technology -0.90%');
  });

  it('labels an extended-hours index print with its session', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      mood: {
        ...initialBrief.mood,
        indices: [{ symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: true, session: 'POST' }],
      },
    });
    renderBrief();
    const market = await screen.findByRole('region', { name: 'Market' });
    expect(within(market).getByText('AFTER HOURS')).toBeInTheDocument();
  });

  it('labels a stale index rather than passing it off as fresh', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    const market = await screen.findByRole('region', { name: 'Market' });
    expect(within(market).getByText('STALE')).toBeInTheDocument();
  });

  it("lists this week's economic events under the mood", async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    const market = await screen.findByRole('region', { name: 'Market' });
    expect(market).toHaveTextContent('Fed rate decision');
    expect(market).toHaveTextContent('Fed raised rates 25 bp to 3.75–4.00%.');
  });

  it('says the mood is unavailable instead of an empty line', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief, mood: { indices: [], vix: null, leader: null, laggard: null },
    });
    renderBrief();
    expect(await screen.findByText('Market mood unavailable right now.')).toBeInTheDocument();
  });

  it('no longer repeats the portfolio and watch list as price cards', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    await screen.findByRole('region', { name: 'Market' });
    expect(screen.queryByRole('region', { name: 'Current coverage' })).not.toBeInTheDocument();
  });

  it('links a holding note to the holding and a watch trigger to its watch row', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...initialBrief,
      watchTriggers: [{ kind: 'BREAKOUT', symbol: 'FSLR', title: 'FSLR confirmed a breakout', detail: 'Closed above its prior 20-day high on 2.1× average volume.' }],
    });
    renderBrief();
    const holding = await screen.findByRole('link', { name: /NVDA has good momentum/ });
    expect(holding).toHaveAttribute('href', '/?symbol=NVDA');
    const trigger = screen.getByRole('link', { name: /FSLR confirmed a breakout/ });
    expect(trigger).toHaveAttribute('href', '/watchlist?symbol=FSLR');
  });

  it('hides empty sections and says once that there is nothing to act on', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ ...initialBrief, holdingNotes: [], watchTriggers: [] });
    renderBrief();
    expect(await screen.findByText('No holding or watch signals right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Holdings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Watch triggers' })).not.toBeInTheDocument();
  });

  it('states the session in the header, and again only on an extended-hours index print', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(initialBrief);
    renderBrief();
    await screen.findByRole('region', { name: 'Market' });
    // Header plus SPY (extended: true); QQQ and the rest of the line stay unlabelled.
    expect(screen.getAllByText('PRE-MARKET')).toHaveLength(2);
  });

  it('forces a fresh Brief and replaces the brief when a watch trigger appears', async () => {
    const fresh = {
      ...initialBrief,
      watchTriggers: [fslrTrigger],
    };
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.includes('refresh=1') ? fresh : initialBrief),
    );
    renderBrief();
    await screen.findByRole('region', { name: 'Market' });
    expect(screen.queryByText('FSLR confirmed a breakout')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/watchlist/daily-brief?refresh=1'));
    expect(await screen.findByRole('link', { name: /FSLR confirmed a breakout/ })).toHaveAttribute('href', '/watchlist?symbol=FSLR');
  });

  it('keeps the forced Brief when an earlier normal request settles afterward', async () => {
    let resolveNormal!: (value: typeof initialBrief) => void;
    const pendingNormal = new Promise<typeof initialBrief>((resolve) => {
      resolveNormal = resolve;
    });
    const forced = {
      ...initialBrief,
      watchTriggers: [fslrTrigger],
    };
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path === '/watchlist/daily-brief' ? pendingNormal : Promise.resolve(forced),
    );
    const { client } = renderBrief();
    await waitFor(() => expect(api).toHaveBeenCalledWith('/watchlist/daily-brief'));
    expect(client.getQueryState(['daily-brief'])?.fetchStatus).toBe('fetching');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    expect(await screen.findByText('FSLR confirmed a breakout')).toBeInTheDocument();

    await act(async () => {
      resolveNormal(initialBrief);
      await pendingNormal;
    });
    await waitFor(() => expect(client.getQueryState(['daily-brief'])?.fetchStatus).toBe('idle'));
    expect(screen.getByText('FSLR confirmed a breakout')).toBeInTheDocument();
  });

  it('keeps the forced brief when a normal read starts during refresh and settles later', async () => {
    let resolveForced!: (value: typeof initialBrief) => void;
    let resolveLateNormal!: (value: typeof initialBrief) => void;
    const forcedRequest = new Promise<typeof initialBrief>((resolve) => { resolveForced = resolve; });
    const lateNormal = new Promise<typeof initialBrief>((resolve) => { resolveLateNormal = resolve; });
    const fresh = {
      ...initialBrief,
      watchTriggers: [fslrTrigger],
    };
    let normalReads = 0;
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes('refresh=1')) return forcedRequest;
      normalReads += 1;
      return normalReads === 1 ? Promise.resolve(initialBrief) : lateNormal;
    });
    const { client } = renderBrief();
    await screen.findByRole('region', { name: 'Market' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh brief' })).toBeDisabled());
    // A focus/poll equivalent: ask the mounted query to fetch again while the
    // forced request is still pending, then let that read settle last.
    let background!: Promise<void>;
    act(() => { background = client.refetchQueries({ queryKey: ['daily-brief'], exact: true }); });
    await act(async () => { resolveForced(fresh); await forcedRequest; });
    expect(await screen.findByRole('link', { name: /FSLR confirmed a breakout/ })).toBeInTheDocument();
    await act(async () => { resolveLateNormal(initialBrief); await background; });
    expect(normalReads).toBe(1);
    expect(client.getQueryData(['daily-brief'])).toEqual(fresh);
    expect(screen.getByRole('link', { name: /FSLR confirmed a breakout/ })).toBeInTheDocument();
  });

  it('keeps the completed brief visible while a manual refresh is pending and after it fails', async () => {
    let rejectRefresh!: (reason: Error) => void;
    const pending = new Promise((_, reject) => { rejectRefresh = reject; });
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.includes('refresh=1') ? pending : Promise.resolve(initialBrief),
    );
    renderBrief();
    await screen.findByRole('region', { name: 'Market' });
    expect(screen.getByRole('link', { name: /NVDA has good momentum/ })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh brief' }));
    expect(screen.getByRole('link', { name: /NVDA has good momentum/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh brief' })).toBeDisabled();

    rejectRefresh(new Error('provider unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh did not complete');
    expect(screen.getByRole('link', { name: /NVDA has good momentum/ })).toBeInTheDocument();
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
      events: [],
    });
    renderBrief();

    expect(await screen.findByRole('alert')).toHaveTextContent('Federal Reserve updates unavailable');
    expect(screen.queryByText('Fed rate decision')).not.toBeInTheDocument();
  });
});
