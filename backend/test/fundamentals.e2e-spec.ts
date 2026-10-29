import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { JSON_BODY_LIMIT } from '../src/body-limit.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { AlphaVantageClient } from '../src/market-data/alpha-vantage.client.js';
import { yahooStub, STUB_FUNDAMENTALS, STUB_FUNDAMENTALS_CALLS } from './yahoo-stub.js';
import { alphaVantageStub, STUB_ESTIMATES } from './alpha-vantage-stub.js';

const B = 1_000_000_000;

describe('Fundamentals (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .overrideProvider(AlphaVantageClient)
      .useValue(alphaVantageStub())
      .compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>();
    nest.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app = nest;
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE fundamentals_cache');
    for (const k of Object.keys(STUB_FUNDAMENTALS)) delete STUB_FUNDAMENTALS[k];
    for (const k of Object.keys(STUB_FUNDAMENTALS_CALLS)) delete STUB_FUNDAMENTALS_CALLS[k];
    for (const k of Object.keys(STUB_ESTIMATES)) delete STUB_ESTIMATES[k];
    STUB_FUNDAMENTALS.NVDA = {
      quoteType: 'EQUITY',
      currency: 'USD',
      epsQuarters: [
        { periodEnd: '2026-04-30', fiscalQuarter: '1Q2027', actual: 1.9, reportedAt: '2026-05-27T20:20:00.000Z' },
        { periodEnd: '2026-07-31', fiscalQuarter: '2Q2027', actual: 2.22, reportedAt: '2026-08-26T20:20:00.000Z' },
      ],
      cash: 62.5 * B,
      debt: 38.9 * B,
      series: [
        { periodEnd: '2025-07-31', revenue: 46.7 * B, fcf: 13 * B },
        { periodEnd: '2026-04-30', revenue: 80 * B, fcf: 40 * B },
        { periodEnd: '2026-07-31', revenue: 96.2 * B, fcf: 45 * B },
      ],
    };
    STUB_ESTIMATES.NVDA = [
      { periodEnd: '2026-07-31', epsEstimate: 2.0916, revenueEstimate: 92.18 * B },
      { periodEnd: '2026-10-31', epsEstimate: 2.47, revenueEstimate: 109 * B },
    ];
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE fundamentals_cache');
    await dataSource.query(`DELETE FROM users WHERE email IS NOT NULL`);
    await app.close();
  });

  it('needs a login', async () => {
    await http(app).get('/knowledge/NVDA/fundamentals').expect(401);
  });

  it('returns the shaped table', async () => {
    const res = await http(app, token).get('/knowledge/nvda/fundamentals').expect(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.quarters.map((q: { label: string }) => q.label)).toEqual(['Q2 FY27', 'Q1 FY27']);
    expect(res.body.quarters[0]).toMatchObject({
      eps: 2.22,
      epsEstimate: 2.0916,
      epsSurprisePct: 6.1,
      revenue: 96.2 * B,
      revenueYoY: 106,
      fcf: 45 * B,
    });
    expect(res.body.next).toMatchObject({ label: 'Q3 FY27', epsEstimate: 2.47, revenueEstimate: 109 * B });
    expect(res.body).toMatchObject({ cash: 62.5 * B, debt: 38.9 * B });
    expect(res.body.netCash).toBeCloseTo(23.6 * B, 0);
  });

  it('asks the providers once across two requests the same day', async () => {
    const first = await http(app, token).get('/knowledge/NVDA/fundamentals').expect(200);
    const second = await http(app, token).get('/knowledge/NVDA/fundamentals').expect(200);
    expect(second.body).toEqual(first.body);
    expect(STUB_FUNDAMENTALS_CALLS.NVDA).toBe(1);
  });

  it('shows the actuals with no expectations when Alpha Vantage fails', async () => {
    STUB_ESTIMATES.NVDA = 'fail';
    const res = await http(app, token).get('/knowledge/NVDA/fundamentals').expect(200);
    expect(res.body.quarters[0]).toMatchObject({ eps: 2.22, epsEstimate: null, revenueEstimate: null });
    expect(res.body.next).toBeNull();
  });

  it('404s a ticker that is not a company, and asks Yahoo once', async () => {
    const res = await http(app, token).get('/knowledge/QQQ/fundamentals').expect(404);
    expect(res.body.message).toBe('QQQ is not a company');
    await http(app, token).get('/knowledge/QQQ/fundamentals').expect(404);
    expect(STUB_FUNDAMENTALS_CALLS.QQQ).toBe(1);
  });

  it('503s when Yahoo fails with nothing cached', async () => {
    STUB_FUNDAMENTALS.NVDA = 'fail';
    const res = await http(app, token).get('/knowledge/NVDA/fundamentals').expect(503);
    expect(res.body.message).toBe("Couldn't load the numbers right now.");
  });

  it('serves the cached table when Yahoo fails on a later day', async () => {
    await http(app, token).get('/knowledge/NVDA/fundamentals').expect(200);
    await dataSource.query(`UPDATE fundamentals_cache SET "fetchedAt" = "fetchedAt" - interval '2 days'`);
    STUB_FUNDAMENTALS.NVDA = 'fail';
    const res = await http(app, token).get('/knowledge/NVDA/fundamentals').expect(200);
    expect(res.body.quarters[0].label).toBe('Q2 FY27');
  });
});
