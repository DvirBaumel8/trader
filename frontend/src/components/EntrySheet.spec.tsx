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
});
