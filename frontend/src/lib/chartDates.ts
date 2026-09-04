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

function format(date: string | undefined, long: boolean): string {
  if (!date) return '';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString([], opts(long));
}

/** "4 Sep" — for the axis ends, where the year is obvious from context. */
export function shortDay(date: string | undefined): string {
  return format(date, false);
}

/** "4 Sep 2026" — for the point actually under the finger. */
export function longDay(date: string | undefined): string {
  return format(date, true);
}
