import { describe, expect, it } from 'vitest';
import { draftRisk, type StopRow } from './stopRisk';
import { emptyDraft, nowLocalInput, signedQuantity } from './entryDraft';

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

  it('ignores a stop on the wrong side of the entry', () => {
    expect(draftRisk('217', '100', [fixed('230', '100')], 'BUY').amount).toBeNull();
  });

  it('is null when the entry price is not yet filled in', () => {
    expect(draftRisk('', '100', [fixed('205', '100')], 'BUY').amount).toBeNull();
  });
});

describe('nowLocalInput', () => {
  it('formats local time for a datetime-local input', () => {
    expect(nowLocalInput(new Date(2026, 7, 29, 9, 5))).toBe('2026-08-29T09:05');
  });
  it('pads single digits', () => {
    expect(nowLocalInput(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
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
