import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GeminiClient } from './llm.client.js';

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
