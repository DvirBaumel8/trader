import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { InstrumentsService } from '../instruments/instruments.service.js';

const VALIDATE_CONCURRENCY = 5;

/** Trim, upper-case, strip `$`, drop blanks, de-duplicate. 400 when nothing is left. */
export function normalizeSymbols(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const r of raw) {
    const s = r.trim().replace(/\$/g, '').toUpperCase();
    if (s) seen.add(s);
  }
  if (seen.size === 0) throw new BadRequestException('No valid symbols');
  return [...seen];
}

/** Validates each symbol through the market-data lookup, 5 at a time. Other errors propagate. */
export async function partitionKnown(
  instruments: InstrumentsService,
  symbols: string[],
): Promise<{ known: string[]; notFound: string[] }> {
  const known: string[] = [];
  const notFound: string[] = [];
  for (let i = 0; i < symbols.length; i += VALIDATE_CONCURRENCY) {
    const batch = symbols.slice(i, i + VALIDATE_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((s) => instruments.findOrCreate(s)));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') known.push(r.value.symbol);
      else if (r.reason instanceof NotFoundException) notFound.push(batch[j]);
      else throw r.reason;
    });
  }
  return { known, notFound };
}
