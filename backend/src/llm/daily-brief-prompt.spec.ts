import { describe, expect, it } from 'vitest';
import { buildDailyBriefUserPrompt } from './daily-brief-prompt.js';

describe('buildDailyBriefUserPrompt', () => {
  it('carries the exact facts block through untouched', () => {
    const facts = 'FACTS (daily brief as of 2026-09-16T14:00:00.000Z)\n- No notable events today.';
    const prompt = buildDailyBriefUserPrompt(facts);
    expect(prompt).toContain(facts);
  });

  it('asks for a prioritized read, not a restatement of the note list', () => {
    const prompt = buildDailyBriefUserPrompt('irrelevant facts');
    expect(prompt).toMatch(/prioritized/i);
    expect(prompt).not.toMatch(/summarize each/i);
  });
});
