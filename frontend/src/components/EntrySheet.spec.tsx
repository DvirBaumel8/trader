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

function renderHarness() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('EntrySheet, composing two new entries in a row', () => {
  it('is blank the second time it is opened, after a clean save of the first', async () => {
    (api as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'created-1' });
    const user = userEvent.setup();
    renderHarness();

    // Open for entry 1, fill it in.
    await user.click(screen.getByText('New entry'));
    const symbol = screen.getByPlaceholderText('NVDA');
    await user.type(symbol, 'NVDA');
    const qty = screen.getByPlaceholderText('qty');
    await user.type(qty, '10');

    // Save entry 1.
    await user.click(screen.getByText('Save entry'));

    // Wait for the dialog to close.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('NVDA')).not.toBeInTheDocument(),
    );

    // Open for entry 2 — must be blank, not carrying entry 1's details.
    await user.click(screen.getByText('New entry'));
    const symbol2 = await screen.findByPlaceholderText('NVDA');

    expect(symbol2).toHaveValue('');
    expect(screen.getByPlaceholderText('qty')).toHaveValue(null);
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
