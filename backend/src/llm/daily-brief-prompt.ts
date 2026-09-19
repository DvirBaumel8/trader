/**
 * The Daily Brief's user turn: an instruction plus the facts block from
 * daily-brief-context.ts. Shares prompts.ts's system role (same trader,
 * same "never invent a number" discipline) — only the instruction and the
 * facts differ from the portfolio summary.
 */
export function buildDailyBriefUserPrompt(factsBlock: string): string {
  return `Turn today's brief into a short, prioritized read — not a list read
back to me, a judgement about what actually matters today.

Lead with whichever single fact is most worth my attention right now — a
notable move, an earnings date, an economic event, or the absence of
anything urgent. Then, only if it adds something the facts alone do not,
connect two facts together (e.g. a position with a notable move and no
stop protecting it). Skip anything that does not change what I would do
today. Two or three sentences, not a paragraph.

${factsBlock}`;
}
