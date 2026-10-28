// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chat } from './Chat';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Chat />
    </QueryClientProvider>,
  );
const box = () => screen.getByPlaceholderText(/Talk to Trader/);

it('sends on Enter, clears the box, and shows the reply', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'done', message: 'Added LMND (long) to your holdings.' });
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(api).toHaveBeenCalledWith('/assistant', { method: 'POST', body: JSON.stringify({ text: 'bought LMND' }) });
  expect(await screen.findByText('Added LMND (long) to your holdings.')).toBeInTheDocument();
  expect(box()).toHaveValue('');
});

it('keeps the text when the request fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('network'));
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(await screen.findByText(/Couldn’t reach Trader/)).toBeInTheDocument();
  expect(box()).toHaveValue('bought LMND');
});

it('flips only when the confirm button is tapped', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    kind: 'confirm',
    message: 'You hold LMND long. Flip it to short?',
    action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
  });
  vi.mocked(api).mockResolvedValueOnce({ symbol: 'LMND', direction: 'SHORT', previous: 'LONG' });
  renderIt();
  await userEvent.type(box(), 'short LMND{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Flip to short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
  expect(await screen.findByText('Flipped LMND to short.')).toBeInTheDocument();
});

it('cancel clears a confirm without calling holdings', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    kind: 'confirm',
    message: 'You hold LMND long. Flip it to short?',
    action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
  });
  renderIt();
  await userEvent.type(box(), 'short LMND{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText(/Flip it to short/)).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
});

it('shows a prompt with a working Copy button', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'Date: 2026-10-28\n\nMy question:\nhello' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  expect(await screen.findByText('Prompt for Gemini')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('Date: 2026-10-28\n\nMy question:\nhello');
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

it('Shift+Enter adds a newline instead of sending', async () => {
  renderIt();
  await userEvent.type(box(), 'line one{Shift>}{Enter}{/Shift}line two');
  expect(api).not.toHaveBeenCalled();
  expect(box()).toHaveValue('line one\nline two');
});
