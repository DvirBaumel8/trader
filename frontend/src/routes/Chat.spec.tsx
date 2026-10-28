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
  vi.mocked(api).mockResolvedValue({ kind: 'done', message: 'Added: LMND' });
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(api).toHaveBeenCalledWith('/assistant', { method: 'POST', body: JSON.stringify({ text: 'bought LMND' }) });
  expect(await screen.findByText('Added: LMND')).toBeInTheDocument();
  expect(box()).toHaveValue('');
});

it('keeps the text when the request fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('network'));
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(await screen.findByText(/Couldn’t reach Trader/)).toBeInTheDocument();
  expect(box()).toHaveValue('bought LMND');
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

it('renders a multi-line done reply line by line', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'done', message: 'Added: LMND\nAlready held: NVDA' });
  renderIt();
  await userEvent.type(box(), 'bought LMND and NVDA{Enter}');
  const el = await screen.findByText(/Added: LMND/);
  expect(el).toHaveClass('whitespace-pre-line');
  expect(el).toHaveTextContent('Already held: NVDA');
});

it('shows the fallback note above the prompt heading', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'q', note: 'Couldn’t read that automatically.' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  const note = await screen.findByText('Couldn’t read that automatically.');
  const heading = screen.getByText('Prompt for Gemini');
  expect(note.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('shows no note when the prompt has none', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'q' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  await screen.findByText('Prompt for Gemini');
  expect(screen.queryByText(/automatically/)).toBeNull();
});

it('clears the previous reply when a send fails', async () => {
  vi.mocked(api).mockResolvedValueOnce({ kind: 'done', message: 'Added: LMND' });
  vi.mocked(api).mockRejectedValueOnce(new Error('network'));
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  await screen.findByText('Added: LMND');
  await userEvent.type(box(), 'again{Enter}');
  expect(await screen.findByText(/Couldn’t reach Trader/)).toBeInTheDocument();
  expect(screen.queryByText('Added: LMND')).toBeNull();
});

it('disables the box and Send while a send is pending', async () => {
  vi.mocked(api).mockReturnValue(new Promise(() => {}));
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  await waitFor(() => expect(box()).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('shows a manual-copy message when the clipboard rejects', async () => {
  const writeText = vi.fn(async () => {
    throw new Error('denied');
  });
  Object.assign(navigator, { clipboard: { writeText } });
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'hi' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));
  expect(await screen.findByText('Copy failed — select the text and copy it manually.')).toBeInTheDocument();
});

it('uses the accurate placeholder', () => {
  renderIt();
  expect(
    screen.getByPlaceholderText('Talk to Trader — “bought LMND”, “sold TSLA”, “watch NVDA”, or ask anything'),
  ).toBeInTheDocument();
});

it('Clear removes the reply, resets copy state and focuses the box', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'q' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));
  await screen.findByRole('button', { name: 'Copied' });
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByText('Prompt for Gemini')).toBeNull();
  expect(box()).toHaveFocus();
});

it('Clear also works on a done reply', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'done', message: 'Watching: AAPL' });
  renderIt();
  await userEvent.type(box(), 'watch AAPL{Enter}');
  await screen.findByText('Watching: AAPL');
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryByText('Watching: AAPL')).toBeNull();
  expect(box()).toHaveFocus();
});

it('Copy & open Gemini is a real link that also copies the prompt', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'the prompt' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  const link = await screen.findByRole('link', { name: 'Copy & open Gemini' });
  expect(link).toHaveAttribute('href', 'https://gemini.google.com/app');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  link.addEventListener('click', (e) => e.preventDefault()); // keep jsdom from navigating
  await userEvent.click(link);
  expect(writeText).toHaveBeenCalledWith('the prompt');
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

it('Copy & open Gemini does not cancel the link navigation itself', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'p' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  const link = await screen.findByRole('link', { name: 'Copy & open Gemini' });
  let prevented = true;
  document.addEventListener('click', (e) => { prevented = e.defaultPrevented; }, { once: true });
  await userEvent.click(link);
  expect(prevented).toBe(false);
});
