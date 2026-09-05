/**
 * Dates for the benchmark chart's read-out.
 *
 * `YYYY-MM-DD` is parsed as UTC and formatted in UTC on purpose: the string is
 * already a calendar date from the server, and letting the browser read it as
 * a local instant shifts it a day for anyone west of Greenwich.
 */
const opts = (long: boolean): Intl.DateTimeFormatOptions => ({
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  ...(long ? { year: 'numeric' } : {}),
});

/**
 * English, pinned, rather than the device's own locale.
 *
 * The rest of the app already fixes `en-US` for every money value, so
 * leaving dates to follow the device meant Hebrew month abbreviations under
 * an otherwise English chart — "אוג׳" where the app everywhere else says
 * Aug. Pinned to the same `en-US`, so there is one locale across the whole
 * UI rather than a split; `en-GB` was tried first for its day-month order
 * and rejected because it abbreviates September as "Sept".
 *
 * The doc comments below used to promise "4 Sep". That was never what this
 * returned on an en-US machine, so they now say what it really does.
 */
const LOCALE = 'en-US';

function format(date: string | undefined, long: boolean): string {
  if (!date) return '';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALE, opts(long));
}

/** "Sep 4" — for the axis ends, where the year is obvious from context. */
export function shortDay(date: string | undefined): string {
  return format(date, false);
}

/** "Sep 4, 2026" — for the point actually under the finger. */
export function longDay(date: string | undefined): string {
  return format(date, true);
}
