import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { GeminiClient, LlmFailure, withRetry } from './llm.client.js';

// `GoogleGenAI` is mocked so `GeminiClient` wiring tests below never touch
// the network; `ApiError` is kept real (via importOriginal) since it's a
// plain data-carrying class and the whole point is exercising the real
// `instanceof ApiError` check in `classify()`.
const generateContent = vi.fn();
const generateContentStream = vi.fn();
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent, generateContentStream };
    },
  };
});

/** Builds the async generator `generateContentStream` resolves to, from a
 * plain array of chunk texts — what the SDK yields when a real call is made. */
async function* fakeStream(texts: string[]) {
  for (const text of texts) yield { text };
}

/** Drains an `AsyncIterable<string>` into an array, for asserting on. */
async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/**
 * `withRetry` is the pure retry/backoff/classification core that
 * `GeminiClient.complete()` wraps around the real SDK call. Testing it here
 * — mocking only the function it calls (`fn`, standing in for a call to the
 * provider) and an injected `sleep` — covers the retry behaviour completely
 * without ever touching the real Gemini API or a real clock.
 */
describe('withRetry', () => {
  const instantSleep = vi.fn().mockResolvedValue(undefined);

  afterEach(() => {
    instantSleep.mockClear();
  });

  it('retries a transient 503 and returns the eventual success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 503 }))
      .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 503 }))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { sleep: instantSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('exhausts retries on a persistent 503 and reports it as busy', async () => {
    const err = new ApiError({ message: 'still busy', status: 503 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'busy',
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404 (bad model name) and reports it as a setup problem', async () => {
    const err = new ApiError({ message: 'model not found', status: 404 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'setup_problem',
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it('does not retry a 401 (auth failure) and reports it as a setup problem', async () => {
    const err = new ApiError({ message: 'unauthorized', status: 401 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'setup_problem',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 403 (auth failure) and reports it as a setup problem', async () => {
    const err = new ApiError({ message: 'forbidden', status: 403 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'setup_problem',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 400 (invalid request) and reports it as a setup problem', async () => {
    const err = new ApiError({ message: 'bad request', status: 400 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'setup_problem',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and, once exhausted, reports it as quota_exceeded rather than busy', async () => {
    const err = new ApiError({ message: 'rate limited', status: 429 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'quota_exceeded',
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('recovers from a 429 that clears on retry', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { sleep: instantSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a plain error with no HTTP status, classifying it unknown', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network hiccup'));

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toMatchObject({
      kind: 'unknown',
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it('uses short exponential backoff between retry attempts', async () => {
    const err = new ApiError({ message: 'busy', status: 503 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toBeInstanceOf(LlmFailure);

    expect(instantSleep).toHaveBeenCalledTimes(2);
    expect(instantSleep.mock.calls[0][0]).toBe(1000);
    expect(instantSleep.mock.calls[1][0]).toBe(2000);
  });

  it('honours a custom maxAttempts', async () => {
    const err = new ApiError({ message: 'busy', status: 503 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { sleep: instantSleep, maxAttempts: 2 }),
    ).rejects.toMatchObject({ kind: 'busy' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(instantSleep).toHaveBeenCalledTimes(1);
  });

  it('carries the original error as the cause and keeps its message', async () => {
    const err = new ApiError({ message: 'model not found', status: 404 });
    const fn = vi.fn().mockRejectedValue(err);

    let caught: unknown;
    try {
      await withRetry(fn, { sleep: instantSleep });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(LlmFailure);
    expect((caught as LlmFailure).cause).toBe(err);
    expect((caught as LlmFailure).message).toContain('model not found');
  });
});

/**
 * Thin wiring tests for `GeminiClient.complete()` itself: that it gates on
 * `isConfigured()` before ever calling the SDK, that a real success path
 * returns the text, that an empty response is treated as a failure, and
 * that a transient failure is retried through the real (mocked-SDK) call
 * path — not just inside the standalone `withRetry` tests above.
 */
describe('GeminiClient', () => {
  const originalApiKey = process.env.LLM_API_KEY;
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;
  const originalThinkingLevel = process.env.LLM_THINKING_LEVEL;

  beforeEach(() => {
    generateContent.mockReset();
    process.env.LLM_API_KEY = 'test-key';
    delete process.env.GEMINI_API_KEY;
    process.env.LLM_PROVIDER = 'gemini';
    delete process.env.LLM_THINKING_LEVEL;
  });

  afterEach(() => {
    process.env.LLM_API_KEY = originalApiKey;
    if (originalGeminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    process.env.LLM_PROVIDER = originalProvider;
    if (originalThinkingLevel !== undefined) {
      process.env.LLM_THINKING_LEVEL = originalThinkingLevel;
    } else {
      delete process.env.LLM_THINKING_LEVEL;
    }
  });

  it('throws a setup_problem LlmFailure without calling the SDK when unconfigured', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const client = new GeminiClient();

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      kind: 'setup_problem',
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns the model text on a first-try success', async () => {
    generateContent.mockResolvedValueOnce({ text: 'hello' });
    const client = new GeminiClient();

    const result = await client.complete({ system: 's', user: 'u' });

    expect(result).toBe('hello');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('treats an empty response body as a failure rather than returning it', async () => {
    generateContent.mockResolvedValueOnce({ text: '' });
    const client = new GeminiClient();

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      kind: 'unknown',
    });
  });

  it('retries a transient 503 through the real complete() call and succeeds', async () => {
    vi.useFakeTimers();
    try {
      generateContent
        .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 503 }))
        .mockResolvedValueOnce({ text: 'ok' });
      const client = new GeminiClient();

      const pending = client.complete({ system: 's', user: 'u' });
      // Let the retry's backoff timer elapse without a real 1s wait.
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toBe('ok');
      expect(generateContent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends no thinkingConfig by default, preserving the provider\'s own automatic budget', async () => {
    generateContent.mockResolvedValueOnce({ text: 'hello' });
    const client = new GeminiClient();

    await client.complete({ system: 's', user: 'u' });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig).toBeUndefined();
  });

  it('passes thinkingLevel through when LLM_THINKING_LEVEL is a recognised value', async () => {
    process.env.LLM_THINKING_LEVEL = 'MINIMAL';
    generateContent.mockResolvedValueOnce({ text: 'hello' });
    const client = new GeminiClient();

    await client.complete({ system: 's', user: 'u' });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
  });

  it('ignores an unrecognised LLM_THINKING_LEVEL rather than sending it to the provider', async () => {
    process.env.LLM_THINKING_LEVEL = 'ULTRA';
    generateContent.mockResolvedValueOnce({ text: 'hello' });
    const client = new GeminiClient();

    await client.complete({ system: 's', user: 'u' });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig).toBeUndefined();
  });

  describe('completeStream', () => {
    it('throws a setup_problem LlmFailure without calling the SDK when unconfigured', async () => {
      delete process.env.LLM_API_KEY;
      delete process.env.GEMINI_API_KEY;
      const client = new GeminiClient();

      await expect(collect(client.completeStream({ system: 's', user: 'u' }))).rejects.toMatchObject(
        { kind: 'setup_problem' },
      );
      expect(generateContentStream).not.toHaveBeenCalled();
    });

    it('yields each chunk\'s text as it arrives', async () => {
      generateContentStream.mockResolvedValueOnce(fakeStream(['Hel', 'lo, ', 'world']));
      const client = new GeminiClient();

      const chunks = await collect(client.completeStream({ system: 's', user: 'u' }));

      expect(chunks).toEqual(['Hel', 'lo, ', 'world']);
    });

    it('treats a stream with no non-empty chunks as a failure', async () => {
      generateContentStream.mockResolvedValueOnce(fakeStream([]));
      const client = new GeminiClient();

      await expect(collect(client.completeStream({ system: 's', user: 'u' }))).rejects.toMatchObject(
        { kind: 'unknown' },
      );
    });

    it('retries establishing the stream on a transient 503, then yields normally', async () => {
      vi.useFakeTimers();
      try {
        generateContentStream
          .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 503 }))
          .mockResolvedValueOnce(fakeStream(['ok']));
        const client = new GeminiClient();

        const pending = collect(client.completeStream({ system: 's', user: 'u' }));
        await vi.advanceTimersByTimeAsync(1000);

        await expect(pending).resolves.toEqual(['ok']);
        expect(generateContentStream).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips an empty delta in the middle of an otherwise successful stream', async () => {
      generateContentStream.mockResolvedValueOnce(fakeStream(['first', '', 'second']));
      const client = new GeminiClient();

      const chunks = await collect(client.completeStream({ system: 's', user: 'u' }));

      expect(chunks).toEqual(['first', 'second']);
    });

    it('passes thinkingLevel through the same as complete()', async () => {
      process.env.LLM_THINKING_LEVEL = 'MINIMAL';
      generateContentStream.mockResolvedValueOnce(fakeStream(['hi']));
      const client = new GeminiClient();

      await collect(client.completeStream({ system: 's', user: 'u' }));

      const config = generateContentStream.mock.calls[0][0].config;
      expect(config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    });
  });
});
