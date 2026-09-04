import { describe, expect, it } from 'vitest';
import {
  buildBookSection,
  buildRecordSection,
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

  it('carries the figures that size the next position', () => {
    const out = buildRecordSection(record, 'X');
    expect(out).toContain('55%');
    expect(out).toContain('0.42R');
    expect(out).toContain('$3,398');
  });
});
