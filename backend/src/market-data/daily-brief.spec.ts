import { describe, expect, it } from 'vitest';
import type { RawBar } from './yahoo.client.js';
import {
  buildDailyBriefNotes,
  isWatchTrigger,
  momentumStreakDays,
  type BriefNote,
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

  it('phrases a fresh momentum note the same way it always has', () => {
    // Flat for months, then a single sharp jump today — momentum is real as
    // of today, but was not true yesterday, so the streak is exactly 1.
    const source = bars([...Array.from({ length: 89 }, () => 100), 130]);
    const notes = buildDailyBriefNotes(
      input({
        price: source.at(-1)!.close,
        bars: source,
        spyBars: bars(Array.from({ length: 90 }, () => 100)),
      }),
    );
    const momentum = notes.find((note) => note.kind === 'MOMENTUM');
    expect(momentum?.title).toBe('NVDA has good momentum');
  });

  it('names the streak length once momentum has held for more than a day, instead of repeating the same sentence', () => {
    const notes = buildDailyBriefNotes(input());
    const momentum = notes.find((note) => note.kind === 'MOMENTUM');
    expect(momentum?.title).toMatch(/NVDA has been in a momentum trend for \d+ days/);
  });
});

describe('momentumStreakDays', () => {
  it('is exactly 1 the day a momentum trend first appears', () => {
    // Flat for months, then a single sharp jump today.
    const source = bars([...Array.from({ length: 89 }, () => 100), 130]);
    const spy = bars(Array.from({ length: 90 }, () => 100));
    expect(momentumStreakDays(source, spy)).toBe(1);
  });

  it('grows with a long-held uptrend, up to its cap', () => {
    const source = bars(Array.from({ length: 90 }, (_, i) => 100 + i * 0.2));
    const spy = bars(Array.from({ length: 90 }, () => 100));
    expect(momentumStreakDays(source, spy)).toBe(30);
  });

  it('is zero when momentum does not currently hold', () => {
    const source = bars(Array.from({ length: 60 }, () => 100));
    const spy = bars(Array.from({ length: 60 }, () => 100));
    expect(momentumStreakDays(source, spy)).toBe(0);
  });
});

describe('isWatchTrigger', () => {
  const note = (over: Partial<BriefNote>): BriefNote => ({
    kind: 'MOMENTUM', symbol: 'FSLR', source: 'WATCHLIST', title: 't', detail: 'd', ...over,
  });

  it('keeps a confirmed breakout', () => {
    expect(isWatchTrigger(note({ kind: 'BREAKOUT' }))).toBe(true);
  });
  it('keeps momentum on its first day', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 1 }))).toBe(true);
  });
  // Pre-market the bars end yesterday, so a trend that only qualifies on
  // today's live price has a streak of 0 — that is still its first day.
  it('keeps momentum that holds only on the live price so far', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 0 }))).toBe(true);
  });
  it('drops a momentum streak already running, which is not news', () => {
    expect(isWatchTrigger(note({ kind: 'MOMENTUM', streakDays: 2 }))).toBe(false);
  });
  it('drops a large daily move, which is not a setup on a watch row', () => {
    expect(isWatchTrigger(note({ kind: 'ATR_MOVE' }))).toBe(false);
  });
});

it('carries the momentum streak on the note it produced', () => {
  const values = Array.from({ length: 60 }, (_, i) => 100 + i * 0.2);
  const spy = bars(Array.from({ length: 60 }, () => 100));
  const momentum = buildDailyBriefNotes(input({ bars: bars(values), spyBars: spy }))
    .find((n) => n.kind === 'MOMENTUM');
  expect(momentum?.streakDays).toBe(momentumStreakDays(bars(values), spy));
});
