import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { CollapsibleCard } from './ui/CollapsibleCard';
import { Markdown } from './Markdown';
import { isSameLocalDay } from '../lib/dayHeading';

const RANKING_KEY = ['watchlist', 'ranking'];

interface RankedTicker {
  symbol: string;
  verdict: string;
  coverage: 'full' | 'no-analyst-coverage' | 'unavailable';
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
 * The order and each verdict are never hidden one row at a time — no per-row
 * toggles — but with a real watchlist (up to 50 tickers) the whole section
 * can be minimized down to its header, so it doesn't push the rest of the
 * Watch tab out of reach. The section's own toggle sits beside its "Ranked"
 * heading, separate from `CollapsibleCard` below (the app's one way of
 * showing long generated prose), which only ever hides the reasoning.
 */
export function WatchlistRanking({ hasTickers }: { hasTickers: boolean }) {
  const queryClient = useQueryClient();
  // Collapsed is the resting state (see the CollapsibleCard usage below for
  // why), but the reasoning IS what was just asked for the instant a refresh
  // the owner triggered comes back — so this is lifted out of
  // CollapsibleCard's own internal state and driven here, where the
  // refresh mutation can flip it open.
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(true);

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

  /**
   * Opening the reasoning card is for a refresh the owner asked for — it IS
   * the answer to the question they just pressed a button to ask. The
   * automatic same-day refresh below shares this same mutation but must NOT
   * pop it open: nobody asked anything by merely opening the page.
   */
  const requestRefresh = () =>
    refreshMutation.mutate(undefined, { onSuccess: () => setReasoningOpen(true) });

  const ranking = rankingQuery.data;

  // Walking in this morning to yesterday's ranking is the same as not having
  // one — auto-refresh once per mount rather than making the owner remember
  // to hit Refresh, but only once: a successful refresh's own response sets
  // `rankedAt` to now, so without this guard the effect would just fire
  // again on the next render.
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (autoRefreshed.current) return;
    if (!ranking || !ranking.configured || ranking.rankedAt === null) return;
    if (isSameLocalDay(new Date(ranking.rankedAt), new Date())) return;
    autoRefreshed.current = true;
    refreshMutation.mutate();
    // refreshMutation is stable across renders (from useMutation); including
    // it would refire this on every mutate state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking]);

  if (!hasTickers) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] uppercase tracking-wide text-muted">
          Ranked
        </h2>
        <button
          type="button"
          onClick={() => setSectionOpen((v) => !v)}
          aria-expanded={sectionOpen}
          aria-label={`${sectionOpen ? 'Hide' : 'Show'} ranked watchlist`}
          className="text-[11px] font-medium text-muted hover:text-text"
        >
          {sectionOpen ? 'Hide ▲' : 'Show ▼'}
        </button>
      </div>

      {sectionOpen && (
        <>
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
                  : "Watchlist ranking isn't set up — set GEMINI_API_KEY (or LLM_API_KEY) in the backend's environment to enable it."}
              </p>
              {ranking.configured && (
                <Button
                  variant="secondary"
                  disabled={refreshMutation.isPending}
                  onClick={requestRefresh}
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
              {/*
                The age (and stale/fresh badge) at the SECTION HEAD, in the same
                glance as the list it describes — not fifty rows down, and not
                waiting behind the reasoning card's own toggle. This is the one
                place either appears; the card below does not repeat them.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    ranking.stale
                      ? 'rounded bg-down/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-down'
                      : 'rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent'
                  }
                >
                  {ranking.stale ? 'stale' : 'fresh'}
                </span>
                <span className="text-[10px] text-muted">
                  {formatAge(ranking.rankedAt)}
                </span>
                {ranking.configured && (
                  <Button
                    variant="secondary"
                    className="ml-auto"
                    disabled={refreshMutation.isPending}
                    onClick={requestRefresh}
                  >
                    {refreshMutation.isPending ? 'Ranking…' : 'Refresh'}
                  </Button>
                )}
              </div>

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
                      {t.coverage === 'no-analyst-coverage' && (
                        <div className="mt-0.5 text-[10px] text-muted">
                          no analyst coverage — ranked on the tape and your record
                          alone
                        </div>
                      )}
                      {/*
                        Distinct from "no coverage": that is a fact about the
                        ticker, this is a fact about the provider call. Collapsing
                        them used to make a Yahoo outage read on screen as if
                        nobody covered the name.
                      */}
                      {t.coverage === 'unavailable' && (
                        <div className="mt-0.5 text-[10px] text-muted">
                          analyst view unavailable right now — ranked on the tape
                          and your record alone
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
                // Controlled rather than the uncontrolled default: unlike the AI
                // summary or a trade idea, nobody just clicked a button to ask
                // for THIS specific answer on a normal page load — it's fetched
                // automatically and may be a day old, so collapsed is the
                // resting state. But the moment "Refresh" above resolves, the
                // reasoning WAS just asked for — the case CollapsibleCard's
                // default-open behaviour exists to serve — so `reasoningOpen` is
                // driven open from the mutation's `onSuccess` rather than left to
                // this card's own internal state.
                open={reasoningOpen}
                onOpenChange={setReasoningOpen}
                header={
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    Reasoning
                  </span>
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
        </>
      )}
    </section>
  );
}
