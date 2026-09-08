export interface TradeReviewFacts {
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

  // Discipline & Stop metrics
  hadInitialStop: boolean;
  initialStopPrice: number | null;
  stopTrailedFavorable: boolean;
  stopWidenedOrMovedAgainst: boolean;
  stopSlippageTotal: number | null;
  stopSlippagePerShare: number | null;

  // Fills & exit breakdown
  exitKinds: {
    stopShares: number;
    targetShares: number;
    discretionaryShares: number;
  };

  // Journal context
  setups: string[];
  mistakes: string[];
  notes: string[];
}

export interface BuildTradeReviewFactsInput {
  trade: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    isOpen: boolean;
    enteredAt: Date;
    exitedAt: Date | null;
    quantity: number;
    remainingQuantity: number;
    avgEntry: number;
    avgExit: number | null;
    realizedPnl: number | null;
    rMultiple: number | null;
    riskAmount?: number | null;
    initialRiskPerShare?: number | null;
    plannedTarget: number | null;
    holdingDays: number | null;
    entryRelativeVolume: number | null;
    highWaterPrice: number | null;
  };
  fills: Array<{
    executedAt: string | Date;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    exitKind?: 'STOP' | 'TARGET' | 'DISCRETIONARY' | null;
    notes?: string | null;
  }>;
  stopLevels?: Array<{
    kind: 'FIXED' | 'TRAILING';
    price?: number | null;
    trailPercent?: number | null;
    resolvedPrice?: number | null;
    quantity: number;
  }>;
  tags?: { setups: string[]; mistakes: string[] };
  journalNotes?: string[];
}

export function buildTradeReviewFacts(input: BuildTradeReviewFactsInput): TradeReviewFacts {
  const { trade, fills, stopLevels = [], tags, journalNotes = [] } = input;

  const enteredAtStr = trade.enteredAt instanceof Date
    ? trade.enteredAt.toISOString().slice(0, 10)
    : String(trade.enteredAt).slice(0, 10);
  const exitedAtStr = trade.exitedAt
    ? (trade.exitedAt instanceof Date ? trade.exitedAt.toISOString().slice(0, 10) : String(trade.exitedAt).slice(0, 10))
    : null;

  const initialRiskPerShare =
    trade.initialRiskPerShare ??
    (trade.riskAmount !== null && trade.riskAmount !== undefined && trade.quantity > 0
      ? trade.riskAmount / trade.quantity
      : null);
  const initialRiskPercent = initialRiskPerShare !== null && trade.avgEntry > 0
    ? (initialRiskPerShare / trade.avgEntry) * 100
    : null;

  const realizedPnlPercent = trade.realizedPnl !== null && trade.avgEntry > 0 && trade.quantity > 0
    ? (trade.realizedPnl / (trade.avgEntry * trade.quantity)) * 100
    : null;

  // Initial stop detection
  const firstStop = stopLevels[0] ?? null;
  const hadInitialStop = Boolean(
    firstStop &&
    (firstStop.resolvedPrice !== null || firstStop.price !== null || (firstStop.trailPercent ?? 0) > 0),
  );
  const initialStopPrice = firstStop
    ? (firstStop.resolvedPrice ?? firstStop.price ?? null)
    : null;

  // Check stop revisions for discipline adherence:
  // For LONG: favorable means stop price increased; adverse means stop price decreased.
  let stopTrailedFavorable = false;
  let stopWidenedOrMovedAgainst = false;

  const resolvedStopPrices = stopLevels
    .map((l) => l.resolvedPrice ?? l.price ?? null)
    .filter((p): p is number => p !== null);

  if (resolvedStopPrices.length > 1) {
    for (let idx = 1; idx < resolvedStopPrices.length; idx++) {
      const prev = resolvedStopPrices[idx - 1];
      const curr = resolvedStopPrices[idx];
      if (trade.direction === 'LONG') {
        if (curr > prev + 0.001) stopTrailedFavorable = true;
        if (curr < prev - 0.001) stopWidenedOrMovedAgainst = true;
      } else {
        if (curr < prev - 0.001) stopTrailedFavorable = true;
        if (curr > prev + 0.001) stopWidenedOrMovedAgainst = true;
      }
    }
  }

  // Analyze exit kinds and slippage
  let stopShares = 0;
  let targetShares = 0;
  let discretionaryShares = 0;
  let stopSlippageTotal = 0;
  let totalStoppedShares = 0;

  for (const fill of fills) {
    const isExit = trade.direction === 'LONG' ? fill.side === 'SELL' : fill.side === 'BUY';
    if (!isExit) continue;

    if (fill.exitKind === 'STOP') {
      stopShares += fill.quantity;
      totalStoppedShares += fill.quantity;
      // If we have an expected stop price, compute slippage
      const expectedStop = initialStopPrice;
      if (expectedStop !== null) {
        // For LONG: slippage = fill.price - expectedStop (negative means loss due to gap/slippage)
        const diff = trade.direction === 'LONG'
          ? fill.price - expectedStop
          : expectedStop - fill.price;
        stopSlippageTotal += diff * fill.quantity;
      }
    } else if (fill.exitKind === 'TARGET') {
      targetShares += fill.quantity;
    } else {
      discretionaryShares += fill.quantity;
    }
  }

  const stopSlippagePerShare = totalStoppedShares > 0 && initialStopPrice !== null
    ? stopSlippageTotal / totalStoppedShares
    : null;

  // Max Favorable Excursion (MFE)
  let mfeGainPercent: number | null = null;
  if (trade.highWaterPrice !== null && trade.avgEntry > 0) {
    if (trade.direction === 'LONG') {
      mfeGainPercent = ((trade.highWaterPrice - trade.avgEntry) / trade.avgEntry) * 100;
    } else {
      mfeGainPercent = ((trade.avgEntry - trade.highWaterPrice) / trade.avgEntry) * 100;
    }
  }

  return {
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.isOpen ? 'OPEN' : 'CLOSED',
    enteredAt: enteredAtStr,
    exitedAt: exitedAtStr,
    holdingDays: trade.holdingDays,
    quantity: trade.quantity,
    remainingQuantity: trade.remainingQuantity,
    avgEntry: trade.avgEntry,
    avgExit: trade.avgExit,
    realizedPnl: trade.realizedPnl,
    realizedPnlPercent,
    rMultiple: trade.rMultiple,
    initialRiskPerShare,
    initialRiskPercent,
    plannedTarget: trade.plannedTarget,
    entryRelativeVolume: trade.entryRelativeVolume,
    highWaterPrice: trade.highWaterPrice,
    mfeGainPercent,
    hadInitialStop,
    initialStopPrice,
    stopTrailedFavorable,
    stopWidenedOrMovedAgainst,
    stopSlippageTotal: totalStoppedShares > 0 ? stopSlippageTotal : null,
    stopSlippagePerShare,
    exitKinds: {
      stopShares,
      targetShares,
      discretionaryShares,
    },
    setups: tags?.setups ?? [],
    mistakes: tags?.mistakes ?? [],
    notes: journalNotes,
  };
}
