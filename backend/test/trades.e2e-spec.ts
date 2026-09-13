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

  // Computed relative to "now" rather than hardcoded, so the suite stays
  // correct whenever it actually runs. Recent: yesterday. Old: two years
  // back, safely outside every preset shorter than ALL. Shared by the range
  // and symbols describe blocks below.
  const iso = (d: Date) => d.toISOString();
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  };

  async function journalRoundTrip(
    symbol: string,
    closedAt: Date,
    prices: { entry: number; exit: number } = { entry: 100, exit: 120 },
    fee = 0,
  ) {
    const opened = new Date(closedAt);
    opened.setUTCDate(opened.getUTCDate() - 1);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'entry',
        occurredAt: iso(opened),
        trade: { symbol, quantity: 10, price: prices.entry, fee },
      })
      .expect(201);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'exit',
        occurredAt: iso(closedAt),
        trade: { symbol, quantity: -10, price: prices.exit, fee },
      })
      .expect(201);
  }

  describe('GET /portfolio/stats — range', () => {
    it('recomputes every figure for the window, not just the trades list', async () => {
      await journalRoundTrip('NVDA', daysAgo(1)); // recent: +200 realized
      await journalRoundTrip('AAPL', daysAgo(730)); // old: +200 realized, outside 1W

      const week = await http(app, token)
        .get('/portfolio/stats?range=1W')
        .expect(200);
      expect(week.body.trades.map((t: { symbol: string }) => t.symbol)).toEqual([
        'NVDA',
      ]);
      expect(week.body.totalPnl).toBe(200);
      expect(week.body.closedCount).toBe(1);

      const all = await http(app, token).get('/portfolio/stats').expect(200);
      expect(all.body.trades).toHaveLength(2);
      expect(all.body.totalPnl).toBe(400);
      expect(all.body.closedCount).toBe(2);
    });

    it('falls back to ALL for an unrecognised range value, the same way the benchmark endpoint does', async () => {
      await journalRoundTrip('NVDA', daysAgo(730));

      const res = await http(app, token)
        .get('/portfolio/stats?range=nonsense')
        .expect(200);
      expect(res.body.trades).toHaveLength(1);
    });
  });

  describe('GET /portfolio/symbols', () => {
    it('lists only symbols with at least one closed trade, most recently active first', async () => {
      await journalRoundTrip('AAPL', daysAgo(30));
      await journalRoundTrip('NVDA', daysAgo(1));
      // An open-only position must not appear — it has no closed trade yet.
      await http(app, token)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'still open',
          occurredAt: iso(daysAgo(1)),
          trade: { symbol: 'MSFT', quantity: 5, price: 300, fee: 0 },
        })
        .expect(201);

      const res = await http(app, token).get('/portfolio/symbols').expect(200);
      expect(res.body.map((r: { symbol: string }) => r.symbol)).toEqual([
        'NVDA',
        'AAPL',
      ]);
      expect(res.body[0]).toMatchObject({ closedCount: 1, totalPnl: 200 });
    });

    it('returns an empty list rather than erroring with no closed trades at all', async () => {
      const res = await http(app, token).get('/portfolio/symbols').expect(200);
      expect(res.body).toEqual([]);
    });

    it('drops a symbol whose only closed trade falls outside the window, and recomputes its total for the ones that stay', async () => {
      await journalRoundTrip('NVDA', daysAgo(1)); // inside 1W
      await journalRoundTrip('AAPL', daysAgo(730)); // outside 1W

      const week = await http(app, token)
        .get('/portfolio/symbols?range=1W')
        .expect(200);
      expect(week.body.map((r: { symbol: string }) => r.symbol)).toEqual([
        'NVDA',
      ]);

      const all = await http(app, token).get('/portfolio/symbols').expect(200);
      expect(all.body.map((r: { symbol: string }) => r.symbol).sort()).toEqual([
        'AAPL',
        'NVDA',
      ]);
    });

    it('reports latestExit so the frontend can offer its own sort', async () => {
      await journalRoundTrip('NVDA', daysAgo(1));
      const res = await http(app, token).get('/portfolio/symbols').expect(200);
      expect(typeof res.body[0].latestExit).toBe('string');
    });

    it('reports feesPaid per symbol, scoped to the same window as the rest of the row', async () => {
      await journalRoundTrip('NVDA', daysAgo(1), { entry: 100, exit: 120 }, 4); // 2 fills, $4 each
      await journalRoundTrip('AAPL', daysAgo(730), { entry: 50, exit: 60 }, 2); // outside 1W

      const week = await http(app, token)
        .get('/portfolio/symbols?range=1W')
        .expect(200);
      expect(week.body).toEqual([expect.objectContaining({ symbol: 'NVDA', feesPaid: 8 })]);

      const all = await http(app, token).get('/portfolio/symbols').expect(200);
      const aapl = all.body.find((r: { symbol: string }) => r.symbol === 'AAPL');
      expect(aapl.feesPaid).toBe(4);
    });
  });

  describe('GET /portfolio/symbols/:symbol', () => {
    it('recomputes stats, fees and the trade list for one symbol, scoped to the window', async () => {
      await journalRoundTrip(
        'NVDA',
        daysAgo(1),
        { entry: 100, exit: 120 },
        4,
      ); // (120-100)*10 - 4 - 4 = 192, recent
      await journalRoundTrip(
        'NVDA',
        daysAgo(730),
        { entry: 50, exit: 60 },
        2,
      ); // (60-50)*10 - 2 - 2 = 96, old — outside 1W
      await journalRoundTrip('AAPL', daysAgo(1)); // a different symbol entirely

      const week = await http(app, token)
        .get('/portfolio/symbols/NVDA?range=1W')
        .expect(200);
      expect(week.body.symbol).toBe('NVDA');
      expect(week.body.closedCount).toBe(1);
      expect(week.body.totalPnl).toBe(192);
      expect(week.body.feesPaid).toBe(8);
      expect(week.body.trades).toHaveLength(1);

      const all = await http(app, token)
        .get('/portfolio/symbols/nvda') // case-insensitive, no range = ALL
        .expect(200);
      expect(all.body.closedCount).toBe(2);
      expect(all.body.totalPnl).toBe(288);
      expect(all.body.feesPaid).toBe(12);
    });

    it('404s a symbol with no trades at all, same as an unknown trade id', async () => {
      await http(app, token).get('/portfolio/symbols/ZZZZNOTREAL').expect(404);
    });
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

    it('empties a stop plan, and says so when read back', async () => {
      // stop_levels is append-only and a revision IS its rows, so an empty
      // list used to write nothing, leave revisionSeq unadvanced, and let the
      // PREVIOUS revision stay live and priced into at-risk. That was
      // rejected outright for a while. An emptied plan is now one tombstone
      // row, so the revision advances like any other.
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
      const cleared = await http(app, token)
        .patch(`/portfolio/trades/${encodeURIComponent(tradeId)}/stops`)
        .send({ levels: [] })
        .expect(200);
      expect(cleared.body).toEqual({ ok: true, levels: 0 });

      const after = await http(app, token)
        .get(`/portfolio/trades/${encodeURIComponent(tradeId)}`)
        .expect(200);
      // No tier, and no tombstone leaking out as one.
      expect(after.body.stopLevels).toEqual([]);
    });

    /**
     * R is anchored to risk at ENTRY (see the stop-executions design), so
     * clearing the live plan must not reach back and erase what the trade
     * originally risked. Revision 0 is never touched by a clear.
     */
    it('leaves the entry stop, and therefore R, intact after a clear', async () => {
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
        .expect(200);

      const after = await http(app, token)
        .get(`/portfolio/trades/${encodeURIComponent(tradeId)}`)
        .expect(200);
      expect(after.body.trade.riskAmount).not.toBeNull();
    });

    it('can set a plan again after clearing it', async () => {
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
        .expect(200);
      await http(app, token)
        .patch(`/portfolio/trades/${encodeURIComponent(tradeId)}/stops`)
        .send({ levels: [{ kind: 'FIXED', price: 190, quantity: 100 }] })
        .expect(200);

      const after = await http(app, token)
        .get(`/portfolio/trades/${encodeURIComponent(tradeId)}`)
        .expect(200);
      expect(after.body.stopLevels).toHaveLength(1);
      expect(after.body.stopLevels[0].price).toBe(190);
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
