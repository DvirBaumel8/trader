import type { ConsensusResult } from '../market-data/yahoo.client.js';
import type { IndicatorSet } from '../market-data/indicators.js';
import { level, pct, renderIndicatorLines } from './indicator-lines.js';
import { renderHistoryLines, type RecordTrade } from './trade-idea-context.js';

/**
 * One watchlist ticker, carrying the three views the model is asked to
 * reconcile: the street (bought-in analyst consensus), the tape (what the app
 * computes from price history) and — via `bookSection` / `recordSection` in
 * `buildRankingUserPrompt`, plus `trades` below — him.
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
  /** Trailing P/E. Not part of `indicators` — it comes from the quote/fundamentals, not price history. */
  peRatio: number | null;
  /** The street: covered, genuinely uncovered, or the fetch failed. */
  consensus: ConsensusResult;
  /** His own target, if he set one, and how far away it is (a fraction). */
  targetPrice: number | null;
  distanceToTarget: number | null;
  /** His tags on the item — sector, style, whatever he chose. */
  tags: string[];
  note: string;
  /**
   * His whole closed-and-open trade history — the same list every candidate
   * carries, filtered down to this one ticker by `renderHistoryLines`. Not
   * pre-filtered per candidate because the filter is cheap and this keeps one
   * shared function doing the filtering, for the trade-idea prompt and this
   * one both.
   */
  trades: RecordTrade[];
}

/** e.g. 'strong_buy' -> 'Strong Buy'. */
const recLabel = (key: string | null): string =>
  key === null
    ? 'n/a'
    : key
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

/**
 * The street's view, rendered — or a plain statement of why it is missing.
 * The wording is load-bearing in both missing cases: it is what tells the
 * model (and, downstream, the reader) that this ticker is ranked on fewer
 * views than its neighbours, never that it scored a silent zero — and,
 * separately, that "unavailable" is a provider failure to weight as unknown,
 * never as "no coverage", which is a fact about the ticker rather than
 * about Yahoo's uptime.
 */
function renderStreet(c: ConsensusResult): string[] {
  if (c.status === 'unavailable') {
    return [
      'THE STREET (bought-in analyst consensus): view unavailable — the',
      'provider call failed, so this is not a resolved "no coverage".',
      'Treat this view as unknown, not as bearish, and say so if it',
      'matters to your ranking.',
    ];
  }

  if (c.status === 'no-coverage') {
    return [
      'THE STREET (bought-in analyst consensus): no analyst coverage — nobody',
      'covers this name. Treat this view as absent, not as bearish.',
    ];
  }

  const data = c.data;
  const lines = [
    'THE STREET (bought-in analyst consensus):',
    `  - Recommendation: ${recLabel(data.recommendationKey)} (mean ${
      data.recommendationMean === null ? 'n/a' : data.recommendationMean.toFixed(2)
    } on a 1=strong buy … 5=sell scale), from ${data.analystCount ?? 'n/a'} analysts`,
    `  - Price targets: mean ${level(data.targetMean)}, high ${level(data.targetHigh)}, low ${level(data.targetLow)}`,
    `  - Revenue growth: ${pct(data.revenueGrowth)} · earnings growth: ${pct(data.earningsGrowth)}`,
    `  - Profit margin: ${pct(data.profitMargin)} · return on equity: ${pct(data.returnOnEquity)}`,
  ];

  if (data.trend.length > 0) {
    const recent = data.trend.slice(0, 3);
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
function renderTape(i: IndicatorSet, peRatio: number | null): string[] {
  return [
    'THE TAPE (computed by the app from price history):',
    `  - P/E: ${peRatio !== null ? peRatio.toFixed(1) : 'n/a'}`,
    // Shared with the trade-idea prompt — see indicator-lines.ts — indented
    // here to sit under this header; the trade idea uses them unindented at
    // the top level of its own facts list.
    ...renderIndicatorLines(i).map((line) => `  ${line}`),
  ];
}

/**
 * Him, for this one ticker: how many times he has traded it, how those went,
 * and the setup/mistake tags he attached — the part `RANKING_SYSTEM_PROMPT`
 * asks for ("specifically his own history in the ticker being ranked, if he
 * has one") and that, before this, no candidate ever actually carried. Says
 * so plainly, in one line, when he never has; that absence is informative
 * too. Shared with `buildRecordSection`'s "My history in X" block via
 * `renderHistoryLines`, so the two descriptions of the same trades cannot
 * drift apart.
 */
function renderHistory(c: RankingCandidate): string[] {
  return ['MY HISTORY IN THIS TICKER:', ...renderHistoryLines(c.trades, c.symbol)];
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
    ...renderTape(c.indicators, c.peRatio),
    '',
    ...renderHistory(c),
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

You may use your own knowledge of a company and its sector when reconciling
the three views. Mark clearly anything you say that is not in the facts
above, and say when that knowledge may be out of date — you do not know
today's news.

OUTPUT CONTRACT — follow this exactly, it is parsed by code:

First, one block per candidate, in ranked order from best to worst:

[RANK]
SYMBOL: <the ticker symbol, exactly as given>
VERDICT: <one line, under 120 characters, the headline judgement>
COVERAGE: full | no-analyst-coverage | unavailable
[/RANK]

Repeat that block for every candidate — best first, worst last. COVERAGE is
"no-analyst-coverage" when THE STREET said no analyst covers that name,
"unavailable" when THE STREET said its view could not be fetched (a
provider failure, not a fact about the ticker), and "full" otherwise.

After every [RANK] block, write your reasoning as plain paragraphs,
referencing tickers by symbol. This is where the reconciliation lives: say
where the three views agreed, where they clashed, and which you weighted and
why — especially anywhere his own record pulls against the street or the
tape. Do not repeat the verdict lines verbatim; the paragraphs are the case
for them.`;
