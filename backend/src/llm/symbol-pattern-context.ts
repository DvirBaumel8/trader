import type { Range } from '../common/date-range.js';
import type { RecordTrade } from './trade-idea-context.js';

/**
 * The subset of `TradeSummary` (`derive-trades.ts`) this feature compares —
 * structurally typed like `trade-idea-context.ts`'s own inputs, so both the
 * per-symbol figures (`getSymbolSummary`) and the all-symbol baseline
 * (`getStats`) satisfy it with no adapter.
 */
export interface SymbolStats {
  closedCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRisk: number | null;
  expectancyR: number | null;
  avgPositionSize: number | null;
  avgHoldingDays: number | null;
}

export interface SymbolPatternFacts {
  symbol: string;
  range: Range;
  thisName: SymbolStats & { totalPnl: number | null; feesPaid: number };
  /** His own record across every symbol, over the SAME window — the
   * baseline that makes "this name" a comparison rather than a number
   * read in isolation. */
  overall: SymbolStats;
  trades: RecordTrade[];
  notes: string[];
}

export interface BuildSymbolPatternFactsInput {
  symbol: string;
  range: Range;
  thisName: SymbolStats & { totalPnl: number | null; feesPaid: number };
  overall: SymbolStats;
  trades: RecordTrade[];
  notes: string[];
}

// Bounds how large the prompt can grow for a name traded very often — the
// most recent trades and notes are what a pattern read needs, not every one
// ever logged.
const MAX_TRADES = 30;
const MAX_NOTE_LENGTH = 240;

function tradeDate(t: RecordTrade): number {
  return new Date(t.exitedAt ?? t.enteredAt).getTime();
}

/**
 * Assembles the facts for one symbol's pattern read: the app's own numbers,
 * never recomputed here, plus the trimming a prompt needs — most recent
 * trades first, capped, and notes stripped of blanks and truncated so one
 * very long entry can't crowd out everything else.
 */
export function buildSymbolPatternFacts(
  input: BuildSymbolPatternFactsInput,
): SymbolPatternFacts {
  const trades = [...input.trades]
    .sort((a, b) => tradeDate(b) - tradeDate(a))
    .slice(0, MAX_TRADES);

  const notes = input.notes
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
    .map((n) => (n.length > MAX_NOTE_LENGTH ? `${n.slice(0, MAX_NOTE_LENGTH)}…` : n));

  return { ...input, trades, notes };
}
