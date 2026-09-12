import type { RawConsensus } from '../market-data/yahoo.client.js';
import type { IndicatorSet } from '../market-data/indicators.js';

/**
 * One watchlist ticker, carrying the three views the model is asked to
 * reconcile: the street (bought-in analyst consensus), the tape (what the app
 * computes from price history) and — via `bookSection` / `recordSection` in
 * `buildRankingUserPrompt` — him.
 *
 * `targetPrice` and `distanceToTarget` are HIS OWN target on the watchlist
 * item, if he set one — a personal marker, not the street's target mean.
 */
export interface RankingCandidate {
  symbol: string;
  name: string | null;
  price: number | null;
  /** The tape. */
  indicators: IndicatorSet;
  /** The street. Null means no analyst covers it. */
  consensus: RawConsensus | null;
  /** His own target, if he set one, and how far away it is (a fraction). */
  targetPrice: number | null;
  distanceToTarget: number | null;
  /** His tags on the item — sector, style, whatever he chose. */
  tags: string[];
  note: string;
}

const price = (n: number | null): string =>
  n === null
    ? 'n/a'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const pct = (n: number | null): string =>
  n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

const level = (n: number | null): string => (n === null ? 'n/a' : price(n));

/** e.g. 'strong_buy' -> 'Strong Buy'. */
const recLabel = (key: string | null): string =>
  key === null
    ? 'n/a'
    : key
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

/**
 * The street's view, rendered — or a plain statement that it does not exist.
 * The "no analyst coverage" wording is load-bearing: it is what tells the
 * model (and, downstream, the reader) that this ticker is ranked on fewer
 * views than its neighbours, never that it scored a silent zero.
 */
function renderStreet(c: RawConsensus | null): string[] {
  if (c === null) {
    return [
      'THE STREET (bought-in analyst consensus): no analyst coverage — nobody',
      'covers this name. Treat this view as absent, not as bearish.',
    ];
  }

  const lines = [
    'THE STREET (bought-in analyst consensus):',
    `  - Recommendation: ${recLabel(c.recommendationKey)} (mean ${
      c.recommendationMean === null ? 'n/a' : c.recommendationMean.toFixed(2)
    } on a 1=strong buy … 5=sell scale), from ${c.analystCount ?? 'n/a'} analysts`,
    `  - Price targets: mean ${level(c.targetMean)}, high ${level(c.targetHigh)}, low ${level(c.targetLow)}`,
    `  - Revenue growth: ${pct(c.revenueGrowth)} · earnings growth: ${pct(c.earningsGrowth)}`,
    `  - Profit margin: ${pct(c.profitMargin)} · return on equity: ${pct(c.returnOnEquity)}`,
  ];

  if (c.trend.length > 0) {
    const recent = c.trend.slice(0, 3);
    lines.push(
      '  - Recommendation trend, most recent first (strong buy/buy/hold/sell/strong sell):',
      ...recent.map(
        (t) =>
          `      ${t.period}: ${t.strongBuy}/${t.buy}/${t.hold}/${t.sell}/${t.strongSell}`,
      ),
    );
  }

  return lines;
}

/** The tape: what the app itself computes from price history. */
function renderTape(i: IndicatorSet): string[] {
  return [
    'THE TAPE (computed by the app from price history):',
    `  - 20-day average: ${level(i.sma20)} (price is ${pct(i.percentFromSma20)} from it)`,
    `  - 50-day average: ${level(i.sma50)} (price is ${pct(i.percentFromSma50)} from it)`,
    `  - 150-day average (HIS trend indicator): ${level(i.sma150)} (price is ${pct(i.percentFromSma150)} from it)`,
    `  - 200-day average: ${level(i.sma200)} (price is ${pct(i.percentFromSma200)} from it)`,
    `  - 52-week high: ${level(i.high52w)} (price is ${pct(i.percentFromHigh52w)} from it)`,
    `  - 52-week low: ${level(i.low52w)} (price is ${pct(i.percentFromLow52w)} from it)`,
    `  - ATR(14): ${level(i.atr14)}${i.atrPercentOfPrice !== null ? ` — ${(i.atrPercentOfPrice * 100).toFixed(1)}% of price` : ''}`,
    `  - Relative volume: ${i.relativeVolume !== null ? `${i.relativeVolume.toFixed(2)}x its 20-day average` : 'n/a'}`,
    `  - History available: ${i.barsAvailable} daily bars${i.barsAvailable < 200 ? ' (thin — treat longer-window readings above as unreliable or absent)' : ''}`,
  ];
}

function renderCandidate(c: RankingCandidate): string {
  const header = `### ${c.symbol}${c.name ? ` — ${c.name}` : ''} (price: ${level(c.price)})`;

  const notes = [
    'HIS OWN NOTES ON THIS TICKER:',
    `  - His own target: ${
      c.targetPrice === null
        ? 'none set'
        : `${level(c.targetPrice)} (${pct(c.distanceToTarget)} away from the current price)`
    }`,
    `  - Tags: ${c.tags.length > 0 ? c.tags.join(', ') : 'none'}`,
    `  - Note: ${c.note.trim().length > 0 ? c.note.trim() : 'none'}`,
  ];

  return [
    header,
    '',
    ...renderStreet(c.consensus),
    '',
    ...renderTape(c.indicators),
    '',
    ...notes,
  ].join('\n');
}

/**
 * The user turn: his profile, his book, his record, then every candidate with
 * its three views, then the ask.
 *
 * Kept separate from `RANKING_SYSTEM_PROMPT` for the same reason
 * `trade-idea-prompt.ts` splits role from facts — the wording of one can be
 * iterated without touching the other. `bookSection` and `recordSection` are
 * consumed verbatim from `trade-idea-context.ts`'s `buildBookSection` /
 * `buildRecordSection`; this file does not re-derive either.
 */
export function buildRankingUserPrompt(
  candidates: RankingCandidate[],
  bookSection: string,
  recordSection: string,
  profile: string,
): string {
  const intro = `Rank these ${candidates.length} watchlist ticker${
    candidates.length === 1 ? '' : 's'
  } from best to worst for "what should I buy next". Every one below must appear in your ranking exactly once — do not drop one and do not invent one that is not listed.`;

  const candidateBlocks = candidates.map(renderCandidate).join('\n\n');

  return [
    intro,
    '',
    'MY TRADING PROFILE:',
    profile,
    '',
    bookSection,
    '',
    recordSection,
    '',
    'THE WATCHLIST — one entry per ticker, each with its three views:',
    '',
    candidateBlocks,
  ].join('\n');
}

/**
 * The role and the output contract. This is the design's whole point made
 * into an instruction: three independent views per ticker — the street
 * (bought-in analyst consensus), the tape (what the app computes) and him
 * (his book, his record, his own history in that name) — reconciled, not
 * averaged. The disagreement between them is the answer worth reading, not
 * an inconvenience to smooth over.
 *
 * No numeric score reaches the output: "NVDA 7.4 versus AMD 7.1" implies a
 * precision three disagreeing views cannot support, and the ranked order
 * already carries the comparison. Nor does a position size or a dollar
 * figure — the app derives size from a stop; this ranks attention, not
 * actions.
 *
 * A missing view (most often no analyst coverage on a thin name or an ETF)
 * is treated as neutral — the middle of its range — never as a zero and
 * never as a mark against the ticker, because a zero would be a silent
 * penalty for a fact about data availability, not about the stock. It must
 * still be named on that ticker's line, so a ticker ranked on two views does
 * not read as equally confident to one ranked on three.
 *
 * The output contract is fixed and machine-parseable: one `[RANK]` block per
 * candidate, in ranked order, followed by the reasoning that justifies that
 * order and calls out where the views disagreed.
 */
export const RANKING_SYSTEM_PROMPT = `You are ranking one trader's stock watchlist, best to worst, to answer the
question he actually asked: "what should I buy next?" You are not screening
for quality in the abstract — you are ordering names he is already watching,
against each other, for his next entry.

For every ticker you have three independent views, and your job is to
RECONCILE them, not average them:

1. THE STREET — bought-in analyst consensus: recommendation, price targets,
   growth and margins. This is someone else's paid research; you are not
   trying to out-analyse fifty-seven analysts, you are reading what they
   already concluded.
2. THE TAPE — what the app itself computed from price history: his 150-day
   average (HIS OWN trend indicator, not the more common 50 or 200 — weight
   it accordingly), distance from the 52-week high and low, ATR as a fraction
   of price, relative volume.
3. HIM — his book (what he already holds, his cash, his current at-risk
   exposure and margin use), his record (win rate, expectancy in R, average
   risk, his last closed trades with the setups and mistakes HE tagged), and
   specifically his own history in the ticker being ranked, if he has one.

Reconciling means saying, for each ticker, whether these three views agree —
and when they do not, saying so plainly and naming which view you weighted
and why. A stock the street loves that is extended on the tape and that he
has already lost money chasing under the same tag is a genuinely different
answer from one all three views agree on, and the reconciliation is the part
worth reading. No vendor's rating and no chart indicator can write that last
comparison — only his own record can, so do not let the street or the tape
drown it out.

A MISSING VIEW IS NEUTRAL, NEVER A PENALTY. Plenty of tickers here — thin
names, ETFs — have no analyst coverage at all. Where a view is absent, treat
it as neutral: the middle of its range, not zero, and never a mark against
the ticker for a fact about data availability rather than about the stock.
But say so on that ticker's line: a ticker ranked on two views sitting next
to one ranked on three, with nothing to tell them apart, is a judgement
wearing a confidence it has not earned.

Do not give any ticker a numeric score, a rating out of ten, or a percentage
confidence — no numeric score of any kind reaches your answer. The ranked
order already carries the comparison; a number beside it would claim a
precision three disagreeing views cannot support. Likewise: no position
size and no dollar figure. The app derives size from a stop; you are
ranking attention, not proposing actions.

Every candidate you are given must appear in your ranking exactly once — no
ticker dropped, none added.

OUTPUT CONTRACT — follow this exactly, it is parsed by code:

First, one block per candidate, in ranked order from best to worst:

[RANK]
SYMBOL: <the ticker symbol, exactly as given>
VERDICT: <one line, under 120 characters, the headline judgement>
COVERAGE: full | no-analyst-coverage
[/RANK]

Repeat that block for every candidate — best first, worst last. COVERAGE is
"no-analyst-coverage" when THE STREET was absent for that ticker and "full"
otherwise.

After every [RANK] block, write your reasoning as plain paragraphs,
referencing tickers by symbol. This is where the reconciliation lives: say
where the three views agreed, where they clashed, and which you weighted and
why — especially anywhere his own record pulls against the street or the
tape. Do not repeat the verdict lines verbatim; the paragraphs are the case
for them.`;
