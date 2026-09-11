// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiSummary } from './AiSummary';

vi.mock('../api/client', () => ({ api: vi.fn() }));
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const row = (id: string) => ({
  id,
  createdAt: '2026-01-05T12:00:00.000Z',
  factsAsOf: '2026-01-05T12:00:00.000Z',
  preview: `summary ${id}`,
  model: 'gemini-3.8-flash',
});

function renderSummary() {
  (api as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path.startsWith('/ai/summaries'))
      return Promise.resolve([row('a'), row('b')]);
    return Promise.resolve({ configured: true, summary: null, error: null });
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AiSummary />
    </QueryClientProvider>,
  );
}

describe('AI summary history, deleting', () => {
  /** Same rule as the Journal and Ideas: delete is never ambient. */
  it('offers no delete until edit mode is on', async () => {
    const user = userEvent.setup();
    renderSummary();
    await user.click(await screen.findByText('Show history'));
    await screen.findByText('summary a');

    expect(
      screen.queryByRole('button', { name: /^delete$/i }),
    ).not.toBeInTheDocument();
  });

  it('offers delete on every row once edit mode is on', async () => {
    const user = userEvent.setup();
    renderSummary();
    await user.click(await screen.findByText('Show history'));
    await screen.findByText('summary a');

    await user.click(screen.getByRole('button', { name: 'Edit summaries' }));

    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(2);
  });
});
