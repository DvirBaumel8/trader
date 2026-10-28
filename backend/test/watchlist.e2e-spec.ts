import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Watchlist (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    await dataSource.query('TRUNCATE watchlist_items, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty', async () => {
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });

  it('watches a ticker, listed by symbol with its name', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'nvda' }).expect(201);
    await http(app, token).post('/watchlist').send({ symbol: 'AAPL' }).expect(201);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([
      { symbol: 'AAPL', name: 'AAPL Inc' },
      { symbol: 'NVDA', name: 'NVDA Inc' },
    ]);
  });

  it('does not duplicate a ticker watched twice', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    const again = await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    expect(again.body).toEqual({ added: false, symbol: 'NVDA' });
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('refuses a ticker the provider does not know', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'ZZZZ' }).expect(404);
  });

  it('stops watching by symbol, and 404s for one not watched', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    await http(app, token).delete('/watchlist/nvda').expect(200);
    await http(app, token).delete('/watchlist/NVDA').expect(404);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });
});
