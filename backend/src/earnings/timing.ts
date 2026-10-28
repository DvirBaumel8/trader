export type Timing = 'before_open' | 'during' | 'after_close' | 'unknown';

export const TIMING_ORDER: Timing[] = ['before_open', 'during', 'after_close', 'unknown'];

const hmFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** US market session timing of an instant, in ET: <09:30 before, >=16:00 after. */
export function timingOf(at: Date | null): Timing {
  if (!at) return 'unknown';
  const parts = hmFormat.formatToParts(at);
  const num = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const minutes = num('hour') * 60 + num('minute');
  if (minutes < 9 * 60 + 30) return 'before_open';
  if (minutes >= 16 * 60) return 'after_close';
  return 'during';
}
