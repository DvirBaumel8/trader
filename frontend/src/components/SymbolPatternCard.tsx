import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { streamNdjson } from '../api/streamNdjson';
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

/** One line of `POST /ai/symbol-patterns/:symbol/stream`'s newline-delimited
 * JSON — either a text delta (already past the `[PATTERN_META]` block the
 * backend strips before streaming), or the one final line carrying
 * everything else `SymbolPatternResponse` has. */
type PatternStreamLine =
  | { delta: string }
  | (Omit<SymbolPatternResponse, 'read'> & { done: true });

const UNREACHABLE_ERROR = "Couldn't reach the AI pattern read right now. Try again in a bit.";
const GENERATION_ERROR = 'Something went wrong reading your history. Try again in a bit.';

type PatternState =
  | { status: 'idle' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; result: SymbolPatternResponse }
  | { status: 'error'; message: string };

/**
 * A retrospective AI read of how the owner actually trades ONE name,
 * compared to his own overall record over the same period — never a
 * buy/sell opinion, which is Trade Idea's job. Button-triggered like every
 * other AI feature in the app: this only shows what was last saved until he
 * asks for a fresh one, and re-fetches whenever the caller's `range`
 * changes since the content is scoped to it.
 */
export function SymbolPatternCard({ symbol, range }: { symbol: string; range: Range }) {
  const queryKey = ['symbol-pattern', symbol, range];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api<SymbolPatternResponse | null>(
        `/ai/symbol-patterns/${encodeURIComponent(symbol)}?range=${range}`,
      ),
    retry: false,
  });

  const [patternState, setPatternState] = useState<PatternState>({ status: 'idle' });

  // This card stays mounted across a `range` change, so a just-generated
  // read (or a failed attempt) for the PREVIOUS range must not keep showing
  // once the range changes — the new range's own (possibly empty) state,
  // read fresh from `data`, is what belongs on screen.
  useEffect(() => {
    setPatternState({ status: 'idle' });
  }, [symbol, range]);

  async function generate() {
    setPatternState({ status: 'streaming', text: '' });
    let text = '';
    let receivedDone = false;

    try {
      await streamNdjson<PatternStreamLine>(
        `/ai/symbol-patterns/${encodeURIComponent(symbol)}/stream?range=${range}`,
        (line) => {
          if ('done' in line) {
            receivedDone = true;
            const { done: _done, ...result } = line;
            setPatternState({ status: 'done', result: { ...result, read: text } });
          } else {
            text += line.delta;
            setPatternState({ status: 'streaming', text });
          }
        },
      );
    } catch (err) {
      setPatternState({
        status: 'error',
        message: err instanceof ApiError ? UNREACHABLE_ERROR : GENERATION_ERROR,
      });
      return;
    }

    if (!receivedDone) {
      setPatternState({ status: 'error', message: GENERATION_ERROR });
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-1 p-4">
        <p className="text-xs text-muted">Checking for a pattern read…</p>
      </div>
    );
  }

  if (patternState.status === 'streaming' && patternState.text) {
    return (
      <div className="rounded-xl border border-dashed border-accent/40 bg-surface-1 p-3">
        <Markdown text={patternState.text} />
      </div>
    );
  }

  const readData = patternState.status === 'done' ? patternState.result : data;
  const isGenerating = patternState.status === 'streaming';

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

  if (patternState.status === 'error' || (readData && readData.error)) {
    const errorMsg =
      readData?.error ?? (patternState.status === 'error' ? patternState.message : GENERATION_ERROR);

    return (
      <div className="space-y-3 rounded-xl border border-dashed border-down/30 bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <span className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-down">
            Read Failed
          </span>
          <button
            type="button"
            onClick={() => void generate()}
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
            onClick={() => void generate()}
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
          onClick={() => void generate()}
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
