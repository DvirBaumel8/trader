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
