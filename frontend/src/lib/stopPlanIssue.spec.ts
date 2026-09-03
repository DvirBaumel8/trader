import { describe, expect, it } from 'vitest';
import { describeStopPlanIssue, type StopPlanRow } from './stopPlanIssue';

const row = (over: Partial<StopPlanRow>): StopPlanRow => ({
  symbol: 'NVDA',
  issue: 'OVER_COVERED',
  recordedQuantity: 0,
  heldQuantity: 0,
  ...over,
});

describe('describeStopPlanIssue', () => {
  it('says nothing is held when the position is closed but stops remain', () => {
    const text = describeStopPlanIssue(
      row({ issue: 'CLOSED_WITH_STOPS', recordedQuantity: 1000, heldQuantity: 0 }),
    );
    expect(text.label).toBe('Position closed');
    expect(text.detail).toContain('1,000 sh');
    expect(text.detail).toContain('nothing is held');
  });

  it('names both share counts when the tiers cover more than is held', () => {
    const text = describeStopPlanIssue(
      row({ issue: 'OVER_COVERED', recordedQuantity: 1000, heldQuantity: 600 }),
    );
    expect(text.label).toBe('Covers too much');
    expect(text.detail).toBe('Stops cover 1,000 sh of 600 held.');
  });

  it('does not quote share counts for a flipped direction — they are not the problem', () => {
    const text = describeStopPlanIssue(
      row({ issue: 'DIRECTION_MISMATCH', recordedQuantity: 200, heldQuantity: 200 }),
    );
    expect(text.label).toBe('Direction flipped');
    expect(text.detail).not.toMatch(/\d/);
  });

  it('explains an unpriced trail as missing history, not as a bad stop', () => {
    const text = describeStopPlanIssue(row({ issue: 'UNRESOLVED_TRAILING' }));
    expect(text.label).toBe('Trail unpriced');
    expect(text.detail).toContain('No price history');
  });

  it('never suggests a fix — the owner decides which tier was meant', () => {
    const issues: StopPlanRow['issue'][] = [
      'CLOSED_WITH_STOPS',
      'DIRECTION_MISMATCH',
      'OVER_COVERED',
      'UNRESOLVED_TRAILING',
    ];
    for (const issue of issues) {
      const { detail } = describeStopPlanIssue(row({ issue }));
      expect(detail).not.toMatch(/should|must|remove|delete|update your/i);
    }
  });
});
