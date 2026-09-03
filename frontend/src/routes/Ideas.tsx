import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { formatMoney, formatPercent, formatQuantity, formatTimestamp } from '../components/format';
import { Markdown } from '../components/Markdown';
import { SessionBadge } from '../components/SessionBadge';

/** Mirrors `LlmFailureKind` in `backend/src/llm/llm.client.ts`. */
type ErrorKind = 'busy' | 'quota_exceeded' | 'setup_problem' | 'unknown';

interface IndicatorSet {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  percentFromSma20: number | null;
  percentFromSma50: number | null;
  percentFromSma200: number | null;
  high52w: number | null;
  low52w: number | null;
  percentFromHigh52w: number | null;
  percentFromLow52w: number | null;
  atr14: number | null;
  atrPercentOfPrice: number | null;
  relativeVolume: number | null;
  barsAvailable: number;
}

interface TickerFacts {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
  session: string | null;
  extended: boolean;
  peRatio: number | null;
  indicators: IndicatorSet;
}

interface TradeRisk {
  direction: 'LONG' | 'SHORT';
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number | null;
  sharesAtUsualRisk: number | null;
  positionValueAtUsualRisk: number | null;
  usualRisk: number | null;
}

interface TradeIdeaResult {
  configured: boolean;
  symbol: string;
  facts: TickerFacts | null;
  opinion: string | null;
  levels: { stop: number; target: number } | null;
  risk: TradeRisk | null;
  levelsUnreadable: boolean;
  error: string | null;
  errorKind: ErrorKind | null;
}

interface TradeIdeaListRow {
  id: string;
  createdAt: string;
  symbol: string;
  entryPrice: number;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  preview: string;
}

interface TradeIdeaDetail {
  id: string;
  createdAt: string;
  symbol: string;
  entryPrice: number;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  opinion: string;
  factsSnapshot: string;
  priceStale: boolean;
  model: string;
}

const HISTORY_QUERY_KEY = ['trade-ideas'];

/** A labelled figure. The label is small and quiet; the number is the thing. */
function Figure({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-sm tabular-nums ${className}`}>{value}</div>
    </div>
  );
}

/**
 * The two levels the MODEL proposed, and everything the APP derived from them.
 * Kept visually together because that is the division of labour the whole
 * feature rests on — and rendered only when there is a complete set. A risk
 * section with gaps in it invites reading a blank as a zero.
 */
function RiskPanel({
  levels,
  risk,
}: {
  levels: { stop: number; target: number };
  risk: TradeRisk;
}) {
  return (
    <div className="space-y-2.5 rounded-lg bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            risk.direction === 'LONG' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
          }`}
        >
          {risk.direction}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          levels proposed by the model
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Figure label="Stop" value={formatMoney(levels.stop)} className="text-down" />
        <Figure label="Target" value={formatMoney(levels.target)} className="text-up" />
        <Figure
          label="Risk / reward"
          value={risk.riskReward === null ? '—' : `${risk.riskReward.toFixed(2)}R`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Figure label="Risk per share" value={formatMoney(risk.riskPerShare)} />
        <Figure label="Reward per share" value={formatMoney(risk.rewardPerShare)} />
      </div>

      {/*
        Only shown once there is an average risk to size against — before
        enough closed trades exist, there is no "usual" and inventing one
        would be exactly the kind of plausible-but-wrong number this app
        refuses to print.
      */}
      {risk.sharesAtUsualRisk !== null &&
        risk.positionValueAtUsualRisk !== null &&
        risk.usualRisk !== null && (
        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted">
          To risk your usual{' '}
          <span className="text-text">{formatMoney(risk.usualRisk)}</span>
          , this stop implies{' '}
          <span className="text-text">{formatQuantity(risk.sharesAtUsualRisk)} shares</span> —{' '}
          <span className="text-text">{formatMoney(risk.positionValueAtUsualRisk)}</span>.
        </p>
      )}
    </div>
  );
}

/** The numbers the opinion rests on. Collapsed: context, not the headline. */
function FactsPanel({ facts }: { facts: TickerFacts }) {
  const i = facts.indicators;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium text-accent">
        The facts this rests on
      </summary>
      <div className="mt-2 space-y-2.5 rounded-lg bg-surface-2 p-3">
        <div className="grid grid-cols-3 gap-2">
          <Figure label="Price" value={formatMoney(facts.price)} />
          <Figure label="P/E" value={facts.peRatio === null ? '—' : facts.peRatio.toFixed(1)} />
          <Figure
            label="ATR (14)"
            value={i.atrPercentOfPrice === null ? '—' : formatPercent(i.atrPercentOfPrice).replace('+', '')}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Figure label="vs 20-day" value={formatPercent(i.percentFromSma20)} />
          <Figure label="vs 50-day" value={formatPercent(i.percentFromSma50)} />
          <Figure label="vs 200-day" value={formatPercent(i.percentFromSma200)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Figure label="From 52w high" value={formatPercent(i.percentFromHigh52w)} />
          <Figure label="From 52w low" value={formatPercent(i.percentFromLow52w)} />
          <Figure
            label="Rel. volume"
            value={i.relativeVolume === null ? '—' : `${i.relativeVolume.toFixed(2)}x`}
          />
        </div>
        {/*
          Said plainly rather than hidden: an indicator computed from three
          months of bars is not the same claim as one from a year, and the
          reader is entitled to know which they are looking at.
        */}
        {i.barsAvailable < 200 && (
          <p className="border-t border-border pt-2 text-[11px] text-muted">
            Computed from {i.barsAvailable} daily bars — thin history, so the longer
            averages may be missing.
          </p>
        )}
      </div>
    </details>
  );
}

function ResultCard({ result }: { result: TradeIdeaResult }) {
  if (!result.configured) {
    return (
      <p className="text-xs text-muted">
        Trade ideas aren't set up yet. Ask the developer to add an LLM API key.
      </p>
    );
  }

  if (result.error || !result.opinion || !result.facts) {
    return (
      <p className="text-xs text-muted">
        {result.error ?? "Couldn't get an opinion just now. Try again in a bit."}
      </p>
    );
  }

  const { facts } = result;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-accent/40 bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-accent">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium">AI generated</span>
        <span className="text-sm font-semibold normal-case tracking-normal text-text">
          {facts.symbol}
        </span>
        <span className="tabular-nums text-sm normal-case tracking-normal text-text">
          {formatMoney(facts.price)}
        </span>
        <SessionBadge session={facts.session} extended={facts.extended} />
        {/* Never show a stale price as if it were fresh. */}
        {facts.stale && (
          <span className="rounded bg-down/15 px-1.5 py-0.5 font-medium text-down">stale</span>
        )}
      </div>

      <Markdown text={result.opinion} />

      {result.levels && result.risk ? (
        <RiskPanel levels={result.levels} risk={result.risk} />
      ) : (
        <p className="rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          {result.levelsUnreadable
            ? "The model didn't give a stop and target in a form this app could read, so no risk figures are shown."
            : 'No stop and target were proposed, so there are no risk figures to show.'}
        </p>
      )}

      <FactsPanel facts={facts} />
    </div>
  );
}

/** One saved idea, expanded: the prose again, plus the prompt it was given. */
function HistoryDetail({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: [...HISTORY_QUERY_KEY, id],
    queryFn: () => api<TradeIdeaDetail>(`/ai/trade-ideas/${id}`),
  });

  if (isLoading) return <p className="px-3 pb-3 text-xs text-muted">Loading…</p>;
  if (isError || !data) {
    return <p className="px-3 pb-3 text-xs text-muted">Couldn't load this idea.</p>;
  }

  return (
    <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
      <Markdown text={data.opinion} />

      {/*
        The stored figures, shown as they were stored. Risk per share and the
        position size are NOT re-derived here: that arithmetic belongs to the
        backend, and a second implementation of it in the UI is exactly how
        two subtly different answers to the same question start appearing.
      */}
      {data.stop !== null && data.target !== null ? (
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-surface-2 p-3">
          <Figure label="Entry" value={formatMoney(data.entryPrice)} />
          <Figure label="Stop" value={formatMoney(data.stop)} className="text-down" />
          <Figure label="Target" value={formatMoney(data.target)} className="text-up" />
          <Figure
            label="R / R"
            value={data.riskReward === null ? '—' : `${data.riskReward.toFixed(2)}R`}
          />
        </div>
      ) : (
        <p className="rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
          The model's levels couldn't be read for this one, so no numbers were saved
          with it.
        </p>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer select-none font-medium text-accent">
          Facts snapshot
        </summary>
        <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 text-[11px] leading-relaxed text-muted">
          {data.factsSnapshot}
        </pre>
      </details>
    </div>
  );
}

interface HistoryRowProps {
  row: TradeIdeaListRow;
  isOpen: boolean;
  onToggle: () => void;
  pendingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  isDeleting: boolean;
}

/**
 * Delete is two taps, never one — a phone screen is exactly where a stray tap
 * on a destructive action happens, and this record can't be recovered.
 */
function HistoryRow({
  row,
  isOpen,
  onToggle,
  pendingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  isDeleting,
}: HistoryRowProps) {
  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">{row.symbol}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted">
              {formatTimestamp(row.createdAt)}
            </span>
            {row.riskReward !== null && (
              <span className="text-[10px] tabular-nums text-muted">
                {row.riskReward.toFixed(2)}R
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted">{row.preview}</span>
        </span>
        <span className="mt-1 shrink-0 text-[10px] text-muted">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && <HistoryDetail id={row.id} />}

      <div className="border-t border-border px-3 py-2">
        {pendingDelete ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Delete this idea?</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                className="rounded px-2 py-1 text-xs font-medium text-muted active:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isDeleting}
                className="rounded bg-down/10 px-2 py-1 text-xs font-medium text-down active:bg-down/20 disabled:opacity-60"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRequestDelete}
            className="text-xs font-medium text-down active:opacity-70"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Ask what the app and a model make of buying a ticker right now, before the
 * trade — the one screen where the model's judgement is the point, and every
 * number under it is still the app's arithmetic.
 */
export function Ideas() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (ticker: string) =>
      api<TradeIdeaResult>('/ai/trade-idea', {
        method: 'POST',
        body: JSON.stringify({ symbol: ticker }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
    },
  });

  const historyQuery = useQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: () => api<TradeIdeaListRow[]>('/ai/trade-ideas'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/ai/trade-ideas/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
      setPendingDeleteId(null);
      setOpenId((current) => (current === id ? null : current));
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ticker = symbol.trim().toUpperCase();
    if (!ticker || mutation.isPending) return;
    mutation.mutate(ticker);
  }

  /**
   * An unknown ticker and a provider outage are different problems with
   * different responses — one is a typo, the other is "try later" — so they
   * get different words rather than a shared "something went wrong".
   */
  function errorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return `No ticker called "${symbol.trim().toUpperCase()}". Check the symbol.`;
      }
      if (error.status === 503) {
        return "Couldn't reach market data just now. Try again in a bit.";
      }
      if (error.status === 400) return 'That doesn’t look like a ticker symbol.';
    }
    return 'Something went wrong getting an opinion. Try again in a bit.';
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Ticker, e.g. NVDA"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm uppercase text-text placeholder:normal-case placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !symbol.trim()}
          className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent active:bg-accent/20 disabled:opacity-60"
        >
          {mutation.isPending ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              Thinking…
            </span>
          ) : (
            'Ask'
          )}
        </button>
      </form>

      {mutation.isSuccess && <ResultCard result={mutation.data} />}
      {mutation.isError && <p className="text-xs text-down">{errorMessage(mutation.error)}</p>}

      <section className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-wide text-muted">Past ideas</h2>
        {historyQuery.isLoading && <p className="text-xs text-muted">Loading…</p>}
        {historyQuery.isError && <p className="text-xs text-muted">Couldn't load history.</p>}
        {historyQuery.data && historyQuery.data.length === 0 && (
          <p className="text-xs text-muted">
            No ideas yet. Type a ticker above to get an opinion before you trade.
          </p>
        )}
        {historyQuery.data && historyQuery.data.length > 0 && (
          <ul className="space-y-1.5">
            {historyQuery.data.map((row) => (
              <HistoryRow
                key={row.id}
                row={row}
                isOpen={openId === row.id}
                onToggle={() => setOpenId((current) => (current === row.id ? null : row.id))}
                pendingDelete={pendingDeleteId === row.id}
                onRequestDelete={() => setPendingDeleteId(row.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onConfirmDelete={() => deleteMutation.mutate(row.id)}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === row.id}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
