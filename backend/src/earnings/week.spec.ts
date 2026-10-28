import { describe, expect, it } from 'vitest';
import { daysBetween, etDate, etWeek } from './week.js';

describe('etWeek', () => {
  it('Thursday gives the current Mon-Fri', () => {
    const w = etWeek(new Date('2026-10-29T15:00:00Z'));
    expect(w.weekStart).toBe('2026-10-26');
    expect(w.weekEnd).toBe('2026-10-30');
    expect(w.today).toBe('2026-10-29');
    expect(w.days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  });
  it('Saturday rolls to next week', () => {
    const w = etWeek(new Date('2026-10-31T15:00:00Z'));
    expect(w.weekStart).toBe('2026-11-02');
    expect(w.weekEnd).toBe('2026-11-06');
    expect(w.days).toHaveLength(5);
  });
  it('Sunday evening ET after DST end rolls to next week', () => {
    const w = etWeek(new Date('2026-11-02T03:30:00Z'));
    expect(w.weekStart).toBe('2026-11-02');
    expect(w.weekEnd).toBe('2026-11-06');
    expect(w.today).toBe('2026-11-01');
  });
  it('Monday 23:30 ET is still Monday', () => {
    expect(etWeek(new Date('2026-10-27T03:30:00Z')).weekStart).toBe('2026-10-26');
  });
});

describe('etDate', () => {
  it('uses the ET calendar date', () => {
    expect(etDate(new Date('2026-11-03T03:00:00Z'))).toBe('2026-11-02');
  });
});

describe('daysBetween', () => {
  it('counts whole days, DST-safe', () => {
    expect(daysBetween('2026-10-29', '2026-10-29')).toBe(0);
    expect(daysBetween('2026-10-29', '2026-11-05')).toBe(7);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2);
  });
});
