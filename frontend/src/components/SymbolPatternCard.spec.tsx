// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SymbolPatternCard } from './SymbolPatternCard';

vi.mock('../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const savedRead = {
  configured: true,
  symbol: 'NVDA',
  range: 'ALL',
  error: null,
  headline: 'You hold winners here longer than your average',
  read: 'You tend to let NVDA winners run past your usual exit.',
  createdAt: '2026-01-05T12:00:00.000Z',
};

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SymbolPatternCard symbol="NVDA" range="ALL" />
    </QueryClientProvider>,
  );
}

/** Lets a test switch `range` on an already-mounted card, the way StockDetail's
 * own RangeSelector does — the shape both regression tests below need. */
function renderSwitchableCard() {
  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <SymbolPatternCard symbol="NVDA" range="ALL" />
    </QueryClientProvider>,
  );
  const switchTo = (range: string) =>
    rerender(
      <QueryClientProvider client={client}>
        <SymbolPatternCard symbol="NVDA" range={range as never} />
      </QueryClientProvider>,
    );
  return { switchTo };
}

describe('SymbolPatternCard', () => {
  it('offers a button rather than calling the model, when nothing is saved yet', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    renderCard();

    expect(
      await screen.findByRole('button', { name: 'Read My Pattern' }),
    ).toBeInTheDocument();
    // GET only — a click is required before any model call happens.
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      '/ai/symbol-patterns/NVDA?range=ALL',
    );
  });

  it('generates a read on click and shows it open, since it was just asked for', async () => {
    (api as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedRead);
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Read My Pattern' }));

    expect(
      await screen.findByText(/You tend to let NVDA winners run/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You hold winners here longer than your average'),
    ).toBeInTheDocument();
  });

  it('shows the saved read immediately when one already exists', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(savedRead);
    renderCard();

    expect(
      await screen.findByText(/You tend to let NVDA winners run/),
    ).toBeInTheDocument();
  });

  /** Same rule TradeReviewCard is held to: collapsed means ONE header line. */
  it('collapses to just the headline', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue(savedRead);
    const user = userEvent.setup();
    renderCard();
    await screen.findByText(/You tend to let NVDA winners run/);

    await user.click(screen.getByRole('button', { name: 'Hide pattern read' }));

    expect(
      screen.queryByText(/You tend to let NVDA winners run/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('You hold winners here longer than your average'),
    ).toBeInTheDocument();
  });

  it('does not keep showing a just-generated read after range changes to one with nothing saved', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(savedRead);
      if (path.includes('range=ALL')) return Promise.resolve(null);
      return Promise.resolve(null); // range=1M: nothing saved either
    });
    const user = userEvent.setup();
    const { switchTo } = renderSwitchableCard();

    await user.click(await screen.findByRole('button', { name: 'Read My Pattern' }));
    await screen.findByText(/You tend to let NVDA winners run/);

    switchTo('1M');

    // The 1M range was never generated — it must show its own empty state,
    // not the ALL range's read left over in the mutation's own result.
    expect(
      await screen.findByRole('button', { name: 'Read My Pattern' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/You tend to let NVDA winners run/),
    ).not.toBeInTheDocument();
  });

  it('clears a failed generate for one range when switching to a range that was never attempted', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new Error('network down'));
      return Promise.resolve(null);
    });
    const user = userEvent.setup();
    const { switchTo } = renderSwitchableCard();

    await user.click(await screen.findByRole('button', { name: 'Read My Pattern' }));
    await screen.findByText('Read Failed');

    switchTo('1M');

    expect(
      await screen.findByRole('button', { name: 'Read My Pattern' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Read Failed')).not.toBeInTheDocument();
  });

  it('shows an unconfigured message instead of a button when the LLM key is missing', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({
      configured: false,
      symbol: 'NVDA',
      range: 'ALL',
      headline: null,
      read: null,
      createdAt: null,
      error: null,
    });
    renderCard();

    expect(
      await screen.findByText(/AI features are not configured yet/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Read My Pattern' }),
    ).not.toBeInTheDocument();
  });
});
