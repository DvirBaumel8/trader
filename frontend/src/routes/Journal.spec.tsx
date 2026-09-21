// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
    exitKind: null,
    stopExecutions: [],
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
      <MemoryRouter>
        <Journal />
      </MemoryRouter>
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
      if (path.startsWith('/portfolio/stats'))
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
      journalTab: 'ACTIVITIES',
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
      journalTab: 'ACTIVITIES',
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

describe('Journal, the Activities tab', () => {
  const trade1: Entry = {
    ...staleEntry,
    id: 'trade-1',
    occurredAt: '2026-09-20T12:00:00.000Z',
    trade: { ...staleEntry.trade!, symbol: 'NVDA', fee: 5 },
  };
  const trade2: Entry = {
    ...staleEntry,
    id: 'trade-2',
    occurredAt: '2026-09-19T12:00:00.000Z',
    trade: { ...staleEntry.trade!, symbol: 'MSFT', fee: 3 },
  };
  const interestEntry: Entry = {
    id: 'interest-1',
    kind: 'INTEREST',
    body: '',
    occurredAt: '2026-09-19T00:00:00.000Z',
    trade: null,
    cash: null,
    dividend: null,
    interest: { amount: 10 },
    tags: [],
  };

  function mockApiForActivitiesTab() {
    const calls: string[] = [];
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      calls.push(path);
      if (path === '/settings') return Promise.resolve({ defaultFee: 4 });
      if (path === '/portfolio/stats') return Promise.resolve({});
      if (path.startsWith('/journal?') && path.includes('kind=TRADE')) {
        return Promise.resolve([trade1, trade2]);
      }
      if (path.startsWith('/journal?') && path.includes('kind=INTEREST')) {
        return Promise.resolve([interestEntry]);
      }
      return Promise.resolve([]);
    });
    return calls;
  }

  it('sums trading fees and interest for the selected time frame', async () => {
    mockApiForActivitiesTab();
    renderJournal();

    expect(await screen.findByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText(/\$8\.00/)).toBeInTheDocument(); // fees: 5 + 3
    expect(screen.getByText(/\$10\.00/)).toBeInTheDocument(); // interest
  });

  it('refetches with new date bounds when a time frame preset is picked', async () => {
    const calls = mockApiForActivitiesTab();
    const user = userEvent.setup();
    renderJournal();

    await screen.findByText('NVDA');
    await user.click(screen.getByRole('button', { name: '1W' }));

    await waitFor(() => {
      const tradeCall = calls.find(
        (p) => p.startsWith('/journal?') && p.includes('kind=TRADE') && p.includes('from='),
      );
      expect(tradeCall).toBeDefined();
    });
  });
});

describe('Journal, the Balance tab', () => {
  it('shows an interest charge alongside cash and dividends, not just dividends', async () => {
    const interestEntry: Entry = {
      id: 'interest-1',
      kind: 'INTEREST',
      body: 'Margin interest',
      occurredAt: '2026-08-30T00:00:00.000Z',
      trade: null,
      cash: null,
      dividend: null,
      interest: { amount: 38.2 },
      tags: [],
    };
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/settings') return Promise.resolve({ defaultFee: 4 });
      if (path === '/portfolio/stats') return Promise.resolve({});
      if (path === '/portfolio') {
        return Promise.resolve({
          cash: -38.2,
          contributedCapital: 0,
          dividendsReceived: 0,
        });
      }
      if (path === '/journal?kind=INTEREST') {
        return Promise.resolve([interestEntry]);
      }
      return Promise.resolve([]);
    });

    renderJournal();
    await userEvent.setup().click(screen.getByText('Balance'));

    expect(await screen.findByText('Margin interest')).toBeInTheDocument();
  });
});

describe('Journal, the Fees tab', () => {
  function mockApiForFeesTab() {
    (api as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === '/settings') return Promise.resolve({ defaultFee: 4 });
        if (path === '/portfolio/stats') return Promise.resolve({});
        if (path.startsWith('/portfolio/fees')) {
          return Promise.resolve({
            period: 'MONTH',
            buckets: [],
            total: 0,
            interestCost: { posted: 45.5, accrued: 28.05, total: 73.55, asOf: '2026-09-21' },
          });
        }
        if (path === '/settings/interest-accrual' && init?.method === 'PATCH') {
          return Promise.resolve({ interestAccrualAmount: 30, interestAccrualAsOf: '2026-09-22' });
        }
        return Promise.resolve([]);
      },
    );
  }

  it('shows the cost of margin interest, charged plus accruing', async () => {
    mockApiForFeesTab();
    renderJournal();

    await userEvent.setup().click(screen.getByText('Fees'));

    expect(await screen.findByText('Margin interest')).toBeInTheDocument();
    expect(screen.getByText('$73.55')).toBeInTheDocument();
    expect(screen.getByText(/45\.50/)).toBeInTheDocument();
    expect(screen.getByText(/28\.05/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-21/)).toBeInTheDocument();
  });

  it('lets the owner record a fresh month-to-date interest snapshot', async () => {
    mockApiForFeesTab();
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByText('Fees'));
    await user.type(
      await screen.findByLabelText('Month-to-date interest'),
      '30',
    );
    await user.click(screen.getByText('Update'));

    await waitFor(() => {
      const patchCall = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/settings/interest-accrual',
      ) as [string, RequestInit] | undefined;
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.amount).toBe(30);
      expect(typeof body.asOf).toBe('string');
    });
  });
});

