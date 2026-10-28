import { BadRequestException } from '@nestjs/common';

/**
 * The full symbol sequence after a reorder: the requested symbols first (in the
 * order given), then any the request left out in their current relative order.
 * `current` is the user's list in its current order. Unknown symbol → 400.
 */
export function reorderSymbols(current: string[], requested: string[]): string[] {
  const known = new Set(current);
  const listed: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const s = raw.trim().replace(/\$/g, '').toUpperCase();
    if (!known.has(s)) throw new BadRequestException(`Unknown symbol in order: ${s}`);
    if (!seen.has(s)) {
      seen.add(s);
      listed.push(s);
    }
  }
  return [...listed, ...current.filter((s) => !seen.has(s))];
}
