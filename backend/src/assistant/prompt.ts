/**
 * The text the owner pastes into his Gemini conversation when Trader cannot
 * answer by itself. Minimal by design — prompt content is a later session
 * (docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
export function buildPrompt(input: {
  message: string;
  date: string;
  holdings: { symbol: string; direction: 'LONG' | 'SHORT' }[];
  watchlist: string[];
}): string {
  const holdings = input.holdings.length
    ? input.holdings.map((h) => `${h.symbol} (${h.direction.toLowerCase()})`).join(', ')
    : 'none';
  const watchlist = input.watchlist.length ? input.watchlist.join(', ') : 'none';
  return [
    `Date: ${input.date}`,
    '',
    `My holdings: ${holdings}`,
    `My watchlist: ${watchlist}`,
    '',
    'My question:',
    input.message,
  ].join('\n');
}
