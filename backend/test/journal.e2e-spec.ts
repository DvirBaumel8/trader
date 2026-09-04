import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Journal (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No test reaches the network. See test/yahoo-stub.ts.
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE stop_levels, stop_executions, transactions, cash_flows, dividends, journal_entries, entry_tags, tags RESTART IDENTITY CASCADE',
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

  it('recognises a stop on its own, with nothing sent by the client', async () => {
    await http(app, token).post('/journal').send({
      kind: 'TRADE', body: 'entry', occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
      },
    }).expect(201);

    // No exitKind, no stopExecutions - the prices alone say what happened.
    // Filled 12 cents under the stop, ordinary slippage.
    await http(app, token).post('/journal').send({
      kind: 'TRADE', body: 'stopped out', occurredAt: '2026-01-08T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: -100, price: 179.88, fee: 0 },
    }).expect(201);

    const rows = (await dataSource.query(
      `SELECT se.quantity, t."exitKind" FROM stop_executions se
       JOIN transactions t ON t.id = se."transactionId"`,
    )) as Array<{ quantity: string; exitKind: string }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(100);
    expect(rows[0].exitKind).toBe('STOP');
  });

  it('claims nothing when the exit is nowhere near the stop', async () => {
    await http(app, token).post('/journal').send({
      kind: 'TRADE', body: 'entry', occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
      },
    }).expect(201);

    // Sold at 210 - a decision, not a stop. Unrecorded is the honest answer.
    await http(app, token).post('/journal').send({
      kind: 'TRADE', body: 'took profit', occurredAt: '2026-01-08T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: -100, price: 210, fee: 0 },
    }).expect(201);

    const rows = (await dataSource.query(`SELECT id FROM stop_executions`)) as unknown[];
    expect(rows).toHaveLength(0);
    const kinds = (await dataSource.query(
      `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
    )) as Array<{ exitKind: string | null }>;
    expect(kinds[0].exitKind).toBeNull();
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

  it('rejects exitKind/stopExecutions on an opening fill, with nothing written', async () => {
    const stopLevelId = '00000000-0000-0000-0000-000000000000';
    await post({
      kind: 'TRADE',
      body: 'entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId, quantity: 100 }],
      },
    }).expect(400);

    const txns = await dataSource.query('SELECT * FROM transactions');
    expect(txns).toHaveLength(0);
  });

  it('rejects exitKind alone (no stopExecutions) on an opening fill, with nothing written', async () => {
    await post({
      kind: 'TRADE',
      body: 'entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        exitKind: 'STOP',
      },
    }).expect(400);

    const txns = await dataSource.query('SELECT * FROM transactions');
    expect(txns).toHaveLength(0);
  });

  it('rejects a well-formed but nonexistent stopLevelId with 400, not a 500', async () => {
    await post({
      kind: 'TRADE',
      body: 'entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 100, price: 200, fee: 0 },
    }).expect(201);

    const nonexistent = '00000000-0000-0000-0000-000000000000';
    await post({
      kind: 'TRADE',
      body: 'stopped out',
      occurredAt: '2026-01-08T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId: nonexistent, quantity: 100 }],
      },
    }).expect(400);

    const executions = await dataSource.query('SELECT * FROM stop_executions');
    expect(executions).toHaveLength(0);
  });

  it('rejects a stopLevelId that belongs to a different instrument', async () => {
    await post({
      kind: 'TRADE',
      body: 'nvda entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
      },
    }).expect(201);
    await post({
      kind: 'TRADE',
      body: 'msft entry',
      occurredAt: '2026-01-03T14:30:00.000Z',
      trade: {
        symbol: 'MSFT', quantity: 50, price: 300, fee: 0,
        stopLevels: [{ kind: 'FIXED', price: 280, quantity: 50 }],
      },
    }).expect(201);

    const [{ id: msftStopLevelId }] = (await dataSource.query(
      `SELECT s.id FROM stop_levels s
       JOIN transactions t ON t.id = s."transactionId"
       JOIN instruments i ON i.id = t."instrumentId"
       WHERE i.symbol = 'MSFT'`,
    )) as Array<{ id: string }>;

    // Sells the NVDA position but names the MSFT tier — a cross-instrument
    // id, which must be rejected rather than silently written: an unmatched
    // execution makes computeEffectiveStops skip price matching entirely,
    // so the real NVDA tier would never be consumed.
    await post({
      kind: 'TRADE',
      body: 'stopped out',
      occurredAt: '2026-01-08T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId: msftStopLevelId, quantity: 100 }],
      },
    }).expect(400);

    const executions = await dataSource.query('SELECT * FROM stop_executions');
    expect(executions).toHaveLength(0);
  });

  it('rejects stopExecutions that claim more shares than the fill itself sold', async () => {
    await post({
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

    // A 50-share sell claiming a 60-share execution would silently
    // under-report the coverage still remaining on the tier.
    await post({
      kind: 'TRADE',
      body: 'partial stop out',
      occurredAt: '2026-01-08T14:30:00.000Z',
      trade: {
        symbol: 'NVDA', quantity: -50, price: 180, fee: 0,
        exitKind: 'STOP',
        stopExecutions: [{ stopLevelId, quantity: 60 }],
      },
    }).expect(400);

    const executions = await dataSource.query('SELECT * FROM stop_executions');
    expect(executions).toHaveLength(0);
  });

  it('reconstructs (does not preserve) a confirmed stop execution when the entry is resaved with it resent', async () => {
    // update() replaces the TRADE entry's transaction row wholesale (delete
    // + recreate — see journal.service.ts), and stop_executions has an
    // ON DELETE CASCADE foreign key to transactions. So a confirmed
    // attribution never survives an edit by identity — the old row is
    // genuinely gone. What "survives" is only a NEW row rebuilt from the
    // resent payload, with a new id and a reset confirmedAt. Editing an
    // entry for ANY reason — even a typo in its body — would silently
    // destroy the attribution unless the caller resends it, the same way it
    // already must resend stopLevels to keep the stop plan.
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

    const before = (await dataSource.query(
      `SELECT id, "confirmedAt" FROM stop_executions WHERE "stopLevelId" = $1`,
      [stopLevelId],
    )) as Array<{ id: string; confirmedAt: string }>;
    expect(before).toHaveLength(1);

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

    const after = (await dataSource.query(
      `SELECT id, quantity, "confirmedAt" FROM stop_executions WHERE "stopLevelId" = $1`,
      [stopLevelId],
    )) as Array<{ id: string; quantity: string; confirmedAt: string }>;
    expect(after).toHaveLength(1);
    expect(Number(after[0].quantity)).toBe(100);
    // Reconstructed, not preserved: a genuinely different row.
    expect(after[0].id).not.toBe(before[0].id);

    const kinds = (await dataSource.query(
      `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
    )) as Array<{ exitKind: string | null }>;
    expect(kinds[0].exitKind).toBe('STOP');
  });

  it('regenerates a stop attribution when an edit omits it, rather than losing it', async () => {
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

    // Edit the SELL entry changing only its body, WITHOUT resending
    // exitKind/stopExecutions — the mistake an edit form makes if it does
    // not round-trip them.
    await http(app, token)
      .patch(`/journal/${stopOut.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'typo fixed',
        occurredAt: '2026-01-08T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: -100, price: 180, fee: 0 },
      })
      .expect(200);

    const rows = (await dataSource.query(
      `SELECT quantity FROM stop_executions WHERE "stopLevelId" = $1`, [stopLevelId],
    )) as Array<{ quantity: string }>;
    // Auto-recognition recomputes the attribution on every save, so the
    // ON DELETE CASCADE no longer destroys it: the row is rebuilt from the
    // prices. This test previously pinned the loss as a known hazard.
    expect(rows).toHaveLength(1);

    const kinds = (await dataSource.query(
      `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
    )) as Array<{ exitKind: string | null }>;
    // Regenerated alongside the execution row, from the prices.
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
  it('filters by search text and an inclusive date range, server-side', async () => {
    const trade = async (symbol: string, day: string, body: string) =>
      http(app, token)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body,
          occurredAt: `${day}T12:00:00.000Z`,
          trade: { symbol, quantity: 1, price: 10, fee: 0 },
        })
        .expect(201);

    await trade('NVDA', '2026-03-01', 'breakout entry');
    await trade('AAPL', '2026-05-10', 'pullback buy');

    // Matches a ticker...
    const bySymbol = await http(app, token).get('/journal?search=nvd').expect(200);
    expect(bySymbol.body.map((e: { trade: { symbol: string } }) => e.trade.symbol)).toEqual([
      'NVDA',
    ]);

    // ...and anything in the note.
    const byBody = await http(app, token).get('/journal?search=pullback').expect(200);
    expect(byBody.body).toHaveLength(1);
    expect(byBody.body[0].trade.symbol).toBe('AAPL');

    // Bounds include their own day: "to 2026-03-01" keeps the 1st.
    const ranged = await http(app, token)
      .get('/journal?from=2026-03-01&to=2026-03-01')
      .expect(200);
    expect(ranged.body).toHaveLength(1);
    expect(ranged.body[0].trade.symbol).toBe('NVDA');

    const none = await http(app, token)
      .get('/journal?from=2026-06-01&to=2026-06-30')
      .expect(200);
    expect(none.body).toEqual([]);
  });
});
