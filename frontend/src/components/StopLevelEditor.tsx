import { draftRisk, type StopRow } from '../lib/stopRisk';
import { formatMoney, formatQuantity } from './format';

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm outline-none focus:border-accent';

/**
 * Stops are a list of tiers, each a fixed price or a percentage trail. The
 * running risk figure is the point: it turns setting a stop from paperwork
 * into a sizing tool, because you see what the trade puts on the line before
 * committing to size.
 */
export function StopLevelEditor({
  rows,
  onChange,
  entryPrice,
  quantity,
  side,
}: {
  rows: StopRow[];
  onChange: (rows: StopRow[]) => void;
  entryPrice: string;
  quantity: string;
  side: 'BUY' | 'SELL';
}) {
  const risk = draftRisk(entryPrice, quantity, rows, side);
  const size = Math.abs(parseFloat(quantity || '0'));

  const update = (i: number, patch: Partial<StopRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Stop levels</span>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                kind: 'FIXED',
                price: '',
                trailPercent: '',
                // The first tier defaults to the whole position; later ones do
                // not guess, since scaling out is a deliberate choice.
                quantity: rows.length === 0 && size > 0 ? String(size) : '',
              },
            ])
          }
          className="text-xs text-accent"
        >
          + add level
        </button>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
            {(['FIXED', 'TRAILING'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={row.kind === k}
                onClick={() => update(i, { kind: k })}
                className={`px-2 py-1.5 text-xs font-medium ${
                  row.kind === k
                    ? 'bg-surface-2 text-text'
                    : 'bg-surface-1 text-muted'
                }`}
              >
                {k === 'FIXED' ? 'Price' : 'Trail'}
              </button>
            ))}
          </div>

          {row.kind === 'FIXED' ? (
            <input
              type="number"
              inputMode="decimal"
              placeholder="stop"
              value={row.price}
              onChange={(e) => update(i, { price: e.target.value })}
              className={inputClass}
            />
          ) : (
            <input
              type="number"
              inputMode="decimal"
              placeholder="% below high"
              value={row.trailPercent}
              onChange={(e) => update(i, { trailPercent: e.target.value })}
              className={inputClass}
            />
          )}

          <input
            type="number"
            inputMode="decimal"
            placeholder="shares"
            value={row.quantity}
            onChange={(e) => update(i, { quantity: e.target.value })}
            className={inputClass}
          />

          <button
            type="button"
            aria-label={`Remove stop level ${i + 1}`}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="shrink-0 px-1 text-lg leading-none text-muted"
          >
            ×
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <p className="text-[11px] text-muted">
          {risk.amount === null ? (
            'Risk appears once a level is complete.'
          ) : (
            <>
              Total risk{' '}
              <span className="text-text">{formatMoney(risk.amount)}</span>
              {size > 0 && (
                <>
                  {' · '}
                  <span className={risk.fullyCovered ? '' : 'text-down'}>
                    covers {formatQuantity(risk.covered)} of{' '}
                    {formatQuantity(size)} sh
                  </span>
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}
