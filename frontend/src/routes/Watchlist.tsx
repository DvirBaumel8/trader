import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { formatMoney, formatPercent, signClass } from '../components/format';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { RefreshButton } from '../components/RefreshButton';
import { WatchlistRanking } from '../components/WatchlistRanking';
import { SessionBadge } from '../components/SessionBadge';
import { usePersistentState } from '../lib/persistentState';
import { shortDay } from '../lib/chartDates';

const inputClass = inputClasses('md');
const WATCHLIST_KEY = ['watchlist'];

interface WatchRow {
  id: string;
  symbol: string;
  name: string | null;
  price: number | null;
  regularPrice: number | null;
  /** Today's move from the previous close, as a fraction. Null without both prices. */
  todayChangePercent: number | null;
  stale: boolean;
  session: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | null;
  extended: boolean;
  targetPrice: number | null;
  targetDirection: 'ABOVE' | 'BELOW' | null;
  distanceToTarget: number | null;
  reached: boolean;
  alerting: boolean;
  reachedOn: string | null;
  note: string;
  tags: { id: string; label: string }[];
  daysUntilEarnings: number | null;
}

/**
 * Tickers the owner is considering but does not own.
 *
 * Nothing here writes a transaction: a watchlist item is an intention, a
 * position is a fact, and keeping them apart is what leaves invariant 1
 * (positions derived from the journal alone) untouched.
 */
export function Watchlist() {
  const [searchParams] = useSearchParams();
  const focusedSymbol = searchParams.get('symbol')?.toUpperCase() ?? null;
  const focusedRowRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const [symbolText, setSymbolText] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // Survives iOS discarding the tab mid-typing, like every other form here.
  const [tagFilter, setTagFilter] = usePersistentState<string | null>(
    'trader.watchlist.tagFilter',
    null,
  );

  const listQuery = useQuery({
    queryKey: WATCHLIST_KEY,
    queryFn: () => api<WatchRow[]>('/watchlist'),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });

  const refreshWatchlist = async () => {
    const fresh = await api<WatchRow[]>('/watchlist?refresh=1');
    queryClient.setQueryData(WATCHLIST_KEY, fresh);
  };

  const addMutation = useMutation({
    mutationFn: async (input: {
      symbols: string[];
      body: { targetPrice?: number; note?: string; tags?: string[] };
    }) => {
      const results = await Promise.allSettled(
        input.symbols.map((symbol) =>
          api<WatchRow>('/watchlist', {
            method: 'POST',
            body: JSON.stringify({ ...input.body, symbol }),
          }),
        ),
      );
      return {
        failed: input.symbols.filter((_, index) => results[index].status === 'rejected'),
      };
    },
    onSuccess: async ({ failed }) => {
      setSymbolText(failed.join('\n'));
      setTarget('');
      setNote('');
      setTags('');
      await invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/watchlist/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/watchlist/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const rows = listQuery.data ?? [];
  const alerting = rows.filter((r) => r.alerting);
  const allTags = [...new Set(rows.flatMap((r) => r.tags.map((t) => t.label)))].sort();
  const filtered = tagFilter
    ? rows.filter((r) => r.tags.some((t) => t.label === tagFilter))
    : rows;
  const focusedRow = rows.find((r) => r.symbol === focusedSymbol);
  const shown = focusedRow && !filtered.includes(focusedRow)
    ? [...filtered, focusedRow]
    : filtered;

  useEffect(() => {
    if (!focusedSymbol) {
      scrolledTo.current = null;
    } else if (focusedRow && scrolledTo.current !== focusedSymbol) {
      focusedRowRef.current?.scrollIntoView?.({ block: 'center' });
      scrolledTo.current = focusedSymbol;
    }
  }, [focusedRow, focusedSymbol]);
  const enteredSymbols = [...new Set(
    symbolText
      .split(/[\s,;]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (enteredSymbols.length === 0) return;
    const parsed = parseFloat(target);
    addMutation.reset();
    addMutation.mutate({
      symbols: enteredSymbols,
      body: {
      ...(target.trim() !== '' && Number.isFinite(parsed) && parsed > 0
        ? { targetPrice: Math.abs(parsed) }
        : {}),
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
      ...(tags.trim() !== ''
        ? {
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
      },
    });
  }

  return (
    <div className="space-y-4">
      {/*
        The whole point of the feature, and why it is the first thing on the
        page: he asked to be told what reached its target when he opens it —
        a notification that only ever fires where he can act on it. Dismissing
        is per ticker, and a new target always announces itself again.
      */}
      {alerting.length > 0 && (
        <section className="space-y-2 rounded-xl border border-accent/40 bg-accent/10 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
            {alerting.length === 1
              ? 'A ticker reached your target'
              : `${alerting.length} tickers reached your target`}
          </h2>
          {alerting.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-semibold">{r.symbol}</span>{' '}
                <span className="text-muted">
                  {r.targetDirection === 'ABOVE' ? 'rose to' : 'fell to'}{' '}
                  {formatMoney(r.targetPrice)}
                </span>
                {/*
                  The day it happened, because the hit may be history: he
                  asked to be told if it reached his price at any point since
                  he set it, so "now" alone would misdescribe a spike that has
                  already pulled back.
                */}
                {r.reachedOn && (
                  <span className="text-muted"> on {shortDay(r.reachedOn)}</span>
                )}
                {r.price !== null && (
                  <span className="text-muted"> · now {formatMoney(r.price)}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => ackMutation.mutate(r.id)}
                className="shrink-0 text-xs font-medium text-accent underline underline-offset-4"
              >
                Got it
              </button>
            </div>
          ))}
        </section>
      )}

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={tagFilter === null}
            onClick={() => setTagFilter(null)}
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              tagFilter === null
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            All
          </button>
          {allTags.map((label) => (
            <button
              key={label}
              type="button"
              aria-pressed={tagFilter === label}
              onClick={() => setTagFilter(tagFilter === label ? null : label)}
              className={`rounded-lg border px-2 py-1 text-[11px] ${
                tagFilter === label
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <WatchlistRanking hasTickers={rows.length > 0} />

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-[10px] uppercase tracking-wide text-muted">
              Watching
            </h2>
            <Link to="/watchlist/ideas" className="text-sm font-medium text-accent">
              Ideas
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {editMode && rows.length > 0 && (
              <ClearAllButton onCleared={invalidate} />
            )}
            {rows.length > 0 && (
              <RefreshButton
                label="Refresh watchlist prices now"
                onRefresh={refreshWatchlist}
              />
            )}
            {rows.length > 0 && (
              <EditModeToggle on={editMode} onChange={setEditMode} noun="watchlist" />
            )}
          </div>
        </div>

        {listQuery.isLoading && <p className="text-xs text-muted">Loading…</p>}
        {!listQuery.isLoading && rows.length === 0 && (
          <p className="text-xs text-muted">
            Nothing watched yet. Tap + to add stocks, with the price you want
            to be told about.
          </p>
        )}

        <div className="min-w-0 md:grid md:grid-cols-[minmax(7.5rem,1fr)_auto_auto_auto] md:items-start md:gap-x-3">
            <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-wide text-text/70 md:block">Symbol</span>
            <span className="hidden whitespace-nowrap text-right text-[10px] uppercase tracking-wide text-text/70 md:block">Price</span>
            <span className="hidden whitespace-nowrap text-right text-[10px] uppercase tracking-wide text-text/70 md:block">Target</span>
            <span className="hidden whitespace-nowrap text-right text-[10px] uppercase tracking-wide text-text/70 md:block">Earnings</span>
            {shown.map((r, i) => (
              <Fragment key={r.id}>
                <div
                  ref={r.symbol === focusedSymbol ? focusedRowRef : undefined}
                  data-testid={`watch-${r.symbol}`}
                  data-focused={r.symbol === focusedSymbol || undefined}
                  className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-lg border px-3 py-3 transition-colors md:col-span-full md:grid-cols-subgrid md:border-0 md:px-0 md:py-3 ${
                    r.symbol === focusedSymbol
                      ? 'border-accent/50 bg-accent/10 md:rounded-md md:px-2'
                      : 'border-border/60 hover:bg-surface-1 active:bg-surface-2 md:border-transparent'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{r.symbol}</span>
                      {r.reached && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent">
                          target hit
                        </span>
                      )}
                      {r.stale && (
                        <span className="text-[9px] uppercase tracking-wide text-muted">
                          stale
                        </span>
                      )}
                    </div>
                    {r.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span
                            key={t.id}
                            className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted"
                          >
                            {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right text-sm tabular-nums">
                    <span>{r.price === null ? '—' : formatMoney(r.price)}</span>
                    {r.todayChangePercent !== null && (
                      <span className={`text-[11px] ${signClass(r.todayChangePercent)}`}>
                        {formatPercent(r.todayChangePercent)} today
                      </span>
                    )}
                    <SessionBadge session={r.session} extended={r.extended} />
                  </div>
                  <div className="col-span-2 mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted md:contents">
                    <div className="whitespace-nowrap md:text-right">
                      <span className="md:hidden">Target </span>
                      {r.targetPrice !== null ? <><span>{formatMoney(r.targetPrice)}</span>{r.distanceToTarget !== null && <span className="ml-1 md:ml-0 md:block">{formatPercent(r.distanceToTarget)} away</span>}</> : 'no target set'}
                    </div>
                    <div className="whitespace-nowrap md:text-right">
                      <span className="md:hidden">Earnings </span>
                      <span>{r.daysUntilEarnings === null ? '—' : r.daysUntilEarnings === 0 ? 'today' : `${r.daysUntilEarnings}d`}</span>
                    </div>
                  </div>
                </div>
                {editMode && (
                  <div className="md:col-span-full"><RowEditor
                    row={r}
                    onDelete={() => removeMutation.mutate(r.id)}
                    onSaved={invalidate}
                  /></div>
                )}
                {i < shown.length - 1 && <div className="my-1 border-b border-border md:col-span-full" />}
              </Fragment>
            ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        aria-label="Add stocks"
        className="fixed right-5 bottom-8 z-40 h-14 w-14 rounded-full bg-accent text-3xl leading-none font-light text-surface-0 shadow-lg"
      >
        +
      </button>

      {composerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setComposerOpen(false)}
            className="flex-1"
          />
          <form
            role="dialog"
            aria-label="Add to watchlist"
            onSubmit={submit}
            className="max-h-[88vh] space-y-4 overflow-y-auto rounded-t-2xl border-t border-border bg-surface-0 p-4 pb-10"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Add to watchlist</h2>
              <button type="button" aria-label="Close" onClick={() => setComposerOpen(false)} className="text-sm text-muted">Close</button>
            </div>
            <textarea
              placeholder="NVDA, AMD, TSLA"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              rows={3}
              value={symbolText}
              onChange={(e) => setSymbolText(e.target.value)}
              className={`${inputClasses('md')} resize-none`}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="target (optional)"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="tags, comma separated"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={inputClass}
              />
            </div>
            <input
              placeholder="why you are watching it (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClasses('sm')}
            />
            {addMutation.data?.failed.length ? (
              <p className="text-xs text-down">Could not add: {addMutation.data.failed.join(', ')}. Check the symbols.</p>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              disabled={addMutation.isPending || enteredSymbols.length === 0}
            >
              {addMutation.isPending
                ? 'Adding…'
                : enteredSymbols.length === 0
                  ? 'Watch stocks'
                  : `Watch ${enteredSymbols.length} ${enteredSymbols.length === 1 ? 'stock' : 'stocks'}`}
            </Button>
          </form>
        </div>
      )}

    </div>
  );
}

/**
 * Empties the whole watchlist in one request, rather than one DELETE per
 * row. Only reachable in edit mode, same rule as a single row's delete, and
 * the same two-step inline confirm `RowEditor` already uses for it — a
 * browser `confirm()` would be off-brand here and this is a bigger blast
 * radius than any one row.
 */
function ClearAllButton({ onCleared }: { onCleared: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);

  const clearAll = useMutation({
    mutationFn: () => api('/watchlist', { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirming(false);
      await onCleared();
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-down active:opacity-70"
      >
        Clear all
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">Remove every watched ticker?</span>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded px-2 py-1 text-xs font-medium text-muted"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={clearAll.isPending}
        onClick={() => clearAll.mutate()}
        className="rounded bg-down/10 px-2 py-1 text-xs font-medium text-down disabled:opacity-50"
      >
        {clearAll.isPending ? 'Clearing…' : 'Clear all'}
      </button>
    </span>
  );
}

/**
 * Editing a watched ticker: its target, its note, its tags.
 *
 * The API has always supported this — `POST /watchlist` upserts on the symbol
 * — but nothing on screen reached it, so the list was add-and-delete only and
 * a target could never be corrected without removing the row and starting
 * again.
 *
 * Lives inside edit mode rather than behind a separate control, which keeps
 * one rule for the whole app: the list is read-only until the pencil is on,
 * and then a row can be changed or removed. Delete keeps its own confirm.
 */
function RowEditor({
  row,
  onDelete,
  onSaved,
}: {
  row: WatchRow;
  onDelete: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [target, setTarget] = useState(
    row.targetPrice === null ? '' : String(row.targetPrice),
  );
  const [note, setNote] = useState(row.note);
  const [tags, setTags] = useState(row.tags.map((t) => t.label).join(', '));
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const parsed = parseFloat(target);
      return api<WatchRow>('/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          symbol: row.symbol,
          // Empty means "remove the target" — null, not omitted. Omitting it
          // would leave the old one in place, which is the opposite of what
          // clearing the field says.
          targetPrice:
            target.trim() === '' || !Number.isFinite(parsed) || parsed <= 0
              ? null
              : Math.abs(parsed),
          note,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
    },
    onSuccess: onSaved,
  });

  const dirty =
    note !== row.note ||
    tags !== row.tags.map((t) => t.label).join(', ') ||
    target !== (row.targetPrice === null ? '' : String(row.targetPrice));

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="target (blank to clear)"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={inputClasses('sm')}
        />
        <input
          placeholder="tags, comma separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={inputClasses('sm')}
        />
      </div>
      <input
        placeholder="why you are watching it"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={inputClasses('sm')}
      />

      {save.isError && (
        <p className="text-xs text-down">Could not save that just now.</p>
      )}

      <div className="flex items-center justify-between gap-2">
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted">Stop watching {row.symbol}?</span>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-xs font-medium text-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-down/10 px-2 py-1 text-xs font-medium text-down"
            >
              Delete
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs font-medium text-down active:opacity-70"
          >
            Delete
          </button>
        )}

        <Button
          variant="secondary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
