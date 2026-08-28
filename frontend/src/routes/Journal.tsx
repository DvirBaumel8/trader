import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { EntryCard, type Entry } from '../components/EntryCard';

type KindFilter = 'ALL' | 'TRADE' | 'NOTE' | 'CASH';

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TRADE', label: 'Trades' },
  { value: 'NOTE', label: 'Notes' },
  { value: 'CASH', label: 'Cash' },
];

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function Journal() {
  const [kind, setKind] = useState<KindFilter>('ALL');

  const { data, isLoading, error } = useQuery({
    queryKey: ['journal', kind],
    queryFn: () =>
      api<Entry[]>(`/journal${kind === 'ALL' ? '' : `?kind=${kind}`}`),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error)
    return <p className="text-sm text-down">{(error as Error).message}</p>;

  const entries = data ?? [];

  // Group by calendar day so the timeline reads as days, not a flat list.
  const groups: { day: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.occurredAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={kind === f.value}
            onClick={() => setKind(f.value)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              kind === f.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      )}

      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1 text-[11px] tracking-wide text-muted uppercase">
            {g.day}
          </h2>
          <ul>
            {g.entries.map((e) => (
              <EntryCard key={e.id} entry={e} onOpen={() => {}} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
