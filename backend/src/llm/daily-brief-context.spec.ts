import { describe, expect, it } from 'vitest';
import { buildDailyBriefContext, type DailyBriefContextInput } from './daily-brief-context.js';
import { EMPTY_MOOD } from '../market-data/brief-mood.js';

function input(over: Partial<DailyBriefContextInput> = {}): DailyBriefContextInput {
  return {
    generatedAt: '2026-09-16T14:00:00.000Z',
    session: 'REGULAR',
    mood: EMPTY_MOOD,
    events: [],
    holdingNotes: [],
    watchTriggers: [],
    ...over,
  };
}

describe('buildDailyBriefContext', () => {
  it('states the time and the market session up top', () => {
    const facts = buildDailyBriefContext(input({ session: 'PRE' }));
    expect(facts).toContain('daily brief as of 2026-09-16T14:00:00.000Z, market session PRE');
  });

  it('writes the mood line with every figure exactly as computed', () => {
    const facts = buildDailyBriefContext(input({
      mood: {
        indices: [
          { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false },
          { symbol: 'QQQ', trend: null, changePct: -0.0025, stale: true, extended: true },
        ],
        vix: { level: 17.8, change: 1.1, stale: false },
        leader: { symbol: 'XLE', name: 'Energy', changePct: 0.012 },
        laggard: { symbol: 'XLK', name: 'Technology', changePct: -0.009 },
      },
    }));
    expect(facts).toContain('- SPY: uptrend, +0.40% today');
    expect(facts).toContain('- QQQ: trend unknown, -0.25% today (extended-hours print) (stale)');
    expect(facts).toContain('- VIX: 17.80 (+1.10)');
    expect(facts).toContain('- Leading sector: Energy (XLE) +1.20%');
    expect(facts).toContain('- Lagging sector: Technology (XLK) -0.90%');
  });

  it('says plainly when the mood is unavailable', () => {
    expect(buildDailyBriefContext(input())).toContain('- Market mood unavailable.');
  });

  it('quotes events, holding notes and watch triggers verbatim, each in its own section', () => {
    const facts = buildDailyBriefContext(input({
      events: [{ title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' }],
      holdingNotes: [{ title: 'MSFT has good momentum', detail: 'Above rising trend averages and outperforming SPY by 2.7%.' }],
      watchTriggers: [{ title: 'FSLR confirmed a breakout', detail: 'Closed above its prior 20-day high on 2.1× average volume.' }],
    }));
    expect(facts).toContain('Economic events this week\n- Fed raised rates 25 bp: Target range is now 3.75–4.00%.');
    expect(facts).toContain('Your holdings\n- MSFT has good momentum: Above rising trend averages and outperforming SPY by 2.7%.');
    expect(facts).toContain('Watchlist triggers\n- FSLR confirmed a breakout: Closed above its prior 20-day high on 2.1× average volume.');
  });

  it('says plainly when a section is empty, rather than leaving it blank', () => {
    const facts = buildDailyBriefContext(input());
    expect(facts).toContain('- No economic events this week.');
    expect(facts).toContain('- Nothing notable on your holdings today.');
    expect(facts).toContain('- No new watchlist triggers.');
  });
});
