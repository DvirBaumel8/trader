/**
 * The Daily Brief's user turn: an instruction plus the facts block from
 * daily-brief-context.ts. Shares prompts.ts's system role (same trader,
 * same "never invent a number" discipline). Asks for ONE answer in a small
 * tagged format that daily-brief-answer.ts parses: a summary, then one
 * thesis line per mover — one model call for the whole brief.
 */
export function buildDailyBriefUserPrompt(factsBlock: string, moverSymbols: readonly string[]): string {
  const thesisSpec =
    moverSymbols.length === 0
      ? ''
      : `

Then, for each mover, one line weighing MY entry note and reasons against
the move and its headline: does my original thesis still hold, is it in
question, or is the move unrelated to why I entered? One sentence each,
only for these symbols, in this order:
${moverSymbols.map((s) => `THESIS ${s}: <one sentence>`).join('\n')}`;

  return `Turn today's brief into a short, prioritized read — not a list read
back to me, a judgement about what actually matters.

Start with a line beginning "SUMMARY:" — lead with the single fact most
worth my attention right now (something in Needs attention first, if
anything is there), and only if it adds something the facts alone do not,
connect two facts. One or two sentences.${thesisSpec}

If the market session is CLOSED, the moves and headlines are from the
last session — do not call them "today".

${factsBlock}`;
}
