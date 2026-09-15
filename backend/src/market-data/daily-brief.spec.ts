import { describe, expect, it } from 'vitest';
import type { RawBar } from './yahoo.client.js';
import {
  buildDailyBriefNotes,
  type BriefSymbolInput,
} from './daily-brief.js';

function bars(values: number[], volume = 1_000_000): RawBar[] {
  return values.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    close,
    adjClose: close,
    open: close,
    high: close + 1,
    low: close - 1,
    volume,
  }));
}

function input(over: Partial<BriefSymbolInput> = {}): BriefSymbolInput {
  return {
    symbol: 'NVDA',
    source: 'PORTFOLIO',
    price: 120,
    bars: bars(Array.from({ length: 60 }, (_, i) => 100 + i * 0.2)),
    spyBars: bars(Array.from({ length: 60 }, () => 100)),
    ...over,
  };
}

describe('daily brief signal rules', () => {
  it('notes when today moved at least one ATR from the prior close', () => {
    const source = bars(Array.from({ length: 20 }, () => 100));
    source[source.length - 1] = { ...source.at(-1)!, close: 103, high: 104, low: 99 };
    const notes = buildDailyBriefNotes(input({ price: 103, bars: source }));
    expect(notes.some((note) => note.kind === 'ATR_MOVE')).toBe(true);
  });

  it('notes good momentum only when trend and relative strength agree', () => {
    const notes = buildDailyBriefNotes(input());
    expect(notes.some((note) => note.kind === 'MOMENTUM')).toBe(true);

    const weak = buildDailyBriefNotes(input({
      price: 90,
      bars: bars(Array.from({ length: 60 }, () => 100)),
    }));
    expect(weak.some((note) => note.kind === 'MOMENTUM')).toBe(false);
  });

  it('notes a confirmed breakout only with a close above the prior 20-day high and volume', () => {
    const source = bars(Array.from({ length: 60 }, () => 100));
    source[source.length - 1] = {
      ...source.at(-1)!,
      close: 105,
      high: 106,
      volume: 2_000_000,
    };
    const notes = buildDailyBriefNotes(input({ price: 105, bars: source }));
    expect(notes.some((note) => note.kind === 'BREAKOUT')).toBe(true);
  });
});
