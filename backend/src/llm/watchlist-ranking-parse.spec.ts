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
    expect(r.order[1].noAnalystCoverage).toBe(true);
    expect(r.order[0].noAnalystCoverage).toBe(false);
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

  it('treats an unrecognised COVERAGE value as full rather than throwing', () => {
    const weird = `
[RANK]
SYMBOL: PLTR
VERDICT: fine
COVERAGE: sort-of
[/RANK]
`;
    const r = parseRanking(weird, ['PLTR']);
    expect(r.order[0].noAnalystCoverage).toBe(false);
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
    ]) {
      expect(RANKING_SYSTEM_PROMPT).toContain(token);
    }
  });
});
