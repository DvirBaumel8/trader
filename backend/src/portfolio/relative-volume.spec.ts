import {
  computeRelativeVolumeAtEntry,
  DEFAULT_LOOKBACK_DAYS,
  type VolumeBar,
} from './relative-volume.js';

/** 20 trading days of steady 1,000,000-share volume, 2026-01-02 .. 2026-01-29. */
function steadyPriorBars(entryDate: string, dailyVolume = 1_000_000): VolumeBar[] {
  const bars: VolumeBar[] = [];
  const entry = new Date(`${entryDate}T00:00:00Z`);
  for (let i = DEFAULT_LOOKBACK_DAYS; i >= 1; i--) {
    const d = new Date(entry);
    d.setUTCDate(d.getUTCDate() - i);
    bars.push({ date: d.toISOString().slice(0, 10), volume: dailyVolume });
  }
  return bars;
}

describe('computeRelativeVolumeAtEntry', () => {
  it('is null with no bars at all', () => {
    const r = computeRelativeVolumeAtEntry([], '2026-02-02');
    expect(r.relativeVolume).toBeNull();
    expect(r.entryVolume).toBeNull();
    expect(r.averageVolume).toBeNull();
  });

  it('is null when the entry date has no bar', () => {
    const bars = steadyPriorBars('2026-02-02');
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBeNull();
  });

  it('is null when the entry bar has a null volume', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: null },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBeNull();
    expect(r.entryVolume).toBeNull();
  });

  it('is null when the entry bar has zero volume', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: 0 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBeNull();
  });

  it('is null when fewer than the lookback window of prior bars have real volume', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02').slice(1), // one short of the 20-day window
      { date: '2026-02-02', volume: 5_000_000 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBeNull();
    // The entry volume itself is still known, even though the average isn't.
    expect(r.entryVolume).toBe(5_000_000);
    expect(r.averageVolume).toBeNull();
  });

  it('treats a null-volume prior bar as missing, not zero, when counting the window', () => {
    const bars = steadyPriorBars('2026-02-02');
    bars[0] = { ...bars[0], volume: null }; // 19 real prior bars, one gap
    bars.push({ date: '2026-02-02', volume: 5_000_000 });
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBeNull();
  });

  it('computes a breakout day at 2x average volume', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: 2_000_000 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.entryVolume).toBe(2_000_000);
    expect(r.averageVolume).toBe(1_000_000);
    expect(r.relativeVolume).toBe(2);
  });

  it('computes a weak-volume entry below 1x', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: 400_000 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.relativeVolume).toBe(0.4);
  });

  it('only looks at bars strictly before the entry day, never after', () => {
    const bars = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: 2_000_000 },
      // A future bar with huge volume must not leak into the average.
      { date: '2026-02-03', volume: 50_000_000 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-02');
    expect(r.averageVolume).toBe(1_000_000);
    expect(r.relativeVolume).toBe(2);
  });

  it('does not care about input order', () => {
    const ordered = [
      ...steadyPriorBars('2026-02-02'),
      { date: '2026-02-02', volume: 2_000_000 },
    ];
    const shuffled = [...ordered].reverse();
    const r = computeRelativeVolumeAtEntry(shuffled, '2026-02-02');
    expect(r.relativeVolume).toBe(2);
  });

  it('respects a custom lookback window', () => {
    const bars = [
      { date: '2026-02-01', volume: 500_000 },
      { date: '2026-02-02', volume: 1_500_000 },
      { date: '2026-02-03', volume: 3_000_000 },
    ];
    const r = computeRelativeVolumeAtEntry(bars, '2026-02-03', 2);
    expect(r.averageVolume).toBe(1_000_000);
    expect(r.relativeVolume).toBe(3);
  });
});
