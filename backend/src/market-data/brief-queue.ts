import type { RawBar } from './yahoo.client.js';
import { isUsMarketHoliday, type MarketSession } from './market-session.js';
import { marketDate } from './trading-day.js';
import { sma } from './daily-brief.js';

/**
 * The Brief's decision queue: what needs a decision today, most urgent
 * first. Pure — every input is something the app already computed
 * (stop-distance rows, the no-stop list, ATR, earnings dates, entry
 * reasons) — so the rules are fixture-tested and nothing here can disagree
 * with the Stops page about a stop. Missing data means no item, never a
 * guessed one.
 */

export type QueueKind = 'STOP_CROSSED' | 'NEAR_STOP' | 'NO_STOP' | 'PARTIAL_STOP' | 'EARNINGS' | 'THESIS_BROKEN';

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
  /** True when the price is an extended-hours print rather than the regular close. */
  extended: boolean;
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
  /** Stop-plan problems from the portfolio's at-risk summary (`stopPlanNeedsUpdate.positions`). */
  stopPlanIssues: ReadonlyArray<{ symbol: string; issue: string }>;
  symbolsWithoutStop: readonly string[];
  /** Positions whose stop covers only some of the shares (`positionsWithPartialStop.positions`). */
  partialStops: ReadonlyArray<{ symbol: string; coveredQuantity: number; heldQuantity: number }>;
  atrBySymbol: ReadonlyMap<string, number>;
  earningsDateBySymbol: ReadonlyMap<string, string>;
  theses: QueueThesis[];
}

const PRIORITY: Record<QueueKind, number> = {
  STOP_CROSSED: 0,
  NEAR_STOP: 1,
  NO_STOP: 2,
  PARTIAL_STOP: 3,
  EARNINGS: 4,
  THESIS_BROKEN: 5,
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function percent(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(1)}%`;
}

function crossedDetail(t: QueueStopTier, session: MarketSession): string {
  if (session === 'REGULAR') return `Last ${money(t.currentPrice)}. If the stop has not filled, act on it now.`;
  // Stops do not fire outside regular hours; a gap past one on an
  // extended-hours print fills at the open, not at the stop.
  if (t.extended) return `Last ${money(t.currentPrice)} outside regular hours. The stop will not fire until the open.`;
  // The regular close itself is through the stop: it was crossed in-session.
  return `Closed ${money(t.currentPrice)} through the stop. If it has not filled, act on it at the open.`;
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
        detail: crossedDetail(t, input.session),
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
  const items = new Map<string, QueueItem>();
  for (const symbol of input.symbolsWithoutStop) {
    if (!held.has(symbol)) continue;
    items.set(symbol, {
      kind: 'NO_STOP',
      symbol,
      title: `${symbol} has no stop`,
      detail: 'Nothing limits the loss on this position.',
    });
  }
  const priced = new Set(input.stopTiers.map((t) => t.symbol));
  for (const { symbol, issue } of input.stopPlanIssues) {
    if (!held.has(symbol) || items.has(symbol)) continue;
    if (issue === 'DIRECTION_MISMATCH') {
      items.set(symbol, {
        kind: 'NO_STOP',
        symbol,
        title: `${symbol}'s stop does not fit this position`,
        detail: 'The stop on record was set for the other direction. Nothing valid limits the loss.',
      });
    } else if (issue === 'UNRESOLVED_TRAILING' && !priced.has(symbol)) {
      items.set(symbol, {
        kind: 'NO_STOP',
        symbol,
        title: `${symbol}'s trailing stop cannot be priced`,
        detail: 'There is no high-water price to trail from. Check the stop.',
      });
    }
  }
  return [...items.values()];
}

function quantity(q: number): string {
  return String(Number(q.toFixed(4)));
}

function partialStopItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>): QueueItem[] {
  const items: QueueItem[] = [];
  const seen = new Set<string>();
  for (const p of input.partialStops) {
    if (!held.has(p.symbol) || seen.has(p.symbol) || input.symbolsWithoutStop.includes(p.symbol)) continue;
    seen.add(p.symbol);
    items.push({
      kind: 'PARTIAL_STOP',
      symbol: p.symbol,
      title: `${p.symbol}'s stop covers ${quantity(p.coveredQuantity)} of ${quantity(p.heldQuantity)} shares`,
      detail: `${quantity(p.heldQuantity - p.coveredQuantity)} shares have nothing limiting the loss.`,
    });
  }
  return items;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** The first exchange session after `date` (YYYY-MM-DD), skipping weekends and full-closure holidays. */
export function nextTradingDate(date: string): string {
  let next = addDays(date, 1);
  while (isWeekend(next) || isUsMarketHoliday(next)) next = addDays(next, 1);
  return next;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function whenLabel(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function stopStatus(
  tiers: QueueStopTier[],
  noStop: boolean,
  planInvalid: boolean,
  partial?: { coveredQuantity: number; heldQuantity: number },
): string {
  const covers = partial
    ? ` Covers ${quantity(partial.coveredQuantity)} of ${quantity(partial.heldQuantity)} shares.`
    : '';
  if (noStop) return 'No stop.';
  if (planInvalid) return 'Stop plan needs updating.';
  if (tiers.length === 0) return 'Stop distance unknown.';
  if (tiers.some((t) => t.passed)) return `Stop already crossed.${covers}`;
  const nearest = tiers.reduce((a, b) => (b.distance < a.distance ? b : a));
  return `Nearest stop ${percent(nearest.distance)} away.${covers}`;
}

function earningsItems(input: QueueInput, held: ReadonlyMap<string, QueuePosition>, today: string): QueueItem[] {
  const next = nextTradingDate(today);
  const items: QueueItem[] = [];
  for (const symbol of held.keys()) {
    const date = input.earningsDateBySymbol.get(symbol);
    if (!date || date < today || date > next) continue;
    items.push({
      kind: 'EARNINGS',
      symbol,
      title: `${symbol} reports ${whenLabel(date, today)}`,
      detail: stopStatus(
        input.stopTiers.filter((t) => t.symbol === symbol),
        input.symbolsWithoutStop.includes(symbol),
        input.stopPlanIssues.some(
          (i) => i.symbol === symbol && (i.issue === 'DIRECTION_MISMATCH' || i.issue === 'UNRESOLVED_TRAILING'),
        ),
        input.partialStops.find((p) => p.symbol === symbol),
      ),
    });
  }
  return items;
}

const BREAKOUT_LOOKBACK = 20;
const SMA_PERIOD = 150;

/**
 * Bars that are a finished session. In PRE and REGULAR, a bar dated today
 * is Yahoo's partial bar for a session still in progress (or not begun),
 * and a thesis should not break on a print that may not hold to the close.
 */
function completedBars(bars: RawBar[], session: MarketSession, today: string): RawBar[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  return session === 'PRE' || session === 'REGULAR'
    ? sorted.filter((bar) => bar.date < today)
    : sorted;
}

function thesisItem(thesis: QueueThesis, session: MarketSession, today: string): QueueItem | null {
  const bars = completedBars(thesis.bars, session, today);
  const last = bars.at(-1);
  // No completed close since entry: judging the thesis on an earlier bar
  // would read a pre-entry price as a break.
  if (!last || last.date < thesis.entryDate) return null;
  const long = thesis.direction === 'LONG';
  const { symbol } = thesis;

  if (thesis.reasons.includes('ENTRY_SMA_150')) {
    const average = sma(bars.map((bar) => bar.close), SMA_PERIOD);
    if (average !== null && (long ? last.close < average : last.close > average)) {
      return {
        kind: 'THESIS_BROKEN',
        symbol,
        title: `${symbol} closed ${long ? 'below' : 'above'} its 150 SMA`,
        detail: `You entered on the 150 SMA. Close ${money(last.close)}, SMA ${money(average)}.`,
      };
    }
  }

  if (thesis.reasons.includes('ENTRY_BREAKOUT')) {
    const before = bars.filter((bar) => bar.date < thesis.entryDate).slice(-BREAKOUT_LOOKBACK);
    if (before.length === BREAKOUT_LOOKBACK) {
      // A missing high/low is not the close: no level, no item.
      const edges = before.map((bar) => (long ? bar.high : bar.low));
      if (edges.some((edge) => edge === null || edge === undefined)) return null;
      const level = long ? Math.max(...(edges as number[])) : Math.min(...(edges as number[]));
      if (long ? last.close < level : last.close > level) {
        return {
          kind: 'THESIS_BROKEN',
          symbol,
          title: long
            ? `${symbol} closed back under its breakout level`
            : `${symbol} closed back above its breakdown level`,
          detail: long
            ? `You entered on a breakout over ${money(level)}. Last close ${money(last.close)}.`
            : `You entered on a breakdown under ${money(level)}. Last close ${money(last.close)}.`,
        };
      }
    }
  }
  return null;
}

export function buildQueue(input: QueueInput): QueueItem[] {
  const held = new Map(input.positions.map((p) => [p.symbol, p]));
  const today = marketDate(input.now);
  const items = [
    ...stopItems(input, held),
    ...noStopItems(input, held),
    ...partialStopItems(input, held),
    ...earningsItems(input, held, today),
    ...input.theses
      .filter((t) => held.has(t.symbol))
      .map((t) => thesisItem(t, input.session, today))
      .filter((item): item is QueueItem => item !== null),
  ];

  for (const item of items) {
    if (held.get(item.symbol)?.stale) item.detail = `${item.detail} Quote is stale.`;
  }

  const size = (symbol: string) => Math.abs(held.get(symbol)?.marketValue ?? 0);
  return items.sort(
    (a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || size(b.symbol) - size(a.symbol),
  );
}
