import { describe, expect, it } from 'vitest';
import { replayFrame, totalReplaySteps } from './tradeReplay';

// A five-bar window shaped like a small real trade: entry on day 2 (index
// 1), a stop the whole time it's live, exit on day 4 (index 3).
const barDates = [
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
];
const markerBarDates = ['2026-08-25', '2026-08-27']; // entry, exit

describe('totalReplaySteps', () => {
  it('equals the bar count', () => {
    expect(totalReplaySteps(barDates)).toBe(5);
  });
});

describe('replayFrame', () => {
  it('reveals nothing before the first step', () => {
    const frame = replayFrame(barDates, markerBarDates, 0);
    expect(frame.visibleBarCount).toBe(0);
    expect(frame.visibleFillIndices).toEqual([]);
    expect(frame.stopLinesVisible).toBe(false);
  });

  it('reveals only the first bar at step 1, with no fills yet', () => {
    const frame = replayFrame(barDates, markerBarDates, 1);
    expect(frame.visibleBarCount).toBe(1);
    expect(frame.visibleFillIndices).toEqual([]);
    expect(frame.stopLinesVisible).toBe(false);
  });

  it('brings in a marker only once its own bar is reached, not before', () => {
    // Step 1 reveals bar index 0 only — the entry's bar (index 1) is not
    // yet visible, so the entry marker must not appear.
    expect(replayFrame(barDates, markerBarDates, 1).visibleFillIndices).toEqual(
      [],
    );
    // Step 2 reveals bars 0..1, which includes the entry's own bar.
    expect(replayFrame(barDates, markerBarDates, 2).visibleFillIndices).toEqual(
      [0],
    );
  });

  it('shows the stop lines starting exactly at the entry bar, not before', () => {
    expect(replayFrame(barDates, markerBarDates, 1).stopLinesVisible).toBe(
      false,
    );
    expect(replayFrame(barDates, markerBarDates, 2).stopLinesVisible).toBe(
      true,
    );
  });

  it('brings in the exit marker only once its own bar is reached', () => {
    // Step 3 reveals bars 0..2 — before the exit's bar (index 3).
    expect(replayFrame(barDates, markerBarDates, 3).visibleFillIndices).toEqual(
      [0],
    );
    // Step 4 reveals bars 0..3, which includes the exit's own bar.
    expect(replayFrame(barDates, markerBarDates, 4).visibleFillIndices).toEqual(
      [0, 1],
    );
  });

  it('at the final step, matches the full static chart exactly', () => {
    const frame = replayFrame(barDates, markerBarDates, barDates.length);
    expect(frame.visibleBarCount).toBe(barDates.length);
    expect(frame.visibleFillIndices).toEqual([0, 1]);
    expect(frame.stopLinesVisible).toBe(true);
  });

  it('clamps a step beyond the bar count to the final frame', () => {
    const frame = replayFrame(barDates, markerBarDates, 999);
    expect(frame.visibleBarCount).toBe(barDates.length);
    expect(frame.visibleFillIndices).toEqual([0, 1]);
    expect(frame.stopLinesVisible).toBe(true);
  });

  it('never goes negative for a negative step', () => {
    const frame = replayFrame(barDates, markerBarDates, -3);
    expect(frame.visibleBarCount).toBe(0);
    expect(frame.visibleFillIndices).toEqual([]);
    expect(frame.stopLinesVisible).toBe(false);
  });

  it('still matches the static chart at the final step when there are no fills at all', () => {
    const frame = replayFrame(barDates, [], barDates.length);
    expect(frame.visibleBarCount).toBe(barDates.length);
    expect(frame.visibleFillIndices).toEqual([]);
    expect(frame.stopLinesVisible).toBe(true);
  });

  it('handles two fills landing on the same bar (both entries of a scale-in)', () => {
    const sameBar = ['2026-08-25', '2026-08-25'];
    // Neither shows before the shared bar is revealed...
    expect(replayFrame(barDates, sameBar, 1).visibleFillIndices).toEqual([]);
    // ...both show together the moment it is.
    expect(replayFrame(barDates, sameBar, 2).visibleFillIndices).toEqual([
      0, 1,
    ]);
  });
});
