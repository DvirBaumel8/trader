import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { formatMoney, formatPercent } from '../components/format';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { WatchlistRanking } from '../components/WatchlistRanking';
import { usePersistentState } from '../lib/persistentState';
import { shortDay } from '../lib/chartDates';

const inputClass = inputClasses('md');
const WATCHLIST_KEY = ['watchlist'];

interface WatchRow {
  id: string;
  symbol: string;
  name: string | null;
  price: number | null;
  stale: boolean;
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

function EarningsCell({ days }: { days: number | null }) {
  return (
    <div className="text-[10px] tabular-nums text-muted">
      <span className="uppercase tracking-wide">Earnings</span>{' '}
      <span>{days === null ? '—' : days === 0 ? 'today' : `${days}d`}</span>
    </div>
  );
}

/**
 * Tickers the owner is considering but does not own.
 *
 * Nothing here writes a transaction: a watchlist item is an intention, a
 * position is a fact, and keeping them apart is what leaves invariant 1
 * (positions derived from the journal alone) untouched.
 */
export function Watchlist() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
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

  const addMutation = useMutation({
    mutationFn: (body: {
      symbol: string;
      targetPrice?: number;
      note?: string;
      tags?: string[];
    }) =>
      api<WatchRow>('/watchlist', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setSymbol('');
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
  const shown = tagFilter
    ? rows.filter((r) => r.tags.some((t) => t.label === tagFilter))
    : rows;

  function submit(e: FormEvent) {
    e.preventDefault();
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) return;
    const parsed = parseFloat(target);
    addMutation.mutate({
      symbol: ticker,
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

      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <input
            placeholder="NVDA"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className={inputClass}
          />
          <input
            type="number"
            inputMode="decimal"
            placeholder="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={addMutation.isPending || !symbol.trim()}
          >
            {addMutation.isPending ? 'Adding…' : 'Watch'}
          </Button>
        </div>
        {/*
          Same fields RowEditor offers after the fact, moved up front —
          they were always accepted by this same endpoint, just undiscoverable
          without the pencil, the row, and Save. Optional, so a quick add
          stays quick: leave them blank and nothing changes about that path.
        */}
        <input
          placeholder="tags, comma separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={inputClasses('sm')}
        />
        <input
          placeholder="why you are watching it (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClasses('sm')}
        />
      </form>
      {addMutation.isError && (
        <p className="text-xs text-down">
          {addMutation.error instanceof ApiError &&
          addMutation.error.status === 404
            ? `No ticker called "${symbol.trim().toUpperCase()}". Check the symbol.`
            : 'Could not add that just now.'}
        </p>
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
          <h2 className="text-[10px] uppercase tracking-wide text-muted">
            Watching
          </h2>
          {rows.length > 0 && (
            <EditModeToggle on={editMode} onChange={setEditMode} noun="watchlist" />
          )}
        </div>

        {listQuery.isLoading && <p className="text-xs text-muted">Loading…</p>}
        {!listQuery.isLoading && rows.length === 0 && (
          <p className="text-xs text-muted">
            Nothing watched yet. Add a ticker above, with the price you want to
            be told about.
          </p>
        )}

        <ul className="space-y-1.5">
          {shown.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-border bg-surface-1 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
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
                  {/* The company, so a row is legible without knowing every ticker. */}
                  {r.name && (
                    <div className="mt-0.5 truncate text-[11px] text-muted">
                      {r.name}
                    </div>
                  )}
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
                <div className="shrink-0 text-right">
                  <div className="text-sm tabular-nums">
                    {r.price === null ? '—' : formatMoney(r.price)}
                  </div>
                  {r.targetPrice !== null ? (
                    <div className="text-[10px] tabular-nums text-muted">
                      target {formatMoney(r.targetPrice)}
                      {r.distanceToTarget !== null && (
                        <> · {formatPercent(r.distanceToTarget)} away</>
                      )}
                    </div>
                  ) : (
                    /*
                      A ticker with no target rendered as a bare symbol and a
                      price, which reads as something half-loaded rather than
                      as a deliberate state. Saying so — and saying where to
                      change it — costs one line and makes the row explain
                      itself. The target stays optional; it just no longer
                      looks like an omission.
                    */
                    <div className="text-[10px] text-muted">no target set</div>
                  )}
                  <EarningsCell days={r.daysUntilEarnings} />
                </div>
              </div>
              {editMode && (
                <RowEditor
                  row={r}
                  onDelete={() => removeMutation.mutate(r.id)}
                  onSaved={invalidate}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

    </div>
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
