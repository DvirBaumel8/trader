// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Watchlist } from './Watchlist';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'w1',
  symbol: 'NVDA',
  name: 'NVIDIA',
  price: 100,
  stale: false,
  targetPrice: 120,
  targetDirection: 'ABOVE',
  distanceToTarget: 20,
  reached: false,
  alerting: false,
  reachedOn: null,
  note: '',
  tags: [],
  daysUntilEarnings: null,
  ...over,
});

const rankedTicker = (over: Partial<Record<string, unknown>> = {}) => ({
  symbol: 'NVDA',
  verdict: 'Strong uptrend, room to the 52w high.',
  coverage: 'full',
  ...over,
});

const rankingResponse = (over: Partial<Record<string, unknown>> = {}) => ({
  configured: true,
  rankedAt: '2026-09-12T09:00:00.000Z',
  model: 'gemini-test',
  order: [rankedTicker()],
  reasoning: 'NVDA leads on trend strength and your own record in semis.',
  missing: [],
  stale: false,
  ...over,
});

// The default for every test that isn't specifically about the ranking:
// nothing computed yet. A default ranking with a real order would plant a
// second "NVDA" (or whatever symbol) in the document for every unrelated
// watchlist test to trip over.
const noRankingYet = () =>
  rankingResponse({ rankedAt: null, order: [], reasoning: null });

function renderWatchlist(
  rows: ReturnType<typeof row>[],
  // `refreshRanking` lets a test answer the refresh POST differently from
  // the initial GET — e.g. proving the reasoning card opens on the NEW
  // answer a just-triggered refresh brought back, not the one already on
  // screen. Defaults to `ranking` so most tests only need to specify one.
  opts: { ranking?: unknown; refreshRanking?: unknown } = {},
) {
  (api as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string, init?: { method?: string }) => {
      if (path === '/watchlist') return Promise.resolve(rows);
      if (path === '/watchlist/ranking') {
        return Promise.resolve(opts.ranking ?? noRankingYet());
      }
      if (path === '/watchlist/ranking/refresh' && init?.method === 'POST') {
        return Promise.resolve(
          opts.refreshRanking ?? opts.ranking ?? noRankingYet(),
        );
      }
      return Promise.resolve({});
    },
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Watchlist />
    </QueryClientProvider>,
  );
}

describe('Watchlist add form', () => {
  it('keeps the add composer out of the page until requested', async () => {
    renderWatchlist([]);
    expect(screen.queryByPlaceholderText('NVDA, AMD, TSLA')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Add stocks' }));
    expect(screen.getByPlaceholderText('NVDA, AMD, TSLA')).toBeInTheDocument();
  });

  /**
   * Tags and a note were only reachable through edit mode after a row
   * already existed — the pencil, the row, and Save, for a field the
   * upsert endpoint has always accepted on the very first write.
   */
  it('offers tags and a note up front, not only after adding', async () => {
    renderWatchlist([]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add stocks' }));
    expect(screen.getByPlaceholderText(/tags/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/why you are watching/)).toBeInTheDocument();
  });

  it('sends the note and tags typed before adding, in the same request', async () => {
    const user = userEvent.setup();
    renderWatchlist([]);
    await user.click(screen.getByRole('button', { name: 'Add stocks' }));
    await user.type(screen.getByPlaceholderText('NVDA, AMD, TSLA'), 'nvda');
    await user.type(screen.getByPlaceholderText(/tags/), 'semis, breakout');
    await user.type(
      screen.getByPlaceholderText(/why you are watching/),
      'earnings run',
    );
    await user.click(screen.getByRole('button', { name: 'Watch 1 stock' }));

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) =>
          c[0] === '/watchlist' && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as { body: string }).body);
      expect(body.symbol).toBe('NVDA');
      expect(body.note).toBe('earnings run');
      expect(body.tags).toEqual(['semis', 'breakout']);
    });
  });

  it('clears note and tags after a successful add, like the ticker field', async () => {
    const user = userEvent.setup();
    renderWatchlist([]);
    await user.click(screen.getByRole('button', { name: 'Add stocks' }));
    await user.type(screen.getByPlaceholderText(/tags/), 'semis');
    await user.type(
      screen.getByPlaceholderText(/why you are watching/),
      'earnings run',
    );
    await user.type(screen.getByPlaceholderText('NVDA, AMD, TSLA'), 'nvda');
    await user.click(screen.getByRole('button', { name: 'Watch 1 stock' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/tags/)).toHaveValue('');
    });
    expect(screen.getByPlaceholderText(/why you are watching/)).toHaveValue('');
  });

  it('adds comma- and newline-separated symbols in one batch', async () => {
    const user = userEvent.setup();
    renderWatchlist([]);
    await user.click(screen.getByRole('button', { name: 'Add stocks' }));
    await user.type(screen.getByPlaceholderText('NVDA, AMD, TSLA'), 'nvda, amd\nTSLA');
    await user.click(screen.getByRole('button', { name: 'Watch 3 stocks' }));

    await waitFor(() => {
      const calls = (api as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === '/watchlist' && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(calls).toHaveLength(3);
      expect(calls.map((c) => JSON.parse((c[1] as { body: string }).body).symbol)).toEqual([
        'NVDA',
        'AMD',
        'TSLA',
      ]);
    });
    expect(screen.getByRole('dialog', { name: 'Add to watchlist' })).toBeInTheDocument();
  });
});

describe('Watchlist target alerts', () => {
  /** The feature he called super important: tell me what hit, when I arrive. */
  it('announces a ticker that reached its target', async () => {
    renderWatchlist([row({ reached: true, alerting: true, price: 121 })]);
    expect(
      await screen.findByText(/A ticker reached your target/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/rose to/)).toBeInTheDocument();
  });

  it('says which way it went for a wait-for-the-dip target', async () => {
    renderWatchlist([
      row({ reached: true, alerting: true, targetDirection: 'BELOW', price: 79 }),
    ]);
    expect(await screen.findByText(/fell to/)).toBeInTheDocument();
  });

  it('stays quiet about a target still out of reach', async () => {
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    expect(screen.queryByText(/reached your target/i)).not.toBeInTheDocument();
  });

  /** Hit but acknowledged: the row still says so, the banner does not shout. */
  /**
   * The hit may be history: he asked to be told if the price reached his
   * target at any point since he set it, so a spike that has already pulled
   * back still counts — and the banner has to say WHEN, or the claim cannot
   * be checked against a chart.
   */
  it('names the day the target was hit, not just that it was', async () => {
    renderWatchlist([
      row({ reached: true, alerting: true, reachedOn: '2026-09-09', price: 95 }),
    ]);
    expect(await screen.findByText(/on Sep 9/)).toBeInTheDocument();
  });

  it('keeps showing a hit quietly after it is acknowledged', async () => {
    renderWatchlist([row({ reached: true, alerting: false })]);
    expect(await screen.findByText('target hit')).toBeInTheDocument();
    expect(screen.queryByText(/reached your target/i)).not.toBeInTheDocument();
  });
});

describe('Watchlist rows', () => {
  it('shows aligned column headers for the watchlist', async () => {
    renderWatchlist([row()]);
    expect(await screen.findByText('Symbol')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();
  });

  it('shows days until the next earnings date', async () => {
    renderWatchlist([row({ daysUntilEarnings: 12 })]);
    expect(await screen.findByText('12d')).toBeInTheDocument();
  });
  /**
   * A ticker with no target rendered as a bare symbol and a price, which
   * reads as half-loaded rather than as a deliberate state. The target stays
   * optional; it just says so.
   */
  it('says so when a ticker is watched without a target', async () => {
    renderWatchlist([row({ targetPrice: null, targetDirection: null, distanceToTarget: null })]);
    expect(await screen.findByText('no target set')).toBeInTheDocument();
  });

  it('names the company, so a row is legible without knowing the ticker', async () => {
    renderWatchlist([row({ name: 'NVIDIA' })]);
    expect(await screen.findByText('NVIDIA')).toBeInTheDocument();
  });

  /**
   * Edit was missing entirely: the list was add-and-delete only. Tags and
   * note now also appear on the add form itself (see "Watchlist add form"
   * below), so this asserts a SECOND set exists once the row's own editor is
   * open, rather than merely that one exists somewhere on the page.
   */
  it('offers an editor for target, tags and note in edit mode', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit watchlist' }));

    expect(screen.getByPlaceholderText('target (blank to clear)')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/tags/)).toHaveLength(1);
    expect(screen.getAllByPlaceholderText(/why you are watching/)).toHaveLength(1);
  });

  /** Clearing the field must REMOVE the target, not leave the old one. */
  it('sends null when the target field is emptied', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: 'Edit watchlist' }));
    await user.clear(screen.getByPlaceholderText('target (blank to clear)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/watchlist' && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body).targetPrice).toBeNull();
    });
  });

  it('shows how far the price still has to travel', async () => {
    renderWatchlist([row()]);
    expect(await screen.findByText(/away/)).toBeInTheDocument();
  });

  /** Same rule as every other list in the app — delete is never ambient. */
  it('offers no delete until edit mode is on', async () => {
    renderWatchlist([row()]);
    await screen.findByText('NVDA');
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();

    await userEvent.setup().click(
      screen.getByRole('button', { name: 'Edit watchlist' }),
    );
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('filters by a tag when one is picked', async () => {
    const user = userEvent.setup();
    renderWatchlist([
      row({ id: 'a', symbol: 'NVDA', tags: [{ id: 't1', label: 'semis' }] }),
      row({ id: 'b', symbol: 'LMND', tags: [{ id: 't2', label: 'insurtech' }] }),
    ]);
    await screen.findByText('NVDA');

    await user.click(screen.getByRole('button', { name: 'semis' }));

    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('LMND')).not.toBeInTheDocument();
  });
});

describe('Watchlist ranking', () => {
  it('shows the ranked order, best first', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({
        order: [
          rankedTicker({ symbol: 'NVDA', verdict: 'Best of the three.' }),
          rankedTicker({ symbol: 'AMD', verdict: 'Weaker trend, still fine.' }),
        ],
      }),
    });

    const nvda = await screen.findByText('Best of the three.');
    const amd = await screen.findByText('Weaker trend, still fine.');
    // Document order carries the rank — position 1 renders before position 2.
    expect(
      nvda.compareDocumentPosition(amd) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says when a ticker was ranked without analyst coverage', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({
        order: [rankedTicker({ coverage: 'no-analyst-coverage' })],
      }),
    });

    expect(
      await screen.findByText(/no analyst coverage/i),
    ).toBeInTheDocument();
  });

  /**
   * Distinct from "no coverage": a Yahoo outage must never read on screen as
   * the resolved fact that nobody covers this ticker.
   */
  it('says when the analyst view was unavailable, not that there is no coverage', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({
        order: [rankedTicker({ coverage: 'unavailable' })],
      }),
    });

    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no analyst coverage/i)).not.toBeInTheDocument();
  });

  it('says how old the ranking is', async () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000,
    ).toISOString();
    renderWatchlist([row()], {
      ranking: rankingResponse({ rankedAt: threeHoursAgo }),
    });

    expect(
      await screen.findByText(/ranked 3 hours ago/i),
    ).toBeInTheDocument();
  });

  it('hides the reasoning behind the app-wide collapsible card', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({
        reasoning: 'This exact sentence is the long-form reasoning.',
      }),
    });

    await screen.findByText('NVDA');
    expect(
      screen.queryByText('This exact sentence is the long-form reasoning.'),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /show ranking/i }),
    );

    expect(
      await screen.findByText(
        'This exact sentence is the long-form reasoning.',
      ),
    ).toBeInTheDocument();
  });

  it('asks for a fresh ranking on demand', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()], { ranking: rankingResponse() });

    await user.click(
      await screen.findByRole('button', { name: /^refresh$/i }),
    );

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) =>
          c[0] === '/watchlist/ranking/refresh' &&
          (c[1] as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
    });
  });

  it('offers a rank button on demand when nothing has been computed yet', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()]); // default mock: no ranking yet

    await user.click(
      await screen.findByRole('button', { name: /rank watchlist/i }),
    );

    await waitFor(() => {
      const call = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) =>
          c[0] === '/watchlist/ranking/refresh' &&
          (c[1] as { method?: string })?.method === 'POST',
      );
      expect(call).toBeDefined();
    });
  });

  it('says plainly when no ranking has been computed yet', async () => {
    const { container } = renderWatchlist([row()]); // default mock: no ranking yet

    expect(await screen.findByText(/no ranking yet/i)).toBeInTheDocument();
    // The Watching list below still renders its own <ul><li>; the absence
    // this asserts is an ORDERED list of ranked rows, which only the
    // ranking section would produce.
    expect(container.querySelector('ol')).not.toBeInTheDocument();
  });

  it('surfaces a ticker the model failed to rank', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({ missing: ['ZZZZ'] }),
    });

    expect(await screen.findByText(/not ranked/i)).toBeInTheDocument();
    expect(screen.getByText(/ZZZZ/)).toBeInTheDocument();
  });

  /**
   * The reasoning is collapsed on arrival because nobody asked for THAT
   * particular cached answer — but the instant a refresh IS asked for, the
   * new reasoning is exactly what was just requested, which is the case
   * CollapsibleCard's own "open on arrival" rule is written for.
   */
  it('opens the reasoning card after a refresh the user just triggered', async () => {
    const user = userEvent.setup();
    renderWatchlist([row()], {
      ranking: rankingResponse({ reasoning: 'Old reasoning text.' }),
      refreshRanking: rankingResponse({
        rankedAt: '2026-09-12T12:00:00.000Z',
        reasoning: 'Fresh reasoning text just computed.',
      }),
    });

    await screen.findByText('NVDA');
    expect(screen.queryByText('Old reasoning text.')).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: /^refresh$/i }),
    );

    expect(
      await screen.findByText('Fresh reasoning text just computed.'),
    ).toBeInTheDocument();
  });

  /**
   * A control living below the list is fine for a 3-ticker fixture and
   * quietly broken for a real, 50-ticker watchlist — a small fixture is
   * exactly what would hide that. This one is deliberately long.
   */
  it('keeps the ranking age above the list even with many rows', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      rankedTicker({ symbol: `T${i}`, verdict: `Verdict ${i}` }),
    );
    renderWatchlist([row()], { ranking: rankingResponse({ order: many }) });

    const age = await screen.findByText(/^ranked .+ ago$/i);
    const firstRow = await screen.findByText('T0');
    expect(
      age.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the stale badge differently from a fresh ranking', async () => {
    renderWatchlist([row()], {
      ranking: rankingResponse({ stale: true }),
    });

    const badge = await screen.findByText('stale');
    expect(screen.queryByText('fresh')).not.toBeInTheDocument();
    expect(badge.className).toMatch(/text-down/);
  });
});
