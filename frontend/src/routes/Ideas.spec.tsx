// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Ideas } from './Ideas';
import { Watchlist } from './Watchlist';
import { stubLocalStorage } from '../test/memoryLocalStorage';
import { writePersisted } from '../lib/persistentState';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

const row = (id: string, symbol: string) => ({
  id,
  createdAt: '2026-01-05T12:00:00.000Z',
  symbol,
  entryPrice: 100,
  stop: 90,
  target: 120,
  riskReward: 2,
  preview: `thoughts on ${symbol}`,
});

function renderIdeas() {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.startsWith('/ai/trade-ideas'))
      return Promise.resolve([row('a', 'NVDA'), row('b', 'PLTR')]);
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Ideas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Builds a fetch Response streaming the given ndjson lines, one read() per
 * array entry — mirrors POST /ai/trade-idea/stream's real shape. */
function streamedNdjsonResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(lines[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status });
}

const fullFacts = {
  symbol: 'NVDA',
  name: null,
  price: 200,
  stale: false,
  session: 'REGULAR',
  extended: false,
  peRatio: null,
  indicators: {
    sma20: null, sma50: null, sma150: null, sma200: null,
    percentFromSma20: null, percentFromSma50: null,
    percentFromSma150: null, percentFromSma200: null,
    high52w: null, low52w: null,
    percentFromHigh52w: null, percentFromLow52w: null,
    atr14: null, atrPercentOfPrice: null,
    relativeVolume: null, barsAvailable: 250,
  },
};

describe('Ideas — asking for an opinion', () => {
  beforeEach(() => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the text growing as delta lines arrive, before the idea is done', async () => {
    let resolveSecondRead: () => void = () => {};
    const secondRead = new Promise<void>((resolve) => {
      resolveSecondRead = resolve;
    });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const encoder = new TextEncoder();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(encoder.encode('{"delta":"This looks like a solid breakout."}\n'));
            return;
          }
          await secondRead;
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText('This looks like a solid breakout.'),
    ).toBeInTheDocument();
    resolveSecondRead();
  });

  it('starts with the free-text context collapsed behind a toggle', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":true,"symbol":"NVDA","facts":null,"levels":null,"risk":null,"levelsUnreadable":false,"error":null,"errorKind":null}\n',
      ]),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('+ Add context')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/why are you looking/i)).not.toBeInTheDocument();
  });

  it('sends the free-text note alongside the symbol once revealed and filled in', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":true,"symbol":"NVDA","facts":null,"levels":null,"risk":null,"levelsUnreadable":false,"error":null,"errorKind":null}\n',
      ]),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByText('+ Add context'));
    await user.type(
      screen.getByPlaceholderText(/why are you looking/i),
      'Heard a buyback rumor on a podcast.',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      symbol: 'NVDA',
      note: 'Heard a buyback rumor on a podcast.',
    });
  });

  it('omits the note entirely when the box was never used — the common case', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":true,"symbol":"NVDA","facts":null,"levels":null,"risk":null,"levelsUnreadable":false,"error":null,"errorKind":null}\n',
      ]),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ symbol: 'NVDA' });
  });

  it('keeps the finished streamed reasoning visible once the done line arrives', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"delta":"This looks like a solid breakout."}\n',
        `{"done":true,"configured":true,"symbol":"NVDA","facts":${JSON.stringify(fullFacts)},"levels":{"stop":180,"target":240},"risk":{"direction":"LONG","riskPerShare":20,"rewardPerShare":40,"riskReward":2,"sharesAtUsualRisk":null,"positionValueAtUsualRisk":null,"usualRisk":null},"levelsUnreadable":false,"error":null,"errorKind":null}\n`,
      ]),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('$180.00')).toBeInTheDocument();
    expect(screen.getByText('$240.00')).toBeInTheDocument();
    const reasoning = screen.getByText('This looks like a solid breakout.');
    expect(reasoning.closest('details')).toHaveAttribute('open');
    expect(reasoning).toBeVisible();
    expect(screen.getByText('Hide the reasoning')).toBeInTheDocument();
  });

  it('shows a plain error message when the stream ends without ever sending a done line', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse(['{"delta":"partial answer"}\n']),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText('Something went wrong getting an opinion. Try again in a bit.'),
    ).toBeInTheDocument();
  });

  it('shows an unconfigured message when the stream reports no key set', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":false,"symbol":"NVDA","facts":null,"levels":null,"risk":null,"levelsUnreadable":false,"error":null,"errorKind":null}\n',
      ]),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Ideas /></MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText('Ticker, e.g. NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText(/Trade ideas aren't set up yet/),
    ).toBeInTheDocument();
  });
});

describe('Ideas navigation', () => {
  it('returns to Watch after opening Ideas from Watch', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/watchlist']}>
          <Routes>
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/watchlist/ideas" element={<Ideas />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('link', { name: 'Ideas' }));
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByText('Watching')).toBeInTheDocument();
  });

  it('uses Watch as Back fallback for a direct Ideas URL', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/watchlist/ideas']}>
          <Routes>
            <Route path="/watchlist/ideas" element={<Ideas />} />
            <Route path="/watchlist" element={<Watchlist />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByText('Watching')).toBeInTheDocument();
  });
});

describe('Ideas restored result', () => {
  it('does not force an old persisted opinion open on reload', () => {
    writePersisted('trader.ideas.lastResult', {
      configured: true,
      symbol: 'NVDA',
      facts: fullFacts,
      opinion: 'An earlier saved opinion.',
      levels: null,
      risk: null,
      levelsUnreadable: false,
      error: null,
      errorKind: null,
    });
    renderIdeas();
    const reasoning = screen.getByText('An earlier saved opinion.');
    expect(reasoning.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Read the reasoning')).toBeInTheDocument();
  });
});

describe('Ideas history, deleting', () => {
  /**
   * A red Delete on every row, permanently, is noise on a phone and a stray
   * tap away from losing a paid-for answer. The list reads clean until edit
   * mode is switched on — the same rule the Journal already followed.
   */
  it('offers no delete until edit mode is on', async () => {
    renderIdeas();
    await screen.findByText('NVDA');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('offers delete on every row once edit mode is on', async () => {
    const user = userEvent.setup();
    renderIdeas();
    await screen.findByText('NVDA');

    await user.click(screen.getByRole('button', { name: 'Edit ideas' }));

    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(2);
  });

  /** Two taps, always — that part was never the problem. */
  it('still confirms before deleting', async () => {
    const user = userEvent.setup();
    renderIdeas();
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit ideas' }));

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    expect(screen.getByText('Delete this idea?')).toBeInTheDocument();

    const calls = (api as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE',
    );
    expect(calls).toHaveLength(0);
  });
});
