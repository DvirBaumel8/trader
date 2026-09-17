import { Injectable, Logger } from '@nestjs/common';

export interface EconomicEvent {
  kind: 'RATE_DECISION';
  name: string;
  date: string;
  title: string;
  detail: string;
}

export interface EconomicCalendarResult {
  available: boolean;
  events: EconomicEvent[];
}

const CACHE_MS = 5 * 60_000;
const REQUEST_MS = 5_000;

function points(value: string): number | null {
  const match = /^(\d+)(?:-(\d+)\/(\d+))?$|^(\d+)\/(\d+)$/.exec(value);
  if (!match) return null;
  if (match[4] !== undefined) {
    const denominator = Number(match[5]);
    return denominator > 0 ? Number(match[4]) / denominator : null;
  }
  const denominator = Number(match[3]);
  return match[2] === undefined
    ? Number(match[1])
    : denominator > 0 ? Number(match[1]) + Number(match[2]) / denominator : null;
}

function rateDecision(html: string, date: string): EconomicEvent | null | undefined {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  if (!/target range for the federal funds rate/i.test(text)) return null;
  const match = /\b(raise|increase|lower|reduce|cut|maintain|keep)\s+the target range for the federal funds rate\s+(?:by\s+([\d/-]+)\s+percentage point\s+to|at)\s+([\d/-]+)\s+to\s+([\d/-]+)\s+percent/i.exec(text);
  if (!match) return undefined;
  const low = points(match[3]);
  const high = points(match[4]);
  const move = match[2] ? points(match[2]) : null;
  if (low === null || high === null || high < low || (match[2] && (move === null || move <= 0))) return undefined;

  const action = match[1].toLowerCase();
  const changed = /raise|increase|lower|reduce|cut/.test(action);
  if ((changed && move === null) || (!changed && move !== null)) return undefined;
  const title = /raise|increase/.test(action)
    ? `Fed raised rates ${Math.round(move! * 100)} bp`
    : /lower|reduce|cut/.test(action)
      ? `Fed cut rates ${Math.round(move! * 100)} bp`
      : 'Fed held rates steady';
  return {
    kind: 'RATE_DECISION',
    name: 'Federal Reserve rate decision',
    date,
    title,
    detail: `Target range is now ${low.toFixed(2)}–${high.toFixed(2)}%.`,
  };
}

/** Official Federal Reserve statements; 404 means no decision on that weekday. */
@Injectable()
export class EconomicCalendarClient {
  private readonly logger = new Logger(EconomicCalendarClient.name);
  private readonly cache = new Map<string, { expiresAt: number; result: EconomicCalendarResult }>();

  async week(from: string, to: string): Promise<EconomicCalendarResult> {
    const key = `${from}/${to}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const dates: string[] = [];
    for (let day = new Date(`${from}T00:00:00.000Z`); day <= new Date(`${to}T00:00:00.000Z`); day.setUTCDate(day.getUTCDate() + 1)) {
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
    }

    const results = await Promise.all(dates.map(async (date) => {
      const stamp = date.replace(/-/g, '');
      const url = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${stamp}a.htm`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) });
        if (response.status === 404) return { available: true, event: null };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const event = rateDecision(await response.text(), date);
        if (event === undefined) throw new Error('Unrecognized FOMC target-range wording');
        return { available: true, event };
      } catch (error) {
        this.logger.warn(`Federal Reserve statement unavailable for ${date}: ${String(error)}`);
        return { available: false, event: null };
      }
    }));

    const result: EconomicCalendarResult = {
      available: results.every((item) => item.available),
      events: results.flatMap((item) => item.event ? [item.event] : []),
    };
    this.cache.set(key, { expiresAt: Date.now() + CACHE_MS, result });
    return result;
  }
}
