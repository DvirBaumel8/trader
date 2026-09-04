import { useState } from 'react';
import { Money } from './Money';
import { formatMoney } from './format';
import type { Bucket, Period } from '../lib/feeTypes';

/**
 * Bar colour, chosen by running the palette validator against the dark chart
 * surface rather than by eye: the app's brighter accent sits outside the
 * dark-mode lightness band. This step passes both that band and contrast.
 */
const BAR = '#2aa79b';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'DAY', label: 'Daily' },
  { value: 'WEEK', label: 'Weekly' },
  { value: 'MONTH', label: 'Monthly' },
  { value: 'YEAR', label: 'Yearly' },
];

/** Labels every bar when there is room, otherwise thins them out evenly. */
function labelStride(count: number): number {
  if (count <= 8) return 1;
  return Math.ceil(count / 8);
}

export function FeesChart({
  buckets,
  total,
  period,
  onPeriodChange,
}: {
  buckets: Bucket[];
  total: number;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const max = Math.max(...buckets.map((b) => b.total), 0);
  const stride = labelStride(buckets.length);
  const active = selected !== null ? buckets[selected] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs tracking-wide text-muted uppercase">
            {active ? active.label : 'Fees paid'}
          </div>
          <div className="mt-0.5 text-3xl font-semibold">
            <Money value={active ? active.total : total} />
          </div>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="shrink-0 text-[11px] text-accent"
          >
            show total
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={period === p.value}
            onClick={() => {
              onPeriodChange(p.value);
              setSelected(null);
            }}
            className={`flex-1 rounded-lg border py-1 text-xs transition-colors ${
              period === p.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {buckets.length === 0 ? (
        <p className="text-sm text-muted">No fees recorded yet.</p>
      ) : (
        <div>
          {/* Bars sit on a shared baseline; height is the only encoding. */}
          <div className="flex h-40 items-end gap-[2px]">
            {buckets.map((b, i) => {
              const pct = max > 0 ? (b.total / max) * 100 : 0;
              const isSelected = selected === i;
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-label={`${b.label}: ${formatMoney(b.total)}`}
                  onClick={() => setSelected(isSelected ? null : i)}
                  className="group flex h-full flex-1 flex-col justify-end"
                >
                  <span
                    className="w-full rounded-t transition-opacity"
                    style={{
                      // A zero period still shows a hairline, so an empty
                      // stretch reads as "nothing here" rather than a gap.
                      height: `${Math.max(pct, b.total > 0 ? 2 : 0.8)}%`,
                      background: BAR,
                      opacity: selected === null || isSelected ? 1 : 0.35,
                    }}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-1 flex gap-[2px]">
            {buckets.map((b, i) => (
              <span
                key={b.key}
                className="flex-1 text-center text-[9px] text-muted"
              >
                {i % stride === 0 ? b.label : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
