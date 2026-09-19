/**
 * Assembles the facts block the model reads for the Daily Brief narrative.
 * Every line is quoted straight from the already-computed notes/coverage
 * DailyBriefService produces — nothing here recalculates a figure, in the
 * same spirit as portfolio-context.ts. Pure and dependency-free so it is
 * covered by fixture-driven tests; the caller is the only place that
 * touches I/O.
 */

export interface ContextNote {
  source: 'PORTFOLIO' | 'WATCHLIST' | 'MARKET';
  title: string;
  detail: string;
}

export interface ContextCoverage {
  source: 'PORTFOLIO' | 'WATCHLIST';
  symbol: string;
  price: number | null;
  regularPrice: number | null;
  stale: boolean;
  session: 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED' | null;
  extended: boolean;
}

export interface DailyBriefContextInput {
  generatedAt: string;
  notes: ContextNote[];
  coverage: ContextCoverage[];
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function coverageLine(item: ContextCoverage): string {
  if (item.price === null) {
    return `[${item.source}] ${item.symbol}: price unavailable${item.stale ? ' (stale)' : ''}`;
  }
  const parts = [money(item.price)];
  if (item.stale) parts.push('(stale)');
  else if (item.extended)
    parts.push(
      `(after-hours/overnight print${item.regularPrice !== null ? `, regular close ${money(item.regularPrice)}` : ''})`,
    );
  return `[${item.source}] ${item.symbol}: ${parts.join(' ')}`;
}

export function buildDailyBriefContext(input: DailyBriefContextInput): string {
  const lines: string[] = [];

  lines.push(`FACTS (daily brief as of ${input.generatedAt}, computed by the app — quote these, do not recalculate)`);
  lines.push('');

  lines.push('Notable events today');
  if (input.notes.length === 0) {
    lines.push('- No notable events today.');
  } else {
    for (const note of input.notes) {
      lines.push(`- [${note.source}] ${note.title}: ${note.detail}`);
    }
  }
  lines.push('');

  lines.push('Current coverage');
  if (input.coverage.length === 0) {
    lines.push('- No portfolio or watchlist tickers covered.');
  } else {
    for (const item of input.coverage) {
      lines.push(`- ${coverageLine(item)}`);
    }
  }

  return lines.join('\n');
}
