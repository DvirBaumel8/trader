import type { SymbolPatternFacts } from './symbol-pattern-context.js';
import { renderHistoryLines } from './trade-idea-context.js';

const RANGE_LABELS: Record<string, string> = {
  '1W': 'the past week',
  '1M': 'the past month',
  '6M': 'the past 6 months',
  YTD: 'this year',
  '1Y': 'the past year',
  ALL: 'his entire history',
};

const money = (n: number | null): string =>
  n === null
    ? 'n/a'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });

const pct = (n: number | null): string => (n === null ? 'n/a' : `${(n * 100).toFixed(0)}%`);

const days = (n: number | null): string => (n === null ? 'n/a' : `${n.toFixed(1)} days`);

const rMultiple = (n: number | null): string => (n === null ? 'n/a' : `${n.toFixed(2)}R`);

function statLines(label: string, s: SymbolPatternFacts['thisName'] | SymbolPatternFacts['overall']): string[] {
  return [
    `${label}:`,
    `- Closed trades: ${s.closedCount}`,
    `- Win rate: ${pct(s.winRate)}`,
    `- Average win: ${money(s.avgWin)} · average loss: ${money(s.avgLoss)}`,
    `- Expectancy: ${rMultiple(s.expectancyR)}`,
    `- Average risk per trade: ${money(s.avgRisk)}`,
    `- Average position size: ${money(s.avgPositionSize)}`,
    `- Average hold time: ${days(s.avgHoldingDays)}`,
  ];
}

/**
 * A retrospective read of how he actually trades one name — never a buy/sell
 * opinion, which is what Trade Idea is for. The comparison against his own
 * overall record over the SAME window is the point: a number for this name
 * alone doesn't say whether it's typical or not.
 */
export function buildSymbolPatternPrompt(
  facts: SymbolPatternFacts,
  profileText?: string | null,
): { system: string; user: string } {
  const system = `You are a trading pattern analyst reviewing how an experienced swing trader has actually traded ONE ticker, compared to his own overall record.

CRITICAL:
- Do NOT give a buy/sell opinion or recommend any action on this ticker. That question belongs to a different tool. Describe patterns in his past behavior only.
- NEVER invent, recompute, or round a number yourself. Quote figures only from the facts given below.
- The comparison between "this name" and his "overall record over the same period" is the actual answer — lead with whatever differs most, not a restatement of both lists.
- If the sample in this name is very small (one or two trades), say so plainly rather than stretching a firm conclusion from it.
- If you mention anything about the company or ticker beyond what is in the facts below, mark it clearly as your own knowledge and say it may be out of date — you do not know today's news.

OUTPUT FORMAT:
Start your response with this exact metadata block on the first lines:
[PATTERN_META]
HEADLINE: <one sentence, under 15 words, the single most notable pattern or its absence>
[/PATTERN_META]

Follow with a short, punchy read for a phone screen (3-5 short paragraphs, no headers needed) covering, in whatever order the evidence supports:
1. How trading this name compares to his overall record over the same window — hold time, win rate, position size, risk taken.
2. Any setup or mistake tag that recurs specifically in this name.
3. Anything his own notes on these trades repeat.
4. Whether what he actually does here matches or contradicts what his stated trading profile says about himself.`;

  const userLines = [
    `FACTS about my trading in ${facts.symbol}, over ${RANGE_LABELS[facts.range] ?? facts.range} — computed by the app, quote these, do not recalculate`,
    '',
    ...statLines(`THIS NAME (${facts.symbol})`, facts.thisName),
    `- Total P&L: ${money(facts.thisName.totalPnl)}`,
    `- Fees paid: ${money(facts.thisName.feesPaid)}`,
    '',
    ...statLines('OVERALL, SAME WINDOW (every symbol)', facts.overall),
    '',
    ...renderHistoryLines(facts.trades, facts.symbol),
  ];

  if (facts.notes.length > 0) {
    userLines.push('', `My own notes on ${facts.symbol} trades:`);
    facts.notes.forEach((n) => userLines.push(`> "${n}"`));
  }

  if (profileText) {
    userLines.push('', '---', 'MY STATED TRADING PROFILE:', profileText.slice(0, 1200));
  }

  return { system, user: userLines.join('\n') };
}
