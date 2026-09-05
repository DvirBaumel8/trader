import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { http, login } from './http.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Trades (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No test reaches the network. See test/yahoo-stub.ts. BITX's extended
      // extreme is configured here (rather than per-test) because the stub
      // is built once for the whole file. 21 is deliberately above both the
      // daily bar's high and BITX's stub quote price (20, STUB_PRICES) used
      // below, so only folding in the extended print can produce it.
      .overrideProvider(YahooClient)
      .useValue(
        yahooStub({ extendedExtremes: { BITX: { high: 21, low: null } } }),
      )
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('404s an unparseable trade id', async () => {
    await http(app, token).get('/portfolio/trades/nonsense').expect(404);
  });

  it('404s a well-formed id that matches no trade', async () => {
    await http(app, token)
      .get(
        `/portfolio/trades/${encodeURIComponent('ZZZZ:2026-08-28T13:30:00.000Z')}`,
      )
      .expect(404);
  });

  it('requires a token', async () => {
    await request(app.getHttpServer())
      .get('/portfolio/trades/anything')
      .expect(401);
  });

  it('returns a seeded trade with its fills, stops, bars and lastBarDate', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'Pullback entry.',
        occurredAt: '2026-08-28T13:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 10,
          price: 200,
          fee: 4,
          stopLevels: [{ kind: 'FIXED', price: 190, quantity: 10 }],
        },
      })
      .expect(201);

    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'Scaling out.',
        occurredAt: '2026-08-29T13:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: -10, price: 220, fee: 4 },
      })
      .expect(201);

    const stats = await http(app, token).get('/portfolio/stats').expect(200);
    const [trade] = stats.body.trades;
    expect(trade.symbol).toBe('NVDA');
    // The stats payload stays lean: no fills or current stops on this route.
    expect(trade.fills).toBeUndefined();
    expect(trade.currentStops).toBeUndefined();

    const id = `${trade.symbol}:${trade.enteredAt}`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    expect(detail.body.trade).toMatchObject({
      symbol: 'NVDA',
      quantity: 10,
      avgEntry: 200,
      avgExit: 220,
    });
    expect(detail.body.fills).toHaveLength(2);
    expect(detail.body.fills[0]).toMatchObject({
      side: 'BUY',
      price: 200,
      quantity: 10,
      fee: 4,
    });
    expect(detail.body.fills[1]).toMatchObject({
      side: 'SELL',
      price: 220,
      quantity: 10,
      fee: 4,
    });
    expect(detail.body.stopLevels).toHaveLength(1);
    expect(detail.body.stopLevels[0]).toMatchObject({
      kind: 'FIXED',
      price: 190,
      quantity: 10,
    });
    expect(Array.isArray(detail.body.bars)).toBe(true);
    expect(
      detail.body.lastBarDate === null ||
        typeof detail.body.lastBarDate === 'string',
    ).toBe(true);
  });

  it('surfaces currentPrice and highWaterPrice for an open trade, so the Stop Plan editor can price a draft from here', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'still open',
        occurredAt: '2026-08-28T13:30:00.000Z',
        trade: {
          symbol: 'PLTR',
          quantity: 100,
          price: 150,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 145, quantity: 100 }],
        },
      })
      .expect(201);

    const id = `PLTR:2026-08-28T13:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    // PLTR's stub quote is 170 (test/yahoo-stub.ts) — with no bars on
    // record, the high-water mark is just today's live price.
    expect(detail.body.trade.currentPrice).toBeCloseTo(170, 6);
    expect(detail.body.trade.highWaterPrice).toBeCloseTo(170, 6);
  });

  it('leaves currentPrice and highWaterPrice null for a closed trade', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'opened',
        occurredAt: '2026-08-28T13:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 0 },
      })
      .expect(201);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'closed',
        occurredAt: '2026-08-29T13:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: -10, price: 220, fee: 0 },
      })
      .expect(201);

    const id = `NVDA:2026-08-28T13:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    expect(detail.body.trade.currentPrice).toBeNull();
    expect(detail.body.trade.highWaterPrice).toBeNull();
  });

  it('returns the target recorded at entry, so the chart can draw it', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'aiming for 240',
        occurredAt: '2026-08-28T13:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 10,
          price: 200,
          fee: 0,
          plannedTarget: 240,
        },
      })
      .expect(201);

    const id = `NVDA:2026-08-28T13:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    expect(detail.body.trade.plannedTarget).toBe(240);
  });

  it('resolves a TRAILING stop level to a concrete resolvedPrice from the high-water mark', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'breakout entry',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'ONDS',
          quantity: 1000,
          price: 7.36,
          fee: 0,
          stopLevels: [{ kind: 'TRAILING', trailPercent: 8.5, quantity: 1000 }],
        },
      })
      .expect(201);

    const [{ id: instrumentId }] = (await dataSource.query(
      `SELECT id FROM instruments WHERE symbol = 'ONDS'`,
    )) as Array<{ id: string }>;
    // Huge artificial high so the assertion is deterministic regardless of
    // ONDS's real, live-fetched quote — see portfolio.e2e-spec.ts's sibling
    // test for the same trick.
    await dataSource.query(
      `INSERT INTO daily_closes (id, "instrumentId", date, close, "adjClose", open, high, low, volume)
       VALUES (public.uuid_generate_v4(), $1, '2026-01-06', 950, 950, 960, 1000, 900, 2000000)`,
      [instrumentId],
    );

    const id = `ONDS:2026-01-03T14:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);
    expect(detail.body.stopLevels).toHaveLength(1);
    // 1000 * (1 - 0.085) = 915, not the entry-anchored 7.36 * 0.915.
    expect(detail.body.stopLevels[0].resolvedPrice).toBeCloseTo(915, 6);
    expect(detail.body.stopPlanStatus.issue).not.toBe('UNRESOLVED_TRAILING');
  });

  it('resolves a TRAILING stop from an extended-hours high, not just daily bars and the live quote', async () => {
    // The real incident this guards: a BITX-style symbol whose true
    // high-water mark was set by a pre/post-market print (21, configured on
    // the shared stub above), higher than both its daily bar (19.21) and its
    // live regular-session quote (20, STUB_PRICES) — the trade detail must
    // agree with the Stops page and price the trail from the true mark.
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'breakout entry',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'BITX',
          quantity: 100,
          price: 18,
          fee: 0,
          stopLevels: [{ kind: 'TRAILING', trailPercent: 5, quantity: 100 }],
        },
      })
      .expect(201);

    const [{ id: instrumentId }] = (await dataSource.query(
      `SELECT id FROM instruments WHERE symbol = 'BITX'`,
    )) as Array<{ id: string }>;
    await dataSource.query(
      `INSERT INTO daily_closes (id, "instrumentId", date, close, "adjClose", open, high, low, volume)
       VALUES (public.uuid_generate_v4(), $1, '2026-01-06', 19.0, 19.0, 18.8, 19.21, 18.7, 2000000)`,
      [instrumentId],
    );

    const id = `BITX:2026-01-03T14:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    // 21 * (1 - 0.05) = 19.95, not the live-quote-only 20 * 0.95 = 19.
    expect(detail.body.stopLevels[0].resolvedPrice).toBeCloseTo(19.95, 6);
  });

  it('leaves resolvedPrice null for a closed trade with no bar history at all', async () => {
    // Closed, so getTrade() never reaches for a live quote either — with no
    // daily_closes rows for ONDS in this range, there is truly nothing to
    // compute a high-water mark from.
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'breakout entry',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'ONDS',
          quantity: 1000,
          price: 7.36,
          fee: 0,
          stopLevels: [{ kind: 'TRAILING', trailPercent: 8.5, quantity: 1000 }],
        },
      })
      .expect(201);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'closing',
        occurredAt: '2026-01-04T14:30:00.000Z',
        trade: { symbol: 'ONDS', quantity: -1000, price: 8, fee: 0 },
      })
      .expect(201);

    const id = `ONDS:2026-01-03T14:30:00.000Z`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);
    // A wrong stop level (the old entry-anchored 6.7344) is worse than an
    // absent one — null, never a guessed fallback.
    expect(detail.body.stopLevels[0].resolvedPrice).toBeNull();
  });

  describe('PATCH /portfolio/trades/:id/stops', () => {
    it('appends a new stop revision on the opening transaction without touching the prior one', async () => {
      await http(app, token)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'opening',
          occurredAt: '2026-01-03T14:30:00.000Z',
          trade: {
            symbol: 'SMCI',
            quantity: 1150,
            price: 32,
            fee: 0,
            stopLevels: [
              { kind: 'FIXED', price: 36.92, quantity: 600 },
              { kind: 'FIXED', price: 30.39, quantity: 550 },
            ],
          },
        })
        .expect(201);
      await http(app, token)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'upper tier executed',
          occurredAt: '2026-01-04T14:30:00.000Z',
          trade: { symbol: 'SMCI', quantity: -600, price: 36.92, fee: 0 },
        })
        .expect(201);

      const id = `SMCI:2026-01-03T14:30:00.000Z`;
      const revised = await http(app, token)
        .patch(`/portfolio/trades/${encodeURIComponent(id)}/stops`)
        .send({ levels: [{ kind: 'FIXED', price: 30.39, quantity: 550 }] })
        .expect(200);
      // The response is an acknowledgement, not the rebuilt trade. It used to
      // return the whole trade — fresh quotes, bars and indicators — which the
      // only caller discards, and which cost up to 3.6s on a cold cache while
      // the editor sat waiting. What the save actually did is asserted below,
      // by reading it back, which was always the stronger check.
      expect(revised.body).toEqual({ ok: true, levels: 1 });

      const detail = await http(app, token)
        .get(`/portfolio/trades/${encodeURIComponent(id)}`)
        .expect(200);
      expect(detail.body.stopLevels).toEqual([
        {
          // A real uuid from stop_levels; the entry sheet needs it to name
          // which tier an exit executed, so it is part of the payload now.
          id: expect.any(String),
          kind: 'FIXED',
          price: 30.39,
          trailPercent: null,
          quantity: 550,
          resolvedPrice: 30.39,
        },
      ]);
      expect(detail.body.stopPlanStatus.needsUpdate).toBe(false);

      // The entry stop — the FIRST revision, which defines R — must survive a
      // revision untouched: the trade id still resolves to the same opening
      // fill, and this was purely an append. Asserted on the read-back rather
      // than on the PATCH's own response, which is now an acknowledgement.
      expect(detail.body.trade.riskAmount).not.toBeNull();
    });

    it('refuses to empty a stop plan, rather than silently keeping it', async () => {
      // stop_levels is append-only and a revision IS its rows, so an empty
      // list writes nothing, leaves revisionSeq unadvanced, and the PREVIOUS
      // revision stays live. Before this guard the save appeared to succeed
      // while the tier remained priced into the at-risk figure.
      await http(app, token)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'entry with a stop',
          occurredAt: '2026-01-03T14:30:00.000Z',
          trade: {
            symbol: 'NVDA',
            quantity: 100,
            price: 200,
            fee: 0,
            stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
          },
        })
        .expect(201);

      const tradeId = `NVDA:2026-01-03T14:30:00.000Z`;
      await http(app, token)
        .patch(`/portfolio/trades/${encodeURIComponent(tradeId)}/stops`)
        .send({ levels: [] })
        .expect(400);

      // The tier is untouched, not half-removed.
      const after = await http(app, token)
        .get(`/portfolio/trades/${encodeURIComponent(tradeId)}`)
        .expect(200);
      expect(after.body.stopLevels).toHaveLength(1);
      expect(after.body.stopLevels[0].price).toBe(180);
    });

    it('404s an unknown trade id', async () => {
      await http(app, token)
        .patch(
          `/portfolio/trades/${encodeURIComponent('ZZZZ:2026-08-28T13:30:00.000Z')}/stops`,
        )
        .send({ levels: [] })
        .expect(404);
    });
  });
});
