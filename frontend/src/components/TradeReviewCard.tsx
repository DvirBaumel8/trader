import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { formatTimestamp } from './format';
import { Markdown } from './Markdown';
import { CollapsibleCard } from './ui/CollapsibleCard';

interface TradeReviewFacts {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  status: 'CLOSED' | 'OPEN';
  enteredAt: string;
  exitedAt: string | null;
  holdingDays: number | null;
  quantity: number;
  remainingQuantity: number;
  avgEntry: number;
  avgExit: number | null;
  realizedPnl: number | null;
  realizedPnlPercent: number | null;
  rMultiple: number | null;
  initialRiskPerShare: number | null;
  initialRiskPercent: number | null;
  plannedTarget: number | null;
  entryRelativeVolume: number | null;
  highWaterPrice: number | null;
  mfeGainPercent: number | null;
  hadInitialStop: boolean;
  initialStopPrice: number | null;
  stopTrailedFavorable: boolean;
  stopWidenedOrMovedAgainst: boolean;
  stopSlippageTotal: number | null;
  stopSlippagePerShare: number | null;
  exitKinds: {
    stopShares: number;
    targetShares: number;
    discretionaryShares: number;
  };
  setups: string[];
  mistakes: string[];
  notes: string[];
}

interface TradeReviewResponse {
  configured: boolean;
  tradeId: string;
  symbol: string;
  score: string | null;
  verdict: string | null;
  review: string | null;
  facts: TradeReviewFacts | null;
  createdAt: string | null;
  error: string | null;
  errorKind: string | null;
}

function scoreStyle(score: string | null): { badge: string; text: string } {
  switch (score?.toUpperCase()) {
    case 'A':
      return {
        badge: 'bg-up/15 text-up border border-up/30',
        text: 'Grade A · Pristine Execution',
      };
    case 'B':
      return {
        badge: 'bg-accent/15 text-accent border border-accent/30',
        text: 'Grade B · Solid Discipline',
      };
    case 'C':
      return {
        badge: 'bg-amber-500/15 text-amber-500 border border-amber-500/30',
        text: 'Grade C · Mixed Adherence',
      };
    case 'D':
      return {
        badge: 'bg-down/15 text-down border border-down/30',
        text: 'Grade D · Rule Breach',
      };
    case 'F':
      return {
        badge: 'bg-down/20 text-down border border-down/40 font-bold',
        text: 'Grade F · Discipline Breakdown',
      };
    default:
      return {
        badge: 'bg-surface-2 text-muted border border-border',
        text: 'Reviewed',
      };
  }
}

export function TradeReviewCard({ tradeId }: { tradeId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['trade-review', tradeId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api<TradeReviewResponse | null>(`/ai/trade-reviews/${encodeURIComponent(tradeId)}`),
    retry: false,
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      api<TradeReviewResponse>(`/ai/trade-reviews/${encodeURIComponent(tradeId)}`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-1 p-4">
        <p className="text-xs text-muted">Checking review status…</p>
      </div>
    );
  }

  const reviewData = reviewMutation.data ?? data;
  const isGenerating = reviewMutation.isPending;

  // Unconfigured LLM message
  if (reviewData && !reviewData.configured) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-1 p-4 space-y-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium">
            AI Discipline Review
          </span>
        </div>
        <p className="text-xs text-muted">
          AI features are not configured yet. Add your Gemini API key in settings to enable automated post-mortems.
        </p>
      </div>
    );
  }

  // Error during generation
  if (reviewMutation.isError || (reviewData && reviewData.error)) {
    const errorMsg =
      reviewData?.error ??
      (reviewMutation.error instanceof ApiError
        ? reviewMutation.error.message
        : "Couldn't generate review just now.");

    return (
      <div className="rounded-xl border border-dashed border-down/30 bg-surface-1 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-medium text-down uppercase tracking-wide">
            Review Failed
          </span>
          <button
            type="button"
            onClick={() => reviewMutation.mutate()}
            disabled={isGenerating}
            className="text-xs text-accent underline hover:opacity-80"
          >
            Try Again
          </button>
        </div>
        <p className="text-xs text-muted">{errorMsg}</p>
      </div>
    );
  }

  // No review yet: Prompt user to run review
  if (!reviewData || !reviewData.review) {
    return (
      <div className="rounded-xl border border-dashed border-accent/40 bg-surface-1 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-accent">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium">
              AI Discipline Review
            </span>
            <span className="text-muted normal-case">Post-Mortem & Adherence</span>
          </div>
        </div>

        <p className="text-xs text-muted">
          Evaluate stop placement, execution slippage, risk boundaries, and trading process adherence against your profile rules.
        </p>

        <div>
          <button
            type="button"
            onClick={() => reviewMutation.mutate()}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Analyzing execution & discipline…
              </>
            ) : (
              'Run AI Discipline Review'
            )}
          </button>
        </div>
      </div>
    );
  }

  const { score, verdict, review, facts, createdAt } = reviewData;
  const grade = scoreStyle(score);

  return (
    <CollapsibleCard
      label="review"
      header={
        <>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${grade.badge}`}>
            {grade.text}
          </span>
          {createdAt && (
            <span className="text-[11px] text-muted">
              {formatTimestamp(createdAt)}
            </span>
          )}
        </>
      }
      actions={
        <button
          type="button"
          onClick={() => reviewMutation.mutate()}
          disabled={isGenerating}
          className="text-[11px] text-accent hover:underline disabled:opacity-50"
        >
          {isGenerating ? 'Re-evaluating…' : 'Re-evaluate'}
        </button>
      }
    >
      <div className="space-y-3">
      {/* Headline Verdict */}
      {verdict && (
        <div className="text-sm font-semibold text-text">
          {verdict}
        </div>
      )}

      {/* Verified Execution Metrics Strip */}
      {facts && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg bg-surface-2/60 p-2.5 text-xs">
          <div>
            <div className="text-[10px] text-muted uppercase">Initial Stop</div>
            <div className="font-medium text-text">
              {facts.hadInitialStop && facts.initialStopPrice !== null
                ? `$${facts.initialStopPrice.toFixed(2)}${
                    facts.initialRiskPercent !== null
                      ? ` (-${facts.initialRiskPercent.toFixed(1)}%)`
                      : ''
                  }`
                : 'None recorded'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-muted uppercase">Stop Management</div>
            <div className={`font-medium ${facts.stopWidenedOrMovedAgainst ? 'text-down font-semibold' : 'text-text'}`}>
              {facts.stopWidenedOrMovedAgainst
                ? 'Widened / Loosened ⚠️'
                : facts.stopTrailedFavorable
                  ? 'Trailed Favorable ✓'
                  : 'Maintained'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-muted uppercase">Stop Slippage</div>
            <div className={`font-medium ${facts.stopSlippagePerShare && facts.stopSlippagePerShare < -0.01 ? 'text-down' : 'text-text'}`}>
              {facts.stopSlippagePerShare !== null
                ? `${facts.stopSlippagePerShare >= 0 ? '+' : ''}$${facts.stopSlippagePerShare.toFixed(2)} / sh`
                : 'No stop exit'}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-muted uppercase">Peak Excursion (MFE)</div>
            <div className="font-medium text-text">
              {facts.mfeGainPercent !== null
                ? `${facts.mfeGainPercent >= 0 ? '+' : ''}${facts.mfeGainPercent.toFixed(1)}%`
                : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Post-Mortem Markdown Content */}
      <div className="border-t border-border/50 pt-3 space-y-3">
        <Markdown text={review} />
      </div>
      </div>
    </CollapsibleCard>
  );
}
