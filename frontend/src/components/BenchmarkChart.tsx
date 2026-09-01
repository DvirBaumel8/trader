import { useState } from 'react';
import { formatPercent, signClass } from './format';

/**
 * Validated with the dataviz palette validator against the dark chart surface
 * (#0a0e17): all three pass the lightness band, chroma floor, CVD separation
 * (worst adjacent ΔE 11.0 deutan), the normal-vision floor and contrast.
 * Do not substitute a hue without re-running it.
 */
const SERIES = [
  { key: 'you', label: 'You', color: '#2aa79b' },
  { key: 'sp500', label: 'S&P 500', color: '#7b8cde' },
  { key: 'nasdaq', label: 'Nasdaq', color: '#c2792f' },
] as const;

export type Range = '1W' | '1M' | '6M' | 'YTD' | '1Y' | 'ALL';

export const RANGES: { value: Range; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];

export interface Point {
  date: string;
  you: number | null;
  sp500: number | null;
  nasdaq: number | null;
}

const W = 320;
const H = 150;
const PAD = { top: 8, right: 8, bottom: 4, left: 8 };

export function BenchmarkChart({
  points,
  deltas,
  range,
  onRangeChange,
  unpricedSymbols = [],
}: {
  points: Point[];
  deltas: { vsSp500: number | null; vsNasdaq: number | null } | null;
  range: Range;
  onRangeChange: (r: Range) => void;
  /** Symbols with no price bar somewhere in this window, valued at cost. */
  unpricedSymbols?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  const values = points.flatMap((p) =>
    SERIES.map((s) => p[s.key]).filter((v): v is number => v !== null),
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  // A flat series would collapse to a zero-height plot; give it breathing room.
  const span = max - min || 0.02;

  const x = (i: number) =>
    points.length <= 1
      ? PAD.left
      : PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);

  const active = hover !== null ? points[hover] : (points.at(-1) ?? null);

  return (
    <section className="space-y-3">
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

      {points.length < 2 ? (
        <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
          {points.length === 0
            ? 'No history yet.'
            : 'One day of history so far — the comparison fills in as the market trades.'}
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none"
            role="img"
            aria-label="Your return versus the S&P 500 and Nasdaq"
            onPointerDown={(e) => setHover(indexFromEvent(e, points.length))}
            onPointerMove={(e) =>
              hover !== null && setHover(indexFromEvent(e, points.length))
            }
            onPointerUp={() => setHover(null)}
            onPointerLeave={() => setHover(null)}
          >
            {/* The zero line is the reference every series is read against. */}
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(0)}
              y2={y(0)}
              stroke="#232f42"
              strokeWidth="1"
            />

            {SERIES.map((s) => {
              const d = points
                .map((p, i) =>
                  p[s.key] === null
                    ? null
                    : `${i === 0 ? 'M' : 'L'}${x(i)},${y(p[s.key] as number)}`,
                )
                .filter(Boolean)
                .join(' ');
              return (
                <path
                  key={s.key}
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="#7d8da6"
                strokeWidth="1"
              />
            )}

            {/* Only the read-out point carries a marker; a dot on every point
                would bury the line it belongs to. */}
            {SERIES.map((s) => {
              const i = hover ?? points.length - 1;
              const v = points[i]?.[s.key];
              return v === null || v === undefined ? null : (
                <circle
                  key={s.key}
                  cx={x(i)}
                  cy={y(v)}
                  r="3.5"
                  fill={s.color}
                  stroke="#0a0e17"
                  strokeWidth="2"
                />
              );
            })}
          </svg>

          <div className="flex justify-between gap-2 text-[11px]">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="text-muted">{s.label}</span>
                <span className={signClass(active?.[s.key] ?? null)}>
                  {formatPercent(active?.[s.key] ?? null)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}

      {deltas && (
        <div className="flex gap-2">
          <Delta label="vs S&P 500" value={deltas.vsSp500} />
          <Delta label="vs Nasdaq" value={deltas.vsNasdaq} />
        </div>
      )}

      {unpricedSymbols.length > 0 && (
        <p className="text-xs text-muted">
          {unpricedSymbols.join(', ')}{' '}
          {unpricedSymbols.length === 1 ? 'has' : 'have'} no price history yet
          — valued at cost in this chart.
        </p>
      )}
    </section>
  );
}

function Delta({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface-1 px-3 py-2 text-center">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`text-sm font-semibold ${signClass(value)}`}>
        {formatPercent(value)}
      </div>
    </div>
  );
}

/** Nearest data index to where the finger is, in viewBox coordinates. */
function indexFromEvent(
  e: React.PointerEvent<SVGSVGElement>,
  count: number,
): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const vbX = ratio * W;
  const usable = W - PAD.left - PAD.right;
  const i = Math.round(((vbX - PAD.left) / usable) * (count - 1));
  return Math.max(0, Math.min(count - 1, i));
}
