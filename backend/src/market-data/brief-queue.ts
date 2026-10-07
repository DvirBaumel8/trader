import type { RawBar } from './yahoo.client.js';
import type { MarketSession } from './market-session.js';

/**
 * The Brief's decision queue: what needs a decision today, most urgent
 * first. Pure — every input is something the app already computed
 * (stop-distance rows, the no-stop list, ATR, earnings dates, entry
 * reasons) — so the rules are fixture-tested and nothing here can disagree
 * with the Stops page about a stop. Missing data means no item, never a
 * guessed one.
 */

export type QueueKind = 'STOP_CROSSED' | 'NEAR_STOP' | 'NO_STOP' | 'EARNINGS' | 'THESIS_BROKEN';

export interface QueueItem {
  kind: QueueKind;
  symbol: string;
  title: string;
  detail: string;
}

/** The fields of a `StopDistanceRow` (portfolio/stop-distance.ts) the queue reads. */
export interface QueueStopTier {
  symbol: string;
  stopPrice: number;
  currentPrice: number;
  /** Signed fraction of price: positive is room, negative is already passed. */
  distance: number;
  passed: boolean;
}

export interface QueuePosition {
  symbol: string;
  marketValue: number | null;
  stale: boolean;
}

export interface QueueThesis {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Entry reason codes from journal/reasons.ts, on the fill that opened the position. */
  reasons: string[];
  /** YYYY-MM-DD of the opening fill. */
  entryDate: string;
  bars: RawBar[];
}

export interface QueueInput {
  now: Date;
  session: MarketSession;
  positions: QueuePosition[];
  stopTiers: QueueStopTier[];
  symbolsWithoutStop: readonly string[];
  atrBySymbol: ReadonlyMap<string, number>;
  earningsDateBySymbol: ReadonlyMap<string, string>;
  theses: QueueThesis[];
}

const PRIORITY: Record<QueueKind, number> = {
  STOP_CROSSED: 0,
  NEAR_STOP: 1,
  NO_STOP: 2,
  EARNINGS: 3,
  THESIS_BROKEN: 4,
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percent(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(1)}%`;
}

function stopItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  const tiersBySymbol = new Map<string, QueueStopTier[]>();
  for (const t of input.stopTiers) {
    if (!held.has(t.symbol)) continue;
    tiersBySymbol.set(t.symbol, [...(tiersBySymbol.get(t.symbol) ?? []), t]);
  }

  const items: QueueItem[] = [];
  for (const [symbol, tiers] of tiersBySymbol) {
    const crossed = tiers.filter((t) => t.passed);
    if (crossed.length > 0) {
      // Of the crossed tiers, the one price is closest to: the level that
      // was hit most recently, which is the one he would check first.
      const t = crossed.reduce((a, b) => (b.distance > a.distance ? b : a));
      items.push({
        kind: 'STOP_CROSSED',
        symbol,
        title: `${symbol} is through its stop at ${money(t.stopPrice)}`,
        detail:
          input.session === 'REGULAR'
            ? `Last ${money(t.currentPrice)}. If the stop has not filled, act on it now.`
            // Stops do not fire outside regular hours; a gap past one
            // fills at the open, not at the stop.
            : `Last ${money(t.currentPrice)} outside regular hours. The stop will not fire until the open.`,
      });
      continue; // A crossed stop is not also "near".
    }

    const atr = input.atrBySymbol.get(symbol);
    if (atr === undefined || !(atr > 0)) continue;
    const nearest = tiers.reduce((a, b) => (b.distance < a.distance ? b : a));
    const room = nearest.distance * nearest.currentPrice;
    if (room <= atr) {
      items.push({
        kind: 'NEAR_STOP',
        symbol,
        title: `${symbol} is within 1 ATR of its stop`,
        detail: `Stop ${money(nearest.stopPrice)}, last ${money(nearest.currentPrice)}: ${(room / atr).toFixed(1)} ATR (${percent(nearest.distance)}) away.`,
      });
    }
  }
  return items;
}

function noStopItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  return input.symbolsWithoutStop
    .filter((symbol) => held.has(symbol))
    .map((symbol) => ({
      kind: 'NO_STOP' as const,
      symbol,
      title: `${symbol} has no stop`,
      detail: 'Nothing limits the loss on this position.',
    }));
}

export function buildQueue(input: QueueInput): QueueItem[] {
  const held = new Map(input.positions.map((p) => [p.symbol, p]));
  const items = [...stopItems(input, held), ...noStopItems(input, held)];

  for (const item of items) {
    if (held.get(item.symbol)?.stale) item.detail = `${item.detail} Quote is stale.`;
  }

  const size = (symbol: string) => Math.abs(held.get(symbol)?.marketValue ?? 0);
  return items.sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || size(b.symbol) - size(a.symbol),
  );
}
