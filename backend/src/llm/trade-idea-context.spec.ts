import { describe, expect, it } from 'vitest';
import {
  buildBookSection,
  buildRecordSection,
  renderHistoryLines,
  type BookInput,
  type RecordInput,
} from './trade-idea-context.js';

const book: BookInput = {
  positions: [
    { symbol: 'BITX', quantity: 4600, price: 19, marketValue: 87_400 },
    { symbol: 'NVDA', quantity: 151, price: 212, marketValue: 32_012 },
  ],
  cash: -20_000,
  accountValue: 100_000,
  atRisk: { amount: 5_400 },
};

describe('buildBookSection', () => {
  it('says plainly when he already holds the ticker being asked about', () => {
    // The failure this was written for: an opinion telling him BITX does not
    // fit his profile while he held 4,600 shares of it.
    const out = buildBookSection(book, 'BITX');
    expect(out).toContain('I ALREADY HOLD BITX: 4,600 shares');
    expect(out).toContain('ADD-TO or TRIM decision');
  });

  it('says so just as plainly when he does not', () => {
    const out = buildBookSection(book, 'LMND');
    expect(out).toContain('I do NOT currently hold LMND');
    expect(out).not.toContain('ALREADY HOLD');
  });

  it('matches the ticker case-insensitively', () => {
    expect(buildBookSection(book, 'bitx')).toContain('I ALREADY HOLD BITX');
  });

  it('reports gross exposure as a multiple of the account', () => {
    // 87,400 + 32,012 = 119,412 against 100,000.
    expect(buildBookSection(book, 'X')).toContain('1.19x account value');
  });

  it('states negative cash as deliberate margin, not a warning', () => {
    // Invariant: cash may be negative and it must never be flagged as a
    // problem — otherwise every answer opens by scolding him for how he trades.
    const out = buildBookSection(book, 'X');
    expect(out).toContain('margin — this is deliberate');
  });

  it('weights each position against account value', () => {
    expect(buildBookSection(book, 'X')).toContain('87.4%');
  });

  /**
   * The watchlist ranking asks about every candidate at once, so there is no
   * single ticker to call out — a null symbol used to render as a hole in
   * the sentence ("I do NOT currently hold ."). It must now render neither
   * callout at all, while the book totals and positions list are untouched.
   */
  it('omits the ALREADY HOLD / do NOT hold callout entirely with no single ticker', () => {
    const out = buildBookSection(book, null);
    expect(out).not.toContain('ALREADY HOLD');
    expect(out).not.toContain('I do NOT currently hold');
    expect(out).toContain('Positions (symbol, shares, price, value, % of account):');
    expect(out).toContain('BITX');
  });
});

const record: RecordInput = {
  winRate: 0.55,
  avgWin: 2400,
  avgLoss: 1100,
  avgRisk: 3398,
  expectancyR: 0.42,
  closedCount: 20,
  trades: [
    {
      symbol: 'BITX',
      direction: 'LONG',
      isOpen: false,
      realizedPnl: -800,
      rMultiple: -0.5,
      enteredAt: '2026-06-01',
      exitedAt: '2026-06-10',
    },
    {
      symbol: 'NVDA',
      direction: 'LONG',
      isOpen: false,
      realizedPnl: 3000,
      rMultiple: 1.4,
      enteredAt: '2026-07-01',
      exitedAt: '2026-07-20',
    },
    {
      symbol: 'BITX',
      direction: 'LONG',
      isOpen: true,
      realizedPnl: null,
      rMultiple: null,
      enteredAt: '2026-08-01',
      exitedAt: null,
    },
  ],
};

describe('buildRecordSection', () => {
  it('shows his own history in the ticker, open positions included', () => {
    const out = buildRecordSection(record, 'BITX');
    expect(out).toContain('My history in BITX (2)');
    expect(out).toContain('still open');
    expect(out).toContain('-0.50R');
  });

  it('says so when he has never traded the name', () => {
    expect(buildRecordSection(record, 'LMND')).toContain(
      'I have never closed a trade in LMND',
    );
  });

  it('lists recent closed trades newest first, and never open ones', () => {
    const out = buildRecordSection(record, 'LMND');
    const nvda = out.indexOf('NVDA');
    const bitx = out.lastIndexOf('BITX');
    // NVDA closed 2026-07-20, BITX 2026-06-10.
    expect(nvda).toBeLessThan(bitx);
    expect(out).toContain('My last 2 closed trades');
  });

  it('shows his own labels, marking mistakes distinctly from setups', () => {
    // The point of the tags: the profile says what he BELIEVES his weaknesses
    // are; these say which setups actually lost money. A mistake is prefixed
    // so the model cannot read "chased" as a setup he uses on purpose.
    const out = buildRecordSection(
      {
        ...record,
        trades: [
          {
            symbol: 'NVDA',
            direction: 'LONG',
            isOpen: false,
            realizedPnl: -400,
            rMultiple: -1,
            enteredAt: '2026-07-01',
            exitedAt: '2026-07-20',
            setups: ['breakout'],
            mistakes: ['chased'],
          },
        ],
      },
      'NVDA',
    );
    expect(out).toContain('[breakout, !chased]');
  });

  it('omits the brackets entirely when a trade carries no labels', () => {
    // An empty "[]" would read as a label the owner chose to leave blank.
    expect(buildRecordSection(record, 'NVDA')).not.toContain('[]');
  });

  it('carries the figures that size the next position', () => {
    const out = buildRecordSection(record, 'X');
    expect(out).toContain('55%');
    expect(out).toContain('0.42R');
    expect(out).toContain('$3,398');
  });

  /**
   * FIX for a hole in the sentence: `buildRecordSection(rec, null)` used to
   * still run the per-ticker branch with an empty symbol, producing
   * "I have never closed a trade in .". With no single ticker to ask about
   * (the watchlist ranking's case), the whole per-ticker block is skipped —
   * the overall stats and the recent-closed-trades list are unaffected.
   */
  it('emits no sentence with a hole in it when there is no single ticker', () => {
    const out = buildRecordSection(record, null);
    expect(out).not.toMatch(/in \.$/m);
    expect(out).not.toContain('My history in');
    expect(out).not.toContain('I have never closed a trade in');
    expect(out).toContain('My last 2 closed trades');
  });
});

describe('renderHistoryLines', () => {
  it('renders his history in a ticker, shared verbatim by buildRecordSection and the ranking prompt', () => {
    const lines = renderHistoryLines(record.trades, 'BITX');
    expect(lines[0]).toBe('My history in BITX (2):');
    expect(lines.some((l) => l.includes('still open'))).toBe(true);
  });

  it('says so plainly, in one line, when he has never traded the name', () => {
    expect(renderHistoryLines(record.trades, 'LMND')).toEqual([
      'I have never closed a trade in LMND.',
    ]);
  });
});
