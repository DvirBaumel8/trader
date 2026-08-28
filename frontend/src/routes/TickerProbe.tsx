import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type Lookup = {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
};

/**
 * Dev-only scaffolding, deliberately absent from the navigation. Its whole job
 * is to prove the price provider knows every ticker the user actually trades,
 * before the portfolio is built on that assumption.
 */
export function TickerProbe() {
  const [input, setInput] = useState('');
  const [symbol, setSymbol] = useState('');

  const { data, error, isFetching } = useQuery({
    queryKey: ['lookup', symbol],
    queryFn: () =>
      api<Lookup>(`/instruments/lookup?symbol=${encodeURIComponent(symbol)}`),
    enabled: symbol.length > 0,
    retry: false,
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Dev tool — check that a ticker resolves and prices correctly.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSymbol(input.trim().toUpperCase());
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="NVDA"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0"
        >
          Check
        </button>
      </form>

      {isFetching && <p className="text-sm text-muted">Loading…</p>}

      {error && !isFetching && (
        <p className="text-sm text-down">{(error as Error).message}</p>
      )}

      {data && !isFetching && (
        <div className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="text-lg font-semibold">{data.symbol}</div>
          <div className="text-sm text-muted">{data.name}</div>
          <div className="mt-3 text-3xl font-semibold">
            ${data.price.toFixed(2)}
          </div>
          {data.stale && (
            <div className="mt-2 text-xs text-down">
              stale — provider unreachable, showing last known price
            </div>
          )}
        </div>
      )}
    </div>
  );
}
