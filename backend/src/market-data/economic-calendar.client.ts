import { Injectable, Logger } from '@nestjs/common';

export interface EconomicEvent {
  id: string;
  name: string;
  date: string;
  actual: number | null;
  expected: number | null;
}

type RawEvent = Record<string, unknown>;

const numberOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Free, best-effort macro calendar adapter. The brief remains useful if it is unavailable. */
@Injectable()
export class EconomicCalendarClient {
  private readonly logger = new Logger(EconomicCalendarClient.name);

  async week(from: string, to: string): Promise<EconomicEvent[]> {
    try {
      const response = await fetch(
        `https://api.tradingeconomics.com/calendar/country/united%20states/${from}/${to}?c=guest:guest`,
      );
      if (!response.ok) return [];
      const raw = (await response.json()) as RawEvent[];
      return raw
        .filter((event) => {
          const name = String(event.Event ?? event.event ?? '');
          return /CPI|PPI|FOMC|interest rate|fed/i.test(name);
        })
        .map((event, index) => ({
          id: String(event.CalendarId ?? event.calendarId ?? `${event.Date ?? event.date}-${index}`),
          name: String(event.Event ?? event.event),
          date: String(event.Date ?? event.date),
          actual: numberOrNull(event.Actual ?? event.actual),
          expected: numberOrNull(event.Forecast ?? event.forecast ?? event.Consensus ?? event.consensus),
        }));
    } catch (error) {
      this.logger.warn(`economic calendar unavailable: ${String(error)}`);
      return [];
    }
  }
}
