import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { inputClasses } from '../components/ui/inputClasses';
import { type HoldingRow, HOLDINGS_KEY, reorderHoldings, addHoldings, removeHolding, useHoldings } from '../api/lists';
import { ReorderableList } from '../components/ReorderableList';
import { useListOrder } from '../lib/useListOrder';
import { parseTickers, summarize } from '../lib/tickers';
import { usePersistentState } from '../lib/persistentState';
import { useMoves } from '../api/moves';
import { AtrToggle, MoveCells, MovesHeader, moveTone, toneClass } from '../components/MoveColumns';

export function Holdings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useHoldings();
  const [symbol, setSymbol] = useState('');
  const [editing, setEditing] = useState(false);
  const [showAtr, setShowAtr] = usePersistentState<boolean>('trader.holdings.atr.v1', false, Infinity);
  const moves = useMoves((data ?? []).map((r) => r.symbol), showAtr);
  const moveOf = (sym: string) => moves.data?.find((m) => m.symbol === sym);
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
        <div className="flex items-center gap-2">
          <AtrToggle on={showAtr} onChange={setShowAtr} />
          <EditModeToggle on={editing} onChange={(next) => {
              setEditing(next);
              if (!next) setConfirming(null);
            }} noun="holdings" />
        </div>
      </div>

      <div className="flex gap-2">
        <input
          className={inputClasses('md', 'uppercase placeholder:normal-case')}
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

      {showAtr && !editing && data && data.length > 0 && <MovesHeader moves={moves.data} />}
      <ReorderableList
        rows={data ?? []}
        editing={editing}
        testIdPrefix="holding"
        onReorder={order.reorder}
        renderRow={(h) => (
          <>
            <span className={`font-medium ${toneClass(showAtr && !editing ? moveTone(moveOf(h.symbol)) : null)}`.trim()}>{h.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{h.name}</span>
            {showAtr && !editing && <MoveCells symbol={h.symbol} move={moveOf(h.symbol)} />}
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
