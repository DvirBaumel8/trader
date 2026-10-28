import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { inputClasses } from '../components/ui/inputClasses';
import { type HoldingRow, HOLDINGS_KEY, reorderHoldings, addHoldings, removeHolding, useHoldings } from '../api/lists';
import { ReorderableList } from '../components/ReorderableList';
import { useListOrder } from '../lib/useListOrder';
import { parseTickers, summarize } from '../lib/tickers';

export function Holdings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useHoldings();
  const [symbol, setSymbol] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const order = useListOrder<HoldingRow>(HOLDINGS_KEY, reorderHoldings);
  const refresh = () => queryClient.invalidateQueries({ queryKey: HOLDINGS_KEY });

  const [result, setResult] = useState('');
  const add = useMutation({
    mutationFn: (symbols: string[]) => addHoldings(symbols),
    onMutate: () => setResult(''),
    onSuccess: (r) => {
      setSymbol('');
      setResult(
        summarize([['Added', r.added], ['Already held', r.already], ["Couldn't find", r.notFound]]),
      );
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (s: string) => removeHolding(s),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
    },
    onError: () => setConfirming(null),
  });

  const tickers = parseTickers(symbol);
  const canAdd = tickers.length > 0 && !add.isPending;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Holdings</h1>
        <EditModeToggle on={editing} onChange={(next) => {
            setEditing(next);
            if (!next) setConfirming(null);
          }} noun="holdings" />
      </div>

      <div className="flex gap-2">
        <input
          className={inputClasses('md', 'uppercase')}
          placeholder="Tickers — e.g. GSIT, LMND NVDA"
          value={symbol}
          autoCapitalize="characters"
          autoCorrect="off"
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button variant="accent" className="shrink-0 whitespace-nowrap" disabled={!canAdd} onClick={() => add.mutate(tickers)}>
          Add
        </Button>
      </div>
      {result && <p className="text-sm text-muted">{result}</p>}
      {add.isError && <p className="text-sm text-down">{(add.error as Error).message}</p>}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {isError && <p className="text-sm text-down">Couldn’t load your holdings.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">No holdings yet. Tell the chat “bought LMND”, or add one above.</p>
      )}

      <ReorderableList
        rows={data ?? []}
        editing={editing}
        testIdPrefix="holding"
        onReorder={order.reorder}
        renderRow={(h) => (
          <>
            <span className="font-medium">{h.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{h.name}</span>
            {editing && confirming !== h.symbol && (
              <Button className="shrink-0 whitespace-nowrap" onClick={() => setConfirming(h.symbol)}>Remove</Button>
            )}
            {editing && confirming === h.symbol && (
              <Button variant="danger" className="shrink-0 whitespace-nowrap" aria-label="Confirm remove" onClick={() => remove.mutate(h.symbol)}>
                Remove {h.symbol}
              </Button>
            )}
          </>
        )}
      />
      {order.error && <p className="text-sm text-down">{order.error}</p>}
      {remove.isError && <p className="text-sm text-down">{(remove.error as Error).message}</p>}
    </section>
  );
}
