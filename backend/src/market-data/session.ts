import { etDate } from '../earnings/week.js';

// Holiday and early-close rules adapted from the parked
// lib/market-data/market-session.ts (rule-based, so no yearly table to update).

/**
 * Rule-based, not a per-year table: a table needs remembering to update every
 * January, and a stale one fails silently — the session badge would just
 * read "regular hours" on a holiday forever until someone noticed. Every
 * holiday here is either a fixed date (with the standard weekend-observance
 * shift) or a "nth/last weekday of month" rule, both computed for whatever
 * year is asked. `trading-day.ts` deliberately does NOT model holidays for
 * its own purpose (an extra bar re-fetch on a holiday is a harmless no-op)
 * — this module has the opposite risk profile: mislabelling a live session
 * on a holiday is the "honest numbers" violation this whole feature exists
 * to fix, so the accuracy is worth the extra rules here.
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return isoDate(year, month, day);
}

export function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, daysInMonth));
  const lastWeekday = last.getUTCDay();
  const day = daysInMonth - ((lastWeekday - weekday + 7) % 7);
  return isoDate(year, month, day);
}

/** Meeus/Jones/Butcher Gregorian algorithm — the standard closed-form Easter date. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** NYSE's standard weekend-observance shift: Saturday moves to Friday, Sunday to Monday. */
export function observedFixedDate(year: number, month: number, day: number): string {
  const date = isoDate(year, month, day);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fullClosureDates(year: number): string[] {
  return [
    observedFixedDate(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday
    addDays(easterSunday(year), -2), // Good Friday
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day
    observedFixedDate(year, 6, 19), // Juneteenth
    observedFixedDate(year, 7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving
    observedFixedDate(year, 12, 25), // Christmas Day
  ];
}

/**
 * Full-closure NYSE holidays. Does not cover a market disruption (weather,
 * a national day of mourning) — those are unscheduled and no calendar rule
 * predicts them, so on such a day this calendar is wrong.
 */
export function isUsMarketHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  return fullClosureDates(year).includes(date);
}

/**
 * Early-close (1:00pm ET) days. Deliberately narrower than reality: NYSE
 * occasionally early-closes July 3rd too, but not by a clean yearly rule, so
 * that case is a known, accepted miss rather than a guess.
 */
export function isEarlyCloseDay(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const dayAfterThanksgiving = addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1);
  const christmasEve = `${year}-12-24`;
  const christmasEveWeekday = new Date(`${christmasEve}T00:00:00Z`).getUTCDay();
  const earlyCloses = [dayAfterThanksgiving];
  if (christmasEveWeekday !== 0 && christmasEveWeekday !== 6) {
    earlyCloses.push(christmasEve);
  }
  return earlyCloses.includes(date);
}

const TZ = 'America/New_York';

export function etMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

export function isTradingDay(ymd: string): boolean {
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isUsMarketHoliday(ymd);
}

/** Last trading day strictly before `ymd`. */
export function previousTradingDay(ymd: string): string {
  let d = addDays(ymd, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

const OPEN_MINUTES = 9 * 60 + 30;

/** Regular-session close in minutes after ET midnight (13:00 on an early-close day). */
export function closeMinutes(ymd: string): number {
  return isEarlyCloseDay(ymd) ? 13 * 60 : 16 * 60;
}

/** True from 09:30 ET until the close (16:00, or 13:00 on an early-close day) of a trading day. */
export function isRegularSessionOpen(now: Date): boolean {
  const date = etDate(now);
  if (!isTradingDay(date)) return false;
  const m = etMinutes(now);
  return m >= OPEN_MINUTES && m < closeMinutes(date);
}

export interface SessionInfo {
  /** The regular session is open right now. */
  live: boolean;
  /** ET date of the session the move belongs to: today while live, else the last completed session. */
  asOf: string;
}

export function currentSession(now: Date): SessionInfo {
  const today = etDate(now);
  if (isRegularSessionOpen(now)) return { live: true, asOf: today };
  if (isTradingDay(today) && etMinutes(now) >= closeMinutes(today)) {
    return { live: false, asOf: today };
  }
  return { live: false, asOf: previousTradingDay(today) };
}
