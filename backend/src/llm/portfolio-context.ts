/**
 * Assembles the compact facts block the model reads. Every number here is
 * read straight off existing service responses (PortfolioService,
 * PerformanceService) — nothing here recomputes a financial figure; the two
 * aggregates it does form (gross exposure, concentration) are simple sums
 * and ratios over numbers the services already produced, in the same spirit
 * as PortfolioService's own `computeAtRisk` totalling.
 *
 * Pure and dependency-free on purpose, like `portfolio/derive.ts`: no
 * database, no network, so it is covered by fixture-driven tests and the
 * caller (llm.service.ts) is the only place that touches I/O.
 */

export interface ContextPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  price: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  stale: boolean;
  /** Trailing P/E. Null when Yahoo has none or it isn't meaningful (loss-making names, some ETFs). */
  peRatio: number | null;
  /**
   * Entry-day volume against its 20-day average — the fact that checks the
   * owner's own stated rule, "volume as a confirming indicator". Null when
   * there isn't a full lookback window of bars, or the entry day had none.
   * See relative-volume.ts.
   */
  entryRelativeVolume: number | null;
}

export interface ContextAtRisk {
  amount: number;
  positionsWithoutStop: { count: number; symbols: string[] };
}

export interface ContextPortfolio {
  positions: ContextPosition[];
  cash: number;
  positionsValue: number;
  accountValue: number;
  pricedAt: string;
  hasStalePrices: boolean;
  atRisk: ContextAtRisk;
}

export interface ContextStats {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRisk: number | null;
  riskTradeCount: number;
  expectancyDollars: number | null;
  expectancyR: number | null;
  rTradeCount: number;
}

export interface ContextPerformance {
  range: string;
  /** The trader's own cumulative return over the range, as a fraction (0.05 = 5%). */
  youReturn: number | null;
  deltas: { vsSp500: number | null; vsNasdaq: number | null } | null;
}

export interface PortfolioContextInput {
  portfolio: ContextPortfolio;
  stats: ContextStats;
  /** Null when no daily-close history exists yet to build a series from. */
  performance: ContextPerformance | null;
}

const MAX_POSITIONS_LISTED = 5;

export function buildPortfolioContext(input: PortfolioContextInput): string {
  const { portfolio, stats, performance } = input;
  const lines: string[] = [];

  lines.push(`FACTS (as of ${portfolio.pricedAt}, computed by the app — quote these, do not recalculate)`);
  lines.push('');

  lines.push('Account');
  lines.push(`- Account value: ${money(portfolio.accountValue)}`);
  lines.push(
    `- Cash: ${money(portfolio.cash)}${portfolio.cash < 0 ? ' (negative — on margin)' : ''}`,
  );
  lines.push(`- Positions value (deployed): ${money(portfolio.positionsValue)}`);

  const grossExposure = portfolio.positions.reduce(
    (sum, p) => sum + Math.abs(p.marketValue ?? 0),
    0,
  );
  lines.push(`- Gross exposure (sum of |position value|): ${money(grossExposure)}`);
  if (portfolio.accountValue > 0) {
    lines.push(
      `- Leverage (gross exposure / account value): ${(grossExposure / portfolio.accountValue).toFixed(2)}x`,
    );
  }
  if (portfolio.hasStalePrices) {
    lines.push('- Note: one or more prices below are stale (provider unavailable).');
  }
  lines.push('');

  lines.push('Risk');
  lines.push(`- Open positions: ${portfolio.positions.length}`);
  lines.push(`- At risk (sum of stop-loss exposure): ${money(portfolio.atRisk.amount)}`);
  lines.push(
    `- Positions without a recorded stop: ${portfolio.atRisk.positionsWithoutStop.count}` +
      (portfolio.atRisk.positionsWithoutStop.count > 0
        ? ` (${portfolio.atRisk.positionsWithoutStop.symbols.join(', ')})`
        : ''),
  );
  lines.push('');

  const bySize = [...portfolio.positions].sort(
    (a, b) => Math.abs(b.marketValue ?? 0) - Math.abs(a.marketValue ?? 0),
  );
  const shown = bySize.slice(0, MAX_POSITIONS_LISTED);
  lines.push(
    `Largest positions (${shown.length} of ${portfolio.positions.length}, by size)`,
  );
  for (const p of shown) {
    const side = p.quantity < 0 ? 'SHORT' : 'LONG';
    const weight =
      portfolio.accountValue > 0 && p.marketValue !== null
        ? ` — ${percent(Math.abs(p.marketValue) / portfolio.accountValue)} of account`
        : '';
    lines.push(
      `- ${p.symbol}: ${side} ${qty(p.quantity)} sh @ ${money(p.avgCost)} avg, ` +
        `now ${p.price !== null ? money(p.price) : 'unpriced'}, ` +
        `value ${p.marketValue !== null ? money(p.marketValue) : 'unknown'}${weight}, ` +
        `unrealized ${p.unrealizedPnl !== null ? money(p.unrealizedPnl, true) : 'unknown'}` +
        (p.unrealizedPct !== null ? ` (${percent(p.unrealizedPct, true)})` : '') +
        `, P/E ${p.peRatio !== null ? p.peRatio.toFixed(1) : 'n/a'}` +
        `, entry volume ${
          p.entryRelativeVolume !== null
            ? `${p.entryRelativeVolume.toFixed(2)}x its 20-day average`
            : 'unknown'
        }` +
        (p.stale ? ' [STALE PRICE]' : ''),
    );
  }
  if (bySize.length > 0) {
    const top3 = bySize.slice(0, 3).reduce((s, p) => s + Math.abs(p.marketValue ?? 0), 0);
    if (portfolio.accountValue > 0) {
      lines.push(
        `- Concentration: top ${Math.min(3, bySize.length)} position(s) are ${percent(top3 / portfolio.accountValue)} of account value.`,
      );
    }
  }
  lines.push('');

  lines.push('Trading history (from the closed-trade log)');
  lines.push(`- Closed trades: ${stats.closedCount}, open trades: ${stats.openCount}`);
  lines.push(
    `- Win rate: ${stats.winRate !== null ? percent(stats.winRate) : 'not enough closed trades'}`,
  );
  lines.push(
    `- Avg win: ${stats.avgWin !== null ? money(stats.avgWin) : 'n/a'}, avg loss: ${
      stats.avgLoss !== null ? money(stats.avgLoss) : 'n/a'
    }`,
  );
  lines.push(
    `- Avg risk per trade: ${stats.avgRisk !== null ? money(stats.avgRisk) : 'n/a'} (based on ${stats.riskTradeCount} trade(s) with a recorded stop)`,
  );
  lines.push(
    `- Expectancy: ${stats.expectancyDollars !== null ? money(stats.expectancyDollars, true) : 'n/a'} per trade` +
      (stats.expectancyR !== null
        ? `, ${stats.expectancyR.toFixed(2)}R average (based on ${stats.rTradeCount} trade(s))`
        : ''),
  );
  lines.push('');

  lines.push('Performance vs. benchmarks');
  if (performance) {
    lines.push(`- Range: ${performance.range}`);
    lines.push(
      `- Your return: ${performance.youReturn !== null ? percent(performance.youReturn, true) : 'n/a'}`,
    );
    lines.push(
      `- vs S&P 500: ${
        performance.deltas?.vsSp500 !== null && performance.deltas?.vsSp500 !== undefined
          ? percent(performance.deltas.vsSp500, true) + ' points'
          : 'n/a'
      }`,
    );
    lines.push(
      `- vs Nasdaq: ${
        performance.deltas?.vsNasdaq !== null && performance.deltas?.vsNasdaq !== undefined
          ? percent(performance.deltas.vsNasdaq, true) + ' points'
          : 'n/a'
      }`,
    );
  } else {
    lines.push('- Not available yet (no priced history).');
  }

  return lines.join('\n');
}

function money(n: number, signed = false): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `-${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

function percent(n: number, signed = false): string {
  const pct = n * 100;
  const formatted = `${Math.abs(pct).toFixed(1)}%`;
  if (n < 0) return `-${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

function qty(n: number): string {
  const abs = Math.abs(n);
  return Number.isInteger(abs) ? String(abs) : abs.toFixed(4);
}
