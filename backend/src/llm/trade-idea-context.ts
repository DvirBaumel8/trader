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
 *
 * `symbol` is null when there is no single ticker to call out — the watchlist
 * ranking asks about every candidate at once, so there is no "do I already
 * hold THIS one" question with a single answer. In that case the ALREADY
 * HOLD / do NOT hold callout is skipped entirely rather than rendered with a
 * blank where the symbol should be; the book totals and the positions list
 * below are unaffected either way.
 */
function grossExposure(book: BookInput): number {
  return book.positions.reduce((sum, p) => sum + Math.abs(p.marketValue ?? 0), 0);
}

export function buildBookSection(book: BookInput, symbol: string | null): string {
  const held =
    symbol === null
      ? undefined
      : book.positions.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());

  const gross = grossExposure(book);

  const lines = [
    'MY BOOK RIGHT NOW — computed by the app. Do not type these numbers',
    'yourself: to state gross exposure or any position\'s share of the account',
    'in your answer, write {{GROSS_EXPOSURE}}, {{GROSS_EXPOSURE_MULTIPLE}} or',
    '{{WEIGHT:<SYMBOL>}} (e.g. {{WEIGHT:LMND}}) and the app will substitute the',
    'real figure. This applies to every position below, not only the one I am',
    'asking about.',
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
  } else if (symbol !== null) {
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

const PLACEHOLDER = /\{\{([A-Z_]+)(?::([A-Za-z0-9.-]+))?\}\}/g;

/**
 * Fills in `{{GROSS_EXPOSURE}}`, `{{GROSS_EXPOSURE_MULTIPLE}}` and
 * `{{WEIGHT:<SYMBOL>}}` in the model's own answer with the real, computed
 * figure — never with a number the model typed itself.
 *
 * Exists because a stronger instruction is not enough: the prompt already
 * told the model "quote these, do not recalculate," handed it the correct
 * LMND weight (22.1%), and it wrote 36.1% anyway, in prose with nothing to
 * check it against. Every OTHER figure in that same answer was accurate,
 * which is what rules out a fetch/timing difference as the cause — this is
 * occasional transcription drift, not a systematic error, so the fix removes
 * the model's ability to transcribe at all rather than trying to catch it
 * after the fact by re-parsing free text. The model still sees every real
 * number as context (it needs them to reason about sizing); it just is
 * never the one who writes a digit of them down.
 *
 * An unresolved placeholder — an invented ticker, a typo'd token — renders as
 * a plain "—", the same way every other "no value" case in this app does.
 * Never the raw `{{...}}` syntax, and never a guess.
 */
export function substituteBookPlaceholders(text: string, book: BookInput): string {
  const gross = grossExposure(book);

  return text.replace(PLACEHOLDER, (_match, token: string, arg?: string) => {
    if (token === 'GROSS_EXPOSURE') return money(gross);
    if (token === 'GROSS_EXPOSURE_MULTIPLE') {
      return book.accountValue > 0 ? `${(gross / book.accountValue).toFixed(2)}x` : '—';
    }
    if (token === 'WEIGHT' && arg) {
      const position = book.positions.find(
        (p) => p.symbol.toUpperCase() === arg.toUpperCase(),
      );
      if (position && position.marketValue !== null && book.accountValue > 0) {
        return `${((position.marketValue / book.accountValue) * 100).toFixed(1)}%`;
      }
    }
    return '—';
  });
}

/**
 * His own history in one ticker, rendered as the lines both `buildRecordSection`
 * (under "My history in X") and the watchlist ranking's per-candidate block
 * (under "MY HISTORY IN THIS TICKER") show — pulled out so those two never
 * drift into two descriptions of the same trades. Says so plainly, in one
 * line, when he has never traded the name: that absence is informative too,
 * not a hole to leave blank.
 */
export function renderHistoryLines(trades: RecordTrade[], symbol: string): string[] {
  const upper = symbol.toUpperCase();
  const inThisName = trades.filter((t) => t.symbol.toUpperCase() === upper);

  if (inThisName.length === 0) {
    return [`I have never closed a trade in ${upper}.`];
  }

  const lines = [`My history in ${upper} (${inThisName.length}):`];
  for (const t of inThisName) {
    lines.push(
      t.isOpen
        ? `  ${day(t.enteredAt)}  ${t.direction}  still open`
        : `  ${day(t.enteredAt)}→${day(t.exitedAt)}  ${t.direction}  ${money(t.realizedPnl)}${
            t.rMultiple === null ? '' : `  ${t.rMultiple.toFixed(2)}R`
          }${labels(t)}`,
    );
  }
  return lines;
}

/**
 * His own results — the answer to "does this fit how I trade" that comes from
 * evidence rather than from the profile's self-description.
 *
 * `symbol` is null for the same reason as `buildBookSection` — the watchlist
 * ranking has no single ticker to ask "my history in X" about — in which case
 * the per-ticker block is skipped entirely rather than rendered with a hole
 * in the sentence ("I have never closed a trade in ."). The overall stats and
 * the recent-closed-trades list are unaffected.
 */
export function buildRecordSection(rec: RecordInput, symbol: string | null): string {
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

  if (symbol !== null) {
    lines.push(...renderHistoryLines(rec.trades, symbol), '');
  }

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
