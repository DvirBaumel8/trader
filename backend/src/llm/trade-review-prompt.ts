import type { TradeReviewFacts } from './trade-review-context.js';

export function buildTradeReviewPrompt(
  facts: TradeReviewFacts,
  profileText?: string | null,
): { system: string; user: string } {
  const fmtMoney = (n: number | null) =>
    n === null
      ? 'n/a'
      : n.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  const fmtPct = (n: number | null) =>
    n === null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  const system = `You are an elite trading performance psychologist and discipline coach reviewing the post-mortem of a completed trade for an experienced swing trader.

The trader's core philosophy (Minervini / CANSLIM growth-breakout style):
- Breakout entries with volume confirmation on daily charts.
- Mandatory stop recorded at entry to define 1R risk.
- Trailing stops upward as the trade moves in favor.
- Scaling out into strength at predefined targets or trailing stop triggers.
- Known self-identified weaknesses to watch for: shorts perform poorly, high conviction leads to over-sizing, and on favorite trades, stops are sometimes neglected or widened.

CRITICAL DIRECTIVE:
Evaluate PROCESS AND EXECUTION DISCIPLINE above all else.
- A losing trade that respected the initial stop at -1.0R is a GRADE A or B trade (flawless execution of a statistical edge; taking losses small and fast is victory in trading).
- A winning trade that violated rules (e.g. removed stop, held through catastrophic drawdown, or oversized recklessly) is a POOR DISCIPLINE trade that got lucky.
- NEVER invent numbers, dates, or calculations. Quote only the facts given below.

DISCIPLINE SCORING RUBRIC:
- Grade A: Pristine discipline. Stop recorded at entry, honored cleanly upon hit OR trailed methodically into profit; zero rule violations.
- Grade B: Good discipline with minor friction (e.g. minor execution hesitation, slight slippage on exit, or minor profit giveback).
- Grade C: Mixed execution. Flawed discipline (e.g. delayed stop entry, entered without volume, or failed to scale out into targets).
- Grade D: Severe rule breach. Stop was widened/lowered, loss extended noticeably beyond planned 1R risk, or traded impulsively.
- Grade F: Catastrophic discipline failure. Removed stop, let a swing trade turn into an uncontrolled hope trade, or oversized without a risk plan.

OUTPUT FORMAT:
Start your response with this exact metadata block on the first lines:
[REVIEW_META]
SCORE: <A | B | C | D | F>
VERDICT: <4 to 8 words summarizing the execution discipline>
[/REVIEW_META]

Follow immediately with a concise, punchy post-mortem written for a phone screen using these exact markdown headers:
### Process vs Outcome
(Evaluate whether the result was good process vs luck. Contrast the P&L with the execution quality.)

### Stop & Risk Discipline
(Analyze the initial stop, trailing actions, slippage, and whether the planned 1R risk boundary was respected.)

### Trade Management & Execution
(Comment on entry timing/volume, scale-out execution, MFE captured vs given back, and any tagged mistakes or notes.)

### Actionable Takeaway
(Exactly 1 concrete, non-generic lesson to carry into the next trade.)`;

  const userLines = [
    `FACTS for Post-Mortem Review: ${facts.symbol} (${facts.direction} · ${facts.status})`,
    '',
    `- Entered: ${facts.enteredAt}`,
    `- Exited: ${facts.exitedAt ?? 'Still open / partially open'}`,
    `- Holding Period: ${facts.holdingDays !== null ? `${facts.holdingDays} days` : 'n/a'}`,
    `- Total Position: ${facts.quantity.toLocaleString()} shares`,
    `- Average Entry: ${fmtMoney(facts.avgEntry)}`,
    `- Average Exit: ${fmtMoney(facts.avgExit)}`,
    `- Realized P&L: ${fmtMoney(facts.realizedPnl)} (${fmtPct(facts.realizedPnlPercent)})`,
    `- Realized R-Multiple: ${facts.rMultiple !== null ? `${facts.rMultiple.toFixed(2)}R` : 'n/a'}`,
    '',
    'STOP & RISK PLAN ADHERENCE:',
    `- Initial Stop Recorded at Entry: ${facts.hadInitialStop ? `YES, at ${fmtMoney(facts.initialStopPrice)}` : 'NO STOP RECORDED AT ENTRY (Rule violation)'}`,
    `- Initial 1R Risk per share: ${fmtMoney(facts.initialRiskPerShare)} (${fmtPct(facts.initialRiskPercent)} from entry)`,
    `- Planned Target: ${facts.plannedTarget !== null ? fmtMoney(facts.plannedTarget) : 'None recorded'}`,
    `- Stop Trailed Favorable: ${facts.stopTrailedFavorable ? 'YES (Trailed up defensively)' : 'No trailing recorded'}`,
    `- Stop Widened / Lowered Against Trade: ${facts.stopWidenedOrMovedAgainst ? 'YES (CRITICAL RULE BREACH: stop was loosened)' : 'NO (Stops were not widened)'}`,
    `- Execution Slippage on Stop Exits: ${facts.stopSlippageTotal !== null ? `${fmtMoney(facts.stopSlippageTotal)} total (${fmtMoney(facts.stopSlippagePerShare)} / share)` : 'None or not stopped out'}`,
    '',
    'PRICE EXCURSION & VOLUME:',
    `- Entry Relative Volume: ${facts.entryRelativeVolume !== null ? `${facts.entryRelativeVolume.toFixed(2)}x 20-day average` : 'n/a'}`,
    `- High Water Mark (MFE): ${fmtMoney(facts.highWaterPrice)} (Peak favorable move: ${fmtPct(facts.mfeGainPercent)})`,
    '',
    'EXIT BREAKDOWN:',
    `- Stopped Out Shares: ${facts.exitKinds.stopShares.toLocaleString()}`,
    `- Target Exit Shares: ${facts.exitKinds.targetShares.toLocaleString()}`,
    `- Discretionary Exits: ${facts.exitKinds.discretionaryShares.toLocaleString()}`,
  ];

  if (facts.setups.length > 0) {
    userLines.push(`- Setups tagged: ${facts.setups.join(', ')}`);
  }
  if (facts.mistakes.length > 0) {
    userLines.push(`- Mistakes tagged by trader: ${facts.mistakes.join(', ')}`);
  }
  if (facts.notes.length > 0) {
    userLines.push('', 'Trader Notes during trade:');
    facts.notes.forEach((note) => userLines.push(`> "${note}"`));
  }

  if (profileText) {
    userLines.push('', '---', 'TRADER BACKGROUND CONTEXT:', profileText.slice(0, 1200));
  }

  return { system, user: userLines.join('\n') };
}
