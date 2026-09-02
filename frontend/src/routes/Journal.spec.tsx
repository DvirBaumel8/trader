// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Journal } from './Journal';
import { saveUiState } from '../lib/uiState';
import type { Entry } from '../components/EntryCard';
import { stubLocalStorage } from '../test/memoryLocalStorage';

vi.mock('../api/client', () => ({
  api: vi.fn(),
}));

import { api } from '../api/client';

const staleEntry: Entry = {
  id: 'stale-1',
  kind: 'TRADE',
  body: 'stale note',
  occurredAt: '2026-01-01T12:00:00.000Z',
  trade: {
    symbol: 'AAPL',
    side: 'BUY',
    quantity: 5,
    price: 200,
    fee: 1,
    plannedTarget: null,
    stopLevels: [],
    riskAmount: null,
  },
  cash: null,
  dividend: null,
  tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});

afterEach(cleanup);

function renderJournal() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Journal />
    </QueryClientProvider>,
  );
}

/** Builds a mock `api` that resolves everything instantly except GET /journal
 * (the "ALL" restore query), which stays pending until the caller resolves
 * it — letting a test control exactly when the restore fetch lands. */
function mockApiWithSlowRestoreFetch() {
  let resolveJournalAll: (v: Entry[]) => void = () => {};
  const journalAllPromise = new Promise<Entry[]>((resolve) => {
    resolveJournalAll = resolve;
  });

  (api as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string, init?: RequestInit) => {
      if (path === '/settings') return Promise.resolve({ defaultFee: 4 });
      if (path === '/portfolio/stats')
        return Promise.resolve({ trades: [], closedCount: 0, openCount: 0 });
      if (path === '/journal' && (!init || init.method === undefined)) {
        // GET /journal — the "ALL" query behind the restore mechanism.
        return journalAllPromise;
      }
      if (path === '/journal' && init?.method === 'POST') {
        return Promise.resolve({ id: 'new-1' });
      }
      return Promise.resolve([]);
    },
  );

  return { resolveJournalAll };
}

describe('Journal restoring an in-progress edit after a background/reload', () => {
  it('does not let a slow-resolving restore fetch clobber a new entry the user is actively composing', async () => {
    // An earlier session left an entry (stale-1) open for editing, then the
    // tab was backgrounded/killed before it was closed out. Within the
    // restore window, editingEntryId survives in uiState.
    saveUiState({
      path: '/journal',
      journalTab: 'TRADES',
      editingEntryId: 'stale-1',
      composing: false,
    });
    const { resolveJournalAll } = mockApiWithSlowRestoreFetch();

    const user = userEvent.setup();
    renderJournal();

    // The user taps + to compose a brand new entry, unrelated to the stale
    // one, before the restore fetch has had a chance to resolve.
    await user.click(screen.getByLabelText('New entry'));
    const symbol = await screen.findByPlaceholderText('NVDA');
    await user.type(symbol, 'NVDA');

    // Now the slow restore fetch finally resolves, carrying the stale entry
    // a past session was mid-edit on.
    resolveJournalAll([staleEntry]);
    await new Promise((r) => setTimeout(r, 20));

    // The compose dialog the user is actively typing into must still show
    // what they typed, not get silently swapped for the stale entry.
    expect(screen.getByPlaceholderText('NVDA')).toHaveValue('NVDA');
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument();
  });

  it('still restores the abandoned edit when the sheet is idle when the fetch resolves', async () => {
    saveUiState({
      path: '/journal',
      journalTab: 'TRADES',
      editingEntryId: 'stale-1',
      composing: false,
    });
    const { resolveJournalAll } = mockApiWithSlowRestoreFetch();

    renderJournal();

    // Nothing is open yet — the user hasn't touched the composer.
    resolveJournalAll([staleEntry]);

    // The legitimate "reopen where I left off" behaviour still works: the
    // sheet opens as an editor on the restored entry.
    await waitFor(() => {
      expect(screen.getByText('Save changes')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText('NVDA')).toHaveValue('AAPL');
    });
  });
});
