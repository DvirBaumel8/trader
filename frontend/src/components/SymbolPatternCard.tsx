import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { formatTimestamp } from './format';
import { Markdown } from './Markdown';
import { CollapsibleCard } from './ui/CollapsibleCard';
import type { Range } from '../lib/benchmarkRange';

interface SymbolPatternResponse {
  configured: boolean;
  symbol: string;
  range: Range;
  headline: string | null;
  read: string | null;
  createdAt: string | null;
  error: string | null;
  errorKind: string | null;
}

/**
 * A retrospective AI read of how the owner actually trades ONE name,
 * compared to his own overall record over the same period — never a
 * buy/sell opinion, which is Trade Idea's job. Button-triggered like every
 * other AI feature in the app: this only shows what was last saved until he
 * asks for a fresh one, and re-fetches whenever the caller's `range`
 * changes since the content is scoped to it.
 */
export function SymbolPatternCard({ symbol, range }: { symbol: string; range: Range }) {
  const queryClient = useQueryClient();
  const queryKey = ['symbol-pattern', symbol, range];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api<SymbolPatternResponse | null>(
        `/ai/symbol-patterns/${encodeURIComponent(symbol)}?range=${range}`,
      ),
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api<SymbolPatternResponse>(
        `/ai/symbol-patterns/${encodeURIComponent(symbol)}?range=${range}`,
        { method: 'POST' },
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });

  // A failed mutation's `isError`/`error` otherwise survives a `range`
  // change indefinitely — the same staleness the comment below guards
  // against for `data`, just for the error path instead of the success one.
  // Without this, switching to a range that was never attempted could show
  // the previous range's failure message.
  const { reset: resetGenerate } = generateMutation;
  useEffect(() => {
    resetGenerate();
  }, [symbol, range, resetGenerate]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-1 p-4">
        <p className="text-xs text-muted">Checking for a pattern read…</p>
      </div>
    );
  }

  // Never `generateMutation.data ?? data`: unlike a trade review (mounted
  // once per fixed tradeId), this card stays mounted across a `range`
  // change, and a stale mutation result would otherwise keep showing the
  // PREVIOUS range's just-generated read instead of the new range's own
  // (possibly empty) one. `data` alone is correct because the mutation's
  // `onSuccess` already writes its result into the query cache under that
  // exact key.
  const readData = data;
  const isGenerating = generateMutation.isPending;

  if (readData && !readData.configured) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border bg-surface-1 p-4">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          AI Pattern Read
        </span>
        <p className="text-xs text-muted">
          AI features are not configured yet. Add your Gemini API key in
          settings to enable this.
        </p>
      </div>
    );
  }

  if (generateMutation.isError || (readData && readData.error)) {
    const errorMsg =
      readData?.error ??
      (generateMutation.error instanceof ApiError
        ? generateMutation.error.message
        : "Couldn't read your history just now.");

    return (
      <div className="space-y-3 rounded-xl border border-dashed border-down/30 bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <span className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-down">
            Read Failed
          </span>
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
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

  if (!readData || !readData.read) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-accent/40 bg-surface-1 p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-accent">
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium">
            AI Pattern Read
          </span>
          <span className="normal-case text-muted">
            How you actually trade this name
          </span>
        </div>

        <p className="text-xs text-muted">
          Compare how you trade {symbol} against your own overall record over
          the same period.
        </p>

        <div>
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Reading your history…
              </>
            ) : (
              'Read My Pattern'
            )}
          </button>
        </div>
      </div>
    );
  }

  const { headline, read, createdAt } = readData;

  return (
    <CollapsibleCard
      label="pattern read"
      header={
        <>
          <span className="truncate text-sm font-semibold text-text">
            {headline}
          </span>
          {createdAt && (
            <span className="shrink-0 text-[11px] text-muted">
              {formatTimestamp(createdAt)}
            </span>
          )}
        </>
      }
      actions={
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={isGenerating}
          className="text-[11px] text-accent hover:underline disabled:opacity-50"
        >
          {isGenerating ? 'Re-reading…' : 'Refresh'}
        </button>
      }
    >
      <Markdown text={read} />
    </CollapsibleCard>
  );
}
