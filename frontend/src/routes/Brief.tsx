import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { SessionBadge } from '../components/SessionBadge';
import { formatTimestamp } from '../components/format';
import { RefreshButton } from '../components/RefreshButton';
import { Markdown } from '../components/Markdown';

type Source = 'PORTFOLIO' | 'WATCHLIST' | 'MARKET';
type Coverage = {
  source: 'PORTFOLIO' | 'WATCHLIST';
  symbol: string;
  price: number | null;
  regularPrice: number | null;
  stale: boolean;
  session: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;
  extended: boolean;
};
type BriefNote = {
  kind: 'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT' | 'EARNINGS' | 'ECONOMIC' | 'QUIET_DAY';
  source: Source;
  symbol: string | null;
  title: string;
  detail: string;
  eventAt?: string;
};
type BriefResponse = {
  generatedAt: string;
  refreshAfterSeconds: number;
  marketDataAvailable: boolean;
  coverage: Coverage[];
  notes: BriefNote[];
  /** Null whenever there is nothing to show — no AI configured, or the call failed. Silent by design. */
  narrative: string | null;
};

const QUERY_KEY = ['daily-brief'];
const GROUPS: { source: Source; label: string }[] = [
  { source: 'MARKET', label: 'Market' },
  { source: 'PORTFOLIO', label: 'Portfolio' },
  { source: 'WATCHLIST', label: 'Watch' },
];

function destination(source: Coverage['source'], symbol: string) {
  const list = source === 'PORTFOLIO' ? '/' : '/watchlist';
  return `${list}?symbol=${encodeURIComponent(symbol)}`;
}

function CoverageCard({ item }: { item: Coverage }) {
  return (
    <Link
      to={destination(item.source, item.symbol)}
      className="block rounded-xl border border-border bg-surface-1 p-3 transition-colors active:bg-surface-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold">{item.symbol}</span>
        <span className="text-base font-medium tabular-nums">
          {item.price === null ? 'Price unavailable' : <Money value={item.price} />}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <SessionBadge session={item.session} extended={item.extended} />
        {item.stale && <span className="font-medium tracking-wide text-down">STALE</span>}
        {item.extended && item.regularPrice !== null && (
          <span>Regular close <Money value={item.regularPrice} /></span>
        )}
        <span className="ml-auto text-accent">View {item.source === 'PORTFOLIO' ? 'holding' : 'watch row'} →</span>
      </div>
    </Link>
  );
}

function NoteCard({ note, coverage }: { note: BriefNote; coverage?: Coverage }) {
  const content = (
    <>
      <h4 className="text-sm font-medium">{note.title}</h4>
      {coverage && (coverage.stale || coverage.extended) && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {coverage.stale && <span className="font-medium tracking-wide text-down">STALE QUOTE</span>}
          {coverage.extended && <SessionBadge session={coverage.session} extended={coverage.extended} />}
        </div>
      )}
      <p className="mt-1 text-xs leading-relaxed text-muted">{note.detail}</p>
    </>
  );
  const className = 'block rounded-xl border border-border bg-surface-1 p-3';
  if (note.source === 'MARKET' || !note.symbol) {
    return <article className={className}>{content}</article>;
  }
  return (
    <Link
      to={destination(note.source, note.symbol)}
      className={`${className} transition-colors active:bg-surface-2`}
    >
      {content}
      <span className="mt-2 block text-xs text-accent">View {note.symbol} →</span>
    </Link>
  );
}

export function Brief() {
  const queryClient = useQueryClient();
  const refreshInFlight = useRef<Promise<BriefResponse> | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => refreshInFlight.current ?? api<BriefResponse>('/watchlist/daily-brief'),
    staleTime: 300_000,
    refetchInterval: (current) => (current.state.data?.refreshAfterSeconds ?? 300) * 1000,
  });
  const brief = query.data;

  const refresh = async () => {
    setRefreshFailed(false);
    try {
      // Any automatic read started during refresh joins this forced request.
      // This also prevents a late normal response from replacing fresh data.
      const freshRequest = queryClient.cancelQueries({ queryKey: QUERY_KEY, exact: true })
        .then(() => api<BriefResponse>('/watchlist/daily-brief?refresh=1'));
      refreshInFlight.current = freshRequest;
      const fresh = await freshRequest;
      queryClient.setQueryData(QUERY_KEY, fresh);
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshInFlight.current = null;
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Daily brief</h1>
          {brief && (
            <p className="mt-1 text-xs text-muted">
              Updated {formatTimestamp(brief.generatedAt)}
            </p>
          )}
        </div>
        <RefreshButton label="Refresh brief" onRefresh={refresh} />
      </header>
      {refreshFailed && (
        <p role="alert" className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">
          {brief
            ? 'Refresh did not complete. Showing the last completed brief.'
            : 'Refresh did not complete. Try again.'}
        </p>
      )}
      {query.isPending && !brief && (
        <p className="text-sm text-muted">Loading today’s brief…</p>
      )}
      {query.isError && !brief && !refreshFailed && (
        <p role="alert" className="text-sm text-down">Daily brief unavailable right now.</p>
      )}
      {brief && <>
        {!brief.marketDataAvailable && (
          <p role="alert" className="rounded-lg border border-border bg-surface-1 p-3 text-sm text-muted">
            Federal Reserve updates unavailable right now. Market events may be incomplete.
          </p>
        )}
        {brief.narrative && (
          <section
            aria-label="AI take"
            className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm leading-relaxed"
          >
            <Markdown text={brief.narrative} />
          </section>
        )}
        <section aria-label="Notable events" className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Notable events</h2>
          {brief.notes.length === 0 ? (
            <p className="text-sm text-muted">No Portfolio or Watch notes to show right now.</p>
          ) : (
            GROUPS.map((group) => {
              const notes = brief.notes.filter((note) => note.source === group.source);
              if (notes.length === 0) return null;
              return (
                <div key={group.source} className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wide text-muted">{group.label}</h3>
                  <div className="space-y-2">
                    {notes.map((note, index) => (
                      <NoteCard
                        key={`${note.kind}-${note.symbol ?? 'market'}-${index}`}
                        note={note}
                        coverage={brief.coverage.find((item) => item.source === note.source && item.symbol === note.symbol)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </section>
        <section aria-label="Current coverage" className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Current coverage</h2>
          {brief.coverage.length === 0 ? (
            <p className="text-sm text-muted">No Portfolio or Watch tickers yet.</p>
          ) : (
            GROUPS.filter((group) => group.source !== 'MARKET').map((group) => {
              const items = brief.coverage.filter((item) => item.source === group.source);
              if (items.length === 0) return null;
              return (
                <div key={group.source} className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wide text-muted">{group.label}</h3>
                  <div className="space-y-2">
                    {items.map((item) => <CoverageCard key={item.symbol} item={item} />)}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </>}
    </div>
  );
}
