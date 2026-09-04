import { compareFills, type DerivedTxn } from './derive.js';
import { computeRisk, type StopLevelInput } from './risk.js';

/**
 * One stop tier as recorded by a specific revision. `stopLevels` on a
 * `TradeTxn` carries every revision ever written for that transaction, not
 * just the live one — `selectEntryStops`/`selectCurrentStops` below are the
 * only code that should pick one revision out of that history.
 */
export interface StopRevisionInput extends StopLevelInput {
  /**
   * `stop_levels.id` — required, not a convenience: this is what lets a
   * recorded `StopExecution` name exactly which tier it fired, in
   * `computeEffectiveStops` below. A tier that somehow arrived without one
   * would silently fail that id match (see `selectCurrentStopsWithIds`) and
   * be reported as still fully intact — an overstated at-risk figure with no
   * error anywhere. `stop-level.entity.ts` generates a UUID for every row,
   * so this is never actually absent; required here keeps it that way
   * instead of leaving a silent-wrong-number trapdoor open.
   */
  id: string;
  /** 0 is the first revision ever recorded; increasing thereafter. */
  revisionSeq: number;
  /**
   * When this revision was recorded, ISO 8601. Null means "unknown" — true
   * only of revision 0 rows written before revisions were tracked. See
   * `selectEntryStops`.
   */
  createdAt: string | null;
}

/** A transaction carrying every stop revision recorded against it. */
export type TradeTxn = DerivedTxn & {
  stopLevels?: StopRevisionInput[];
  plannedTarget?: number | null;
  /**
   * The owner's confirmed attribution of this fill to the stop tier(s) it
   * executed, from `stop_executions` — carried through to the matching
   * `ReducingFill` so `computeEffectiveStops` can consume it directly. Only
   * meaningful on a reducing fill; an opening or adding fill's value here is
   * never read.
   */
  executions?: Array<{ stopLevelId: string; quantity: number }>;
  /** From `transactions.exitKind` — see `ReducingFill.exitKind`. */
  exitKind?: 'STOP' | 'DISCRETIONARY' | null;
  /** The journal entry this fill was written through — see `TradeFill.entryId`. */
  entryId?: string;
};

function stripRevisionMeta(l: StopRevisionInput): StopLevelInput {
  return {
    kind: l.kind,
    price: l.price,
    trailPercent: l.trailPercent,
    quantity: l.quantity,
  };
}

/**
 * The stop plan as it stood at entry — the earliest revision — which is what
 * defines risk and R. Returned empty (not the earliest revision's rows) when
 * that earliest revision's `createdAt` is unknown: an unknown-vintage
 * revision is the *final* trailed stop from before revisions were tracked,
 * mislabelled as revision 0 by the migration, and is NOT known to be what
 * the owner actually set at entry. Guessing risk from it would be worse than
 * reporting none — see stop-level.entity.ts.
 */
export function selectEntryStops(levels: StopRevisionInput[]): StopLevelInput[] {
  if (levels.length === 0) return [];
  const minSeq = Math.min(...levels.map((l) => l.revisionSeq));
  const earliest = levels.filter((l) => l.revisionSeq === minSeq);
  if (earliest.some((l) => l.createdAt === null)) return [];
  return earliest.map(stripRevisionMeta);
}

/**
 * The stop plan live right now — the latest revision — which is what the
 * At-risk box and the trade chart draw. Unlike `selectEntryStops`, an
 * unknown-vintage revision is still perfectly good here: it is genuinely the
 * most recent stop the owner recorded, just not provably the first one.
 */
export function selectCurrentStops(levels: StopRevisionInput[]): StopLevelInput[] {
  if (levels.length === 0) return [];
  const maxSeq = Math.max(...levels.map((l) => l.revisionSeq));
  return levels.filter((l) => l.revisionSeq === maxSeq).map(stripRevisionMeta);
}

/**
 * Like `selectCurrentStops`, but keeps each tier's `stop_levels.id` — needed
 * only internally, by `finish()` below, to pass tiers into
 * `computeEffectiveStops` that a recorded `StopExecution` can be matched
 * against by id. Not exported: `selectCurrentStops` stays the public,
 * id-free view every existing caller and test already relies on. The id is
 * stripped back off before `DerivedTrade.currentStops` is built, so it is
 * never observed outside `computeEffectiveStops`'s own matching.
 */
function selectCurrentStopsWithIds(
  levels: StopRevisionInput[],
): Array<StopLevelInput & { id: string }> {
  if (levels.length === 0) return [];
  const maxSeq = Math.max(...levels.map((l) => l.revisionSeq));
  return levels
    .filter((l) => l.revisionSeq === maxSeq)
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      price: l.price,
      trailPercent: l.trailPercent,
      quantity: l.quantity,
    }));
}

/** When the latest revision was recorded, or null if that revision predates revision tracking. */
function latestRevisionCreatedAt(levels: StopRevisionInput[]): Date | null {
  if (levels.length === 0) return null;
  const maxSeq = Math.max(...levels.map((l) => l.revisionSeq));
  const latest = levels.filter((l) => l.revisionSeq === maxSeq);
  if (latest.some((l) => l.createdAt === null)) return null;
  // Every row in one revision is written in the same batch (see
  // writeStopRevision), so any one of their timestamps is representative.
  return new Date(latest[0].createdAt as string);
}

/** A fill that reduces the position, relevant to `computeEffectiveStops`. */
export interface ReducingFill {
  executedAt: Date;
  price: number;
  /** Always positive. */
  quantity: number;
  /**
   * Stop tiers the owner confirmed this fill executed — from `stop_executions`.
   * When present (non-empty), this is authoritative and price matching is
   * never run for this fill: the owner named the tier himself, so a price
   * that happens to sit nearer a different tier is not a wrong guess to
   * correct, it is irrelevant.
   */
  executions?: Array<{ stopLevelId: string; quantity: number }>;
  /**
   * How this exit came about, from `transactions.exitKind`. `'DISCRETIONARY'`
   * means the owner exited by his own decision, not because a stop fired —
   * `computeEffectiveStops` attributes no tier to it, though the fill still
   * happened and the shares are still gone (that reduction in what is
   * actually held is enforced downstream, in `computeRisk`'s coverage cap).
   * Undefined/null means "not yet classified", which still falls back to
   * price matching — the guess this whole feature is narrowing, not
   * replacing.
   */
  exitKind?: 'STOP' | 'DISCRETIONARY' | null;
}

const EFFECTIVE_EPSILON = 1e-9;

/**
 * How far a fill's execution price sits from a tier's price — the signal
 * `computeEffectiveStops` uses to decide which tier a sale most plausibly
 * executed. A TRAILING tier has no single price to compare against (it
 * moves with the market — see risk.ts), so it has no distance and is only
 * matched once every priced (FIXED) tier is exhausted.
 */
function distanceFromFill(level: StopLevelInput, fillPrice: number): number | null {
  if (level.kind === 'FIXED' && level.price !== null) {
    return Math.abs(level.price - fillPrice);
  }
  return null;
}

/**
 * The tier a fill most plausibly executed, by price proximity — the same
 * signal `computeEffectiveStops` uses, extracted so the entry sheet can
 * offer it as a pre-selected default.
 *
 * This is a SUGGESTION and nothing more. It was wrong on a real trade
 * (MSTR: the only tier was a trailing stop the exit never reached, and a
 * matcher with one candidate will always pick it), which is exactly why the
 * owner confirms it before anything is stored.
 */
export function suggestTierForFill(
  tiers: Array<StopLevelInput & { id: string }>,
  fillPrice: number,
): string | null {
  let best: { id: string; gap: number } | null = null;
  for (const tier of tiers) {
    const gap = distanceFromFill(tier, fillPrice);
    if (gap === null) continue;
    if (best === null || gap < best.gap) best = { id: tier.id, gap };
  }
  return best?.id ?? null;
}

/**
 * The stop plan that actually still applies, right now — the latest
 * recorded revision, minus whatever a reducing fill (a SELL against a long,
 * a covering BUY against a short) has already consumed since that revision
 * was set. This is derivation, not mutation: `recordedTiers` is never
 * changed or thrown away, only read, the same way positions themselves are
 * derived from the immutable transaction log rather than stored — so a
 * wrong inference here is visible and correctable (recording a fresh
 * revision through the normal journal flow) rather than a silently
 * destroyed level.
 *
 * Matching rule: process reducing fills oldest first, and for each one,
 * consume from the tier whose price is CLOSEST to the fill's execution
 * price — scale traders exit at planned levels, so a fill at 36.92 against
 * a tier recorded at exactly 36.92 is not a coincidence. A fill can span
 * more than one tier (consume the closest fully, then the next-closest for
 * the remainder) and a tier can be partially consumed (reduced in place,
 * not retired) rather than retired outright. A fill that matches no tier
 * closely (a discretionary exit) still reduces total coverage by its
 * quantity, taken from the closest tier available — coverage can never
 * exceed what is actually held (see risk.ts's `evaluateStopPlan`), it just
 * cannot say which recorded level the owner "meant" to reduce. Once every
 * tier is exhausted, further reducing quantity has nothing left to consume
 * (there is nothing more this function can honestly report).
 *
 * Only fills at or after `recordedAt` (the latest revision's set-time) are
 * considered for PRICE MATCHING — an earlier reducing fill was already
 * reflected in whatever the owner set as that revision, so re-consuming it
 * here would double count. When `recordedAt` is unknown (a legacy,
 * pre-revision-tracking stop), `openedAt` is the fallback cutoff: everything
 * since the position opened is fair game, since tiers cannot consume a sale
 * that predates the position they protect. This cutoff applies ONLY to the
 * price-matched branch below — a recorded execution is authoritative
 * regardless of revision timing, because the owner named the tier himself,
 * not because its price happened to line up with a live revision.
 *
 * Every fill is processed oldest-first, and each one is handled by exactly
 * one of three branches, decided before any proximity logic runs:
 *
 * 1. `fill.executions` is non-empty — a confirmed `StopExecution` record.
 *    Consume each named tier by its recorded quantity directly, by id.
 *    Nothing here is a guess, so proximity is not consulted at all.
 * 2. `fill.exitKind === 'DISCRETIONARY'` — the owner's own decision, not a
 *    stop firing. Attribute nothing: coverage still reads as if the tier is
 *    intact, because it never triggered. (The shares are still gone; that is
 *    enforced separately, downstream, by `computeRisk`'s coverage cap against
 *    what is actually held — not here.)
 * 3. Anything else — an unclassified fill — falls back to the price-matching
 *    guess this function used exclusively before recorded executions existed.
 */
export function computeEffectiveStops(
  recordedTiers: Array<StopLevelInput & { id: string }>,
  recordedAt: Date | null,
  openedAt: Date,
  reducingFills: ReducingFill[],
): Array<StopLevelInput & { id: string }> {
  const cutoff = recordedAt ?? openedAt;
  const orderedFills = [...reducingFills].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
  );

  const remaining = recordedTiers.map((t) => ({ ...t }));

  for (const fill of orderedFills) {
    if (fill.executions !== undefined && fill.executions.length > 0) {
      for (const execution of fill.executions) {
        const tier = remaining.find((t) => t.id === execution.stopLevelId);
        // Deliberately silent, not a fallback to price matching: this is
        // reachable once a later revision replaces the tiers a
        // StopExecution was recorded against, so `stopLevelId` no longer
        // appears in `recordedTiers` here. Such an execution predates
        // `recordedAt` — it was already reflected in whatever the owner set
        // as that later revision — so re-consuming it (against any tier,
        // guessed or not) would double count exactly the case the
        // recordedAt/openedAt cutoff below exists to prevent.
        if (tier === undefined) continue;
        tier.quantity = Math.max(0, tier.quantity - execution.quantity);
      }
      continue;
    }

    if (fill.exitKind === 'DISCRETIONARY') {
      continue;
    }

    // Unclassified: the pre-existing price-matching guess, cutoff-gated.
    if (fill.executedAt.getTime() < cutoff.getTime()) continue;

    let toConsume = fill.quantity;
    while (toConsume > EFFECTIVE_EPSILON) {
      const candidates = remaining
        .map((t, index) => ({ t, index }))
        .filter(({ t }) => t.quantity > EFFECTIVE_EPSILON);
      if (candidates.length === 0) break; // Oversold past every tier.

      candidates.sort((a, b) => {
        const da = distanceFromFill(a.t, fill.price);
        const db = distanceFromFill(b.t, fill.price);
        if (da === null && db === null) return a.index - b.index;
        if (da === null) return 1;
        if (db === null) return -1;
        if (da !== db) return da - db;
        return a.index - b.index;
      });

      const target = candidates[0].t;
      const consumed = Math.min(target.quantity, toConsume);
      target.quantity -= consumed;
      toConsume -= consumed;
    }
  }

  return remaining.filter((t) => t.quantity > EFFECTIVE_EPSILON);
}

/** One transaction inside a trade, as executed. */
export interface TradeFill {
  executedAt: Date;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
  /**
   * The journal entry this fill was written through. Carried so a caller can
   * reach the entry's tags — the setups and mistakes the owner labelled the
   * trade with — without re-deriving which entries belong to which trade.
   * Optional because it is only needed by callers that want tags.
   */
  entryId?: string;
  /** Carried from `TradeTxn.executions` — see `ReducingFill.executions`. */
  executions?: Array<{ stopLevelId: string; quantity: number }>;
  /** Carried from `TradeTxn.exitKind` — see `ReducingFill.exitKind`. */
  exitKind?: 'STOP' | 'DISCRETIONARY' | null;
}

export interface DerivedTrade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Total size opened, in shares. */
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  enteredAt: Date;
  exitedAt: Date | null;
  holdingDays: number | null;
  feesPaid: number;
  /** Null while the trade is still open. Net of fees. */
  realizedPnl: number | null;
  isWin: boolean | null;
  isOpen: boolean;
  /**
   * Shares actually held right now, signed (negative short, 0 once flat) —
   * distinct from `quantity`, which is the total ever opened. This is what
   * a live coverage check (`evaluateStopPlan` in risk.ts) must compare
   * recorded stop tiers against, not the historical open size: a partial
   * exit or a flip through zero changes this without changing `quantity`.
   */
  remainingQuantity: number;
  /**
   * Dollars at risk from the stop tiers recorded AT ENTRY (the earliest
   * revision). Null when none were set, or when the earliest revision on
   * record is of unknown vintage — see `selectEntryStops`. This is the
   * figure R-multiple and expectancy are built from; it is deliberately
   * never computed from whatever stop happens to be live now.
   */
  riskAmount: number | null;
  /** False when the entry stop tiers covered only part of the position. */
  riskCoversFullPosition: boolean;
  /** Result in units of entry risk. Null without a known entry stop. */
  rMultiple: number | null;

  /**
   * Every transaction that composed this trade, in execution order. Emitted
   * here rather than reconstructed by the caller: the grouping walk already
   * has exactly these rows, and re-deriving them from a date range would be
   * ambiguous where one trade closes and another opens at the same instant.
   */
  fills: TradeFill[];

  /**
   * The stop plan that actually still applies RIGHT NOW — the latest
   * recorded revision, reconciled against reducing fills executed since
   * (see `computeEffectiveStops`), which is what the dashboard's At-risk
   * box, the Stops page and the trade chart all draw. NOT simply the latest
   * revision's raw rows: a SELL that executed one of the tiers does not
   * rewrite `stop_levels` (tiers attach to the opening fill and are never
   * reconciled in the database — see stop-level.entity.ts), so this is a
   * derived VIEW of what is still live, the same way positions are derived
   * rather than stored. Also NOT the plan as it stood at entry; see
   * `riskAmount`'s doc comment for that one.
   */
  currentStops: Array<StopLevelInput & { id: string }>;
}

const EPSILON = 1e-9;

interface OpenTrade {
  direction: 'LONG' | 'SHORT';
  position: number;
  openQty: number;
  openNotional: number;
  closeQty: number;
  closeNotional: number;
  fees: number;
  enteredAt: Date;
  /**
   * Every stop revision ever recorded on the opening fill. `finish()` splits
   * this into the entry stop (earliest revision, for risk/R) and the current
   * stop (latest revision, for `DerivedTrade.currentStops`) — see
   * `selectEntryStops`/`selectCurrentStops`.
   */
  stopLevels: StopRevisionInput[];
  fills: TradeFill[];
}

/**
 * A trade is the span from flat to flat in one symbol. Derived, never stored,
 * for the same reason positions are: it cannot then disagree with the journal.
 *
 * Scaling in and out stays ONE trade — it is one idea, and splitting it would
 * inflate the trade count and distort win rate. A re-entry after going flat is
 * a new trade.
 */
export function deriveTrades(txns: TradeTxn[]): DerivedTrade[] {
  const bySymbol = new Map<string, TradeTxn[]>();
  for (const t of txns) {
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  }

  const trades: DerivedTrade[] = [];

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort(compareFills);

    let open: OpenTrade | null = null;

    for (const t of ordered) {
      const signed = t.side === 'BUY' ? t.quantity : -t.quantity;

      if (open === null) {
        open = {
          direction: signed > 0 ? 'LONG' : 'SHORT',
          position: signed,
          openQty: t.quantity,
          openNotional: t.quantity * t.price,
          closeQty: 0,
          closeNotional: 0,
          fees: t.fee,
          enteredAt: t.executedAt,
          // The plan belongs to the opening fill; later adds do not redefine it.
          stopLevels: t.stopLevels ?? [],
          fills: [],
        };
        open.fills.push({
          executedAt: t.executedAt,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          fee: t.fee,
          executions: t.executions,
          exitKind: t.exitKind,
          entryId: t.entryId,
        });
        continue;
      }

      open.fills.push({
        executedAt: t.executedAt,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee,
        executions: t.executions,
        exitKind: t.exitKind,
        entryId: t.entryId,
      });
      open.fees += t.fee;
      const adding = Math.sign(signed) === Math.sign(open.position);
      if (adding) {
        open.openQty += t.quantity;
        open.openNotional += t.quantity * t.price;
      } else {
        open.closeQty += t.quantity;
        open.closeNotional += t.quantity * t.price;
      }
      open.position += signed;

      if (Math.abs(open.position) < EPSILON) {
        trades.push(finish(symbol, open, t.executedAt));
        open = null;
      }
    }

    if (open !== null) {
      trades.push(finish(symbol, open, null));
    }
  }

  return trades.sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime());
}

function finish(
  symbol: string,
  open: OpenTrade,
  exitedAt: Date | null,
): DerivedTrade {
  const avgEntry = round(open.openNotional / open.openQty);
  const avgExit =
    open.closeQty > EPSILON ? round(open.closeNotional / open.closeQty) : null;

  let realizedPnl: number | null = null;
  if (exitedAt !== null && avgExit !== null) {
    const gross =
      open.direction === 'LONG'
        ? (avgExit - avgEntry) * open.closeQty
        : (avgEntry - avgExit) * open.closeQty;
    realizedPnl = round(gross - open.fees);
  }

  // Risk comes from the stop tiers AT ENTRY — the earliest revision — against
  // the average entry price. Tiers may cover only part of the position;
  // computeRisk reports that rather than pretending the whole position was
  // protected. An unknown-vintage revision (see selectEntryStops) yields no
  // entry tiers at all, so risk stays null rather than being guessed from
  // whatever stop is live now.
  const entryStops = selectEntryStops(open.stopLevels);

  // A SELL against a long (a covering BUY against a short) is a reducing
  // fill — it may have executed one of the recorded tiers, which the tier
  // itself is never updated to reflect (see stop-level.entity.ts). The
  // opening fill is automatically excluded here: its side always matches
  // `open.direction`, the opposite of what counts as reducing, and so does
  // any later ADD in the same direction (scaling in further).
  const reducingSide: 'BUY' | 'SELL' = open.direction === 'LONG' ? 'SELL' : 'BUY';
  const reducingFills: ReducingFill[] = open.fills
    .filter((f) => f.side === reducingSide)
    .map((f) => ({
      executedAt: f.executedAt,
      price: f.price,
      quantity: f.quantity,
      executions: f.executions,
      exitKind: f.exitKind,
    }));

  // Each tier's id is carried through rather than stripped. It started out
  // internal to matching a recorded StopExecution against the right tier, but
  // the entry sheet needs it too: to say "this sale executed THAT tier" it has
  // to be able to name the tier, and an id-free list leaves it nothing to
  // name. Callers that do not care simply ignore the extra field.
  const currentStops = computeEffectiveStops(
    selectCurrentStopsWithIds(open.stopLevels),
    latestRevisionCreatedAt(open.stopLevels),
    open.enteredAt,
    reducingFills,
  );

  const risk = computeRisk({
    avgEntry,
    quantity: open.openQty,
    levels: entryStops,
    direction: open.direction,
  });

  return {
    symbol,
    direction: open.direction,
    quantity: round(open.openQty),
    avgEntry,
    avgExit,
    enteredAt: open.enteredAt,
    exitedAt,
    remainingQuantity: round(open.position),
    holdingDays:
      exitedAt === null
        ? null
        : Math.round(
            (exitedAt.getTime() - open.enteredAt.getTime()) / 86_400_000,
          ),
    feesPaid: round(open.fees),
    realizedPnl,
    // Break-even is not a win. Counting a scratch as a win flatters the rate.
    isWin: realizedPnl === null ? null : realizedPnl > 0,
    isOpen: exitedAt === null,
    riskAmount: risk.amount,
    riskCoversFullPosition: risk.fullyCovered,
    rMultiple:
      realizedPnl !== null && risk.amount !== null && risk.amount > EPSILON
        ? round(realizedPnl / risk.amount)
        : null,
    fills: open.fills,
    currentStops,
  };
}

export interface TradeSummary {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /**
   * Average dollars at risk per trade that set a stop. Open trades count:
   * risk is fixed at entry and does not depend on the outcome.
   */
  avgRisk: number | null;
  /** How many trades the risk figure is based on. */
  riskTradeCount: number;
  expectancyDollars: number | null;
  /** Averaged over trades that had a stop. Null when none did. */
  expectancyR: number | null;
  /** How many trades the R figure is based on, so the number stays honest. */
  rTradeCount: number;
}

type Summarisable = Pick<
  DerivedTrade,
  'realizedPnl' | 'isOpen' | 'isWin' | 'rMultiple' | 'riskAmount'
>;

export function summariseTrades(trades: Summarisable[]): TradeSummary {
  const closed = trades.filter((t) => !t.isOpen && t.realizedPnl !== null);
  const wins = closed.filter((t) => t.isWin === true);
  const losses = closed.filter((t) => t.isWin === false);
  const withR = closed.filter((t) => t.rMultiple !== null);
  // Risk is known at entry, so an open trade contributes to average risk.
  //
  // Positive, not merely non-null: a plan whose every tier locks in a gain
  // reports $0 risk (see `computeRisk`, which counts such a tier as covering
  // its shares), and averaging those zeros in would drag "what I typically
  // risk" toward nothing. This average exists to size the next position —
  // trades that risked nothing are not representative of that, and several
  // real positions have exactly this shape because a trailed-up plan is
  // recorded against the entry.
  const withRisk = trades.filter(
    (t) => t.riskAmount !== null && t.riskAmount > 0,
  );

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length);

  return {
    closedCount: closed.length,
    openCount: trades.filter((t) => t.isOpen).length,
    winRate: closed.length === 0 ? null : round(wins.length / closed.length),
    avgWin: mean(wins.map((t) => t.realizedPnl as number)),
    // Reported as a positive magnitude so "avg loss $920" reads naturally.
    avgLoss: mean(losses.map((t) => Math.abs(t.realizedPnl as number))),
    avgRisk: mean(withRisk.map((t) => t.riskAmount as number)),
    riskTradeCount: withRisk.length,
    expectancyDollars: mean(closed.map((t) => t.realizedPnl as number)),
    expectancyR: mean(withR.map((t) => t.rMultiple as number)),
    rTradeCount: withR.length,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}


/**
 * How close a fill must sit to a tier's price before the app will record, on
 * its own, that the tier fired. 0.25% of the tier price.
 *
 * Calibrated against the owner's real history: his stop fills land between
 * exact and 18 cents off a $207 level (0.09%), which is ordinary slippage.
 * A wider window would start claiming that any sale in the neighbourhood of a
 * stop WAS that stop, which is the guess this whole feature exists to stop
 * making.
 */
const AUTO_ATTRIBUTE_TOLERANCE = 0.0025;

/**
 * The tier a fill demonstrably executed, or null.
 *
 * Unlike `suggestTierForFill`, which always returns its best candidate for a
 * human to accept or reject, this refuses to answer unless the prices
 * genuinely match — it is written to be believed without review, so it must
 * only claim what it can see.
 *
 * TRAILING tiers are never matched here. Their live level depends on the
 * high-water mark since entry, which exists in the portfolio derivation and
 * not in the journal write path, so a trailing tier cannot be priced at the
 * moment a fill is recorded. An exit against one is simply left unrecorded
 * rather than guessed at.
 */
export function autoAttributeTier(
  tiers: Array<StopLevelInput & { id: string }>,
  fillPrice: number,
): string | null {
  if (!(fillPrice > 0)) return null;
  let best: { id: string; gap: number } | null = null;
  for (const tier of tiers) {
    if (tier.kind !== 'FIXED') continue;
    if (tier.price === null || !(tier.price > 0)) continue;
    const gap = Math.abs(tier.price - fillPrice);
    if (gap > tier.price * AUTO_ATTRIBUTE_TOLERANCE) continue;
    if (best === null || gap < best.gap) best = { id: tier.id, gap };
  }
  return best?.id ?? null;
}
