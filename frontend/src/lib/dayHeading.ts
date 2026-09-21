/**
 * The Journal's per-day grouping heading — e.g. "Sep 4, 2026".
 *
 * `new Date(iso)` reads the full instant, deliberately unlike
 * `chartDates.ts`'s forced-UTC parsing: `occurredAt` carries a real
 * time-of-day (when the trade actually happened), and grouping by day
 * should follow the day it fell on for whoever is looking, not a
 * UTC-shifted one. The two helpers look similar but solve different
 * problems, which is why they live in separate files rather than sharing
 * one "format a date" function.
 *
 * en-US, pinned, for the same reason as chartDates.ts and every money value
 * in this app: this heading used to pass no locale at all and follow the
 * device, which put Hebrew month abbreviations under an otherwise English
 * screen on the owner's phone.
 */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Whether two instants fall on the same LOCAL calendar day — the viewer's
 * own "today", not a UTC one. Used to decide whether a cached answer is
 * still "from today" for whoever is looking at it right now, the same
 * everyday sense `dayLabel`'s grouping already uses.
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
