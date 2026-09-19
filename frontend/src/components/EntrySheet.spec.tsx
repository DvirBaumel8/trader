// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntrySheet } from './EntrySheet';
import type { Entry } from './EntryCard';
import { stubLocalStorage } from '../test/memoryLocalStorage';
import { emptyDraft } from '../lib/entryDraft';

vi.mock('../api/client', () => ({
  api: vi.fn(),
}));

import { api } from '../api/client';

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});

afterEach(cleanup);

/** Mirrors exactly how Journal.tsx wires composing/editing into EntrySheet. */
function Harness() {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const close = () => {
    setComposing(false);
    setEditing(null);
  };
  return (
    <>
      <button onClick={() => setComposing(true)}>New entry</button>
      <EntrySheet
        open={composing || editing !== null}
        onClose={close}
        defaultFee={4}
        editing={editing}
      />
    </>
  );
}

/** Fills the two platform-reconciliation fields a new trade now requires before Save enables. */
async function fillReportedCash(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Platform net cash'), '1000');
  await user.type(screen.getByLabelText('Platform balance after'), '5000');
}

function renderHarness() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('EntrySheet, composing two new entries in a row', () => {
  it('stays open and resets to blank after saving a new entry', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    // Open for entry 1, fill it in.
    await user.click(screen.getByText('New entry'));
    const symbol = screen.getByPlaceholderText('NVDA');
    await user.type(symbol, 'NVDA');
    const qty = screen.getByPlaceholderText('qty');
    await user.type(qty, '10');
    await fillReportedCash(user);

    // Save entry 1.
    await user.click(screen.getByText('Save entry'));

    // The composer remains available for entry 2, but must be blank rather
    // than carrying entry 1's details.
    const symbol2 = await screen.findByPlaceholderText('NVDA');
    expect(symbol2).toBeVisible();
    expect(symbol2).toHaveValue('');
    expect(screen.getByPlaceholderText('qty')).toHaveValue(null);
  });

  it('keeps the picked date for the next entry, rather than resetting to today', async () => {
    // Backfilling a past day is normally several entries in a row, all on
    // that same day — resetting the date to today after each save would
    // mean re-picking it every single time.
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    const dateInput = screen.getByLabelText('Date');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-08-01');
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.type(screen.getByPlaceholderText('qty'), '10');
    await fillReportedCash(user);

    await user.click(screen.getByText('Save entry'));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('NVDA')).toHaveValue(''),
    );
    expect(screen.getByLabelText('Date')).toHaveValue('2026-08-01');
  });

  it('is blank on a new entry even when a draft was abandoned, not saved', async () => {
    // The owner's rule, in his words: a new activity screen is empty ALWAYS —
    // not empty once a timer expires. Abandoning a half-typed entry and
    // opening a new one must not bring the old text back, however recently it
    // was typed.
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'TSLA');

    // Dismiss without saving.
    await user.click(screen.getByLabelText('Close'));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('NVDA')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByText('New entry'));
    expect(await screen.findByPlaceholderText('NVDA')).toHaveValue('');
  });

  it('brings the draft back when the app was discarded mid-entry', async () => {
    // The exception, and the reason the draft exists at all: iOS reclaiming
    // the tab is the same form returning, not a new one being opened. Without
    // this, switching to the broker app to read a fill loses what was typed.
    window.localStorage.setItem(
      'trader.entryDraft.v1',
      JSON.stringify({
        v: { ...emptyDraft(4), symbol: 'MSTR', quantity: '25' },
        savedAt: Date.now(),
      }),
    );

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <EntrySheet open onClose={() => {}} defaultFee={4} editing={null} resuming />
      </QueryClientProvider>,
    );

    expect(await screen.findByPlaceholderText('NVDA')).toHaveValue('MSTR');
    expect(screen.getByPlaceholderText('qty')).toHaveValue(25);
  });
});

describe('EntrySheet, platform reconciliation fields', () => {
  it('disables Save on a new trade until both platform fields are filled', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.type(screen.getByPlaceholderText('qty'), '10');
    expect(screen.getByText('Save entry')).toBeDisabled();

    await user.type(screen.getByLabelText('Platform net cash'), '1000');
    expect(screen.getByText('Save entry')).toBeDisabled();

    await user.type(screen.getByLabelText('Platform balance after'), '5000');
    expect(screen.getByText('Save entry')).not.toBeDisabled();
  });

  it('sends the net cash negated for a buy and as-is for a sell, from a plain positive amount', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.type(screen.getByPlaceholderText('qty'), '10');
    await user.type(screen.getByLabelText('Platform net cash'), '1004');
    await user.type(screen.getByLabelText('Platform balance after'), '-165188');
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      const save = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/journal',
      );
      expect(save).toBeDefined();
      expect(bodyOf(save as unknown[]).trade).toMatchObject({
        reportedNetCash: -1004,
        reportedBalance: -165188,
      });
    });
  });

  it('fills the price from quantity, fee, and platform net cash — recovering precision a typed 2-decimal price would lose', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    await user.type(screen.getByPlaceholderText('qty'), '600');
    await user.clear(screen.getByPlaceholderText('fee'));
    await user.type(screen.getByPlaceholderText('fee'), '6');
    await user.type(screen.getByLabelText('Platform net cash'), '22149');

    // 600 sold, fee 6, net cash 22149 → price = (22149 + 6) / 600 = 36.925.
    expect(screen.getByPlaceholderText('price')).toHaveValue(36.925);

    await user.type(screen.getByLabelText('Platform balance after'), '22149');
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      const save = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/journal',
      );
      expect(bodyOf(save as unknown[]).trade.price).toBe(36.925);
    });
  });

  it('stops re-suggesting a price once cleared, rather than fighting an owner trying to type their own', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    await user.type(screen.getByPlaceholderText('qty'), '600');
    await user.clear(screen.getByPlaceholderText('fee'));
    await user.type(screen.getByPlaceholderText('fee'), '6');
    await user.type(screen.getByLabelText('Platform net cash'), '22149');

    // Computed and shown automatically — nothing typed into price yet.
    expect(screen.getByPlaceholderText('price')).toHaveValue(36.925);

    // Clearing it to type a different value must not bring the suggestion
    // straight back, exactly like the quantity suggestion never does.
    await user.clear(screen.getByPlaceholderText('price'));
    expect(screen.getByPlaceholderText('price')).toHaveValue(null);

    await user.type(screen.getByPlaceholderText('price'), '37');
    expect(screen.getByPlaceholderText('price')).toHaveValue(37);
  });

  it('does not force platform fields on an old trade that was never reconciled', async () => {
    const savedEntry: Entry = {
      id: 'entry-1',
      kind: 'TRADE',
      body: '',
      occurredAt: '2026-09-01T14:30:00.000Z',
      trade: {
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 10,
        price: 200,
        fee: 4,
        plannedTarget: null,
        stopLevels: [],
        riskAmount: null,
        exitKind: null,
        stopExecutions: [],
        reportedNetCash: null,
        reportedBalance: null,
        reconciliation: null,
      },
      cash: null,
      dividend: null,
      tags: [],
      reasons: [],
    };
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1' });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <EntrySheet open onClose={() => {}} defaultFee={4} editing={savedEntry} />
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue('NVDA');
    expect(screen.getByLabelText('Platform net cash')).toHaveValue(null);
    expect(screen.getByText('Save changes')).not.toBeDisabled();
  });

  it('keeps requiring the platform fields when editing a trade that was already reconciled', async () => {
    const savedEntry: Entry = {
      id: 'entry-1',
      kind: 'TRADE',
      body: '',
      occurredAt: '2026-09-01T14:30:00.000Z',
      trade: {
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 10,
        price: 200,
        fee: 4,
        plannedTarget: null,
        stopLevels: [],
        riskAmount: null,
        exitKind: null,
        stopExecutions: [],
        reportedNetCash: -2004,
        reportedBalance: 5000,
        reconciliation: {
          expectedNetCash: -2004,
          expectedBalance: 5000,
          netCashMismatch: false,
          balanceMismatch: false,
        },
      },
      cash: null,
      dividend: null,
      tags: [],
      reasons: [],
    };
    const user = userEvent.setup();
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'entry-1' });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <EntrySheet open onClose={() => {}} defaultFee={4} editing={savedEntry} />
      </QueryClientProvider>,
    );

    await screen.findByDisplayValue('NVDA');
    expect(screen.getByLabelText('Platform net cash')).toHaveValue(2004);
    expect(screen.getByText('Save changes')).not.toBeDisabled();

    await user.clear(screen.getByLabelText('Platform net cash'));
    expect(screen.getByText('Save changes')).toBeDisabled();
  });
});

/** Routes the mocked api by path, so a test can stock the portfolio. */
function stubApi(positions: { symbol: string; quantity: number }[]) {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/portfolio') return Promise.resolve({ positions });
    if (path === '/settings')
      return Promise.resolve({
        defaultFee: 4,
        reasons: {
          opening: [
            { code: 'ENTRY_BREAKOUT', label: 'Breakout' },
            { code: 'ENTRY_SMA_150', label: '150 SMA' },
          ],
          closing: [
            { code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' },
            { code: 'EXIT_RISK_OFF', label: 'Risk off' },
          ],
        },
      });
    return Promise.resolve({ id: 'created-1' });
  });
}

const bodyOf = (call: unknown[]) =>
  JSON.parse((call[1] as { body: string }).body);

describe('EntrySheet, selling something already held', () => {
  it('prefills the quantity with the whole position', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('qty')).toHaveValue(500),
    );
  });

  it('offers the magnitude when buying back a short', async () => {
    stubApi([{ symbol: 'LMND', quantity: -300 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'LMND');

    await waitFor(() =>
      expect(screen.getByPlaceholderText('qty')).toHaveValue(300),
    );
  });

  it('never overwrites a quantity the owner typed himself', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('qty'), '200');
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));

    await screen.findByText(/500 held/);
    expect(screen.getByPlaceholderText('qty')).toHaveValue(200);
  });

  it('leaves the quantity alone when the fill opens rather than closes', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');

    await screen.findByRole('button', { name: 'Breakout' });
    expect(screen.getByPlaceholderText('qty')).toHaveValue(null);
  });
});

describe('EntrySheet reason chips', () => {
  it('offers exit reasons on a closing fill', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));

    await screen.findByRole('button', { name: 'Stop executed' });
    expect(
      screen.queryByRole('button', { name: 'Breakout' }),
    ).not.toBeInTheDocument();
  });

  it('offers entry reasons on a fill that opens a position', async () => {
    stubApi([]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'TSLA');

    await screen.findByRole('button', { name: 'Breakout' });
    expect(
      screen.queryByRole('button', { name: 'Stop executed' }),
    ).not.toBeInTheDocument();
  });

  it('sends the codes of the chips that are on, including the closing default', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    // "Stop executed" is already on by default for a closing fill — tapping
    // "Risk off" adds to it rather than replacing it.
    await user.click(await screen.findByRole('button', { name: 'Risk off' }));
    await user.type(screen.getByPlaceholderText('price'), '100');
    await fillReportedCash(user);
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      const save = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/journal',
      );
      expect(save).toBeDefined();
      expect(bodyOf(save as unknown[]).reasons).toEqual([
        'EXIT_STOP_EXECUTED',
        'EXIT_RISK_OFF',
      ]);
    });
  });

  it('turns a chip back off when tapped again', async () => {
    stubApi([]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'TSLA');
    const chip = await screen.findByRole('button', { name: 'Breakout' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('defaults "Stop executed" to on for a closing fill, before any tap', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));

    const chip = await screen.findByRole('button', { name: 'Stop executed' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the default "Stop executed" chip off once tapped off, rather than reappearing', async () => {
    stubApi([{ symbol: 'NVDA', quantity: 500 }]);
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));

    const chip = await screen.findByRole('button', { name: 'Stop executed' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    // Typing elsewhere (a re-render trigger) must not bring it back.
    await user.type(screen.getByPlaceholderText('price'), '100');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not default a saved entry\'s cleared reasons back to "Stop executed" when editing', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/portfolio')
        return Promise.resolve({ positions: [{ symbol: 'NVDA', quantity: 500 }] });
      if (path === '/settings')
        return Promise.resolve({
          defaultFee: 4,
          reasons: {
            opening: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
            closing: [{ code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' }],
          },
        });
      return Promise.resolve({ id: 'created-1' });
    });
    const savedEntry: Entry = {
      id: 'entry-1',
      kind: 'TRADE',
      body: '',
      occurredAt: '2026-09-01T14:30:00.000Z',
      trade: {
        symbol: 'NVDA',
        side: 'SELL',
        quantity: 100,
        price: 220,
        fee: 4,
        plannedTarget: null,
        stopLevels: [],
        riskAmount: null,
        exitKind: null,
        stopExecutions: [],
      },
      cash: null,
      dividend: null,
      tags: [],
      reasons: [],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EntrySheet open onClose={() => {}} defaultFee={4} editing={savedEntry} />
      </QueryClientProvider>,
    );

    const chip = await screen.findByRole('button', { name: 'Stop executed' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });
});

/** Routes the mocked api by path AND method, and lets `/portfolio` answer
 * differently before vs. after the save — the shape the auto-watch tests
 * below need, since the whole point is "the position was there, then it
 * wasn't". */
function stubApiForSale(opts: {
  beforePositions: { symbol: string; quantity: number }[];
  afterPositions: { symbol: string; quantity: number }[];
}) {
  let portfolioCalls = 0;
  (api as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string) => {
      if (path === '/portfolio') {
        portfolioCalls += 1;
        return Promise.resolve({
          positions: portfolioCalls === 1 ? opts.beforePositions : opts.afterPositions,
        });
      }
      if (path === '/settings') {
        return Promise.resolve({
          defaultFee: 4,
          reasons: {
            opening: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
            closing: [{ code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' }],
          },
        });
      }
      if (path === '/journal') return Promise.resolve({ id: 'created-1' });
      if (path === '/watchlist') return Promise.resolve({ id: 'wl-1' });
      return Promise.resolve({});
    },
  );
}

describe('EntrySheet, auto-watching a name once fully sold', () => {
  it('adds the symbol to the watchlist when a sell empties the position out', async () => {
    stubApiForSale({
      beforePositions: [{ symbol: 'NVDA', quantity: 500 }],
      afterPositions: [],
    });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('qty')).toHaveValue(500),
    );
    await user.type(screen.getByPlaceholderText('price'), '220');
    await fillReportedCash(user);
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      const watch = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/watchlist',
      );
      expect(watch).toBeDefined();
      expect(bodyOf(watch as unknown[])).toEqual({ symbol: 'NVDA' });
    });
  });

  it('does not add to the watchlist when the sell only reduces the position, not closes it', async () => {
    stubApiForSale({
      beforePositions: [{ symbol: 'NVDA', quantity: 500 }],
      // Still holds some after the sell — a partial exit, not a full one.
      afterPositions: [{ symbol: 'NVDA', quantity: 200 }],
    });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    await user.clear(screen.getByPlaceholderText('qty'));
    await user.type(screen.getByPlaceholderText('qty'), '300');
    await user.type(screen.getByPlaceholderText('price'), '220');
    await fillReportedCash(user);
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      expect(
        (api as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/journal'),
      ).toBe(true);
    });
    expect(
      (api as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/watchlist'),
    ).toBe(false);
  });

  it('does not add to the watchlist for a fill that opens a position', async () => {
    stubApiForSale({ beforePositions: [], afterPositions: [] });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'TSLA');
    await user.type(screen.getByPlaceholderText('qty'), '10');
    await user.type(screen.getByPlaceholderText('price'), '220');
    await fillReportedCash(user);
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      expect(
        (api as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/journal'),
      ).toBe(true);
    });
    expect(
      (api as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === '/watchlist'),
    ).toBe(false);
  });

  it('keeps the new-entry sheet open even when the auto-watch call itself fails', async () => {
    (api as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string, init?: RequestInit) => {
        if (path === '/portfolio') {
          return Promise.resolve({ positions: [{ symbol: 'NVDA', quantity: 500 }] });
        }
        if (path === '/settings') {
          return Promise.resolve({
            defaultFee: 4,
            reasons: {
              opening: [],
              closing: [{ code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' }],
            },
          });
        }
        if (path === '/journal' && init?.method === 'POST') {
          return Promise.resolve({ id: 'created-1' });
        }
        if (path === '/watchlist') return Promise.reject(new Error('provider down'));
        return Promise.resolve({});
      },
    );
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.type(screen.getByPlaceholderText('NVDA'), 'NVDA');
    await user.click(screen.getByRole('button', { name: 'SELL' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('qty')).toHaveValue(500),
    );
    await user.type(screen.getByPlaceholderText('price'), '220');
    await fillReportedCash(user);
    await user.click(screen.getByText('Save entry'));

    // A failed best-effort watchlist add must never read as the trade itself
    // failing to save, and the new-entry composer remains chained.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('price')).toBeInTheDocument(),
    );
  });
});

describe('EntrySheet, an interest charge', () => {
  it('submits a margin-interest charge as its own kind, distinct from a cash withdrawal', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('New entry'));
    await user.click(screen.getByText('Interest'));
    await user.type(screen.getByPlaceholderText('amount charged'), '45.5');
    await user.click(screen.getByText('Save entry'));

    await waitFor(() => {
      const save = (api as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === '/journal',
      );
      expect(save).toBeDefined();
      const body = bodyOf(save as unknown[]);
      expect(body.kind).toBe('INTEREST');
      expect(body.interest).toEqual({ amount: 45.5 });
      expect(body.cash).toBeUndefined();
    });
  });
});
