import type { TickerFacts } from '../market-data/ticker-facts.service.js';

/**
 * The user turn for a pre-trade opinion: the facts the app computed, then the
 * ask.
 *
 * Kept separate from the system prompt (which carries the analyst role and the
 * owner's trading profile) so the wording can be iterated without touching
 * anything that could change behaviour by accident — the same split
 * `prompts.ts` uses for the portfolio summary.
 *
 * The instruction is explicit that the model must NOT compute a ratio, a
 * position size or any dollar figure. It proposes two levels; the app derives
 * everything else from them. That division is the whole reason this feature
 * can be trusted with money.
 */
export function buildTradeIdeaPrompt(
  facts: TickerFacts,
  usualRisk: number | null,
  context?: { book: string; record: string },
): string {
  const i = facts.indicators;
  const price = (n: number) =>
    n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const pct = (n: number | null) =>
    n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
  const level = (n: number | null) => (n === null ? 'n/a' : price(n));

  const lines = [
    `FACTS about ${facts.symbol}${facts.name ? ` (${facts.name})` : ''} — computed by the app, quote these, do not recalculate`,
    '',
    `- Price now: ${price(facts.price)}${facts.extended ? ' (extended-hours print)' : ''}`,
    `- P/E: ${facts.peRatio !== null ? facts.peRatio.toFixed(1) : 'n/a'}`,
    `- 20-day average: ${level(i.sma20)} (price is ${pct(i.percentFromSma20)} from it)`,
    `- 50-day average: ${level(i.sma50)} (price is ${pct(i.percentFromSma50)} from it)`,
    `- 200-day average: ${level(i.sma200)} (price is ${pct(i.percentFromSma200)} from it)`,
    `- 52-week high: ${level(i.high52w)} (price is ${pct(i.percentFromHigh52w)} from it)`,
    `- 52-week low: ${level(i.low52w)} (price is ${pct(i.percentFromLow52w)} from it)`,
    `- ATR(14): ${level(i.atr14)}${i.atrPercentOfPrice !== null ? ` — ${(i.atrPercentOfPrice * 100).toFixed(1)}% of price` : ''}`,
    `- Volume today: ${i.relativeVolume !== null ? `${i.relativeVolume.toFixed(2)}x its 20-day average` : 'n/a'}`,
    `- History available: ${i.barsAvailable} daily bars`,
  ];

  // How it has actually traded, not just where it sits. "Up 8% today off the
  // low" and "flat all week" are different trades at the same distance from
  // the 20-day average, and the indicators above cannot tell them apart.
  const a = facts.priceAction;
  if (a) {
    lines.push(
      `- Today (${a.today.date}): ${pct(a.today.changePercent)} vs the previous close, open ${level(a.today.open)}, high ${level(a.today.high)}, low ${level(a.today.low)}`,
      `- Past ${a.week.sessions} sessions: ${pct(a.week.changePercent)}, ranging ${level(a.week.low)} to ${level(a.week.high)}`,
      '',
      'Last 10 sessions (oldest first) — date, open, high, low, close, volume:',
      ...a.recent.map(
        (b) =>
          `  ${b.date}  ${level(b.open)}  ${level(b.high)}  ${level(b.low)}  ${price(b.close)}  ${b.volume === null ? 'n/a' : b.volume.toLocaleString('en-US')}`,
      ),
    );
  }

  if (usualRisk !== null) {
    lines.push(
      `- For context, my average risk per trade across my own closed history is ${price(usualRisk)}. Do NOT size the position — the app does that from your stop.`,
    );
  }

  return `I am thinking about buying ${facts.symbol} at the current price. Tell me what you actually think.

Answer three things, in this order:
1. Does this fit the way I trade? Use my profile above — my setups, my rules,
   my stated weaknesses — AND my book and my record below. If I already hold
   this name, the question is whether to add, hold or trim, not whether to
   open it. Judge it against what I am already carrying, including anything
   in the same theme.
2. Is this stock worth buying right now? Trend, momentum, where price sits,
   and the business itself.
3. Is the risk/reward worth taking?

You may use your own knowledge of the company and its sector. Mark clearly
anything that is not in the facts below, and say when your knowledge may be
out of date — you do not know today's news.

State no figure about price, volume or valuation that is not in the facts
below. Do NOT compute a risk/reward ratio, a position size, or any dollar
amount: propose the levels and the app will do that arithmetic.

If this is a bad idea, say so plainly in the first sentence.

End your answer with exactly this block and nothing after it:

LEVELS
stop: <price>
target: <price>

${lines.join('\n')}
${context ? `\n${context.book}\n\n${context.record}\n` : ''}`;
}
