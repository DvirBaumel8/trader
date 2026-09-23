// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntryCard, type Entry } from './EntryCard';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

type Reconciliation = NonNullable<Entry['trade']>['reconciliation'];

const entry = (reasons: string[], reconciliation: Reconciliation = null): Entry => ({
  id: 'e1',
  kind: 'TRADE',
  body: 'took the loss',
  occurredAt: '2026-01-05T12:00:00.000Z',
  trade: {
    symbol: 'NVDA',
    side: 'SELL',
    quantity: -100,
    price: 10,
    fee: 0,
    plannedTarget: null,
    stopLevels: [],
    riskAmount: null,
    exitKind: null,
    stopExecutions: [],
    reportedNetCash: reconciliation ? 1000 : null,
    reportedBalance: reconciliation ? 5000 : null,
    netCash: 1000,
    reconciliation,
  },
  cash: null,
  dividend: null,
  tags: [],
  reasons,
});

function renderCard(reasons: string[], reconciliation: Reconciliation = null) {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    defaultFee: 4,
    reasons: {
      opening: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
      closing: [{ code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' }],
    },
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EntryCard
        entry={entry(reasons, reconciliation)}
        editMode={false}
        onOpen={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('EntryCard reasons', () => {
  it('names the reasons the fill was journalled with', async () => {
    renderCard(['EXIT_STOP_EXECUTED']);
    expect(await screen.findByText('Stop executed')).toBeInTheDocument();
  });

  /**
   * A code stored before a label was reworded — or before the frontend knew
   * the vocabulary at all — must not render as an empty chip or as
   * EXIT_STOP_EXECUTED shouting at the owner.
   */
  it('says nothing about a code it cannot name', async () => {
    renderCard(['EXIT_RETIRED_OPTION']);
    await screen.findByText('took the loss');
    expect(screen.queryByText(/EXIT_RETIRED/)).not.toBeInTheDocument();
  });
});

describe('EntryCard reconciliation badge', () => {
  it('shows nothing when the platform numbers were never given', async () => {
    renderCard([], null);
    await screen.findByText('took the loss');
    expect(screen.queryByText(/off by/)).not.toBeInTheDocument();
  });

  it('shows nothing when the platform numbers match what we derive', async () => {
    renderCard([], {
      expectedNetCash: 1000,
      expectedBalance: 5000,
      netCashMismatch: false,
      balanceMismatch: false,
    });
    await screen.findByText('took the loss');
    expect(screen.queryByText(/off by/)).not.toBeInTheDocument();
  });

  it('flags a net-cash mismatch with the dollar amount off', async () => {
    renderCard([], {
      expectedNetCash: 997,
      expectedBalance: 5000,
      netCashMismatch: true,
      balanceMismatch: false,
    });
    // reportedNetCash from the fixture is 1000; expected is 997 — off by 3.
    expect(await screen.findByText(/off by \$3\.00/)).toBeInTheDocument();
  });

  it('flags a balance mismatch even when the net cash matches', async () => {
    renderCard([], {
      expectedNetCash: 1000,
      expectedBalance: 4750,
      netCashMismatch: false,
      balanceMismatch: true,
    });
    // reportedBalance from the fixture is 5000; expected is 4750 — off by 250.
    expect(await screen.findByText(/off by \$250\.00/)).toBeInTheDocument();
  });
});
