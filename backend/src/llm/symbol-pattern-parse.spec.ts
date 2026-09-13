import { describe, expect, it } from 'vitest';
import { parsePatternMeta, stripPatternMeta } from './symbol-pattern-parse.js';

describe('symbol-pattern-parse', () => {
  it('parses the structured meta block correctly', () => {
    const raw = `[PATTERN_META]
HEADLINE: You cut winners early in this name
[/PATTERN_META]

You tend to exit NVDA well before your average hold time.`;

    const meta = parsePatternMeta(raw);
    expect(meta.headline).toBe('You cut winners early in this name');

    const clean = stripPatternMeta(raw);
    expect(clean).not.toContain('[PATTERN_META]');
    expect(clean).toContain('You tend to exit NVDA');
  });

  it('falls back to pattern-matching when the tags are altered', () => {
    const raw = `HEADLINE: Bigger size, same discipline

You size up in this name but keep the same stop discipline.`;

    const meta = parsePatternMeta(raw);
    expect(meta.headline).toBe('Bigger size, same discipline');
  });

  it('defaults gracefully on empty text', () => {
    expect(parsePatternMeta('').headline).toBe('Pattern read');
  });
});
