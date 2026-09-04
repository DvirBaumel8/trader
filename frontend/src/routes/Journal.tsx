import { useEffect, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { EntryCard, type Entry } from '../components/EntryCard';
import { TradeCard, type Trade } from '../components/TradeCard';
import { Money } from '../components/Money';
import { StatsHeader } from '../components/StatsHeader';
import { EntrySheet } from '../components/EntrySheet';
import { loadUiState, saveUiState } from '../lib/uiState';
import { FeesChart } from '../components/FeesChart';
import type { FeesResponse, Period } from '../lib/feeTypes';
import { FilterBar, type SortValue } from '../components/FilterBar';
import {
  emptyFilters,
  filterTrades,
  hasActiveFilters,
  journalQuery,
  sortEntries,
  sortTrades,
  type Filters,
} from '../lib/entryFilters';
import { useDebounced } from '../lib/useDebounced';

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

type Tab = 'TRADES' | 'ACTIVITIES' | 'BALANCE' | 'FEES';

const TABS: { value: Tab; label: string }[] = [
  { value: 'TRADES', label: 'Trades' },
  { value: 'ACTIVITIES', label: 'Activities' },
  { value: 'BALANCE', label: 'Balance' },
  { value: 'FEES', label: 'Fees' },
];

interface Stats {
  trades: Trade[];
  closedCount: number;
  openCount: number;
}

interface Balance {
  cash: number;
  contributedCapital: number;
  dividendsReceived: number;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Groups entries under a date heading so the list reads as days, not a blur. */
function ByDay({
  entries,
  render,
}: {
  entries: { id: string; occurredAt: string }[];
  render: (id: string) => ReactNode;
}) {
  const groups: { day: string; ids: string[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.occurredAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.ids.push(e.id);
    else groups.push({ day, ids: [e.id] });
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1 text-[11px] tracking-wide text-muted uppercase">
            {g.day}
          </h2>
          <ul>{g.ids.map((id) => render(id))}</ul>
        </section>
      ))}
    </>
  );
}

function TradesTab() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<SortValue>('NEWEST');

  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/portfolio/stats'),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  const closed = (data?.trades ?? []).filter((t) => !t.isOpen);
  const shown = sortTrades(filterTrades(closed, filters), sort);

  if (closed.length === 0) {
    return (
      <p className="text-sm text-muted">
        No closed trades yet.
        {data && data.openCount > 0 && (
          <>
            {' '}
            Your {data.openCount} open positions are on the Portfolio tab, and
            their fills are under Activities.
          </>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        // On a results list, "largest" means the best outcome, not the biggest bet.
        sortLabels={{ LARGEST: 'Biggest win', SMALLEST: 'Biggest loss' }}
        resultCount={shown.length}
        totalCount={closed.length}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No trades match those filters.</p>
      ) : (
        <ul>
          {shown.map((t) => (
            <TradeCard key={`${t.symbol}-${t.enteredAt}`} trade={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivitiesTab({
  onOpen,
  editMode,
}: {
  onOpen: (e: Entry) => void;
  editMode: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<SortValue>('NEWEST');

  // The server does the selecting; this waits for a pause in typing so a
  // search is one request rather than one per keystroke.
  const settled = useDebounced(filters);
  const active = hasActiveFilters(settled);

  const { data, isLoading } = useQuery({
    queryKey: ['journal', 'TRADE', settled],
    queryFn: () => api<Entry[]>(`/journal?${journalQuery(settled)}`),
    placeholderData: keepPreviousData,
  });

  // Only when filtering, and only to say "12 of 40" — the unfiltered list is
  // otherwise exactly the list above, so asking twice would be waste.
  const { data: allData } = useQuery({
    queryKey: ['journal', 'TRADE', emptyFilters],
    queryFn: () => api<Entry[]>('/journal?kind=TRADE'),
    enabled: active,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const entries = data ?? [];
  if (entries.length === 0 && !active) {
    return <p className="text-sm text-muted">No buys or sells logged yet.</p>;
  }

  const totalCount = active ? (allData?.length ?? entries.length) : entries.length;
  const shown = sortEntries(entries, sort);
  const byId = new Map(shown.map((e) => [e.id, e]));
  // Day headings only make sense while the list is in date order. Sorted by
  // money, they would break the list into meaningless one-row groups.
  const chronological = sort === 'NEWEST' || sort === 'OLDEST';

  const row = (id: string) => {
    const e = byId.get(id);
    return e ? (
      <EntryCard key={id} entry={e} editMode={editMode} onOpen={onOpen} />
    ) : null;
  };

  return (
    <div className="space-y-3">
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        resultCount={shown.length}
        totalCount={totalCount}
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing matches those filters.</p>
      ) : chronological ? (
        <div className="space-y-4">
          <ByDay entries={shown} render={row} />
        </div>
      ) : (
        <ul>{shown.map((e) => row(e.id))}</ul>
      )}
    </div>
  );
}

function BalanceTab({
  onOpen,
  editMode,
}: {
  onOpen: (e: Entry) => void;
  editMode: boolean;
}) {
  const { data: balance } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Balance>('/portfolio'),
  });
  const { data: cashEntries } = useQuery({
    queryKey: ['journal', 'MONEY'],
    queryFn: async () => {
      const [cash, dividends] = await Promise.all([
        api<Entry[]>('/journal?kind=CASH'),
        api<Entry[]>('/journal?kind=DIVIDEND'),
      ]);
      return [...cash, ...dividends].sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      );
    },
  });

  const entries = cashEntries ?? [];

  return (
    <div className="space-y-5">
      <section>
        <div className="text-xs tracking-wide text-muted uppercase">Cash</div>
        <div
          className={`mt-1 text-3xl font-semibold ${
            balance && balance.cash < 0 ? 'text-down' : ''
          }`}
        >
          <Money value={balance?.cash} />
        </div>
        {balance && balance.cash < 0 && (
          <div className="text-[10px] tracking-wide text-down">ON MARGIN</div>
        )}
      </section>

      {/*
        A summary only earns its place once it says something the list below
        does not. With a single deposit and no dividends it just repeats the
        one row underneath it.
      */}
      {(entries.length > 1 || (balance?.dividendsReceived ?? 0) > 0) && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-surface-1 p-3">
            <div className="text-xs text-muted">Net deposited</div>
            <div className="mt-1 font-medium">
              <Money value={balance?.contributedCapital} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-1 p-3">
            <div className="text-xs text-muted">Dividends</div>
            <div className="mt-1 font-medium">
              <Money value={balance?.dividendsReceived} />
            </div>
          </div>
        </section>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted">No money movements yet.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              editMode={editMode}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeesTab() {
  const [period, setPeriod] = useState<Period>('MONTH');

  // The backend buckets and totals; this only draws the result. It used to
  // fetch every trade entry and aggregate them here — see invariant 5.
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', 'fees', period],
    queryFn: () => api<FeesResponse>(`/portfolio/fees?period=${period}`),
    // Changing period changes the key; without this the chart empties for a
    // frame before redrawing, the same flash the benchmark chart had.
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <FeesChart
      buckets={data?.buckets ?? []}
      total={data?.total ?? 0}
      period={period}
      onPeriodChange={setPeriod}
    />
  );
}

export function Journal() {
  // iOS discards backgrounded tabs, so returning from the broker app cold-
  // starts this one. Everything below exists to put the user back where they
  // were rather than on the default screen.
  const restored = useRef(loadUiState());
  const [tab, setTab] = useState<Tab>(
    (restored.current?.journalTab as Tab) ?? 'TRADES',
  );
  const [composing, setComposing] = useState(
    restored.current?.composing ?? false,
  );
  const [editMode, setEditMode] = useState(
    restored.current?.editingEntryId != null,
  );
  const [editing, setEditing] = useState<Entry | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ defaultFee: number }>('/settings'),
  });

  // Only fetched when there is an entry to reopen, and only once.
  const pendingEntryId = restored.current?.editingEntryId ?? null;
  const { data: allEntries } = useQuery({
    queryKey: ['journal', 'ALL'],
    queryFn: () => api<Entry[]>('/journal'),
    enabled: pendingEntryId !== null,
  });

  useEffect(() => {
    if (!pendingEntryId || !allEntries) return;
    // The fetch behind this can take a moment, and by the time it resolves
    // the user may already be composing a new entry or have opened a
    // different one. Reopening the restored entry onto that would silently
    // replace what they are doing right now, so a restore only ever lands
    // on an idle sheet — otherwise it is simply dropped.
    if (!composing && editing === null) {
      const found = allEntries.find((e) => e.id === pendingEntryId);
      // The entry may have been deleted from another device; silently skip
      // it rather than reopening an editor onto nothing.
      if (found) setEditing(found);
    }
    restored.current = null;
  }, [pendingEntryId, allEntries, composing, editing]);

  useEffect(() => {
    saveUiState({
      path: '/journal',
      journalTab: tab,
      editingEntryId: editing?.id ?? null,
      composing,
    });
  }, [tab, editing, composing]);

  const close = () => {
    setComposing(false);
    setEditing(null);
  };

  return (
    <div className="space-y-4 pb-20">
      <StatsHeader />

      <div className="-mx-4 flex items-center gap-1 overflow-x-auto px-4">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              tab === t.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}

        {(tab === 'ACTIVITIES' || tab === 'BALANCE') && (
          <button
            type="button"
            aria-pressed={editMode}
            aria-label={editMode ? 'Done editing' : 'Edit entries'}
            onClick={() => setEditMode((v) => !v)}
            className={`shrink-0 rounded-lg border px-2 py-1.5 transition-colors ${
              editMode
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            <PencilIcon />
          </button>
        )}
      </div>

      {editMode && (tab === 'ACTIVITIES' || tab === 'BALANCE') && (
        <p className="text-[11px] text-accent">
          Tap an entry to edit or delete it.
        </p>
      )}

      {tab === 'TRADES' && <TradesTab />}
      {tab === 'ACTIVITIES' && (
        <ActivitiesTab onOpen={setEditing} editMode={editMode} />
      )}
      {tab === 'BALANCE' && (
        <BalanceTab onOpen={setEditing} editMode={editMode} />
      )}
      {tab === 'FEES' && <FeesTab />}

      <button
        type="button"
        onClick={() => setComposing(true)}
        aria-label="New entry"
        className="fixed right-5 bottom-8 z-40 h-14 w-14 rounded-full bg-accent text-3xl leading-none font-light text-surface-0 shadow-lg"
      >
        +
      </button>

      <EntrySheet
        open={composing || editing !== null}
        onClose={close}
        defaultFee={settings?.defaultFee ?? 4}
        editing={editing}
        resuming={restored.current?.composing ?? false}
      />
    </div>
  );
}
