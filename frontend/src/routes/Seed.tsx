import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

type Side = 'LONG' | 'SHORT';

interface HoldingRow {
  symbol: string;
  side: Side;
  quantity: string;
  avgCost: string;
}

const blankRow: HoldingRow = {
  symbol: '',
  side: 'LONG',
  quantity: '',
  avgCost: '',
};

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent';

/**
 * A segmented toggle rather than a typed sign. The iOS decimal keypad has no
 * minus key, so any UI that requires typing "-" is simply unusable on a phone
 * — which is where this app is meant to be used.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; activeClass: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 overflow-hidden rounded-lg border border-border"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            value === o.value ? o.activeClass : 'bg-surface-1 text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Seed() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [cashNegative, setCashNegative] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [rows, setRows] = useState<HoldingRow[]>([{ ...blankRow }]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const update = (i: number, patch: Partial<HoldingRow>) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );

  const mutation = useMutation({
    mutationFn: () =>
      api('/portfolio/seed', {
        method: 'POST',
        body: JSON.stringify({
          asOf,
          startingCash:
            Math.abs(parseFloat(cashAmount || '0')) * (cashNegative ? -1 : 1),
          holdings: rows
            .filter((r) => r.symbol.trim() !== '')
            .map((r) => ({
              symbol: r.symbol.trim().toUpperCase(),
              quantity:
                Math.abs(parseFloat(r.quantity || '0')) *
                (r.side === 'SHORT' ? -1 : 1),
              avgCost: Math.abs(parseFloat(r.avgCost || '0')),
            })),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      navigate('/');
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Seed your portfolio</h1>
        <p className="mt-1 text-sm text-muted">
          One time only. After this, the diary keeps it current.
        </p>
      </div>

      {/* min-w-0 on the children: grid items default to min-width:auto, and the
          native date control's intrinsic width otherwise overflows its track. */}
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 space-y-1">
          <span className="block text-xs text-muted">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="min-w-0 space-y-1">
          <span className="block text-xs text-muted">Cash balance</span>
          <div className="flex gap-2">
            <Segmented
              ariaLabel="Cash sign"
              value={cashNegative ? 'NEG' : 'POS'}
              onChange={(v) => setCashNegative(v === 'NEG')}
              options={[
                {
                  value: 'POS',
                  label: '+',
                  activeClass: 'bg-surface-2 text-text',
                },
                {
                  value: 'NEG',
                  label: '−',
                  activeClass: 'bg-down/20 text-down',
                },
              ]}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {cashNegative && (
        <p className="-mt-3 text-xs text-down">
          Negative cash — you’re on margin. That’s fine and fully supported.
        </p>
      )}

      <div className="space-y-3">
        <span className="block text-xs text-muted">Holdings</span>

        {rows.map((row, i) => (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-border bg-surface-1/50 p-3"
          >
            <div className="flex gap-2">
              <input
                placeholder="NVDA"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={row.symbol}
                onChange={(e) => update(i, { symbol: e.target.value })}
                className={inputClass}
              />
              <Segmented
                ariaLabel={`Direction for holding ${i + 1}`}
                value={row.side}
                onChange={(side) => update(i, { side })}
                options={[
                  {
                    value: 'LONG',
                    label: 'Long',
                    activeClass: 'bg-up/20 text-up',
                  },
                  {
                    value: 'SHORT',
                    label: 'Short',
                    activeClass: 'bg-down/20 text-down',
                  },
                ]}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove holding ${i + 1}`}
                  onClick={() =>
                    setRows((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="shrink-0 px-1 text-xl leading-none text-muted"
                >
                  ×
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="quantity"
                value={row.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="avg cost"
                value={row.avgCost}
                onChange={(e) => update(i, { avgCost: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...blankRow }])}
          className="text-sm text-accent"
        >
          + Add holding
        </button>
      </div>

      {mutation.isError && (
        <p className="text-sm text-down">{(mutation.error as Error).message}</p>
      )}

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-surface-0 disabled:opacity-50"
      >
        {mutation.isPending ? 'Seeding…' : 'Seed portfolio'}
      </button>
    </div>
  );
}
