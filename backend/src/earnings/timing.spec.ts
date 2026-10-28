import { describe, expect, it } from 'vitest';
import { TIMING_ORDER, timingOf } from './timing.js';

describe('timingOf', () => {
  it.each([
    ['2026-11-02T13:30:00Z', 'before_open'],
    ['2026-10-29T12:30:00Z', 'before_open'],
    ['2026-11-02T21:00:00Z', 'after_close'],
    ['2026-11-02T17:00:00Z', 'during'],
    ['2026-11-02T14:30:00Z', 'during'],
  ])('%s -> %s', (iso, expected) => {
    expect(timingOf(new Date(iso))).toBe(expected);
  });
  it('null is unknown', () => {
    expect(timingOf(null)).toBe('unknown');
  });
  it('order', () => {
    expect(TIMING_ORDER).toEqual(['before_open', 'during', 'after_close', 'unknown']);
  });
});
