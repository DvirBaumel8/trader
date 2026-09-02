const SESSION_LABEL: Record<string, string> = {
  PRE: 'PRE-MARKET',
  POST: 'AFTER HOURS',
  CLOSED: 'MARKET CLOSED',
};

/**
 * Says which session a price comes from. Silent during regular hours, when a
 * live price needs no explanation; extended-hours prints are thinner and can
 * gap, so they are always labelled rather than passed off as the close — see
 * invariant 7 in CLAUDE.md. Shared by every screen that shows a live price
 * (Dashboard, Stops) so the wording can never drift between them.
 */
export function SessionBadge({
  session,
  extended,
}: {
  session: string | null;
  extended: boolean;
}) {
  if (!session || session === 'REGULAR') return null;
  const label = SESSION_LABEL[session];
  if (!label) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${
        extended ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted'
      }`}
    >
      {label}
    </span>
  );
}
