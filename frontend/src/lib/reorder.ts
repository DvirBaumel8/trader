import { arrayMove } from '@dnd-kit/sortable';

/** Moves `active` to where `over` is. Returns the same array when nothing would change. */
export function moveSymbol<T extends { symbol: string }>(rows: T[], active: string, over: string): T[] {
  const from = rows.findIndex((r) => r.symbol === active);
  const to = rows.findIndex((r) => r.symbol === over);
  if (from < 0 || to < 0 || from === to) return rows;
  return arrayMove(rows, from, to);
}
