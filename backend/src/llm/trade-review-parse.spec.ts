import { describe, expect, it } from 'vitest';
import { parseReviewMeta, stripReviewMeta } from './trade-review-parse.js';

describe('trade-review-parse', () => {
  it('parses structured meta block correctly', () => {
    const raw = `[REVIEW_META]
SCORE: A
VERDICT: Disciplined Cut at Initial Stop
[/REVIEW_META]

### Process vs Outcome
The trader respected the stop loss cleanly.`;

    const meta = parseReviewMeta(raw);
    expect(meta.score).toBe('A');
    expect(meta.verdict).toBe('Disciplined Cut at Initial Stop');

    const clean = stripReviewMeta(raw);
    expect(clean).not.toContain('[REVIEW_META]');
    expect(clean).toContain('### Process vs Outcome');
  });

  it('handles fallback when meta tags are slightly altered', () => {
    const raw = `SCORE: C
VERDICT: Hesitated on Exit with Slippage

### Discipline Breakdown
The trader waited 2 days after the stop was triggered.`;

    const meta = parseReviewMeta(raw);
    expect(meta.score).toBe('C');
    expect(meta.verdict).toBe('Hesitated on Exit with Slippage');
  });

  it('defaults gracefully on empty text', () => {
    const meta = parseReviewMeta('');
    expect(meta.score).toBe('B');
    expect(meta.verdict).toBe('Execution & Discipline Review');
  });
});
