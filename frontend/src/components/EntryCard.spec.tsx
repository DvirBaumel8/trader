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

const entry = (reasons: string[]): Entry => ({
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
  },
  cash: null,
  dividend: null,
  tags: [],
  reasons,
});

function renderCard(reasons: string[]) {
  (api as ReturnType<typeof vi.fn>).mockResolvedValue({
    defaultFee: 4,
    reasons: {
      opening: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
      closing: [{ code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' }],
    },
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EntryCard entry={entry(reasons)} editMode={false} onOpen={() => {}} />
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
