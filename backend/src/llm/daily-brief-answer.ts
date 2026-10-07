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

const SUMMARY = /^\s*\**\s*SUMMARY\s*:\s*\**\s*/i;
const THESIS = /^\s*\**\s*THESIS\s+([A-Za-z0-9.^-]+)\s*:\s*\**\s*(.*)$/i;

export function parseDailyBriefAnswer(text: string, moverSymbols: readonly string[]): DailyBriefAnswer {
  const bySymbol = new Map(moverSymbols.map((s) => [s.toUpperCase(), s]));
  const thesis: Record<string, string> = {};
  const summaryLines: string[] = [];
  let inThesis = false;

  for (const line of text.split('\n')) {
    const match = THESIS.exec(line);
    if (match) {
      inThesis = true;
      const symbol = bySymbol.get(match[1].toUpperCase());
      const body = match[2].trim();
      if (symbol && body && !(symbol in thesis)) thesis[symbol] = body;
      continue;
    }
    if (!inThesis) summaryLines.push(line.replace(SUMMARY, ''));
  }

  const summary = summaryLines.join('\n').trim();
  return { summary: summary === '' ? null : summary, thesis };
}
