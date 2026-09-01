import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';

describe('History (e2e)', () => {
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
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const seed = () =>
    http(app, token)
      .post('/portfolio/seed')
      .send({
        asOf: '2026-08-03',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

  it('backfills closes for held instruments and both benchmarks', async () => {
    await seed();

    const res = await http(app, token)
      .post('/history/backfill')
      .expect(201);

    expect(res.body.symbols).toEqual(
      expect.arrayContaining(['NVDA', 'SPY', 'QQQ']),
    );
    expect(res.body.barsWritten).toBeGreaterThan(0);

    const rows = await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM daily_closes',
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('is idempotent — running twice does not duplicate bars', async () => {
    await seed();
    await http(app, token).post('/history/backfill').expect(201);
    const first = await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM daily_closes',
    );
    await http(app, token).post('/history/backfill').expect(201);
    const second = await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM daily_closes',
    );
    expect(second[0].n).toBe(first[0].n);
  });

  it('stores an adjusted close alongside the raw one', async () => {
    await seed();
    await http(app, token).post('/history/backfill').expect(201);
    const rows = await dataSource.query(
      'SELECT close, "adjClose" FROM daily_closes LIMIT 5',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Number(r.close)).toBeGreaterThan(0);
      expect(Number(r.adjClose)).toBeGreaterThan(0);
    }
  });

  it('writes nothing when there are no transactions', async () => {
    const res = await http(app, token)
      .post('/history/backfill')
      .expect(201);
    expect(res.body).toEqual({ symbols: [], barsWritten: 0 });
  });
});
