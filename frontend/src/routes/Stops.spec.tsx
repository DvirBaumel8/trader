// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Stops } from './Stops';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const basePosition = (symbol: string) => ({
  symbol,
  quantity: 100,
  price: 110,
  stale: false,
  session: 'REGULAR' as const,
  extended: false,
  marketValue: 11000,
  tradeId: null,
});

function renderStops(portfolio: {
  positions: ReturnType<typeof basePosition>[];
  accountValue: number;
  atRisk: {
    amount: number;
    positionsWithoutStop: { count: number; symbols: string[] };
    positionsWithPartialStop: {
      count: number;
      positions: { symbol: string; coveredQuantity: number; heldQuantity: number }[];
    };
  };
  stopGroups: unknown[];
}) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/portfolio') return Promise.resolve(portfolio);
    return Promise.resolve({});
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Stops />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Stops page — partial coverage', () => {
  it('flags a position whose stop covers only part of it', async () => {
    renderStops({
      positions: [basePosition('NVDA')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 0, symbols: [] },
        positionsWithPartialStop: {
          count: 1,
          positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
        },
      },
      stopGroups: [],
    });

    expect(await screen.findByText(/partial stop/i)).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText(/40 of 100 sh covered/i)).toBeInTheDocument();
    expect(screen.getByText(/60 sh unprotected/i)).toBeInTheDocument();
  });

  it('says nothing about partial stops when every plan is fully covered', async () => {
    renderStops({
      positions: [basePosition('NVDA')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 0, symbols: [] },
        positionsWithPartialStop: { count: 0, positions: [] },
      },
      stopGroups: [],
    });

    await screen.findByText('No stops recorded yet.');
    expect(screen.queryByText(/partial stop/i)).not.toBeInTheDocument();
  });

  it('shows both the no-stop and partial-stop sections together when both apply', async () => {
    renderStops({
      positions: [basePosition('NVDA'), basePosition('PLTR')],
      accountValue: 20000,
      atRisk: {
        amount: 0,
        positionsWithoutStop: { count: 1, symbols: ['PLTR'] },
        positionsWithPartialStop: {
          count: 1,
          positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
        },
      },
      stopGroups: [],
    });

    expect(await screen.findByText(/no stop ·/i)).toBeInTheDocument();
    expect(screen.getByText(/partial stop ·/i)).toBeInTheDocument();
  });
});

describe('Stops page — grouped tiers', () => {
  const tier = (stopPrice: number, amountAtRisk: number, distance: number) => ({
    symbol: 'NVDA',
    direction: 'LONG' as const,
    stopPrice,
    quantity: 150,
    currentPrice: 240.74,
    session: 'REGULAR' as const,
    extended: false,
    stale: false,
    distance,
    passed: false,
    amountAtRisk,
    trailPercent: null,
    trailsFrom: null,
  });
  const tiers = [tier(215.93, 3721.5, 0.103), tier(229.93, 1621.5, 0.0449)];
  const group = (over: Record<string, unknown> = {}) => ({
    symbol: 'NVDA',
    direction: 'LONG',
    currentPrice: 240.74,
    session: 'REGULAR',
    extended: false,
    stale: false,
    tierCount: 2,
    quantity: 300,
    amountAtRisk: 5343,
    distance: 0.074,
    nearestDistance: 0.0449,
    passed: false,
    tiers,
    ...over,
  });
  const portfolio = (stopGroups: unknown[]) => ({
    positions: [{ ...basePosition('NVDA'), tradeId: 't1' }],
    accountValue: 20000,
    atRisk: {
      amount: 5343,
      positionsWithoutStop: { count: 0, symbols: [] },
      positionsWithPartialStop: { count: 0, positions: [] },
    },
    stopGroups,
  });

  it('shows two tiers of one symbol as one collapsed row and toggles them', async () => {
    const user = userEvent.setup();
    renderStops(portfolio([group()]));

    const toggle = await screen.findByRole('button', { name: /NVDA/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(toggle).getByText(/2 stops · 300 sh/)).toBeInTheDocument();
    expect(within(toggle).getByText('7.40%')).toBeInTheDocument();
    expect(within(toggle).getByText('$5,343.00')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/trades/t1');
    expect(screen.getByText('$215.93')).toBeInTheDocument();
    expect(screen.getByText('$229.93')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the PASSED treatment on a combined row when any tier has passed', async () => {
    renderStops(portfolio([group({ passed: true, distance: -0.01 })]));
    const toggle = await screen.findByRole('button', { name: /NVDA/ });
    expect(within(toggle).getByText(/PASSED/)).toBeInTheDocument();
  });

  it('renders a single-tier symbol as a plain link row, as before', async () => {
    renderStops(
      portfolio([
        group({
          tierCount: 1,
          quantity: 150,
          amountAtRisk: 3721.5,
          distance: 0.103,
          tiers: [tiers[0]],
        }),
      ]),
    );
    const link = await screen.findByRole('link', { name: /NVDA/ });
    expect(link).toHaveAttribute('href', '/trades/t1');
    expect(screen.queryByRole('button', { name: /NVDA/ })).not.toBeInTheDocument();
    expect(screen.getByText('$215.93')).toBeInTheDocument();
  });
});
