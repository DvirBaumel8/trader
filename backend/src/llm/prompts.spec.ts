import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
  it('tells the model every number is precomputed and must be quoted, not calculated', () => {
    const prompt = buildSystemPrompt(null);
    expect(prompt).toMatch(/never .*calculate|never .*recompute/i);
    expect(prompt).toMatch(/never invent/i);
  });

  it('renders an honest fallback when no profile has been recorded, without inventing one', () => {
    const prompt = buildSystemPrompt(null);
    expect(prompt).toContain('No profile has been recorded yet');
  });

  it('renders the same fallback for an empty or whitespace-only profile file', () => {
    const prompt = buildSystemPrompt('   \n  ');
    expect(prompt).toContain('No profile has been recorded yet');
  });

  it('includes the profile content verbatim when one is supplied', () => {
    const profile = '## Edge\n\nSells option premium on earnings drift.';
    const prompt = buildSystemPrompt(profile);
    expect(prompt).toContain('Sells option premium on earnings drift.');
    expect(prompt).not.toContain('No profile has been recorded yet');
  });
});

describe('buildUserPrompt', () => {
  it('carries the exact facts block through untouched', () => {
    const facts = 'FACTS (as of 2026-09-02T14:30:00.000Z)\n- Account value: $21,000.00';
    const prompt = buildUserPrompt(facts);
    expect(prompt).toContain(facts);
  });

  it('asks for judgement, and forbids restating what a screen already shows', () => {
    const prompt = buildUserPrompt('irrelevant facts');
    expect(prompt).toMatch(/what you actually think/i);
    expect(prompt).toMatch(/looking at a screen/i);
    // A summary request produces a summary; this one must not read as one.
    expect(prompt).not.toMatch(/give me an AI summary/i);
  });
});
