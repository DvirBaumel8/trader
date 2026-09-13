/**
 * One labelled figure tile — the header stat's own look, extracted so the
 * Trades tab's period totals can use the exact same tile rather than
 * inventing a second one.
 */
export function Stat({
  label,
  value,
  sub,
  tone = '',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface-1 p-2.5 text-center">
      <div className="text-[10px] tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}
