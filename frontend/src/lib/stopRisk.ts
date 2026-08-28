export type StopKind = 'FIXED' | 'TRAILING';

/** Draft rows hold strings, because they mirror what is in the inputs. */
export interface StopRow {
  kind: StopKind;
  price: string;
  trailPercent: string;
  quantity: string;
}

export interface DraftRisk {
  amount: number | null;
  covered: number;
  fullyCovered: boolean;
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Mirrors the backend's computeRisk, over half-typed strings. Deliberately
 * returns null rather than a partial figure: a risk number that flickers
 * through wrong values while you type is worse than no number at all.
 */
export function draftRisk(
  entryPrice: string,
  positionQuantity: string,
  rows: StopRow[],
  side: 'BUY' | 'SELL',
): DraftRisk {
  const entry = num(entryPrice);
  const size = Math.abs(num(positionQuantity) ?? 0);
  if (entry === null || entry <= 0) {
    return { amount: null, covered: 0, fullyCovered: false };
  }

  let amount = 0;
  let covered = 0;

  for (const row of rows) {
    const qty = Math.abs(num(row.quantity) ?? 0);
    if (qty <= 0) continue;

    let perShare: number | null = null;
    if (row.kind === 'FIXED') {
      const price = num(row.price);
      if (price !== null && price > 0) {
        const distance = side === 'BUY' ? entry - price : price - entry;
        if (distance > 0) perShare = distance;
      }
    } else {
      const pct = num(row.trailPercent);
      if (pct !== null && pct > 0) perShare = entry * (pct / 100);
    }

    if (perShare === null) continue;
    amount += perShare * qty;
    covered += qty;
  }

  const cappedCover = Math.min(covered, size || covered);
  return {
    amount: covered > 0 ? Math.round(amount * 100) / 100 : null,
    covered: cappedCover,
    fullyCovered: covered > 0 && size > 0 && cappedCover >= size,
  };
}
