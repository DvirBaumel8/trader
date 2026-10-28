import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt.js';

describe('buildPrompt', () => {
  it('carries the date, holdings with direction, watchlist and the message verbatim', () => {
    expect(
      buildPrompt({
        message: 'What do you think about my semis exposure?',
        date: '2026-10-28',
        holdings: [
          { symbol: 'LMND', direction: 'LONG' },
          { symbol: 'TSLA', direction: 'SHORT' },
        ],
        watchlist: ['AMD', 'NVDA'],
      }),
    ).toBe(
      [
        'Date: 2026-10-28',
        '',
        'My holdings: LMND (long), TSLA (short)',
        'My watchlist: AMD, NVDA',
        '',
        'My question:',
        'What do you think about my semis exposure?',
      ].join('\n'),
    );
  });

  it('says none for empty lists', () => {
    const text = buildPrompt({ message: 'hi', date: '2026-10-28', holdings: [], watchlist: [] });
    expect(text).toContain('My holdings: none');
    expect(text).toContain('My watchlist: none');
  });
});
