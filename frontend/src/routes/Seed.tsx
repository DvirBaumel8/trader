import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface HoldingRow {
  symbol: string;
  quantity: string;
  avgCost: string;
}

const blankRow: HoldingRow = { symbol: '', quantity: '', avgCost: '' };

const inputClass =
  'w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent';

export function Seed() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [startingCash, setStartingCash] = useState('');
  const [rows, setRows] = useState<HoldingRow[]>([{ ...blankRow }]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const update = (i: number, patch: Partial<HoldingRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mutation = useMutation({
    mutationFn: () =>
      api('/portfolio/seed', {
        method: 'POST',
        body: JSON.stringify({
          asOf,
          startingCash: parseFloat(startingCash || '0'),
          holdings: rows
            .filter((r) => r.symbol.trim() !== '')
            .map((r) => ({
              symbol: r.symbol.trim().toUpperCase(),
              quantity: parseFloat(r.quantity || '0'),
              avgCost: parseFloat(r.avgCost || '0'),
            })),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      navigate('/');
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Seed your portfolio</h1>
        <p className="mt-1 text-sm text-muted">
          One time only. After this, the diary keeps it current.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Cash balance</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={startingCash}
            onChange={(e) => setStartingCash(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted">Holdings</span>
          <span className="text-[11px] text-muted">
            negative quantity = short
          </span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <input
              placeholder="NVDA"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={row.symbol}
              onChange={(e) => update(i, { symbol: e.target.value })}
              className={inputClass}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="qty"
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
            <button
              type="button"
              aria-label={`Remove holding ${i + 1}`}
              onClick={() =>
                setRows((prev) => prev.filter((_, idx) => idx !== i))
              }
              className="px-2 text-xl leading-none text-muted"
            >
              ×
            </button>
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
