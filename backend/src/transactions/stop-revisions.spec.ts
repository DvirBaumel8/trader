import { describe, expect, it } from 'vitest';
import {
  earliestRevisionRows,
  isClearedRevision,
  latestRevisionRows,
} from './stop-revisions.js';

const row = (revisionSeq: number, cleared = false) => ({
  revisionSeq,
  cleared,
});

describe('stop revision selection', () => {
  it('takes every row of the highest revision, and only those', () => {
    const rows = [row(0), row(2), row(1), row(2)];
    expect(latestRevisionRows(rows)).toEqual([row(2), row(2)]);
  });

  it('takes every row of the lowest revision for the entry stop', () => {
    expect(earliestRevisionRows([row(0), row(1), row(0)])).toEqual([
      row(0),
      row(0),
    ]);
  });

  it('has nothing to return when nothing was ever recorded', () => {
    expect(latestRevisionRows([])).toEqual([]);
    expect(earliestRevisionRows([])).toEqual([]);
  });

  /**
   * An empty plan cannot be zero rows — that leaves revisionSeq unadvanced
   * and every reader keeps returning the previous revision. It is one
   * tombstone row instead, and this is the single place that knows.
   */
  it('reads a tombstone revision as "no stops"', () => {
    expect(isClearedRevision([row(3, true)])).toBe(true);
  });

  it('does not mistake a real revision for a cleared one', () => {
    expect(isClearedRevision([row(3), row(3)])).toBe(false);
    expect(isClearedRevision([])).toBe(false);
  });

  /**
   * A tombstone is always written alone. A revision holding both would mean
   * the writer is broken, and treating it as cleared would hide real tiers,
   * so the live tiers win.
   */
  it('treats a mixed revision as not cleared, rather than hiding tiers', () => {
    expect(isClearedRevision([row(3, true), row(3)])).toBe(false);
  });

  it('tolerates rows with no cleared field at all', () => {
    expect(isClearedRevision([{ revisionSeq: 0 }])).toBe(false);
  });
});
