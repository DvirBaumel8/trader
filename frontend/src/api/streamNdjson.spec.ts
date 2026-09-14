// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamNdjson } from './streamNdjson';
import { ApiError } from './client';

/** Builds a fetch Response whose body streams the given chunks (already
 * UTF-8 encoded strings) one read() at a time — lets a test control exactly
 * where a line gets split across chunk boundaries. */
function streamedResponse(chunks: string[], init: { status?: number } = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: init.status ?? 200 });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamNdjson', () => {
  it('parses one line per onLine call when lines arrive whole', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedResponse(['{"delta":"a"}\n{"delta":"b"}\n']),
    );
    const lines: unknown[] = [];

    await streamNdjson('/ai/portfolio-summary/stream', (l) => lines.push(l));

    expect(lines).toEqual([{ delta: 'a' }, { delta: 'b' }]);
  });

  it('reassembles a line split across two chunks', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedResponse(['{"del', 'ta":"ab"}\n']),
    );
    const lines: unknown[] = [];

    await streamNdjson('/ai/portfolio-summary/stream', (l) => lines.push(l));

    expect(lines).toEqual([{ delta: 'ab' }]);
  });

  it('parses a final line with no trailing newline', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      streamedResponse(['{"done":true}']),
    );
    const lines: unknown[] = [];

    await streamNdjson('/ai/portfolio-summary/stream', (l) => lines.push(l));

    expect(lines).toEqual([{ done: true }]);
  });

  it('sends the given body as JSON when one is passed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(streamedResponse(['{"done":true}']));

    await streamNdjson('/ai/trade-idea/stream', () => {}, { symbol: 'NVDA' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ symbol: 'NVDA' }));
  });

  it('sends no body at all when none is passed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(streamedResponse(['{"done":true}']));

    await streamNdjson('/ai/portfolio-summary/stream', () => {});

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('throws an ApiError on a non-ok response instead of trying to stream it', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 500 }),
    );

    await expect(
      streamNdjson('/ai/portfolio-summary/stream', () => {}),
    ).rejects.toThrow(ApiError);
  });
});
