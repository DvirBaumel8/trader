/** Earnings this close are highlighted; further out the countdown is quiet. */
const EARNINGS_SOON_DAYS = 7;

/** Days to the next earnings report, beside a symbol in any ticker table. */
export function EarningsBadge({ days }: { days: number }) {
  const soon = days <= EARNINGS_SOON_DAYS;
  return (
    <span
      data-testid="earnings-badge"
      data-soon={soon || undefined}
      className={`rounded px-1 py-px text-[9px] font-medium tracking-wide ${
        soon ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'
      }`}
    >
      E·{days === 0 ? 'today' : `${days}d`}
    </span>
  );
}
