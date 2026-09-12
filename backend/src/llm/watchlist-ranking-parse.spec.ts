import { describe, expect, it } from 'vitest';
import { parseRanking } from './watchlist-ranking-parse.js';
import { RANKING_SYSTEM_PROMPT } from './watchlist-ranking-prompt.js';

const answer = `
[RANK]
SYMBOL: PLTR
VERDICT: Nearest a breakout with the street behind it.
COVERAGE: full
[/RANK]
[RANK]
SYMBOL: SPY
VERDICT: Steady, but nothing here is a setup you trade.
COVERAGE: no-analyst-coverage
[/RANK]

### Why
PLTR sits 3% under its high while you are already long two semis.
`;

describe('parseRanking', () => {
  it('reads the order the model gave, not alphabetical or input order', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order.map((t) => t.symbol)).toEqual(['PLTR', 'SPY']);
  });

  it('keeps each verdict', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order[0].verdict).toContain('breakout');
  });

  it('flags the ticker the model was told has no coverage', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order[1].coverage).toBe('no-analyst-coverage');
    expect(r.order[0].coverage).toBe('full');
  });

  it('flags a ticker the model was told the street view was unavailable', () => {
    const withUnavailable = `
[RANK]
SYMBOL: PLTR
VERDICT: Fine on the tape, street view unavailable.
COVERAGE: unavailable
[/RANK]
`;
    const r = parseRanking(withUnavailable, ['PLTR']);
    expect(r.order[0].coverage).toBe('unavailable');
  });

  it('keeps the reasoning outside the blocks, verbatim', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.reasoning).toContain('already long two semis');
    expect(r.reasoning).not.toContain('[RANK]');
  });

  /**
   * A candidate the model dropped is REPORTED, not quietly absent. A ranking
   * that silently covers part of the list is the failure the fifty-ticker cap
   * exists to prevent; it must not reappear here.
   */
  it('reports a candidate the model failed to rank', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR', 'AMD']);
    expect(r.missing).toEqual(['AMD']);
  });

  it('ignores a symbol the model invented', () => {
    const r = parseRanking(answer, ['PLTR']);
    expect(r.order.map((t) => t.symbol)).toEqual(['PLTR']);
  });

  it('returns an empty order rather than throwing on unparseable text', () => {
    const r = parseRanking('the model rambled', ['NVDA']);
    expect(r.order).toEqual([]);
    expect(r.missing).toEqual(['NVDA']);
  });

  it('does not throw on a block missing its closing delimiter', () => {
    const truncated = `
[RANK]
SYMBOL: PLTR
VERDICT: cut off mid
`;
    expect(() => parseRanking(truncated, ['PLTR'])).not.toThrow();
  });

  /**
   * The lazy-regex predecessor of this parser stopped at the FIRST
   * `[/RANK]` it found — which, when A never got a closing tag of its own,
   * is B's. The merged span then read A's own SYMBOL/VERDICT (first match
   * wins) but B's COVERAGE (the only COVERAGE line in the merged body),
   * silently attributing B's coverage flag to A. A must instead be rejected
   * outright and reported in `missing`: not ranked beats ranked wrongly.
   */
  it('rejects a block left unclosed when the next one opens, rather than borrowing its neighbor’s fields', () => {
    const adjacent = `
[RANK]
SYMBOL: A
VERDICT: foo
[RANK]
SYMBOL: B
VERDICT: bar
COVERAGE: no-analyst-coverage
[/RANK]
`;
    const r = parseRanking(adjacent, ['A', 'B']);
    expect(r.order).toEqual([
      { symbol: 'B', verdict: 'bar', coverage: 'no-analyst-coverage' },
    ]);
    expect(r.missing).toEqual(['A']);
  });

  /**
   * A real LLM failure mode is repetition: the model gets stuck emitting
   * the same opening tag over and over with no closing tag ever. The
   * original `[\s\S]*?` regex rescanned to the end of the remaining text on
   * every such attempt — quadratic in input length, and since Node is
   * single-threaded, a hang here stalls the whole API. This asserts the
   * linear-scan replacement stays fast on exactly that input.
   */
  it('parses a long run of unclosed [RANK] tags quickly, not quadratically', () => {
    const unit = '[RANK]\n';
    const degenerate = unit.repeat(Math.ceil(200_000 / unit.length));

    const start = Date.now();
    const r = parseRanking(degenerate, ['NVDA']);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(500);
    expect(r.order).toEqual([]);
    expect(r.missing).toEqual(['NVDA']);
  });

  it('treats an unrecognised COVERAGE value as full rather than throwing', () => {
    const weird = `
[RANK]
SYMBOL: PLTR
VERDICT: fine
COVERAGE: sort-of
[/RANK]
`;
    const r = parseRanking(weird, ['PLTR']);
    expect(r.order[0].coverage).toBe('full');
  });

  it('returns an empty order and no throw on an empty string', () => {
    const r = parseRanking('', ['NVDA']);
    expect(r.order).toEqual([]);
    expect(r.missing).toEqual(['NVDA']);
    expect(r.reasoning).toBe('');
  });

  /**
   * This parser is written against a format defined in prose inside another
   * file's string constant, not against a shared schema either file imports.
   * Someone editing that prompt's wording could break this parser with no
   * test failing anywhere — the prompt's own tests only check its
   * instructions, and this parser's own tests only check its sample input.
   * This test is the seam between them: it pins the literal tokens the regex
   * above depends on, so an edit that drops or renames one of them fails
   * here instead of silently in production.
   */
  it('depends on tokens that are still present in the ranking prompt', () => {
    for (const token of [
      '[RANK]',
      '[/RANK]',
      'SYMBOL:',
      'VERDICT:',
      'COVERAGE:',
      'full',
      'no-analyst-coverage',
      'unavailable',
    ]) {
      expect(RANKING_SYSTEM_PROMPT).toContain(token);
    }
  });
});
