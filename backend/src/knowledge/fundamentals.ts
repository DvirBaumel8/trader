import type { QuarterEstimate } from '../market-data/alpha-vantage.client.js';
import type { RawFundamentals } from '../market-data/yahoo.client.js';

export interface FundamentalsQuarter {
  label: string;
  periodEnd: string;
  reportedAt: string | null;
  revenue: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  revenueYoY: number | null;
  eps: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  fcf: number | null;
}

export interface FundamentalsNext {
  label: string | null;
  periodEnd: string | null;
  reportAt: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

export interface Fundamentals {
  fetchedAt: string;
  currency: string | null;
  /** Newest first, at most 4. */
  quarters: FundamentalsQuarter[];
  next: FundamentalsNext | null;
  cash: number | null;
  debt: number | null;
  netCash: number | null;
}

const MAX_QUARTERS = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Fiscal and calendar period ends differ by days, so quarters match on year and month. */
const monthKey = (ymd: string) => ymd.slice(0, 7);

function yearAgoKey(ymd: string): string {
  return `${Number(ymd.slice(0, 4)) - 1}${ymd.slice(4, 7)}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Percent change of `now` against `base`, 1 decimal; null when either is missing or the base is zero. */
function pctChange(now: number | null, base: number | null): number | null {
  if (now === null || base === null || base === 0) return null;
  return round1(((now - base) / Math.abs(base)) * 100);
}

function monthLabel(ymd: string): string {
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
}

/** "2Q2027" -> { q: 2, year: 2027 }. */
function parseFiscal(fq: string | null): { q: number; year: number } | null {
  const m = fq ? /^([1-4])Q(\d{4})$/.exec(fq) : null;
  return m ? { q: Number(m[1]), year: Number(m[2]) } : null;
}

function fiscalLabel(f: { q: number; year: number }): string {
  return `Q${f.q} FY${String(f.year).slice(2)}`;
}

function stepFiscal(f: { q: number; year: number }): { q: number; year: number } {
  return f.q === 4 ? { q: 1, year: f.year + 1 } : { q: f.q + 1, year: f.year };
}

/**
 * Pure shaping of Yahoo actuals and Alpha Vantage expectations into what the
 * table shows. `estimates` null (unavailable) leaves every expected field null.
 * `today` is an ET date (YYYY-MM-DD); quarters ending after it are not reported yet.
 */
export function shapeFundamentals(
  raw: RawFundamentals,
  estimates: QuarterEstimate[] | null,
  fetchedAt: string,
  today: string,
): Fundamentals {
  const seriesByMonth = new Map(raw.series.map((s) => [monthKey(s.periodEnd), s]));
  const estByMonth = new Map((estimates ?? []).map((e) => [monthKey(e.periodEnd), e]));

  const reported = raw.epsQuarters
    .filter((q) => q.actual !== null && q.periodEnd <= today)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  const quarters: FundamentalsQuarter[] = reported.slice(0, MAX_QUARTERS).map((q) => {
    const fiscal = parseFiscal(q.fiscalQuarter);
    const s = seriesByMonth.get(monthKey(q.periodEnd));
    const e = estByMonth.get(monthKey(q.periodEnd));
    const revenue = s?.revenue ?? null;
    const revenueEstimate = e?.revenueEstimate ?? null;
    const epsEstimate = e?.epsEstimate ?? null;
    return {
      label: fiscal ? fiscalLabel(fiscal) : monthLabel(q.periodEnd),
      periodEnd: q.periodEnd,
      reportedAt: q.reportedAt,
      revenue,
      revenueEstimate,
      revenueSurprisePct: pctChange(revenue, revenueEstimate),
      revenueYoY: pctChange(revenue, seriesByMonth.get(yearAgoKey(q.periodEnd))?.revenue ?? null),
      eps: q.actual,
      epsEstimate,
      epsSurprisePct: pctChange(q.actual, epsEstimate),
      fcf: s?.fcf ?? null,
    };
  });

  let next: FundamentalsNext | null = null;
  if (estimates) {
    const newest = reported[0];
    const after = [...estimates]
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      .find((e) => (newest ? monthKey(e.periodEnd) > monthKey(newest.periodEnd) : e.periodEnd > today));
    if (after) {
      const fiscal = parseFiscal(newest?.fiscalQuarter ?? null);
      next = {
        label: fiscal ? fiscalLabel(stepFiscal(fiscal)) : monthLabel(after.periodEnd),
        periodEnd: after.periodEnd,
        reportAt: null,
        epsEstimate: after.epsEstimate,
        revenueEstimate: after.revenueEstimate,
      };
    }
  }

  return {
    fetchedAt,
    currency: raw.currency,
    quarters,
    next,
    cash: raw.cash,
    debt: raw.debt,
    netCash: raw.cash !== null && raw.debt !== null ? raw.cash - raw.debt : null,
  };
}
