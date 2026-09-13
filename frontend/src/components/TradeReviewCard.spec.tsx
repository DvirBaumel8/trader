// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradeReviewCard } from './TradeReviewCard';

vi.mock('../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const review = {
  configured: true,
  error: null,
  score: 'A',
  verdict: 'Disciplined Target Exit',
  review: '### Process vs Outcome\n\nExemplary adherence.',
  createdAt: '2026-01-05T12:00:00.000Z',
  facts: {
    symbol: 'NVDA',
    hadInitialStop: true,
    initialStopPrice: 180,
    initialRiskPercent: 10,
    stopWidenedOrMovedAgainst: false,
    stopTrailedFavorable: true,
    stopSlippagePerShare: -0.05,
    mfeGainPercent: 12.5,
  },
};

function renderCard() {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue(review);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TradeReviewCard tradeId="NVDA:2026-01-03T14:30:00.000Z" />
    </QueryClientProvider>,
  );
}

/** Builds a fetch Response streaming the given ndjson lines, one read() per
 * array entry — mirrors POST /ai/trade-reviews/:id/stream's real shape. */
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

describe('TradeReviewCard generation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderNoSavedReview() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <TradeReviewCard tradeId="NVDA:2026-01-03T14:30:00.000Z" />
      </QueryClientProvider>,
    );
  }

  it('shows the finished, graded review once the done line arrives, with the meta block never shown', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"delta":"### Process vs Outcome\\nExemplary adherence to risk boundaries."}\n',
        '{"done":true,"configured":true,"tradeId":"t1","symbol":"NVDA","score":"A","verdict":"Disciplined Target Exit","facts":null,"createdAt":"2026-01-05T12:00:00.000Z","error":null,"errorKind":null}\n',
      ]),
    );
    const user = userEvent.setup();
    renderNoSavedReview();

    await user.click(
      await screen.findByRole('button', { name: 'Run AI Discipline Review' }),
    );

    expect(await screen.findByText(/Exemplary adherence/)).toBeInTheDocument();
    expect(screen.getByText('Disciplined Target Exit')).toBeInTheDocument();
    expect(screen.getByText(/Grade A/)).toBeInTheDocument();
    expect(screen.queryByText(/REVIEW_META/)).not.toBeInTheDocument();
  });

  it('shows a plain error message when the stream ends without ever sending a done line', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse(['{"delta":"partial review"}\n']),
    );
    const user = userEvent.setup();
    renderNoSavedReview();

    await user.click(
      await screen.findByRole('button', { name: 'Run AI Discipline Review' }),
    );

    expect(
      await screen.findByText(
        'Something went wrong generating the review. Try again in a bit.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/partial review/)).not.toBeInTheDocument();
  });

  it('shows an unconfigured message when the stream reports no key set', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":false,"tradeId":"t1","symbol":"NVDA","score":null,"verdict":null,"facts":null,"createdAt":null,"error":null,"errorKind":null}\n',
      ]),
    );
    const user = userEvent.setup();
    renderNoSavedReview();

    await user.click(
      await screen.findByRole('button', { name: 'Run AI Discipline Review' }),
    );

    expect(
      await screen.findByText(/AI features are not configured yet/),
    ).toBeInTheDocument();
  });
});

describe('TradeReviewCard', () => {
  it('opens showing the review, since it was just asked for', async () => {
    renderCard();
    expect(await screen.findByText(/Exemplary adherence/)).toBeInTheDocument();
  });

  /**
   * The bug: "minimised" hid only the prose. The verdict line and the
   * four-tile metrics grid stayed on screen, leaving a card inches tall on a
   * phone — the same burying the portfolio summary was fixed for.
   */
  it('collapses to one header line, metrics strip included', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/Exemplary adherence/);

    await user.click(screen.getByRole('button', { name: 'Hide review' }));

    expect(screen.queryByText(/Exemplary adherence/)).not.toBeInTheDocument();
    expect(screen.queryByText('Disciplined Target Exit')).not.toBeInTheDocument();
    expect(screen.queryByText('Initial Stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak Excursion (MFE)')).not.toBeInTheDocument();
  });

  it('still shows the grade and keeps Re-evaluate reachable when collapsed', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/Exemplary adherence/);
    await user.click(screen.getByRole('button', { name: 'Hide review' }));

    expect(screen.getByText(/Grade A/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
  });
});
