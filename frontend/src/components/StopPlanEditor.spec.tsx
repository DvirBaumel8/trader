// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StopPlanEditor } from './StopPlanEditor';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', () => ({ api: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});
afterEach(cleanup);

function renderEditor(tiers: React.ComponentProps<typeof StopPlanEditor>['tiers']) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StopPlanEditor
        tradeId="NVDA:2026-01-03T14:30:00.000Z"
        tiers={tiers}
        avgEntry={200}
        quantity={100}
        direction="LONG"
        currentPrice={210}
        highWaterPrice={215}
      />
    </QueryClientProvider>,
  );
}

describe('StopPlanEditor with no stop', () => {
  /**
   * A position with no stop is now a state the owner can deliberately reach,
   * so absence has to be visible rather than inferred from an empty editor —
   * this is the owner's self-identified failure mode (a high-conviction
   * position carrying no stop at all).
   */
  it('says plainly that the position is unprotected', () => {
    renderEditor([]);
    expect(screen.getByText(/no stop on this position/i)).toBeInTheDocument();
  });

  it('says nothing of the sort when a stop is set', () => {
    renderEditor([
      { kind: 'FIXED', price: 180, trailPercent: null, quantity: 100 },
    ]);
    expect(screen.queryByText(/no stop on this position/i)).not.toBeInTheDocument();
  });
});
