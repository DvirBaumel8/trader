import { describe, expect, it } from 'vitest';
import { rangeToDates } from './benchmarkRange';

describe('rangeToDates', () => {
  const now = new Date('2026-09-21T12:00:00Z');

  it('is unbounded for ALL', () => {
    expect(rangeToDates('ALL', now)).toEqual({ from: '', to: '' });
  });

  it('goes back 7 days for 1W', () => {
    expect(rangeToDates('1W', now)).toEqual({ from: '2026-09-14', to: '2026-09-21' });
  });

  it('goes back one calendar month for 1M', () => {
    expect(rangeToDates('1M', now)).toEqual({ from: '2026-08-21', to: '2026-09-21' });
  });

  it('goes back six calendar months for 6M', () => {
    expect(rangeToDates('6M', now)).toEqual({ from: '2026-03-21', to: '2026-09-21' });
  });

  it('starts at January 1st of the current year for YTD', () => {
    expect(rangeToDates('YTD', now)).toEqual({ from: '2026-01-01', to: '2026-09-21' });
  });

  it('goes back one calendar year for 1Y', () => {
    expect(rangeToDates('1Y', now)).toEqual({ from: '2025-09-21', to: '2026-09-21' });
  });
});
