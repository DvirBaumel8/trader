import { resolveTradeSide, normaliseTagLabel } from './journal.service.js';

describe('resolveTradeSide', () => {
  it('maps a positive quantity to BUY', () => {
    expect(resolveTradeSide(10)).toEqual({ side: 'BUY', quantity: 10 });
  });

  it('maps a negative quantity to SELL', () => {
    expect(resolveTradeSide(-10)).toEqual({ side: 'SELL', quantity: 10 });
  });

  it('rejects a zero quantity', () => {
    expect(() => resolveTradeSide(0)).toThrow();
  });

  it('rejects a non-finite quantity', () => {
    expect(() => resolveTradeSide(NaN)).toThrow();
  });
});

describe('normaliseTagLabel', () => {
  it('trims whitespace', () => {
    expect(normaliseTagLabel('  pullback  ')).toBe('pullback');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseTagLabel('broke  the   plan')).toBe('broke the plan');
  });

  it('lowercases so tags do not fragment by capitalisation', () => {
    expect(normaliseTagLabel('Pullback')).toBe('pullback');
  });

  it('rejects an empty label', () => {
    expect(() => normaliseTagLabel('   ')).toThrow();
  });
});
