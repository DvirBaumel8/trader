/**
 * Reads the model's answer against the contract fixed in
 * `RANKING_SYSTEM_PROMPT`'s OUTPUT CONTRACT: one `[RANK]` … `[/RANK]` block
 * per candidate, in ranked order, each carrying `SYMBOL:`, `VERDICT:` and
 * `COVERAGE:` — followed by the reasoning as plain paragraphs after all of
 * the blocks, one shared block of prose rather than one per ticker.
 *
 * Modelled on `trade-idea-parse.ts`: forgiving about presentation, strict
 * about substance. Here "strict about substance" means never inventing a
 * ranking out of prose that does not fit the shape — a block that cannot be
 * read is a missing candidate, not a guessed one. This file must never
 * throw: a model that rambles, truncates a block, or invents a symbol is a
 * routine outcome the caller can show as "no ranking yet", not a 500.
 */
export interface RankedTicker {
  symbol: string;
  verdict: string;
  /** True when the model was told this ticker has no analyst coverage. */
  noAnalystCoverage: boolean;
}

export interface ParsedRanking {
  order: RankedTicker[];
  /** Everything outside the [RANK] blocks — the reasoning, verbatim. */
  reasoning: string;
  /** Candidates the model failed to rank. Never silently dropped. */
  missing: string[];
}

/** Non-greedy: stops at the first [/RANK], so one truncated block does not
 * swallow every block after it. */
const RANK_BLOCK = /\[RANK\]([\s\S]*?)\[\/RANK\]/g;

function readField(source: string, label: string): string | null {
  const match = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(source);
  return match ? match[1].trim() : null;
}

export function parseRanking(text: string, expected: string[]): ParsedRanking {
  const expectedSet = new Set(expected);
  const order: RankedTicker[] = [];
  const seen = new Set<string>();

  let lastBlockEnd = 0;
  let match: RegExpExecArray | null;
  RANK_BLOCK.lastIndex = 0;
  while ((match = RANK_BLOCK.exec(text)) !== null) {
    lastBlockEnd = RANK_BLOCK.lastIndex;

    const body = match[1];
    const symbol = readField(body, 'SYMBOL');
    const verdict = readField(body, 'VERDICT');
    const coverage = readField(body, 'COVERAGE');

    if (symbol === null || verdict === null) continue;
    if (!expectedSet.has(symbol)) continue;
    if (seen.has(symbol)) continue;

    seen.add(symbol);
    order.push({
      symbol,
      verdict,
      noAnalystCoverage: coverage?.toLowerCase() === 'no-analyst-coverage',
    });
  }

  // Everything after the last recognised block is the shared reasoning. If
  // no block was found at all, the whole text is unparseable prose — none
  // of it is reasoning worth keeping, so it degrades to empty rather than
  // dumping the model's raw ramble where a caller expects a verdict.
  const reasoning = lastBlockEnd > 0 ? text.slice(lastBlockEnd).trim() : '';

  const missing = expected.filter((symbol) => !seen.has(symbol));

  return { order, reasoning, missing };
}
