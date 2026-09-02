/**
 * Relative volume at entry — the fact a breakout trader actually wants.
 * Raw share volume means nothing on its own; what matters is whether the
 * entry day traded busier than usual, which is what turns "he bought a
 * breakout" into "he bought a breakout with volume behind it" — his own
 * stated rule, from `docs/trader-profile.md`: "Volume as a confirming
 * indicator."
 *
 * Pure and dependency-free, in the style of `derive.ts`/`risk.ts`: no
 * database, no network, covered by fixture-driven tests. The caller
 * (`portfolio.service.ts`) does the I/O and hands this whatever bars it has.
 */

export interface VolumeBar {
  /** YYYY-MM-DD, matching `daily_closes.date`. */
  date: string;
  /** Null when Yahoo returned the bar without a volume figure. */
  volume: number | null;
}

export interface RelativeVolumeResult {
  /** Entry-day volume divided by the average of the `lookbackDays` before it. Null when it cannot be honestly computed. */
  relativeVolume: number | null;
  /** The entry day's own volume, for display. Null if unknown. */
  entryVolume: number | null;
  /** The average volume it was measured against. Null if unknown. */
  averageVolume: number | null;
}

const NULL_RESULT: RelativeVolumeResult = {
  relativeVolume: null,
  entryVolume: null,
  averageVolume: null,
};

/** Conventional choice for "recent average volume" — see the docstring above. */
export const DEFAULT_LOOKBACK_DAYS = 20;

/**
 * `bars` need not be sorted or pre-trimmed to the window — this sorts and
 * slices itself, so callers can simply hand over "everything found in a
 * generous date range around the entry."
 *
 * Nulled, never estimated, when:
 *  - the entry date has no bar at all, or that bar has no volume;
 *  - fewer than `lookbackDays` prior bars have a real (non-null, positive)
 *    volume figure. A partial window — a recently-listed instrument, or bars
 *    that simply haven't been backfilled that far back — would silently
 *    average over fewer days and could mislabel a middling day "above
 *    average" just because its few neighbours happened to be quiet.
 */
export function computeRelativeVolumeAtEntry(
  bars: VolumeBar[],
  entryDate: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): RelativeVolumeResult {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const entryIndex = sorted.findIndex((b) => b.date === entryDate);
  if (entryIndex === -1) return NULL_RESULT;

  const entryVolume = sorted[entryIndex].volume;
  if (entryVolume === null || !(entryVolume > 0)) return NULL_RESULT;

  const priorBars = sorted.slice(Math.max(0, entryIndex - lookbackDays), entryIndex);
  const priorVolumes = priorBars
    .map((b) => b.volume)
    .filter((v): v is number => v !== null && v > 0);

  if (priorVolumes.length < lookbackDays) {
    return { relativeVolume: null, entryVolume, averageVolume: null };
  }

  const averageVolume =
    priorVolumes.reduce((sum, v) => sum + v, 0) / priorVolumes.length;
  if (!(averageVolume > 0)) {
    return { relativeVolume: null, entryVolume, averageVolume: null };
  }

  return {
    relativeVolume: round(entryVolume / averageVolume),
    entryVolume,
    averageVolume: round(averageVolume),
  };
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
