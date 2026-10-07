import type { MarketSession } from './market-session.js';
import { ENTRY_REASONS } from '../journal/reasons.js';

/**
 * The holdings that moved enough to matter today, measured in ATR so a
 * volatile name's ordinary day does not crowd out a quiet name's real move.
 * Takes the portfolio's own day-change figures (already session-aware: a
 * pre-market move is measured from the last close) rather than re-deriving
 * them, so the Brief can never disagree with the Portfolio screen.
 */

export interface MoverInput {
  symbol: string;
  dayChange: number | null;
  dayChangePct: number | null;
  dayPnl: number | null;
  extended: boolean;
  stale: boolean;
  session: MarketSession | null;
}

export interface MoverRow {
  symbol: string;
  changePct: number;
  atrMultiple: number;
  dollarChange: number | null;
  extended: boolean;
  stale: boolean;
  session: MarketSession | null;
  reasons: { code: string; label: string }[];
  headline: { title: string; source: string; url: string; at: string } | null;
  /** The AI's one-line thesis check — slice 4; null until then. */
  thesis: string | null;
}

export const MOVER_LIMIT = 5;
const MIN_ATR_MULTIPLE = 1;
const LABEL_BY_CODE = new Map(ENTRY_REASONS.map((r) => [r.code, r.label]));

export function rankMovers(
  positions: MoverInput[],
  atrBySymbol: ReadonlyMap<string, number>,
  reasonsBySymbol: ReadonlyMap<string, string[]>,
): MoverRow[] {
  const rows: MoverRow[] = [];
  for (const p of positions) {
    const atr = atrBySymbol.get(p.symbol);
    if (atr === undefined || !(atr > 0) || p.dayChange === null || p.dayChangePct === null) continue;
    const atrMultiple = Math.abs(p.dayChange) / atr;
    if (atrMultiple < MIN_ATR_MULTIPLE) continue;
    rows.push({
      symbol: p.symbol,
      changePct: p.dayChangePct,
      atrMultiple,
      dollarChange: p.dayPnl,
      extended: p.extended,
      stale: p.stale,
      session: p.session,
      reasons: (reasonsBySymbol.get(p.symbol) ?? []).flatMap((code) => {
        const label = LABEL_BY_CODE.get(code);
        return label ? [{ code, label }] : [];
      }),
      headline: null,
      thesis: null,
    });
  }
  return rows.sort((a, b) => b.atrMultiple - a.atrMultiple).slice(0, MOVER_LIMIT);
}
