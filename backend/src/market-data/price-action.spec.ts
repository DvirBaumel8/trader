import { describe, expect, it } from 'vitest';
import { computePriceAction } from './price-action.js';
import type { RawBar } from './yahoo.client.js';

const bar = (
  date: string,
  close: number,
  extra: Partial<RawBar> = {},
): RawBar => ({
  date,
  close,
  adjClose: close,
  open: close,
  high: close,
  low: close,
  volume: 1_000_000,
  ...extra,
});

describe('computePriceAction', () => {
  it('measures today against the previous close, not against its own open', () => {
    const bars = [
      bar('2026-09-03', 100),
      bar('2026-09-04', 110, { open: 102, high: 112, low: 101 }),
    ];
    const a = computePriceAction(bars)!;

    expect(a.today.date).toBe('2026-09-04');
    expect(a.today.close).toBe(110);
    expect(a.today.open).toBe(102);
    expect(a.today.high).toBe(112);
    expect(a.today.low).toBe(101);
    // +10 on a 100 previous close. Measuring from the open would say +7.8%
    // and disagree with every quote screen he looks at.
    expect(a.today.changePercent).toBeCloseTo(0.1, 6);
  });

  it('measures the week from the close five sessions back', () => {
    const bars = [
      bar('2026-08-28', 100),
      bar('2026-08-31', 101),
      bar('2026-09-01', 102),
      bar('2026-09-02', 103),
      bar('2026-09-03', 104),
      bar('2026-09-04', 110, { high: 111, low: 99 }),
    ];
    const a = computePriceAction(bars)!;

    // Six bars: today plus five before it. 110 against the 100 close.
    expect(a.week.changePercent).toBeCloseTo(0.1, 6);
    expect(a.week.high).toBe(111);
    expect(a.week.low).toBe(99);
    expect(a.week.sessions).toBe(6);
  });

  it('returns the last ten sessions, oldest first', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      bar(`2026-08-${String(i + 1).padStart(2, '0')}`, 100 + i),
    );
    const a = computePriceAction(bars)!;

    expect(a.recent).toHaveLength(10);
    expect(a.recent[0].date).toBe('2026-08-21');
    expect(a.recent[9].date).toBe('2026-08-30');
  });

  it('has no day change on the very first bar rather than inventing one', () => {
    const a = computePriceAction([bar('2026-09-04', 110)])!;
    // Nothing to compare against. A zero here would read as "flat today".
    expect(a.today.changePercent).toBeNull();
    expect(a.week.changePercent).toBeNull();
  });

  it('is null with no bars at all', () => {
    expect(computePriceAction([])).toBeNull();
  });

  it('uses what history there is when a week is not available', () => {
    const a = computePriceAction([bar('2026-09-03', 100), bar('2026-09-04', 105)])!;
    expect(a.week.sessions).toBe(2);
    expect(a.week.changePercent).toBeCloseTo(0.05, 6);
  });

  it('ignores a missing high or low rather than treating it as zero', () => {
    const bars = [
      bar('2026-09-03', 100),
      bar('2026-09-04', 110, { high: null, low: null }),
    ];
    const a = computePriceAction(bars)!;
    expect(a.today.high).toBeNull();
    // A null low must never become the week's low, or the range reads as
    // running to zero.
    expect(a.week.low).toBe(100);
  });
});
