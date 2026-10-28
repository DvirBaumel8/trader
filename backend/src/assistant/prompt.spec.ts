import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt.js';
import { etDate } from '../earnings/week.js';

describe('buildPrompt', () => {
  it('carries the date, holdings (symbols only), watchlist and the message verbatim', () => {
    expect(
      buildPrompt({
        message: 'What do you think about my semis exposure?',
        date: '2026-10-28',
        holdings: ['AMZN', 'AVGO', 'TSLA'],
        watchlist: ['AMD', 'NVDA'],
      }),
    ).toBe(
      [
        'Date: Oct 28, 2026 (New York time)',
        '',
        'My holdings: AMZN, AVGO, TSLA',
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

  it('formats the date as given (the New York day, not UTC)', () => {
    const text = buildPrompt({ message: 'hi', date: etDate(new Date('2026-10-29T00:30:00Z')), holdings: [], watchlist: [] });
    expect(text.split('\n')[0]).toBe('Date: Oct 28, 2026 (New York time)');
  });
});
