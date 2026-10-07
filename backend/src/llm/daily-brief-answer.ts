/**
 * Reads the Daily Brief's one model answer: a SUMMARY plus one THESIS line
 * per mover. Pure and forgiving — a model that ignores the format still
 * yields its prose as the summary, and a thesis line for a symbol that is
 * not a mover is dropped rather than shown, so the model can never attach
 * an opinion to a position the app did not put in front of it.
 */
export interface DailyBriefAnswer {
  summary: string | null;
  thesis: Record<string, string>;
}

const SUMMARY = /^\s*(?:[-*•]\s+)?\**\s*SUMMARY\s*\**\s*:\s*\**\s*/i;
const THESIS = /^\s*(?:[-*•]\s+)?\**\s*THESIS\s+\**([A-Za-z0-9.^-]+)\**\s*:\s*\**\s*(.*)$/i;
const SHOUTED_THESIS = /^\s*(?:[-*•]\s+)?\**\s*THESIS\s+\**[A-Z0-9.^-]+\**\s*:/;
/** Drops a trailing bold marker only when it is unbalanced (an opener we already consumed). */
const stripTrailingBold = (text: string) =>
  ((text.match(/\*\*/g) ?? []).length % 2 === 1 ? text.replace(/\**\s*$/, '') : text).trim();

export function parseDailyBriefAnswer(text: string, moverSymbols: readonly string[]): DailyBriefAnswer {
  const bySymbol = new Map(moverSymbols.map((s) => [s.toUpperCase(), s]));
  const thesis: Record<string, string> = {};
  const summaryLines: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = THESIS.exec(line);
    if (match) {
      const symbol = bySymbol.get(match[1].toUpperCase());
      if (symbol) {
        const body = stripTrailingBold(match[2]);
        if (body && !(symbol in thesis)) thesis[symbol] = body;
        continue;
      }
      // A shouted "THESIS XYZ:" tag for a non-mover is an invented opinion:
      // drop it. Anything else ("Thesis check: ...") is ordinary prose.
      if (SHOUTED_THESIS.test(line)) continue;
    }
    summaryLines.push(stripTrailingBold(line.replace(SUMMARY, '')));
  }

  const summary = summaryLines.join('\n').trim();
  return { summary: summary === '' ? null : summary, thesis };
}
