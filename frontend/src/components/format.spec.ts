import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatPercent,
  formatQuantity,
  signClass,
} from './format';

describe('formatQuantity', () => {
  it('groups thousands', () => {
    expect(formatQuantity(1800)).toBe('1,800');
  });
  it('groups large share counts', () => {
    expect(formatQuantity(18000)).toBe('18,000');
  });
  it('leaves small counts alone', () => {
    expect(formatQuantity(49)).toBe('49');
  });
  it('keeps a negative sign for a short', () => {
    expect(formatQuantity(-1050)).toBe('-1,050');
  });
  it('keeps fractional precision without padding', () => {
    expect(formatQuantity(0.5)).toBe('0.5');
  });
  it('renders a dash for a missing value', () => {
    expect(formatQuantity(null)).toBe('—');
  });
});

describe('formatMoney', () => {
  it('formats a plain amount', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
  });
  it('shows negatives with a leading minus, not parentheses', () => {
    expect(formatMoney(-1234.5)).toBe('-$1,234.50');
  });
  it('rounds to cents', () => {
    expect(formatMoney(0.005)).toBe('$0.01');
  });
  it('renders a dash for a missing value', () => {
    expect(formatMoney(null)).toBe('—');
  });
  it('renders a dash rather than NaN', () => {
    expect(formatMoney(NaN)).toBe('—');
  });
  it('adds an explicit plus when asked', () => {
    expect(formatMoney(12, { signed: true })).toBe('+$12.00');
  });
  it('does not add a plus to zero when signed', () => {
    expect(formatMoney(0, { signed: true })).toBe('+$0.00');
  });
  it('groups thousands in large balances', () => {
    expect(formatMoney(1234567.891)).toBe('$1,234,567.89');
  });
});

describe('formatPercent', () => {
  it('formats a fraction as a percentage', () => {
    expect(formatPercent(0.184)).toBe('+18.40%');
  });
  it('formats a negative fraction', () => {
    expect(formatPercent(-0.021)).toBe('-2.10%');
  });
  it('renders a dash for a missing value', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('signClass', () => {
  it('is the up colour when positive', () => {
    expect(signClass(1)).toContain('up');
  });
  it('is the down colour when negative', () => {
    expect(signClass(-1)).toContain('down');
  });
  it('is muted at exactly zero', () => {
    expect(signClass(0)).toContain('muted');
  });
  it('is muted for a missing value', () => {
    expect(signClass(null)).toContain('muted');
  });
});
