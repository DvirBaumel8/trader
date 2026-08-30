export type Period = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface FeeEvent {
  occurredAt: string;
  fee: number;
}

export interface Bucket {
  /** Sortable key, also the bucket's start date. */
  key: string;
  label: string;
  total: number;
}

/** How many buckets are worth showing on a phone before bars become slivers. */
export const MAX_BUCKETS: Record<Period, number> = {
  DAY: 30,
  WEEK: 26,
  MONTH: 24,
  YEAR: 10,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date parts, matching how dates are displayed everywhere else. */
function parts(iso: string) {
  const d = new Date(iso);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), date: d };
}

/** Monday of the week containing `date`. Trading weeks start Monday. */
function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay: 0=Sun … 6=Sat. Sunday belongs to the week that began six days ago.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

export function bucketKey(iso: string, period: Period): string {
  const { y, m, date } = parts(iso);
  switch (period) {
    case 'DAY':
      return `${y}-${pad(m + 1)}-${pad(date.getDate())}`;
    case 'WEEK': {
      const mon = mondayOf(date);
      return `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`;
    }
    case 'MONTH':
      return `${y}-${pad(m + 1)}`;
    case 'YEAR':
      return String(y);
  }
}

export function bucketLabel(key: string, period: Period): string {
  switch (period) {
    case 'DAY': {
      const [, m, d] = key.split('-');
      return `${d}/${m}`;
    }
    case 'WEEK': {
      const [, m, d] = key.split('-');
      return `${d}/${m}`;
    }
    case 'MONTH': {
      const [y, m] = key.split('-');
      const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString([], {
        month: 'short',
      });
      return name;
    }
    case 'YEAR':
      return key;
  }
}

/** The next bucket key after `key`, used to fill gaps. */
function nextKey(key: string, period: Period): string {
  switch (period) {
    case 'DAY':
    case 'WEEK': {
      const [y, m, d] = key.split('-').map(Number);
      const next = new Date(y, m - 1, d + (period === 'DAY' ? 1 : 7));
      return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
    }
    case 'MONTH': {
      const [y, m] = key.split('-').map(Number);
      const next = new Date(y, m, 1);
      return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
    }
    case 'YEAR':
      return String(Number(key) + 1);
  }
}

/**
 * Fees grouped into periods, oldest first.
 *
 * Empty periods are filled with zero rather than skipped: a month you did not
 * trade is information, and dropping it would squeeze the time axis so two
 * distant bars appear adjacent.
 */
export function bucketFees(events: FeeEvent[], period: Period): Bucket[] {
  if (events.length === 0) return [];

  const totals = new Map<string, number>();
  for (const e of events) {
    if (!(e.fee > 0)) continue;
    const key = bucketKey(e.occurredAt, period);
    totals.set(key, (totals.get(key) ?? 0) + e.fee);
  }
  if (totals.size === 0) return [];

  const keys = [...totals.keys()].sort();
  const out: Bucket[] = [];
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
