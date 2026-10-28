import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GeminiClient, LlmRateLimitError, toLlmError } from './llm.client.js';

describe('GeminiClient without a key', () => {
  const saved = { g: process.env.GEMINI_API_KEY, l: process.env.LLM_API_KEY };
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;
  });
  afterEach(() => {
    if (saved.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.g;
    if (saved.l === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.l;
  });

  it('is not configured', () => {
    expect(new GeminiClient().isConfigured()).toBe(false);
  });
  it('generateJson rejects with "not configured" and makes no call', async () => {
    await expect(
      new GeminiClient().generateJson({ system: 's', user: 'u', schema: {}, timeoutMs: 100 }),
    ).rejects.toThrow(/not configured/);
  });
});

describe('GeminiClient model', () => {
  const saved = process.env.LLM_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = saved;
  });
  it('defaults to gemini-3.5-flash-lite', () => {
    delete process.env.LLM_MODEL;
    expect(new GeminiClient().modelName()).toBe('gemini-3.5-flash-lite');
  });
});

describe('toLlmError', () => {
  it('maps status 429 to LlmRateLimitError', () => {
    expect(toLlmError(Object.assign(new Error('boom'), { status: 429 }))).toBeInstanceOf(LlmRateLimitError);
  });
  it('maps a RESOURCE_EXHAUSTED message to LlmRateLimitError', () => {
    expect(toLlmError(new Error('{"status":"RESOURCE_EXHAUSTED"}'))).toBeInstanceOf(LlmRateLimitError);
  });
  it('leaves other errors unchanged', () => {
    const e = Object.assign(new Error('nope'), { status: 500 });
    expect(toLlmError(e)).toBe(e);
  });
});
