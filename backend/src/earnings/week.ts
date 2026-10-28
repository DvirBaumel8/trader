const TZ = 'America/New_York';

const ymdFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface EtWeek {
  weekStart: string;
  weekEnd: string;
  today: string;
  days: string[];
}

/** YYYY-MM-DD of the given instant in America/New_York. */
export function etDate(at: Date): string {
  const parts = ymdFormat.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole calendar days from `fromYmd` to `toYmd` (YYYY-MM-DD); negative if `toYmd` is earlier. DST-safe. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toYmd) - utc(fromYmd)) / 86_400_000);
}

/** Mon-Fri of the current ET week; on Saturday/Sunday, the coming week. */
export function etWeek(now: Date): EtWeek {
  const today = etDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
  const offset = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  const weekStart = addDays(today, offset);
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
  return { weekStart, weekEnd: days[4], today, days };
}
