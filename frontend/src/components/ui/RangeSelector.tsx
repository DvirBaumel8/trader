import { RANGES, type Range } from '../../lib/benchmarkRange';

/**
 * The preset window row — 1W/1M/6M/YTD/1Y/All — first built for the
 * benchmark chart. Extracted so the Trades tab's period totals can reuse the
 * exact same control rather than growing a second one: "that control, not a
 * second one."
 */
export function RangeSelector({
  range,
  onRangeChange,
}: {
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  return (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={range === r.value}
          onClick={() => onRangeChange(r.value)}
          className={`flex-1 rounded-lg border py-1 text-xs transition-colors ${
            range === r.value
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border text-muted'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
