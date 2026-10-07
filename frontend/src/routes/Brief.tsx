import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { SessionBadge } from '../components/SessionBadge';
import { formatTimestamp } from '../components/format';
import { RefreshButton } from '../components/RefreshButton';
import { Markdown } from '../components/Markdown';
import { MoodLine } from '../components/brief/MoodLine';
import { MoverList } from '../components/brief/MoverList';
import { BriefNoteList } from '../components/brief/BriefNoteList';
import { DAILY_BRIEF_QUERY_KEY, fetchDailyBrief, type BriefResponse } from '../api/dailyBrief';

const QUERY_KEY = DAILY_BRIEF_QUERY_KEY;
const holdingDestination = (symbol: string) => `/?symbol=${encodeURIComponent(symbol)}`;
const watchDestination = (symbol: string) => `/watchlist?symbol=${encodeURIComponent(symbol)}`;

export function Brief() {
  const queryClient = useQueryClient();
  const refreshInFlight = useRef<Promise<BriefResponse> | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => refreshInFlight.current ?? fetchDailyBrief<BriefResponse>(),
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
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              Updated {formatTimestamp(brief.generatedAt)}
              <SessionBadge session={brief.session} extended={false} />
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
            {brief.narrativeAt && brief.narrativeAt !== brief.generatedAt && (
              <p className="mb-1 text-[10px] tracking-wide text-muted uppercase">
                AI take as of {formatTimestamp(brief.narrativeAt)}
              </p>
            )}
            <Markdown text={brief.narrative} />
          </section>
        )}
        <MoodLine mood={brief.mood} events={brief.events} />
        <BriefNoteList label="Needs attention" notes={brief.queue} destination={holdingDestination} empty="Nothing needs a decision today." />
        <MoverList movers={brief.movers} />
        <BriefNoteList label="Watch triggers" notes={brief.watchTriggers} destination={watchDestination} />
      </>}
    </div>
  );
}
