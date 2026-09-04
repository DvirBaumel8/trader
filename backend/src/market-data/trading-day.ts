/**
 * When the stored daily history should be considered out of date.
 *
 * Pure, so the rule can be tested without a clock, a database or a provider —
 * the house style of `derive.ts` and `risk.ts`.
 *
 * This exists because nothing was refreshing `daily_closes`: `backfill()` is
 * manual and `ensurePriced()` only fires for an instrument with no rows at
 * all, so every symbol froze on the day of the last manual run. A trailing
 * stop resolves from the high-water mark since entry, so two days of missing
 * bars put the app's BITX stop at 17.17 against the broker's 17.32, and the
 * benchmark comparison was measuring the portfolio's live value against a
 * two-day-old S&P.
 */
const MARKET_TIME_ZONE = 'America/New_York';

/** The calendar date at the exchange, `YYYY-MM-DD`. */
export function marketDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD, which sorts lexicographically — the same
  // shape `daily_closes.date` is stored in, so the two compare directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function dayOfWeek(date: string): number {
  // Parsed as UTC midnight deliberately: `date` is already an exchange-local
  // calendar date, so re-interpreting it in the local zone could shift it.
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The most recent session a bar could exist for — today when the exchange
 * calendar says a weekday, otherwise the preceding weekday.
 *
 * Today counts even mid-session, and even before the open. Yahoo serves a
 * partial bar for the current day whose high is what a trailing stop must
 * ratchet against; waiting for the close would leave every trail a day
 * stale. Asking too early simply returns nothing new.
 *
 * Market holidays are not modelled. Treating one as a session costs an
 * upsert of bars that already exist, which is idempotent — whereas modelling
 * the holiday calendar means maintaining it forever, and getting it wrong
 * means silently not refreshing.
 */
export function lastExpectedSession(now: Date): string {
  let date = marketDate(now);
  while (dayOfWeek(date) === 0 || dayOfWeek(date) === 6) {
    date = previousDate(date);
  }
  return date;
}

/**
 * True when the newest stored bar is older than the last expected session.
 *
 * Accepts a `Date` as well as a string, and that is not politeness: the first
 * version of this took a string, and a raw `MAX(date)` query handed it a
 * `Date`, because node-postgres parses DATE columns into JS dates. The
 * comparison then read `"Wed Sep 02 2026…" < "2026-09-04"` — always false, so
 * the history silently never refreshed and the bug this was written to fix
 * stayed fixed only in the tests.
 */
export function isHistoryBehind(
  latestStored: string | Date | null,
  now: Date,
): boolean {
  if (latestStored === null) return true;
  const latest =
    latestStored instanceof Date ? marketDate(latestStored) : latestStored;
  return latest < lastExpectedSession(now);
}
