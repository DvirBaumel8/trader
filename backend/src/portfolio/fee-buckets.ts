export type FeePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface FeeEvent {
  occurredAt: Date;
  fee: number;
}

export interface FeeBucket {
  /** Sortable key, also the bucket's start date. */
  key: string;
  label: string;
  total: number;
}

/** How many buckets are worth showing on a phone before bars become slivers. */
export const MAX_BUCKETS: Record<FeePeriod, number> = {
  DAY: 30,
  WEEK: 26,
  MONTH: 24,
  YEAR: 10,
};

/**
 * Fees grouped into periods. Moved here from the frontend: aggregating is
 * business logic, and every other aggregate in this app (`summariseTrades`,
 * `derive.ts`) already lives in the backend.
 *
 * Bucketed in UTC, which is safe rather than lucky. A trade's date is written
 * as local NOON before conversion (see `entryDraft.ts`'s `dateToIso`), so a
 * stored instant is at least twelve hours from either end of its own calendar
 * day. Reading it back in UTC therefore lands on the same date the owner
 * picked, from any timezone he is plausibly in — which is exactly why noon
 * was chosen over midnight in the first place. Bucketing on the server would
 * otherwise have quietly moved trades into the wrong month.
 *
 * Pure: no database, no clock. Fixture-tested, in the style of `derive.ts`.
 */
const pad = (n: number) => String(n).padStart(2, '0');

function parts(date: Date) {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth(),
    d: date.getUTCDate(),
  };
}

/** Monday of the week containing `date`. Trading weeks start Monday. */
function mondayOf(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0=Sun … 6=Sat. Sunday belongs to the week that began six days ago.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

export function bucketKey(date: Date, period: FeePeriod): string {
  const { y, m, d } = parts(date);
  switch (period) {
    case 'DAY':
      return `${y}-${pad(m + 1)}-${pad(d)}`;
    case 'WEEK': {
      const mon = mondayOf(date);
      return `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;
    }
    case 'MONTH':
      return `${y}-${pad(m + 1)}`;
    case 'YEAR':
      return String(y);
  }
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Month names are a fixed table rather than `toLocaleDateString`. The label is
 * computed on a server whose locale is not the owner's, so asking the runtime
 * for a month name would render whatever the host happens to be configured
 * for. English short names are what the rest of this UI already shows.
 */
export function bucketLabel(key: string, period: FeePeriod): string {
  switch (period) {
    case 'DAY':
    case 'WEEK': {
      const [, m, d] = key.split('-');
      return `${d}/${m}`;
    }
    case 'MONTH': {
      const [, m] = key.split('-');
      return MONTH_NAMES[Number(m) - 1] ?? key;
    }
    case 'YEAR':
      return key;
  }
}

/** The next bucket key after `key`, used to fill gaps. */
function nextKey(key: string, period: FeePeriod): string {
  switch (period) {
    case 'DAY':
    case 'WEEK': {
      const [y, m, d] = key.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + (period === 'DAY' ? 1 : 7)));
      return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    }
    case 'MONTH': {
      const [y, m] = key.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, 1));
      return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
    }
    case 'YEAR':
      return String(Number(key) + 1);
  }
}

/**
 * Oldest first. Empty periods are filled with zero rather than skipped: a
 * month you did not trade is information, and dropping it would squeeze the
 * time axis so two distant bars appear adjacent.
 */
export function bucketFees(events: FeeEvent[], period: FeePeriod): FeeBucket[] {
  if (events.length === 0) return [];

  const totals = new Map<string, number>();
  for (const e of events) {
    if (!(e.fee > 0)) continue;
    const key = bucketKey(e.occurredAt, period);
    totals.set(key, (totals.get(key) ?? 0) + e.fee);
  }
  if (totals.size === 0) return [];

  const keys = [...totals.keys()].sort();
  const out: FeeBucket[] = [];
  let cursor = keys[0];
  const last = keys[keys.length - 1];

  // Guard against a runaway loop if a key ever fails to advance.
  for (let i = 0; i < 5000; i += 1) {
    out.push({
      key: cursor,
      label: bucketLabel(cursor, period),
      total: round(totals.get(cursor) ?? 0),
    });
    if (cursor === last) break;
    cursor = nextKey(cursor, period);
  }

  // Only the most recent window fits on a phone; older periods drop off.
  return out.slice(-MAX_BUCKETS[period]);
}

export function totalFees(events: FeeEvent[]): number {
  return round(events.reduce((sum, e) => sum + (e.fee > 0 ? e.fee : 0), 0));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
