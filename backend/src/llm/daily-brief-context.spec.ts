import { describe, expect, it } from 'vitest';
import { buildDailyBriefContext, type DailyBriefContextInput } from './daily-brief-context.js';
import { EMPTY_MOOD } from '../market-data/brief-mood.js';

function input(over: Partial<DailyBriefContextInput> = {}): DailyBriefContextInput {
  return {
    generatedAt: '2026-09-16T14:00:00.000Z',
    session: 'REGULAR',
    mood: EMPTY_MOOD,
    events: [],
    queue: [],
    movers: [],
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
          { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false, session: 'REGULAR' },
          { symbol: 'QQQ', trend: null, changePct: -0.0025, stale: true, extended: true, session: 'POST' },
        ],
        vix: { level: 17.8, change: 1.1, stale: false },
        leader: { symbol: 'XLE', name: 'Energy', changePct: 0.012 },
        laggard: { symbol: 'XLK', name: 'Technology', changePct: -0.009 },
      },
    }));
    expect(facts).toContain('- SPY: uptrend, +0.40% since prior close');
    expect(facts).toContain('- QQQ: trend unknown, -0.25% since prior close (extended-hours print) (stale)');
    expect(facts).toContain('- VIX: 17.80 (+1.10)');
    expect(facts).toContain('- Leading sector: Energy (XLE) +1.20%');
    expect(facts).toContain('- Lagging sector: Technology (XLK) -0.90%');
  });

  it('says plainly when the mood is unavailable', () => {
    expect(buildDailyBriefContext(input())).toContain('- Market mood unavailable.');
  });

  it('quotes events and watch triggers verbatim, each in its own section', () => {
    const facts = buildDailyBriefContext(input({
      events: [{ title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' }],
      watchTriggers: [{ title: 'FSLR confirmed a breakout', detail: 'Closed above its prior 20-day high on 2.1× average volume.' }],
    }));
    expect(facts).toContain('Economic events this week\n- Fed raised rates 25 bp: Target range is now 3.75–4.00%.');
    expect(facts).toContain('Watchlist triggers\n- FSLR confirmed a breakout: Closed above its prior 20-day high on 2.1× average volume.');
  });

  it('says plainly when a section is empty, rather than leaving it blank', () => {
    const facts = buildDailyBriefContext(input());
    expect(facts).toContain('- No economic events this week.');
    expect(facts).toContain('- No new watchlist triggers.');
  });

  it('lists what needs attention verbatim, first among the per-name sections', () => {
    const facts = buildDailyBriefContext(input({
      queue: [{ title: 'NVDA is through its stop at $95.00', detail: 'Last $93.00. If the stop has not filled, act on it now.' }],
    }));
    expect(facts).toContain('Needs attention\n- NVDA is through its stop at $95.00: Last $93.00. If the stop has not filled, act on it now.');
    expect(facts.indexOf('Needs attention')).toBeLessThan(facts.indexOf('Movers'));
  });

  it('writes each mover with figures as given and its headline', () => {
    const facts = buildDailyBriefContext(input({
      movers: [
        { symbol: 'NVDA', changePct: 0.042, atrMultiple: 2.31, dollarChange: 1234.5, extended: false, stale: false, headline: { title: 'Nvidia wins deal', source: 'Reuters' } },
        { symbol: 'MRNA', changePct: 0.03, atrMultiple: 1.2, dollarChange: -600, extended: true, stale: false, headline: null },
      ],
    }));
    expect(facts).toContain('Movers\n- NVDA: +4.20% since prior close (2.3× ATR), +$1234.50 on the position. Headline: "Nvidia wins deal" (Reuters)');
    expect(facts).toContain('- MRNA: +3.00% since prior close (1.2× ATR), -$600.00 on the position (extended-hours print). No headline found.');
  });

  it('says plainly when nothing moved enough', () => {
    expect(buildDailyBriefContext(input())).toContain('- No holding moved 1 ATR or more.');
  });

  it('says plainly when nothing needs attention', () => {
    expect(buildDailyBriefContext(input())).toContain('- Nothing needs a decision today.');
  });
});
