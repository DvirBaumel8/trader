import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Portfolio (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE transactions, cash_flows, journal_entries RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty portfolio before seeding', async () => {
    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.cash).toBe(0);
    expect(res.body.accountValue).toBe(0);
  });

  it('prices seeded positions and computes account value', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
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
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 5000,
        holdings: [{ symbol: 'TSLA', quantity: -10, avgCost: 300 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    const p = res.body.positions[0];
    expect(p.symbol).toBe('TSLA');
    expect(p.quantity).toBe(-10);
    expect(p.costBasis).toBe(-3000);
    expect(p.avgCost).toBe(300);
    expect(res.body.cash).toBe(5000);
  });

  it('supports a negative starting cash balance (margin)', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: -2500,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    expect(res.body.cash).toBe(-2500);
  });

  it('rejects seeding an unknown ticker', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 1000,
        holdings: [{ symbol: 'ZZZZNOTREAL', quantity: 1, avgCost: 1 }],
      })
      .expect(404);
  });

  it('writes nothing at all when one ticker in the batch is bad', async () => {
    await request(app.getHttpServer())
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

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.cash).toBe(0);
  });

  it('refuses to seed twice', async () => {
    const body = {
      asOf: '2026-01-02',
      startingCash: 10000,
      holdings: [{ symbol: 'NVDA', quantity: 1, avgCost: 100 }],
    };
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send(body)
      .expect(409);
  });

  it('reports seeded status', async () => {
    const before = await request(app.getHttpServer())
      .get('/portfolio/status')
      .expect(200);
    expect(before.body.seeded).toBe(false);

    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 100,
        holdings: [{ symbol: 'NVDA', quantity: 1, avgCost: 100 }],
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/portfolio/status')
      .expect(200);
    expect(after.body.seeded).toBe(true);
  });

  it('rejects a malformed seed payload', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({ asOf: 'not-a-date', startingCash: 'lots', holdings: 'nope' })
      .expect(400);
  });
});
