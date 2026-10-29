import { Injectable } from '@nestjs/common';

/** One fiscal-quarter consensus row; `periodEnd` is YYYY-MM-DD. */
export interface QuarterEstimate {
  periodEnd: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

const TIMEOUT_MS = 15_000;

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The only file permitted to talk to Alpha Vantage. Used for analysts'
 * consensus estimates, which Yahoo does not offer for past quarters.
 */
@Injectable()
export class AlphaVantageClient {
  /** Fiscal-quarter consensus rows, past and next. Throws on HTTP failure, a missing key, or a quota/error reply. */
  async quarterEstimates(symbol: string): Promise<QuarterEstimate[]> {
    const key = process.env.ALPHAVANTAGE_API_KEY;
    if (!key) throw new Error('ALPHAVANTAGE_API_KEY is not set');
    const url =
      'https://www.alphavantage.co/query?function=EARNINGS_ESTIMATES' +
      `&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Alpha Vantage answered ${res.status}`);
    const body = (await res.json()) as {
      estimates?: { date?: unknown; horizon?: unknown; eps_estimate_average?: unknown; revenue_estimate_average?: unknown }[];
      Information?: unknown;
      Note?: unknown;
      'Error Message'?: unknown;
    };
    const problem = body.Information ?? body.Note ?? body['Error Message'];
    if (problem !== undefined) throw new Error(`Alpha Vantage: ${String(problem).slice(0, 200)}`);
    // No `estimates` key and no error message: Alpha Vantage simply has no coverage of this ticker.
    if (body.estimates !== undefined && !Array.isArray(body.estimates)) throw new Error('Alpha Vantage: unexpected reply');
    const out: QuarterEstimate[] = [];
    for (const e of body.estimates ?? []) {
      if (e.horizon !== 'fiscal quarter' || typeof e.date !== 'string') continue;
      out.push({
        periodEnd: e.date,
        epsEstimate: num(e.eps_estimate_average),
        revenueEstimate: num(e.revenue_estimate_average),
      });
    }
    return out.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }
}
