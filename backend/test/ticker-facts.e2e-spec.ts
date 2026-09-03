import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';

describe('Ticker facts (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const bars = Array.from({ length: 220 }, (_, i) => ({
    date: `2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 100,
    adjClose: 100,
    open: 100,
    high: 101,
    low: 99,
    volume: 1_000_000,
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue({
        quote: async (symbol: string) =>
          symbol === 'NVDA'
            ? {
                symbol: 'NVDA',
                name: 'NVIDIA',
                price: 110,
                currency: 'USD',
                session: 'REGULAR',
                extended: false,
                regularPrice: 110,
                peRatio: 45.2,
              }
            : null,
        dailyBars: async () => bars,
        quoteMany: async () => [],
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a token', async () => {
    await request(app.getHttpServer()).get('/market-data/ticker-facts/NVDA').expect(401);
  });

  it('returns the quote and computed indicators for a known ticker', async () => {
    const res = await http(app, token)
      .get('/market-data/ticker-facts/NVDA')
      .expect(200);
    expect(res.body.symbol).toBe('NVDA');
    expect(res.body.price).toBe(110);
    expect(res.body.peRatio).toBe(45.2);
    expect(res.body.indicators.sma20).toBeCloseTo(100, 6);
    // 110 against a 100 average.
    expect(res.body.indicators.percentFromSma20).toBeCloseTo(0.1, 6);
    expect(res.body.indicators.barsAvailable).toBe(220);
  });

  it('404s a ticker Yahoo does not recognise', async () => {
    await http(app, token)
      .get('/market-data/ticker-facts/ZZZZNOTREAL')
      .expect(404);
  });

  it('writes nothing to instruments — a researched ticker is not a holding', async () => {
    await http(app, token).get('/market-data/ticker-facts/NVDA').expect(200);

    // The direct check: an orphan instruments row with no transaction would
    // not surface as a position, so checking /portfolio alone would pass
    // even if the service had inserted the researched ticker. Query the
    // table the invariant is actually about.
    const rows = (await dataSource.query(
      `SELECT id FROM instruments WHERE symbol = 'NVDA'`,
    )) as Array<{ id: string }>;
    expect(rows).toEqual([]);

    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
  });
});
