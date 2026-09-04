import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Portfolio (e2e)', () => {
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
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty portfolio before seeding', async () => {
    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.cash).toBe(0);
    expect(res.body.accountValue).toBe(0);
  });

  it('prices seeded positions and computes account value', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.positions).toHaveLength(1);

    const p = res.body.positions[0];
    expect(p.symbol).toBe('NVDA');
    expect(p.quantity).toBe(10);
    expect(p.avgCost).toBe(100);
    expect(typeof p.price).toBe('number');
    expect(p.marketValue).toBeCloseTo(p.price * 10, 2);
    expect(p.unrealizedPnl).toBeCloseTo(p.price * 10 - 1000, 2);

    // The seed deposit is startingCash + holdings cost, and the opening BUYs
    // then spend the holdings cost — so the balance lands exactly on what the
    // user said they had. This is the invariant most likely to regress.
    expect(res.body.cash).toBe(10000);
    expect(res.body.accountValue).toBeCloseTo(10000 + p.marketValue, 2);
  });

  it('seeds a short position with the right sign and cash', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 5000,
        holdings: [{ symbol: 'TSLA', quantity: -10, avgCost: 300 }],
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    const p = res.body.positions[0];
    expect(p.symbol).toBe('TSLA');
    expect(p.quantity).toBe(-10);
    expect(p.costBasis).toBe(-3000);
    expect(p.avgCost).toBe(300);
    expect(res.body.cash).toBe(5000);
  });

  it('supports a negative starting cash balance (margin)', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: -2500,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.cash).toBe(-2500);
  });

  it('exposes one stop-tier row per stop, priced against the live quote', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'scaled stop',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 100,
          price: 217,
          fee: 0,
          stopLevels: [
            { kind: 'FIXED', price: 205, quantity: 60 },
            { kind: 'FIXED', price: 210, quantity: 40 },
          ],
        },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    const rows = res.body.stopTiers.filter(
      (r: { symbol: string }) => r.symbol === 'NVDA',
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.direction).toBe('LONG');
      expect(r.currentPrice).toBe(res.body.positions[0].price);
      expect(typeof r.distance).toBe('number');
      expect(typeof r.passed).toBe('boolean');
    }
    expect(rows.map((r: { stopPrice: number }) => r.stopPrice).sort()).toEqual([
      205, 210,
    ]);
    expect(rows.map((r: { quantity: number }) => r.quantity).sort()).toEqual([
      40, 60,
    ]);
    // NVDA now has a stop, so it must not also appear in the unstopped list.
    expect(res.body.atRisk.positionsWithoutStop.symbols).not.toContain('NVDA');
  });

  it('leaves an unstopped position out of stopTiers and reports it as unstopped', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'no stop set',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 217, fee: 0 },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    expect(
      res.body.stopTiers.filter((r: { symbol: string }) => r.symbol === 'NVDA'),
    ).toEqual([]);
    expect(res.body.atRisk.positionsWithoutStop.symbols).toContain('NVDA');
  });

  it('excludes stops on a fully closed position from at-risk and the Stops page', async () => {
    // Buy, stop it, then sell it all — the position closes to 0 but the
    // stop tiers stay on the opening transaction, exactly the bug the
    // owner found live: BITX/BMNR/MSTR carry stops after being fully
    // closed.
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'opening',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'BITX',
          quantity: 100,
          price: 13.29,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 11, quantity: 100 }],
        },
      })
      .expect(201);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'closing',
        occurredAt: '2026-01-04T14:30:00.000Z',
        trade: { symbol: 'BITX', quantity: -100, price: 17.46, fee: 0 },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    // The position is gone, so it must not appear at all, and it must not
    // contribute any dollars to the at-risk total.
    expect(res.body.positions).toEqual([]);
    expect(res.body.atRisk.amount).toBe(0);
    expect(
      res.body.stopTiers.filter((r: { symbol: string }) => r.symbol === 'BITX'),
    ).toEqual([]);
  });

  it('caps the at-risk dollar figure when tiers overshoot the held quantity', async () => {
    // SMCI's shape: 1150 opened with two tiers (600 @ 36.92, 550 @ 30.39),
    // then 600 sold WELL AWAY from either level — a decision, not a stop, so
    // nothing is auto-attributed and both tiers stay on record against a
    // 550-share position. The app must not price 1150 shares of protection.
    // (A sale AT 36.92 is now recognised as that tier firing and leaves the
    // plan correctly matching what is held — see the auto-recognition tests
    // in journal.e2e-spec.ts.)
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
        body: 'sold on a view, nowhere near either stop',
        occurredAt: '2026-01-04T14:30:00.000Z',
        trade: { symbol: 'SMCI', quantity: -600, price: 41.5, fee: 0 },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    const p = res.body.positions.find(
      (x: { symbol: string }) => x.symbol === 'SMCI',
    );
    expect(p.quantity).toBe(550);

    const needsUpdate = res.body.atRisk.stopPlanNeedsUpdate.positions.find(
      (n: { symbol: string }) => n.symbol === 'SMCI',
    );
    expect(needsUpdate).toMatchObject({
      issue: 'OVER_COVERED',
      recordedQuantity: 1150,
      heldQuantity: 550,
    });
  });

  it('flags a short whose stops were recorded while long, and excludes it from at-risk', async () => {
    // MRNA's shape: 400 bought long with a stop set below entry, then one
    // SELL of 600 flips the position to -200 in a single fill.
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'opening long',
        occurredAt: '2026-01-03T14:30:00.000Z',
        trade: {
          symbol: 'MRNA',
          quantity: 400,
          price: 60,
          fee: 0,
          stopLevels: [{ kind: 'FIXED', price: 55, quantity: 400 }],
        },
      })
      .expect(201);
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'flips short',
        occurredAt: '2026-01-04T14:30:00.000Z',
        trade: { symbol: 'MRNA', quantity: -600, price: 65, fee: 0 },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio').expect(200);
    const p = res.body.positions.find(
      (x: { symbol: string }) => x.symbol === 'MRNA',
    );
    expect(p.quantity).toBe(-200);

    const needsUpdate = res.body.atRisk.stopPlanNeedsUpdate.positions.find(
      (n: { symbol: string }) => n.symbol === 'MRNA',
    );
    expect(needsUpdate).toMatchObject({ issue: 'DIRECTION_MISMATCH' });
    // Not priced as protected, and not listed as bare-unstopped either — a
    // stop plan exists, it just no longer matches the direction held.
    expect(res.body.atRisk.positionsWithoutStop.symbols).not.toContain('MRNA');
    expect(
      res.body.stopTiers.filter((r: { symbol: string }) => r.symbol === 'MRNA'),
    ).toEqual([]);
  });

  it('resolves a trailing stop from the high-water price since entry, not the entry price', async () => {
    // ONDS-shaped: entry 7.36, TRAILING 8.5%, still open. The bug this
    // guards was resolving the trail from the entry price forever — a
    // fixed stop wearing a trailing label. The bars below once carried an
    // absurd high (1000) purely to dominate ONDS's real, live-fetched
    // quote; with the quote stubbed they can be the ordinary prices this
    // trade would actually have printed.
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
    await dataSource.query(
      `INSERT INTO daily_closes (id, "instrumentId", date, close, "adjClose", open, high, low, volume)
       VALUES (public.uuid_generate_v4(), $1, '2026-01-03', 7.40, 7.40, 7.36, 7.50, 7.20, 1000000),
              (public.uuid_generate_v4(), $1, '2026-01-06', 9.60, 9.60, 9.10, 10.00, 9.00, 2000000)`,
      [instrumentId],
    );

    const res = await http(app, token).get('/portfolio').expect(200);
    const row = res.body.stopTiers.find(
      (r: { symbol: string }) => r.symbol === 'ONDS',
    );
    expect(row).toBeDefined();
    // 10.00 * (1 - 0.085) = 9.15 — from the high-water mark, never
    // 7.36 * (1 - 0.085) = 6.7344, the old entry-anchored (wrong) answer.
    expect(row.stopPrice).toBeCloseTo(9.15, 6);

    const needsUpdate = res.body.atRisk.stopPlanNeedsUpdate.positions.find(
      (n: { symbol: string }) => n.symbol === 'ONDS',
    );
    expect(needsUpdate).toBeUndefined(); // resolved fine, nothing to flag
  });

  it('rejects seeding an unknown ticker', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 1000,
        holdings: [{ symbol: 'ZZZZNOTREAL', quantity: 1, avgCost: 1 }],
      })
      .expect(404);
  });

  it('writes nothing at all when one ticker in the batch is bad', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 1000,
        holdings: [
          { symbol: 'NVDA', quantity: 1, avgCost: 100 },
          { symbol: 'ZZZZNOTREAL', quantity: 1, avgCost: 1 },
        ],
      })
      .expect(404);

    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.cash).toBe(0);
  });

  it('refuses to seed twice', async () => {
    const body = {
      asOf: '2026-01-02',
      startingCash: 10000,
      holdings: [{ symbol: 'NVDA', quantity: 1, avgCost: 100 }],
    };
    await http(app, token)
      .post('/portfolio/seed')
      .send(body)
      .expect(201);
    await http(app, token)
      .post('/portfolio/seed')
      .send(body)
      .expect(409);
  });

  it('reports seeded status', async () => {
    const before = await http(app, token)
      .get('/portfolio/status')
      .expect(200);
    expect(before.body.seeded).toBe(false);

    await http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 100,
        holdings: [{ symbol: 'NVDA', quantity: 1, avgCost: 100 }],
      })
      .expect(201);

    const after = await http(app, token)
      .get('/portfolio/status')
      .expect(200);
    expect(after.body.seeded).toBe(true);
  });

  it('rejects a malformed seed payload', async () => {
    await http(app, token)
      .post('/portfolio/seed')
      .send({ asOf: 'not-a-date', startingCash: 'lots', holdings: 'nope' })
      .expect(400);
  });

  it('buckets fees server-side, defaulting an unknown period to months', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'entry',
        occurredAt: '2026-01-05T12:00:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 100, fee: 7 },
      })
      .expect(201);

    const res = await http(app, token).get('/portfolio/fees?period=MONTH').expect(200);
    expect(res.body.total).toBeCloseTo(7, 6);
    expect(res.body.buckets).toEqual([{ key: '2026-01', label: 'Jan', total: 7 }]);

    // A junk period must not 500 or return an empty chart.
    const fallback = await http(app, token).get('/portfolio/fees?period=DECADE').expect(200);
    expect(fallback.body.period).toBe('MONTH');
  });

  describe('stop-risk', () => {
    // The stop editor's live figure. Stateless and writes nothing: it prices
    // a plan the owner is still typing, which may never be saved. It exists
    // so the risk arithmetic has ONE implementation — the frontend used to
    // carry its own copy, which drifted and overstated risk.
    it('prices a draft plan without saving anything', async () => {
      const res = await http(app, token)
        .post('/portfolio/stop-risk')
        .send({
          avgEntry: 100,
          quantity: 100,
          direction: 'LONG',
          levels: [{ kind: 'FIXED', price: 90, quantity: 100 }],
        })
        .expect(201);

      expect(res.body.amount).toBeCloseTo(1000, 6);
      expect(res.body.coveredQuantity).toBeCloseTo(100, 6);
      expect(res.body.fullyCovered).toBe(true);
    });

    it('caps the dollar figure when tiers overshoot the position', async () => {
      // The exact case the frontend copy got wrong: it reported 1200.
      const res = await http(app, token)
        .post('/portfolio/stop-risk')
        .send({
          avgEntry: 100,
          quantity: 100,
          direction: 'LONG',
          levels: [
            { kind: 'FIXED', price: 90, quantity: 80 },
            { kind: 'FIXED', price: 95, quantity: 80 },
          ],
        })
        .expect(201);

      expect(res.body.amount).toBeCloseTo(750, 6);
      expect(res.body.overCovered).toBe(true);
    });

    it('counts a stop that locks in a gain as covered, at zero risk', async () => {
      const res = await http(app, token)
        .post('/portfolio/stop-risk')
        .send({
          avgEntry: 100,
          quantity: 100,
          direction: 'LONG',
          levels: [{ kind: 'FIXED', price: 120, quantity: 100 }],
        })
        .expect(201);

      expect(res.body.amount).toBeCloseTo(0, 6);
      expect(res.body.fullyCovered).toBe(true);
    });

    it('requires a token', async () => {
      await request(app.getHttpServer())
        .post('/portfolio/stop-risk')
        .send({ avgEntry: 100, quantity: 100, levels: [] })
        .expect(401);
    });

    it('rejects a malformed plan', async () => {
      await http(app, token)
        .post('/portfolio/stop-risk')
        .send({ avgEntry: 'lots', quantity: 100, levels: 'nope' })
        .expect(400);
    });
  });
});
