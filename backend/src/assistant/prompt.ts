/**
 * The text the owner pastes into his Gemini conversation when Trader cannot
 * answer by itself. Minimal by design — prompt content is a later session
 * (docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-28 → Oct 28, 2026 */
function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function buildPrompt(input: {
  message: string;
  /** New York calendar date, YYYY-MM-DD (see etDate). */
  date: string;
  holdings: string[];
  watchlist: string[];
}): string {
  const holdings = input.holdings.length ? input.holdings.join(', ') : 'none';
  const watchlist = input.watchlist.length ? input.watchlist.join(', ') : 'none';
  return [
    `Date: ${formatDate(input.date)} (New York time)`,
    '',
    `My holdings: ${holdings}`,
    `My watchlist: ${watchlist}`,
    '',
    'My question:',
    input.message,
  ].join('\n');
}
