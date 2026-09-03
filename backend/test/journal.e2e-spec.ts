import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';

describe('Journal (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: object) =>
    http(app, token).post('/journal').send(body);

  const trade = (
    quantity: number,
    price: number,
    occurredAt: string,
    extra: Record<string, unknown> = {},
  ) =>
    post({
      kind: 'TRADE',
      body: 'x',
      occurredAt,
      trade: { symbol: 'NVDA', quantity, price, fee: 0, ...extra },
    });

  it('returns an empty timeline before anything is logged', async () => {
    const res = await http(app, token).get('/journal').expect(200);
    expect(res.body).toEqual([]);
  });

  it('shows seeded entries on the timeline', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await http(app, token).get('/journal').expect(200);
    expect(res.body).toHaveLength(2);
    const tradeEntry = res.body.find((e: { kind: string }) => e.kind === 'TRADE');
    expect(tradeEntry.trade).toMatchObject({
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: 100,
    });
    const cash = res.body.find((e: { kind: string }) => e.kind === 'CASH');
    expect(cash.cash).toMatchObject({ direction: 'DEPOSIT', amount: 11000 });
  });

  it('filters by kind', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await http(app, token)
      .get('/journal?kind=TRADE')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe('TRADE');
  });

  it('filters by symbol', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [
          { symbol: 'NVDA', quantity: 10, avgCost: 100 },
          { symbol: 'AAPL', quantity: 5, avgCost: 200 },
        ],
      })
      .expect(201);

    const res = await http(app, token)
      .get('/journal?symbol=nvda')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].trade.symbol).toBe('NVDA');
  });

  it('returns an empty tag list initially', async () => {
    const res = await http(app, token)
      .get('/journal/tags')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('logs a buy and moves the portfolio', async () => {
    await post({
      kind: 'TRADE',
      body: 'Pullback to the 50 day, adding.',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      tags: [{ type: 'SETUP', label: 'Pullback' }],
    }).expect(201);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(10);
    expect(nvda.avgCost).toBe(200);
    // No deposits, so a buy drives cash negative by cost plus fee.
    expect(portfolio.body.cash).toBe(-2004);
  });

  it('logs a sell that reduces a position', async () => {
    await trade(10, 200, '2026-08-01T14:30:00.000Z', { fee: 4 }).expect(201);
    await trade(-5, 250, '2026-08-15T14:30:00.000Z', { fee: 4 }).expect(201);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(5);
    expect(nvda.realizedPnl).toBe(250 - 8); // (250-200)*5 minus both fees
  });

  it('logs a note that moves nothing', async () => {
    await post({
      kind: 'NOTE',
      body: 'Market feels toppy. Sitting on hands.',
      occurredAt: '2026-08-29T14:30:00.000Z',
    }).expect(201);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);
  });

  it('logs a deposit that moves only cash', async () => {
    await post({
      kind: 'CASH',
      body: 'monthly transfer',
      occurredAt: '2026-08-29T14:30:00.000Z',
      cash: { direction: 'DEPOSIT', amount: 5000 },
    }).expect(201);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.cash).toBe(5000);
    expect(portfolio.body.positions).toEqual([]);
  });

  it('reuses a tag regardless of capitalisation', async () => {
    await trade(1, 200, '2026-08-29T14:30:00.000Z').expect(201);
    await post({
      kind: 'TRADE',
      body: 'x',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
      tags: [{ type: 'SETUP', label: 'Pullback' }],
    }).expect(201);
    await post({
      kind: 'TRADE',
      body: 'x',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
      tags: [{ type: 'SETUP', label: 'pullback' }],
    }).expect(201);

    const tags = await http(app, token)
      .get('/journal/tags')
      .expect(200);
    expect(tags.body).toHaveLength(1);
    expect(tags.body[0].label).toBe('pullback');
  });

  it('rejects a trade on an unknown ticker without writing anything', async () => {
    await post({
      kind: 'TRADE',
      body: 'x',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'ZZZZNOTREAL', quantity: 1, price: 1, fee: 0 },
    }).expect(404);

    const res = await http(app, token).get('/journal').expect(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a zero-quantity trade', async () => {
    await trade(0, 200, '2026-08-29T14:30:00.000Z').expect(400);
  });

  it('accepts a trade with an empty note', async () => {
    // Notes are optional by design; the UI marks them, the API allows them.
    await post({
      kind: 'TRADE',
      body: '',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
    }).expect(201);
  });

  it('stores tiered stop levels and reports their combined risk', async () => {
    const res = await trade(100, 217, '2026-08-29T14:30:00.000Z', {
      stopLevels: [
        { kind: 'FIXED', price: 205, quantity: 50 },
        { kind: 'TRAILING', trailPercent: 8, quantity: 50 },
      ],
    }).expect(201);

    expect(res.body.trade.stopLevels).toHaveLength(2);
    // 50 * (217-205) = 600, plus 50 * 217 * 0.08 = 868
    expect(res.body.trade.riskAmount).toBe(1468);
  });

  it('reports null risk for a trade with no stop', async () => {
    const res = await trade(10, 200, '2026-08-29T14:30:00.000Z').expect(201);
    expect(res.body.trade.stopLevels).toEqual([]);
    expect(res.body.trade.riskAmount).toBeNull();
  });

  it('edits a trade and recomputes the position', async () => {
    const created = await trade(100, 200, '2026-08-29T14:30:00.000Z', {
      fee: 4,
    }).expect(201);

    await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'corrected',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      })
      .expect(200);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(10);
    expect(portfolio.body.cash).toBe(-2004);
  });

  it('shows only the current stop tiers on edit, keeping the earlier revision as history', async () => {
    const created = await trade(100, 217, '2026-08-29T14:30:00.000Z', {
      stopLevels: [
        { kind: 'FIXED', price: 205, quantity: 50 },
        { kind: 'FIXED', price: 195, quantity: 50 },
      ],
    }).expect(201);

    const updated = await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'one stop now',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 100,
          price: 217,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 200, quantity: 100 }],
        },
      })
      .expect(200);

    // The view shows only the CURRENT tiers — not the superseded ones.
    expect(updated.body.trade.stopLevels).toHaveLength(1);
    expect(updated.body.trade.riskAmount).toBe(1700);

    // But the superseded revision is not gone — it's history, not deleted.
    // 2 rows from the original revision plus 1 from the new one.
    const rows = await dataSource.query('SELECT COUNT(*) FROM stop_levels');
    expect(Number(rows[0].count)).toBe(3);
  });

  it('moving a stop appends a new revision rather than overwriting the old one', async () => {
    const created = await trade(100, 217, '2026-08-29T14:30:00.000Z', {
      stopLevels: [{ kind: 'FIXED', price: 205, quantity: 100 }],
    }).expect(201);

    await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'trailed the stop up',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 100,
          price: 217,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 212, quantity: 100 }],
        },
      })
      .expect(200);

    const rows = await dataSource.query(
      'SELECT price, "revisionSeq", "createdAt" FROM stop_levels ORDER BY "revisionSeq" ASC',
    );
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].price)).toBe(205);
    expect(rows[0].revisionSeq).toBe(0);
    expect(Number(rows[1].price)).toBe(212);
    expect(rows[1].revisionSeq).toBe(1);
    // Both revisions were written by the new, revision-aware path, so both
    // have a known set-time.
    expect(rows[0].createdAt).not.toBeNull();
    expect(rows[1].createdAt).not.toBeNull();
  });

  it('does not write a new revision when an unrelated field is edited', async () => {
    const created = await trade(100, 217, '2026-08-29T14:30:00.000Z', {
      stopLevels: [{ kind: 'FIXED', price: 205, quantity: 100 }],
    }).expect(201);

    await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'fixed a typo in the note',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 100,
          price: 217,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 205, quantity: 100 }],
        },
      })
      .expect(200);

    const rows = await dataSource.query('SELECT COUNT(*) FROM stop_levels');
    expect(Number(rows[0].count)).toBe(1);
  });

  it('records which stop tier a sell executed', async () => {
    const open = await http(app, token).post('/journal').send({
      kind: 'TRADE',
      body: 'entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
      },
    }).expect(201);

    const [{ id: stopLevelId }] = (await dataSource.query(
      `SELECT s.id FROM stop_levels s
       JOIN transactions t ON t.id = s."transactionId"
       JOIN instruments i ON i.id = t."instrumentId"
       WHERE i.symbol = 'NVDA'`,
    )) as Array<{ id: string }>;

    await http(app, token).post('/journal').send({
      kind: 'TRADE',
      body: 'stopped out',
      occurredAt: '2026-01-08T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId, quantity: 100 }],
      },
    }).expect(201);

    const rows = (await dataSource.query(
      `SELECT quantity FROM stop_executions WHERE "stopLevelId" = $1`, [stopLevelId],
    )) as Array<{ quantity: string }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(100);

    const kinds = (await dataSource.query(
      `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
    )) as Array<{ exitKind: string | null }>;
    expect(kinds[0].exitKind).toBe('STOP');

    // The tier is consumed, so the position no longer reports coverage.
    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.stopTiers.filter((r: { symbol: string }) => r.symbol === 'NVDA')).toEqual([]);
  });

  it('keeps a confirmed stop execution when the entry is edited for an unrelated reason', async () => {
    // update() replaces the TRADE entry's transaction row wholesale (delete
    // + recreate — see journal.service.ts), and stop_executions has an
    // ON DELETE CASCADE foreign key to transactions. Editing an entry for
    // ANY reason — even a typo in its body — would silently destroy a
    // confirmed stop attribution unless the update path rewrites it from
    // the payload, the same way it already does for tags.
    await http(app, token).post('/journal').send({
      kind: 'TRADE',
      body: 'entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
      },
    }).expect(201);

    const [{ id: stopLevelId }] = (await dataSource.query(
      `SELECT s.id FROM stop_levels s
       JOIN transactions t ON t.id = s."transactionId"
       JOIN instruments i ON i.id = t."instrumentId"
       WHERE i.symbol = 'NVDA'`,
    )) as Array<{ id: string }>;

    const stopOut = await http(app, token).post('/journal').send({
      kind: 'TRADE',
      body: 'stopped out',
      occurredAt: '2026-01-08T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId, quantity: 100 }],
      },
    }).expect(201);

    // Edit the SELL entry, changing only its body. The update path is a
    // full replace, not a patch, so this resends the trade fields verbatim
    // — including exitKind and stopExecutions — the same way it must
    // already resend stopLevels to keep the stop plan.
    await http(app, token)
      .patch(`/journal/${stopOut.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'stopped out at 180 — typo fixed',
        occurredAt: '2026-01-08T14:30:00.000Z',
        trade: {
          symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
          exitKind: 'STOP',
          stopExecutions: [{ stopLevelId, quantity: 100 }],
        },
      })
      .expect(200);

    const rows = (await dataSource.query(
      `SELECT quantity FROM stop_executions WHERE "stopLevelId" = $1`, [stopLevelId],
    )) as Array<{ quantity: string }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(100);

    const kinds = (await dataSource.query(
      `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
    )) as Array<{ exitKind: string | null }>;
    expect(kinds[0].exitKind).toBe('STOP');
  });

  it('deletes an entry and removes its effect on the portfolio', async () => {
    const created = await trade(10, 200, '2026-08-29T14:30:00.000Z', {
      fee: 4,
      stopLevels: [{ kind: 'FIXED', price: 190, quantity: 10 }],
    }).expect(201);

    await http(app, token)
      .delete(`/journal/${created.body.id}`)
      .expect(200);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);

    const orphans = await dataSource.query('SELECT COUNT(*) FROM stop_levels');
    expect(Number(orphans[0].count)).toBe(0);
  });

  it('can add a thesis to an entry saved without one', async () => {
    const created = await post({
      kind: 'TRADE',
      body: '',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
    }).expect(201);

    const updated = await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'Added the reasoning later.',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
        tags: [{ type: 'MISTAKE', label: 'no plan' }],
      })
      .expect(200);

    expect(updated.body.body).toBe('Added the reasoning later.');
    expect(updated.body.tags).toHaveLength(1);
  });

  it('404s editing an entry that does not exist', async () => {
    await http(app, token)
      .patch('/journal/00000000-0000-0000-0000-000000000000')
      .send({
        kind: 'NOTE',
        body: 'x',
        occurredAt: '2026-08-29T14:30:00.000Z',
      })
      .expect(404);
  });

  it('a dividend raises cash but not contributed capital', async () => {
    await post({
      kind: 'CASH',
      body: '',
      occurredAt: '2026-08-01T14:30:00.000Z',
      cash: { direction: 'DEPOSIT', amount: 10000 },
    }).expect(201);

    await post({
      kind: 'DIVIDEND',
      body: 'quarterly',
      occurredAt: '2026-08-20T14:30:00.000Z',
      dividend: { symbol: 'NVDA', amount: 250 },
    }).expect(201);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    // Cash rises by the dividend...
    expect(portfolio.body.cash).toBe(10250);
    // ...but contributed capital does not. A dividend is earned, not added.
    expect(portfolio.body.contributedCapital).toBe(10000);
    expect(portfolio.body.dividendsReceived).toBe(250);
    // And it creates no position.
    expect(portfolio.body.positions).toEqual([]);
  });

  it('rejects a dividend on an unknown ticker', async () => {
    await post({
      kind: 'DIVIDEND',
      body: '',
      occurredAt: '2026-08-20T14:30:00.000Z',
      dividend: { symbol: 'ZZZZNOTREAL', amount: 100 },
    }).expect(404);
  });

  it('deletes a dividend and removes it from cash', async () => {
    const created = await post({
      kind: 'DIVIDEND',
      body: '',
      occurredAt: '2026-08-20T14:30:00.000Z',
      dividend: { symbol: 'NVDA', amount: 250 },
    }).expect(201);

    expect(created.body.dividend).toMatchObject({
      symbol: 'NVDA',
      amount: 250,
    });

    await http(app, token)
      .delete(`/journal/${created.body.id}`)
      .expect(200);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.cash).toBe(0);
    expect(portfolio.body.dividendsReceived).toBe(0);
  });

  it('can change an entry from a trade into a note', async () => {
    const created = await trade(10, 200, '2026-08-29T14:30:00.000Z', {
      fee: 4,
    }).expect(201);

    await http(app, token)
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'NOTE',
        body: 'just a thought',
        occurredAt: '2026-08-29T14:30:00.000Z',
      })
      .expect(200);

    const portfolio = await http(app, token)
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);
  });
});
