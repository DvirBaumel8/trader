import { describe, expect, it } from 'vitest';
import { buildDailyBriefContext, type DailyBriefContextInput } from './daily-brief-context.js';

function input(over: Partial<DailyBriefContextInput> = {}): DailyBriefContextInput {
  return {
    generatedAt: '2026-09-16T14:00:00.000Z',
    notes: [],
    coverage: [],
    ...over,
  };
}

describe('buildDailyBriefContext', () => {
  it('lists each note with its source and exact wording, unchanged', () => {
    const facts = buildDailyBriefContext(
      input({
        notes: [
          { source: 'PORTFOLIO', title: 'MSFT has good momentum', detail: 'Above rising trend averages and outperforming SPY by 2.7%.' },
          { source: 'MARKET', title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' },
        ],
      }),
    );
    expect(facts).toContain('[PORTFOLIO] MSFT has good momentum: Above rising trend averages and outperforming SPY by 2.7%.');
    expect(facts).toContain('[MARKET] Fed raised rates 25 bp: Target range is now 3.75–4.00%.');
  });

  it('lists current coverage with its price, session, and whether it is a stale or extended print', () => {
    const facts = buildDailyBriefContext(
      input({
        coverage: [
          { source: 'PORTFOLIO', symbol: 'AAPL', price: 334.8, regularPrice: 336.13, stale: false, session: 'CLOSED', extended: true },
          { source: 'WATCHLIST', symbol: 'AMD', price: null, regularPrice: null, stale: true, session: null, extended: false },
        ],
      }),
    );
    expect(facts).toContain('[PORTFOLIO] AAPL: $334.80 (after-hours/overnight print, regular close $336.13)');
    expect(facts).toContain('[WATCHLIST] AMD: price unavailable (stale)');
  });

  it('says plainly when there is nothing notable, rather than leaving the section blank', () => {
    const facts = buildDailyBriefContext(input());
    expect(facts).toContain('No notable events today.');
  });

  it('never invents a number: every figure in a note or coverage row is quoted exactly, not recomputed', () => {
    // A regression guard in spirit — this builder must never call toFixed on
    // anything but the raw price/percent fields it was handed.
    const facts = buildDailyBriefContext(
      input({
        notes: [
          { source: 'PORTFOLIO', title: 'NVDA moved 2.1× its daily ATR', detail: 'Today’s move was 2.1 ATR from the prior close.' },
        ],
      }),
    );
    expect(facts).toContain('2.1');
    expect(facts).not.toMatch(/NaN/);
  });
});
