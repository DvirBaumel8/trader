/**
 * Picking one revision out of a transaction's stop history.
 *
 * `stop_levels` is append-only: a revision IS its rows, grouped by
 * `revisionSeq`. Choosing "the current plan" or "the entry plan" used to be
 * written out separately in `derive-trades.ts` (three times) and
 * `journal.service.ts` (three more), which was survivable only while every
 * revision had rows. It no longer does — a CLEARED plan is one tombstone row
 * — and a tombstone that five readers understand and the sixth does not is a
 * silently wrong at-risk number. Hence one definition, here.
 */
export interface RevisionRow {
  revisionSeq: number;
  /** True on the single row that records "this plan was emptied". */
  cleared?: boolean;
}

/** Every row of the most recent revision, tombstones included. */
export function latestRevisionRows<T extends RevisionRow>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const maxSeq = Math.max(...rows.map((r) => r.revisionSeq));
  return rows.filter((r) => r.revisionSeq === maxSeq);
}

/** Every row of the first revision ever recorded — the stop that defines R. */
export function earliestRevisionRows<T extends RevisionRow>(rows: T[]): T[] {
  if (rows.length === 0) return [];
  const minSeq = Math.min(...rows.map((r) => r.revisionSeq));
  return rows.filter((r) => r.revisionSeq === minSeq);
}

/**
 * Whether a revision records "no stops at all".
 *
 * `every` rather than `some`: a tombstone is always written alone, so a
 * revision holding both a tombstone and a real tier means the writer is
 * broken. Reading that as cleared would hide live tiers and understate risk,
 * so the tiers win and the anomaly stays visible.
 */
export function isClearedRevision(rows: RevisionRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.cleared === true);
}
