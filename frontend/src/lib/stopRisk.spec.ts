import { describe, expect, it } from 'vitest';
import { draftRisk, type StopRow } from './stopRisk';
import { dateToIso, emptyDraft, localDate, signedQuantity } from './entryDraft';

const fixed = (price: string, quantity: string): StopRow => ({
  kind: 'FIXED',
  price,
  trailPercent: '',
  quantity,
});
const trail = (percent: string, quantity: string): StopRow => ({
  kind: 'TRAILING',
  price: '',
  trailPercent: percent,
  quantity,
});

describe('draftRisk', () => {
  it('is null with no rows', () => {
    expect(draftRisk('217', '100', [], 'BUY').amount).toBeNull();
  });

  it('computes a single fixed stop', () => {
    const r = draftRisk('217', '100', [fixed('205', '100')], 'BUY');
    expect(r.amount).toBe(1200);
    expect(r.covered).toBe(100);
    expect(r.fullyCovered).toBe(true);
  });

  it('sums a tiered plan mixing fixed and trailing', () => {
    const r = draftRisk(
      '217',
      '100',
      [fixed('205', '50'), trail('8', '50')],
      'BUY',
    );
    expect(r.amount).toBe(600 + 868);
  });

  it('reports partial coverage', () => {
    const r = draftRisk('217', '150', [fixed('205', '100')], 'BUY');
    expect(r.fullyCovered).toBe(false);
    expect(r.covered).toBe(100);
  });

  it('handles a short, where a stop sits above entry', () => {
    const r = draftRisk('300', '10', [fixed('320', '10')], 'SELL');
    expect(r.amount).toBe(200);
  });

  it('ignores a half-typed row rather than flashing a wrong number', () => {
    // Mid-typing, price is empty. Showing $21,700 for a moment would be worse
    // than showing nothing.
    const r = draftRisk('217', '100', [fixed('', '100')], 'BUY');
    expect(r.amount).toBeNull();
  });

  it('counts a stop beyond entry as covered, at zero risk', () => {
    // A stop above entry on a long locks in a gain, so it protects its
    // shares. Treating it as no coverage told the owner a winning position
    // was unprotected.
    const r = draftRisk('217', '100', [fixed('230', '100')], 'BUY');
    expect(r.amount).toBe(0);
    expect(r.covered).toBe(100);
    expect(r.fullyCovered).toBe(true);
  });

  it('shows a winner half-stopped at a gain as fully covered', () => {
    // The real META plan: 46 sh in at 593.49, 20 stopped at 572.68 and 26 at
    // 602.93. The editor used to say "covers 20 of 46 sh" in red.
    const r = draftRisk(
      '593.49',
      '46',
      [fixed('572.68', '20'), fixed('602.93', '26')],
      'BUY',
    );
    expect(r.covered).toBe(46);
    expect(r.fullyCovered).toBe(true);
    expect(r.amount).toBe(416.2);
  });

  it('is null when the entry price is not yet filled in', () => {
    expect(draftRisk('', '100', [fixed('205', '100')], 'BUY').amount).toBeNull();
  });
});

describe('localDate', () => {
  it('formats the local calendar date', () => {
    expect(localDate(new Date(2026, 7, 29, 9, 5))).toBe('2026-08-29');
  });
  it('pads single digits', () => {
    expect(localDate(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02');
  });
  it('keeps the local day even late at night', () => {
    // Midnight-adjacent times are where UTC-based formatting slips a day.
    expect(localDate(new Date(2026, 7, 29, 23, 50))).toBe('2026-08-29');
  });
});

describe('dateToIso', () => {
  it('round-trips a picked date back to the same local day', () => {
    expect(localDate(new Date(dateToIso('2026-08-29')))).toBe('2026-08-29');
  });
  it('lands at local midday, away from the day boundary', () => {
    expect(new Date(dateToIso('2026-08-29')).getHours()).toBe(12);
  });
  it('falls back to now rather than producing an invalid date', () => {
    expect(Number.isNaN(new Date(dateToIso('')).getTime())).toBe(false);
  });
});

describe('signedQuantity', () => {
  it('is positive for a buy', () => {
    const d = { ...emptyDraft(4), side: 'BUY' as const, quantity: '10' };
    expect(signedQuantity(d)).toBe(10);
  });
  it('is negative for a sell', () => {
    const d = { ...emptyDraft(4), side: 'SELL' as const, quantity: '10' };
    expect(signedQuantity(d)).toBe(-10);
  });
  it('ignores a typed minus sign so it cannot double-negate', () => {
    const d = { ...emptyDraft(4), side: 'SELL' as const, quantity: '-10' };
    expect(signedQuantity(d)).toBe(-10);
  });
  it('is zero for an empty quantity', () => {
    expect(signedQuantity({ ...emptyDraft(4), quantity: '' })).toBe(0);
  });
});

describe('emptyDraft', () => {
  it('prefills the fee from the user default', () => {
    expect(emptyDraft(4).fee).toBe('4');
  });
  it('starts as a trade entry', () => {
    expect(emptyDraft(4).kind).toBe('TRADE');
  });
});
