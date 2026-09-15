import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { MinimizableSection } from './ui/MinimizableSection';

type Source = 'PORTFOLIO' | 'WATCHLIST' | 'MARKET';

interface BriefNote {
  kind: 'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT' | 'EARNINGS' | 'ECONOMIC';
  source: Source;
  symbol: string | null;
  title: string;
  detail: string;
  eventAt?: string;
  actual?: number | null;
  expected?: number | null;
}

interface BriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  notes: BriefNote[];
}

const groups: { source: Source; label: string }[] = [
  { source: 'PORTFOLIO', label: 'Portfolio' },
  { source: 'WATCHLIST', label: 'Watchlist' },
  { source: 'MARKET', label: 'Market' },
];

export function DailyBrief() {
  const query = useQuery({
    queryKey: ['daily-brief'],
    queryFn: () => api<BriefResponse>('/watchlist/daily-brief'),
    refetchInterval: 5 * 60 * 1000,
  });
  const notes = query.data?.notes ?? [];

  return (
    <MinimizableSection storageKey="trader.portfolio.dailyBriefOpen" label="Daily brief">
      {query.isLoading ? (
        <p className="text-xs text-muted">Loading today’s brief…</p>
      ) : query.isError ? (
        <p className="text-xs text-muted">Daily brief unavailable right now.</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted">No notable moves or events right now.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const groupNotes = notes.filter((note) => note.source === group.source);
            if (groupNotes.length === 0) return null;
            return (
              <section key={group.source} className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wide text-muted">{group.label}</h3>
                <div className="space-y-2">
                  {groupNotes.map((note, index) => (
                    <article key={`${note.kind}-${note.symbol ?? 'market'}-${index}`} className="rounded-lg border border-border bg-surface-1 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium">{note.title}</p>
                        {note.symbol && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">{note.symbol}</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted">{note.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </MinimizableSection>
  );
}
