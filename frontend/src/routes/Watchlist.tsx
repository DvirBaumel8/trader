import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { formatMoney, formatPercent } from '../components/format';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { RefreshButton } from '../components/RefreshButton';
import { WatchlistRanking } from '../components/WatchlistRanking';
import { SessionBadge } from '../components/SessionBadge';
import { usePersistentState } from '../lib/persistentState';
import { shortDay } from '../lib/chartDates';
import { sortWatchRows, type WatchSort } from '../lib/sortWatchRows';
import { DataTable, type Column } from '../components/ui/DataTable';
import { EarningsBadge } from '../components/EarningsBadge';
import { Percent } from '../components/Percent';

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
  session: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;
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

const BADGE = 'rounded px-1 py-px text-[9px] font-medium tracking-wide';

/**
 * Same table as Holdings. Tags sit under the symbol rather than the company
 * name, which the owner chose to leave out; the session is labeled once, in
 * the title, not per row.
 */
const WATCH_COLUMNS: Column<WatchRow>[] = [
  {
    id: 'symbol',
    header: 'Symbol',
    align: 'left',
    sortKey: 'symbol',
    firstDir: 'asc',
    primary: (r) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="font-semibold">{r.symbol}</span>
        {r.reached && <span className={`${BADGE} bg-accent/15 text-accent uppercase`}>target hit</span>}
        {r.stale && <span className={`${BADGE} text-muted`}>STALE</span>}
        {r.daysUntilEarnings !== null && <EarningsBadge days={r.daysUntilEarnings} />}
      </span>
    ),
    secondary: (r) => r.tags.map((t) => t.label).join(' · '),
  },
  {
    id: 'last',
    header: 'Last',
    align: 'right',
    primary: (r) => (r.price === null ? '—' : formatMoney(r.price)),
  },
  {
    id: 'day',
    header: 'Day',
    align: 'right',
    sortKey: 'day',
    primary: (r) => <Percent value={r.todayChangePercent} />,
  },
  {
    id: 'target',
    header: 'Target',
    align: 'right',
    sortKey: 'target',
    firstDir: 'asc',
    primary: (r) => (r.targetPrice === null ? '—' : formatMoney(r.targetPrice)),
    secondary: (r) =>
      r.targetPrice === null
        ? 'no target set'
        : r.distanceToTarget === null
          ? ''
          : `${formatPercent(r.distanceToTarget)} away`,
  },
];

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
  const focusedRowRef = useRef<HTMLSpanElement>(null);
  // No sort until a header is tapped: the list keeps its own order.
  const [sort, setSort] = usePersistentState<WatchSort | null>('trader.watchlist.sort', null);
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

        {shown.length > 0 && (
          <DataTable<WatchRow>
            title={
              <SessionBadge
                session={shown.find((r) => r.session !== null)?.session ?? null}
                extended={shown.some((r) => r.extended)}
              />
            }
            columns={WATCH_COLUMNS}
            rows={sortWatchRows(shown, sort)}
            rowKey={(r) => r.symbol}
            rowTestId={(r) => `watch-${r.symbol}`}
            sort={sort ?? undefined}
            onSortChange={setSort}
            focusedKey={focusedSymbol}
            focusedRef={focusedRowRef}
            renderBelowRow={
              editMode
                ? (r) => (
                    <RowEditor
                      row={r}
                      onDelete={() => removeMutation.mutate(r.id)}
                      onSaved={invalidate}
                    />
                  )
                : undefined
            }
          />
        )}
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
