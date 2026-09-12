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
 * throw, and must never hang: a model that rambles, truncates a block,
 * leaves a `[RANK]` unclosed before starting the next one, or repeats
 * `[RANK]` many times with no closing tag anywhere (a real repetition
 * failure mode, not a hypothetical one) is a routine outcome the caller can
 * show as "no ranking yet" — not a 500, and not a stalled process, since
 * Node is single-threaded and a slow parse here blocks every other request
 * on the API, not just the one that triggered it.
 */
export interface RankedTicker {
  symbol: string;
  verdict: string;
  /**
   * What the model was told about this ticker's analyst view:
   * genuinely uncovered, or the fetch itself failed. Anything else the
   * model writes — including a typo or an omission — is treated as `full`,
   * the same as the two-value parser did before this existed.
   */
  coverage: 'full' | 'no-analyst-coverage' | 'unavailable';
}

export interface ParsedRanking {
  order: RankedTicker[];
  /** Everything outside the [RANK] blocks — the reasoning, verbatim. */
  reasoning: string;
  /** Candidates the model failed to rank. Never silently dropped. */
  missing: string[];
}

const OPEN_TAG = '[RANK]';
const CLOSE_TAG = '[/RANK]';

/**
 * Every position of a literal tag, left to right, found with plain
 * `indexOf` rather than a regex over `[\s\S]*?`. That lazy quantifier was
 * the original implementation, and it back-tracks: on a run of `[RANK]`
 * tags with no `[/RANK]` anywhere, every attempt rescans forward to the end
 * of the remaining text before failing, which is quadratic in the length of
 * the input. `indexOf` cannot do that — each call's search start strictly
 * advances past the previous match, so the total work across every call in
 * this loop is bounded by the length of `text` once, however many or few
 * tags it contains.
 */
function findAll(text: string, tag: string): number[] {
  const positions: number[] = [];
  let i = text.indexOf(tag);
  while (i !== -1) {
    positions.push(i);
    i = text.indexOf(tag, i + tag.length);
  }
  return positions;
}

function readField(source: string, label: string): string | null {
  const match = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(source);
  return match ? match[1].trim() : null;
}

export function parseRanking(text: string, expected: string[]): ParsedRanking {
  const expectedSet = new Set(expected);
  const order: RankedTicker[] = [];
  const seen = new Set<string>();

  const opens = findAll(text, OPEN_TAG);
  const closes = findAll(text, CLOSE_TAG);

  let lastBlockEnd = 0;
  let oi = 0;
  let ci = 0;

  // Two pointers, each only ever advancing — never rescanning territory
  // already ruled out — so this loop is linear in opens.length +
  // closes.length regardless of how the tags are arranged.
  while (oi < opens.length) {
    const bodyStart = opens[oi] + OPEN_TAG.length;

    // Skip past any close tag that sits before this block's own start —
    // left over from a stray `[/RANK]` with no matching open.
    while (ci < closes.length && closes[ci] < bodyStart) ci++;

    if (ci >= closes.length) break; // no close left anywhere; nothing further can match.

    const closePos = closes[ci];

    // If the NEXT open tag falls before this close, the model started a
    // new block without ever closing the current one. The regex this
    // replaces would have kept scanning to that later `[/RANK]` and treated
    // the whole merged span as the outer block's body — which reads the
    // outer block's own SYMBOL/VERDICT (first match wins) but the INNER
    // block's COVERAGE (the only COVERAGE line in the merged span),
    // silently attributing one candidate's coverage flag to another.
    // Reject the outer, unclosed block outright rather than guess at its
    // boundary: it falls through to `missing`, and not-ranked beats
    // ranked-with-a-borrowed-field.
    if (oi + 1 < opens.length && opens[oi + 1] < closePos) {
      oi++;
      continue;
    }

    const body = text.slice(bodyStart, closePos);
    const symbol = readField(body, 'SYMBOL');
    const verdict = readField(body, 'VERDICT');
    const coverage = readField(body, 'COVERAGE');

    if (
      symbol !== null &&
      verdict !== null &&
      expectedSet.has(symbol) &&
      !seen.has(symbol)
    ) {
      seen.add(symbol);
      const coverageValue = coverage?.toLowerCase();
      order.push({
        symbol,
        verdict,
        coverage:
          coverageValue === 'no-analyst-coverage' || coverageValue === 'unavailable'
            ? coverageValue
            : 'full',
      });
    }

    lastBlockEnd = closePos + CLOSE_TAG.length;
    oi++;
    ci++;
  }

  // Everything after the last recognised block is the shared reasoning. If
  // no block was recognised at all, the whole text is unparseable prose —
  // none of it is reasoning worth keeping, so it degrades to empty rather
  // than dumping the model's raw ramble where a caller expects a verdict.
  const reasoning = lastBlockEnd > 0 ? text.slice(lastBlockEnd).trim() : '';

  const missing = expected.filter((symbol) => !seen.has(symbol));

  return { order, reasoning, missing };
}
