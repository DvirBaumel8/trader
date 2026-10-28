import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { inputClasses } from '../components/ui/inputClasses';
import { WATCHLIST_KEY, addWatch, removeWatch, useWatchlist } from '../api/lists';

export function Watchlist() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useWatchlist();
  const [symbol, setSymbol] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });

  const add = useMutation({
    mutationFn: () => addWatch(symbol),
    onSuccess: () => {
      setSymbol('');
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (s: string) => removeWatch(s),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
    },
  });

  const canAdd = symbol.trim() !== '' && !add.isPending;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlist</h1>
        <EditModeToggle on={editing} onChange={setEditing} noun="watchlist" />
      </div>

      <div className="flex gap-2">
        <input
          className={inputClasses('md', 'uppercase')}
          placeholder="Ticker"
          value={symbol}
          autoCapitalize="characters"
          autoCorrect="off"
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button variant="accent" disabled={!canAdd} onClick={() => add.mutate()}>
          Watch
        </Button>
      </div>
      {add.isError && <p className="text-sm text-down">{(add.error as Error).message}</p>}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {isError && <p className="text-sm text-down">Couldn’t load your watchlist.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">Nothing watched yet. Tell the chat “watch NVDA”, or add one above.</p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {data?.map((w) => (
          <li key={w.symbol} data-testid={`watch-${w.symbol}`} className="flex items-center gap-3 px-3 py-2.5">
            <span className="font-medium">{w.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{w.name}</span>
            {editing && confirming !== w.symbol && <Button onClick={() => setConfirming(w.symbol)}>Remove</Button>}
            {editing && confirming === w.symbol && (
              <Button variant="danger" aria-label="Confirm remove" onClick={() => remove.mutate(w.symbol)}>
                Remove {w.symbol}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
