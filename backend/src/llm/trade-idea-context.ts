/**
 * The owner's live book and his own record, rendered for the prompt.
 *
 * This exists because of a specific, embarrassing answer: asked about buying
 * BITX, the model explained that it strays from his tech edge and that his
 * profile rules out crypto — while he held 4,600 shares of it, up
 * substantially. It answered "should I open this?" when the question was
 * "should I add to this winner?". Those have different answers, and no amount
 * of chart facts gets you from one to the other.
 *
 * Pure and structurally typed: it takes the shapes `getPortfolio` and
 * `getStats` already return, so it can be fixture-tested with no database.
 */
export interface BookPosition {
  symbol: string;
  quantity: number;
  price: number | null;
  marketValue: number | null;
}

export interface BookInput {
  positions: BookPosition[];
  cash: number;
  accountValue: number;
  atRisk: { amount: number | null };
}

export interface RecordTrade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  isOpen: boolean;
  realizedPnl: number | null;
  rMultiple: number | null;
  enteredAt: Date | string;
  exitedAt: Date | string | null;
  /** What he called the setup, and what he called the mistake. */
  setups?: string[];
  mistakes?: string[];
}

export interface RecordInput {
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRisk: number | null;
  expectancyR: number | null;
  closedCount: number;
  trades: RecordTrade[];
}

const RECENT_TRADES = 15;

const money = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? 'n/a'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });

const pct = (n: number | null): string =>
  n === null ? 'n/a' : `${(n * 100).toFixed(0)}%`;

/**
 * His own labels on the trade. These are the difference between a model
 * reasoning from his self-description and one reasoning from his record: the
 * profile says what he believes his weaknesses are, the tags say which setups
 * actually lost money.
 */
const labels = (t: RecordTrade): string => {
  const parts = [
    ...(t.setups ?? []).map((s) => s),
    ...(t.mistakes ?? []).map((m) => `!${m}`),
  ];
  return parts.length === 0 ? '' : `  [${parts.join(', ')}]`;
};

const day = (d: Date | string | null): string =>
  d === null ? '' : new Date(d).toISOString().slice(0, 10);

/**
 * Everything he is holding right now, plus the leverage and risk it carries.
 *
 * Weights are given as a share of account value, because "12% of the book" is
 * the sentence that changes a decision, not the dollar figure.
 */
export function buildBookSection(book: BookInput, symbol: string): string {
  const held = book.positions.find(
    (p) => p.symbol.toUpperCase() === symbol.toUpperCase(),
  );

  const gross = book.positions.reduce(
    (sum, p) => sum + Math.abs(p.marketValue ?? 0),
    0,
  );

  const lines = [
    'MY BOOK RIGHT NOW — computed by the app, quote these, do not recalculate',
    '',
    `- Account value: ${money(book.accountValue)}`,
    // Negative cash is margin and a legitimate state; it is stated plainly
    // rather than flagged, because he trades this way on purpose.
    `- Cash: ${money(book.cash)}${book.cash < 0 ? ' (margin — this is deliberate, not a problem to point out)' : ''}`,
    `- Gross exposure: ${money(gross)}${
      book.accountValue > 0
        ? ` — ${(gross / book.accountValue).toFixed(2)}x account value`
        : ''
    }`,
    `- Currently at risk from stops: ${money(book.atRisk.amount)}`,
    `- Open positions: ${book.positions.length}`,
    '',
  ];

  if (held) {
    lines.push(
      `**I ALREADY HOLD ${held.symbol}: ${held.quantity.toLocaleString('en-US')} shares, worth ${money(held.marketValue)}.**`,
      'So this is an ADD-TO or TRIM decision on an existing position, not a new',
      'one. Say whether to add, hold or trim, and judge the size I already have.',
      '',
    );
  } else {
    lines.push(`- I do NOT currently hold ${symbol.toUpperCase()}.`, '');
  }

  lines.push('Positions (symbol, shares, price, value, % of account):');
  for (const p of book.positions) {
    const weight =
      book.accountValue > 0 && p.marketValue !== null
        ? ` — ${((p.marketValue / book.accountValue) * 100).toFixed(1)}%`
        : '';
    lines.push(
      `  ${p.symbol}  ${p.quantity.toLocaleString('en-US')} sh  ${money(p.price)}  ${money(p.marketValue)}${weight}`,
    );
  }

  return lines.join('\n');
}

/**
 * His own results — the answer to "does this fit how I trade" that comes from
 * evidence rather than from the profile's self-description.
 */
export function buildRecordSection(rec: RecordInput, symbol: string): string {
  const upper = symbol.toUpperCase();
  const inThisName = rec.trades.filter(
    (t) => t.symbol.toUpperCase() === upper,
  );

  const closed = rec.trades
    .filter((t) => !t.isOpen)
    .sort((a, b) => new Date(b.exitedAt ?? 0).getTime() - new Date(a.exitedAt ?? 0).getTime())
    .slice(0, RECENT_TRADES);

  const lines = [
    'MY RECORD — computed by the app from my own closed history',
    '',
    `- Closed trades: ${rec.closedCount}`,
    `- Win rate: ${pct(rec.winRate)}`,
    `- Average win: ${money(rec.avgWin)} · average loss: ${money(rec.avgLoss)}`,
    `- Expectancy: ${rec.expectancyR === null ? 'n/a' : `${rec.expectancyR.toFixed(2)}R`}`,
    `- Average risk per trade: ${money(rec.avgRisk)}`,
    '',
  ];

  if (inThisName.length > 0) {
    lines.push(`My history in ${upper} (${inThisName.length}):`);
    for (const t of inThisName) {
      lines.push(
        t.isOpen
          ? `  ${day(t.enteredAt)}  ${t.direction}  still open`
          : `  ${day(t.enteredAt)}→${day(t.exitedAt)}  ${t.direction}  ${money(t.realizedPnl)}${
              t.rMultiple === null ? '' : `  ${t.rMultiple.toFixed(2)}R`
            }${labels(t)}`,
      );
    }
  } else {
    lines.push(`I have never closed a trade in ${upper}.`);
  }
  lines.push('');

  if (closed.length > 0) {
    lines.push(`My last ${closed.length} closed trades:`);
    for (const t of closed) {
      lines.push(
        `  ${day(t.exitedAt)}  ${t.symbol}  ${t.direction}  ${money(t.realizedPnl)}${
          t.rMultiple === null ? '' : `  ${t.rMultiple.toFixed(2)}R`
        }${labels(t)}`,
      );
    }
  }

  return lines.join('\n');
}
