/**
 * Splits what the owner typed or pasted into tickers: on whitespace, commas
 * and semicolons, dropping list numbering such as `4.` or `4)`. Display
 * parsing only — the server normalises and validates again.
 */
export function parseTickers(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const token = raw.replace(/^\d+[.)]/, '').trim();
    if (token) out.push(token);
  }
  return out;
}

/** `Added: A, B · Already held: C` — empty groups left out. */
export function summarize(groups: [label: string, symbols: string[]][]): string {
  return groups
    .filter(([, s]) => s.length > 0)
    .map(([label, s]) => `${label}: ${s.join(', ')}`)
    .join(' · ');
}
