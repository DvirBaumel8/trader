import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { CollapsibleCard } from './ui/CollapsibleCard';
import { Markdown } from './Markdown';

const RANKING_KEY = ['watchlist', 'ranking'];

interface RankedTicker {
  symbol: string;
  verdict: string;
  noAnalystCoverage: boolean;
}

interface RankingResponse {
  configured: boolean;
  rankedAt: string | null;
  model: string | null;
  order: RankedTicker[];
  reasoning: string | null;
  missing: string[];
  stale: boolean;
}

/**
 * "3 hours ago", not a clock time — the header's job here is to answer "can I
 * trust this without re-running it", and an elapsed duration answers that
 * faster than a timestamp does. `Math.round` rather than `floor` so a
 * ranking made 59 seconds ago reads "just now" instead of "0 minutes ago".
 */
function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'ranked just now';
  if (minutes < 60) {
    return `ranked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ranked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `ranked ${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The watchlist ranked best to worst, one model call for the whole list (see
 * `watchlist-ranking.service.ts`). The app orders; it never re-sorts or
 * scores what comes back — invariant 5 again, this time for a list rather
 * than a single figure.
 *
 * The order and each verdict are always on screen, never behind a tap: only
 * the reasoning — the long generated prose — goes inside `CollapsibleCard`,
 * the app's one way of showing that. Its header carries the ranking's age
 * and the refresh control, so both stay visible collapsed or not: an age
 * hidden behind a tap is a stale price wearing a fresh face.
 */
export function WatchlistRanking({ hasTickers }: { hasTickers: boolean }) {
  const queryClient = useQueryClient();

  const rankingQuery = useQuery({
    queryKey: RANKING_KEY,
    queryFn: () => api<RankingResponse>('/watchlist/ranking'),
    enabled: hasTickers,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      api<RankingResponse>('/watchlist/ranking/refresh', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(RANKING_KEY, data);
    },
  });

  if (!hasTickers) return null;

  const ranking = rankingQuery.data;

  return (
    <section className="space-y-2">
      <h2 className="text-[10px] uppercase tracking-wide text-muted">
        Ranked
      </h2>

      {rankingQuery.isLoading && (
        <p className="text-xs text-muted">Loading ranking…</p>
      )}

      {rankingQuery.isError && (
        <p className="text-xs text-muted">Couldn't load the ranking.</p>
      )}

      {/*
        `rankedAt` decides whether there is anything to show; `configured`
        only decides whether a REFRESH can be asked for. A key removed after
        a ranking was already computed must not blank out a cached answer
        that is still perfectly readable — it should just lose its refresh
        button, the same way the rest of the row stays intact.
      */}
      {ranking && ranking.rankedAt === null && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {ranking.configured
              ? 'No ranking yet — rank the watchlist to see the strongest candidate first.'
              : "Watchlist ranking isn't set up yet. Ask the developer to add an LLM API key."}
          </p>
          {ranking.configured && (
            <Button
              variant="secondary"
              disabled={refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              {refreshMutation.isPending ? 'Ranking…' : 'Rank watchlist'}
            </Button>
          )}
        </div>
      )}

      {refreshMutation.isError && (
        <p className="text-xs text-down">
          {refreshMutation.error instanceof ApiError &&
          refreshMutation.error.status === 503
            ? 'Could not refresh the ranking just now. The ranking above is unchanged.'
            : 'Could not refresh the ranking just now.'}
        </p>
      )}

      {ranking && ranking.rankedAt !== null && (
        <>
          <ol className="space-y-1.5">
            {ranking.order.map((t, i) => (
              <li
                key={t.symbol}
                className="flex items-start gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
              >
                <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="shrink-0 text-sm font-semibold">
                      {t.symbol}
                    </span>
                    <span className="min-w-0 text-xs text-muted">
                      {t.verdict}
                    </span>
                  </div>
                  {/*
                    A ticker ranked on two views sitting next to one ranked on
                    three, with nothing to tell them apart, is a judgement
                    wearing a confidence it hasn't earned — the design doc's
                    own words for it.
                  */}
                  {t.noAnalystCoverage && (
                    <div className="mt-0.5 text-[10px] text-muted">
                      no analyst coverage — ranked on the tape and your record
                      alone
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {/*
            The 50-cap and the parser both exist to keep a candidate from
            being silently dropped. Saying so here is what makes that
            guarantee visible rather than theoretical.
          */}
          {ranking.missing.length > 0 && (
            <p className="text-[11px] text-muted">
              Not ranked: {ranking.missing.join(', ')} — the model didn't
              return {ranking.missing.length === 1 ? 'an answer' : 'answers'}{' '}
              for {ranking.missing.length === 1 ? 'it' : 'them'}.
            </p>
          )}

          <CollapsibleCard
            label="ranking"
            // Unlike the AI summary or a trade idea, nobody just clicked a
            // button to ask for THIS specific answer — it is fetched the
            // moment the tab opens and may be a day old. Opening it by
            // default would put several paragraphs of prose on screen
            // before he asked to read them; here collapsed is the resting
            // state, and the always-visible header line is what he glances
            // at first.
            defaultOpen={false}
            header={
              <>
                <span
                  className={
                    ranking.stale
                      ? 'rounded bg-down/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-down'
                      : 'rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent'
                  }
                >
                  {ranking.stale ? 'stale' : 'ranking'}
                </span>
                <span className="text-[10px] text-muted">
                  {formatAge(ranking.rankedAt)}
                </span>
              </>
            }
            actions={
              ranking.configured && (
                <Button
                  variant="secondary"
                  disabled={refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  {refreshMutation.isPending ? 'Ranking…' : 'Refresh'}
                </Button>
              )
            }
          >
            {ranking.reasoning ? (
              <Markdown text={ranking.reasoning} />
            ) : (
              <p className="text-xs text-muted">No reasoning recorded.</p>
            )}
          </CollapsibleCard>
        </>
      )}
    </section>
  );
}
