// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiSummary } from './AiSummary';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: vi.fn() };
});
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

/** Builds a fetch Response streaming the given ndjson lines, one read() per
 * array entry — mirrors the real backend's `Content-Type: application/x-ndjson`
 * response shape from `POST /ai/portfolio-summary/stream`. */
function streamedNdjsonResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(lines[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status });
}

describe('AI summary generation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the text growing as delta lines arrive, before the summary is done', async () => {
    let resolveSecondRead: () => void = () => {};
    const secondRead = new Promise<void>((resolve) => {
      resolveSecondRead = resolve;
    });
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const encoder = new TextEncoder();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(encoder.encode('{"delta":"You are up "}\n'));
            return;
          }
          await secondRead;
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: 'Analyse my portfolio' }));

    expect(await screen.findByText('You are up')).toBeInTheDocument();
    resolveSecondRead();
  });

  it('shows the finished, collapsible summary once the done line arrives', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"delta":"You are up 4.2% this month."}\n',
        '{"done":true,"configured":true,"factsAsOf":"2026-01-05T12:00:00.000Z","error":null,"errorKind":null,"id":"new-1"}\n',
      ]),
    );
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: 'Analyse my portfolio' }));

    expect(
      await screen.findByText('You are up 4.2% this month.'),
    ).toBeInTheDocument();
    expect(screen.getByText('AI generated')).toBeInTheDocument();
  });

  it('shows the unconfigured message when the stream reports no key set, with no summary text', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse([
        '{"done":true,"configured":false,"factsAsOf":null,"error":null,"errorKind":null,"id":null}\n',
      ]),
    );
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: 'Analyse my portfolio' }));

    expect(
      await screen.findByText(/AI summaries aren't set up yet/),
    ).toBeInTheDocument();
  });

  it('shows a plain error message when the stream ends without ever sending a done line', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedNdjsonResponse(['{"delta":"partial answer"}\n']),
    );
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: 'Analyse my portfolio' }));

    expect(
      await screen.findByText(
        'Something went wrong generating the summary. Try again in a bit.',
      ),
    ).toBeInTheDocument();
    // The incomplete partial text must not be shown as if it were a real answer.
    expect(screen.queryByText(/partial answer/)).not.toBeInTheDocument();
  });

  it('shows a network error message when the request itself fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'boom' }), { status: 500 }),
    );
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: 'Analyse my portfolio' }));

    expect(
      await screen.findByText(
        "Couldn't reach the AI summary right now. Try again in a bit.",
      ),
    ).toBeInTheDocument();
  });
});

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
