import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
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

  it('watches tickers in bulk, listed in the order added, with their names', async () => {
    const add = await http(app, token).post('/watchlist').send({ symbols: ['nvda', 'AAPL'] }).expect(201);
    expect(add.body).toEqual({ added: ['NVDA', 'AAPL'], already: [], notFound: [], full: [] });
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([
      { symbol: 'NVDA', name: 'NVDA Inc' },
      { symbol: 'AAPL', name: 'AAPL Inc' },
    ]);
  });

  it('does not duplicate a ticker watched twice', async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['NVDA'] }).expect(201);
    const again = await http(app, token).post('/watchlist').send({ symbols: ['NVDA', '$nvda'] }).expect(201);
    expect(again.body).toEqual({ added: [], already: ['NVDA'], notFound: [], full: [] });
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('reports a ticker the provider does not know instead of failing the batch', async () => {
    const res = await http(app, token).post('/watchlist').send({ symbols: ['ZZZZ', 'AMD'] }).expect(201);
    expect(res.body).toEqual({ added: ['AMD'], already: [], notFound: ['ZZZZ'], full: [] });
  });

  it('stops at 50 and reports the rest as full', async () => {
    const symbols = Array.from({ length: 50 }, (_, i) => `A${String(i).padStart(2, '0')}`);
    const first = await http(app, token).post('/watchlist').send({ symbols }).expect(201);
    expect(first.body.added).toHaveLength(50);
    const res = await http(app, token).post('/watchlist').send({ symbols: ['A00', 'NVDA'] }).expect(201);
    expect(res.body).toEqual({ added: [], already: ['A00'], notFound: [], full: ['NVDA'] });
  });

  it('rejects an empty or oversized list', async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['', ' '] }).expect(400);
    await http(app, token).post('/watchlist').send({ symbols: [] }).expect(400);
    await http(app, token).post('/watchlist').send({ symbols: Array.from({ length: 51 }, (_, i) => `T${i}`) }).expect(400);
  });

  it('stops watching by symbol, and 404s for one not watched', async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['NVDA'] }).expect(201);
    await http(app, token).delete('/watchlist/nvda').expect(200);
    await http(app, token).delete('/watchlist/NVDA').expect(404);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });

  it('keeps the order set by PUT /watchlist/order, and new items go last', async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['LMND', 'NVDA', 'TSLA'] }).expect(201);
    const res = await http(app, token).put('/watchlist/order').send({ symbols: ['tsla', 'LMND', 'NVDA'] }).expect(200);
    expect(res.body.map((r: { symbol: string }) => r.symbol)).toEqual(['TSLA', 'LMND', 'NVDA']);
    await http(app, token).post('/watchlist').send({ symbols: ['AAPL'] }).expect(201);
    const list = await http(app, token).get('/watchlist').expect(200);
    expect(list.body.map((r: { symbol: string }) => r.symbol)).toEqual(['TSLA', 'LMND', 'NVDA', 'AAPL']);
  });

  it('rejects an unknown symbol in the order with 400, and a bad body', async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['LMND'] }).expect(201);
    const res = await http(app, token).put('/watchlist/order').send({ symbols: ['LMND', 'NVDA'] }).expect(400);
    expect(res.body.message).toBe('Unknown symbol in order: NVDA');
    await http(app, token).put('/watchlist/order').send({ symbols: [] }).expect(400);
    await http(app, token).put('/watchlist/order').send({ symbols: [1] }).expect(400);
  });

  it("reordering never touches another user's list", async () => {
    await http(app, token).post('/watchlist').send({ symbols: ['LMND', 'NVDA'] }).expect(201);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `order-${Date.now()}@e2e.local`, password: 'other-password-1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    await http(app, other).post('/watchlist').send({ symbols: ['LMND', 'NVDA'] }).expect(201);
    await http(app, other).put('/watchlist/order').send({ symbols: ['NVDA', 'LMND'] }).expect(200);
    const mine = await http(app, token).get('/watchlist').expect(200);
    expect(mine.body.map((r: { symbol: string }) => r.symbol)).toEqual(['LMND', 'NVDA']);
    await http(app, other).put('/watchlist/order').send({ symbols: ['TSLA'] }).expect(400);
  });
});
