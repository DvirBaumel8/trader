import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';

describe('Portfolio (e2e)', () => {
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
});
