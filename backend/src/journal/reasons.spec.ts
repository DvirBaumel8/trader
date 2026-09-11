import { describe, expect, it } from 'vitest';
import {
  ENTRY_REASONS,
  EXIT_REASONS,
  isReasonCode,
  reasonVocabulary,
} from './reasons.js';

describe('reason vocabulary', () => {
  it('accepts a code it publishes', () => {
    expect(isReasonCode('ENTRY_BREAKOUT')).toBe(true);
    expect(isReasonCode('EXIT_STOP_EXECUTED')).toBe(true);
  });

  it('rejects anything it does not publish', () => {
    expect(isReasonCode('EXIT_FEELING_LUCKY')).toBe(false);
    expect(isReasonCode('')).toBe(false);
  });

  /**
   * Reclaiming the 150 SMA and losing it are opposite facts that would merge
   * into one meaningless count if they shared a code, so the two lists must
   * never overlap — even though both read "150 SMA" on screen.
   */
  it('gives every option its own code across both lists', () => {
    const codes = [...ENTRY_REASONS, ...EXIT_REASONS].map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('publishes both lists together for the settings payload', () => {
    expect(reasonVocabulary()).toEqual({
      opening: ENTRY_REASONS,
      closing: EXIT_REASONS,
    });
  });
});
