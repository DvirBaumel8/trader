import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { EntryCard, type Entry } from '../components/EntryCard';
import { TradeCard, type Trade } from '../components/TradeCard';
import { Money } from '../components/Money';
import { StatsHeader } from '../components/StatsHeader';
import { EntrySheet } from '../components/EntrySheet';

type Tab = 'TRADES' | 'ACTIVITIES' | 'BALANCE';

const TABS: { value: Tab; label: string }[] = [
  { value: 'TRADES', label: 'Trades' },
  { value: 'ACTIVITIES', label: 'Activities' },
  { value: 'BALANCE', label: 'Balance' },
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
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/portfolio/stats'),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  const closed = (data?.trades ?? []).filter((t) => !t.isOpen);

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
    <ul>
      {closed.map((t) => (
        <TradeCard key={`${t.symbol}-${t.enteredAt}`} trade={t} />
      ))}
    </ul>
  );
}

function ActivitiesTab({ onOpen }: { onOpen: (e: Entry) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['journal', 'TRADE'],
    queryFn: () => api<Entry[]>('/journal?kind=TRADE'),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  const entries = data ?? [];
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No buys or sells logged yet.</p>;
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  return (
    <div className="space-y-4">
      <ByDay
        entries={entries}
        render={(id) => {
          const e = byId.get(id);
          return e ? <EntryCard key={id} entry={e} onOpen={onOpen} /> : null;
        }}
      />
    </div>
  );
}

function BalanceTab({ onOpen }: { onOpen: (e: Entry) => void }) {
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
            <EntryCard key={e.id} entry={e} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Journal() {
  const [tab, setTab] = useState<Tab>('TRADES');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ defaultFee: number }>('/settings'),
  });

  const close = () => {
    setComposing(false);
    setEditing(null);
  };

  return (
    <div className="space-y-4 pb-20">
      <StatsHeader />

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              tab === t.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'TRADES' && <TradesTab />}
      {tab === 'ACTIVITIES' && <ActivitiesTab onOpen={setEditing} />}
      {tab === 'BALANCE' && <BalanceTab onOpen={setEditing} />}

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
      />
    </div>
  );
}
