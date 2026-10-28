import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Holdings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    await dataSource.query('TRUNCATE holdings, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty', async () => {
    expect((await http(app, token).get('/holdings').expect(200)).body).toEqual([]);
  });

  it('adds holdings in bulk, in the order added, symbols and names only', async () => {
    const res = await http(app, token).post('/holdings').send({ symbols: ['tsla', 'LMND'] }).expect(201);
    expect(res.body).toEqual({ added: ['TSLA', 'LMND'], already: [], notFound: [] });
    expect((await http(app, token).get('/holdings').expect(200)).body).toEqual([
      { symbol: 'TSLA', name: 'TSLA Inc' },
      { symbol: 'LMND', name: 'LMND Inc' },
    ]);
  });

  it('stores every holding as LONG', async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND'] }).expect(201);
    expect(await dataSource.query('SELECT DISTINCT direction FROM holdings')).toEqual([{ direction: 'LONG' }]);
  });

  it('normalises, de-duplicates, and sorts each symbol into one group', async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND'] }).expect(201);
    const res = await http(app, token)
      .post('/holdings')
      .send({ symbols: [' $nvda ', 'NVDA', 'lmnd', 'ZZZZ'] })
      .expect(201);
    expect(res.body).toEqual({ added: ['NVDA'], already: ['LMND'], notFound: ['ZZZZ'] });
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(2);
  });

  it('rejects an empty, oversized or malformed list', async () => {
    await http(app, token).post('/holdings').send({ symbols: [] }).expect(400);
    await http(app, token).post('/holdings').send({ symbols: Array.from({ length: 51 }, (_, i) => `T${i}`) }).expect(400);
    await http(app, token).post('/holdings').send({ symbol: 'LMND' }).expect(400);
    const blank = await http(app, token).post('/holdings').send({ symbols: [' ', '$'] }).expect(400);
    expect(blank.body.message).toContain('No valid symbols');
  });

  it('no longer takes a direction per symbol', async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(404);
  });

  it('removes by symbol, and 404s for one not held', async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND'] }).expect(201);
    await http(app, token).delete('/holdings/lmnd').expect(200);
    await http(app, token).delete('/holdings/LMND').expect(404);
  });

  it("never shows or removes another user's holdings", async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND'] }).expect(201);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `other-${Date.now()}@e2e.local`, password: 'other-password-1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    expect((await http(app, other).get('/holdings').expect(200)).body).toEqual([]);
    await http(app, other).delete('/holdings/LMND').expect(404);
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(1);
  });

  it('keeps the order set by PUT /holdings/order, and new items go last', async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND', 'NVDA', 'TSLA'] }).expect(201);
    const res = await http(app, token).put('/holdings/order').send({ symbols: ['tsla', 'LMND', 'NVDA'] }).expect(200);
    expect(res.body.map((r: { symbol: string }) => r.symbol)).toEqual(['TSLA', 'LMND', 'NVDA']);
    await http(app, token).post('/holdings').send({ symbols: ['AAPL'] }).expect(201);
    const list = await http(app, token).get('/holdings').expect(200);
    expect(list.body.map((r: { symbol: string }) => r.symbol)).toEqual(['TSLA', 'LMND', 'NVDA', 'AAPL']);
  });

  it('rejects an unknown symbol in the order with 400, and a bad body', async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND'] }).expect(201);
    const res = await http(app, token).put('/holdings/order').send({ symbols: ['LMND', 'NVDA'] }).expect(400);
    expect(res.body.message).toBe('Unknown symbol in order: NVDA');
    await http(app, token).put('/holdings/order').send({ symbols: [] }).expect(400);
    await http(app, token).put('/holdings/order').send({ symbols: [1] }).expect(400);
  });

  it("reordering never touches another user's list", async () => {
    await http(app, token).post('/holdings').send({ symbols: ['LMND', 'NVDA'] }).expect(201);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `order-${Date.now()}@e2e.local`, password: 'other-password-1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    await http(app, other).post('/holdings').send({ symbols: ['LMND', 'NVDA'] }).expect(201);
    await http(app, other).put('/holdings/order').send({ symbols: ['NVDA', 'LMND'] }).expect(200);
    const mine = await http(app, token).get('/holdings').expect(200);
    expect(mine.body.map((r: { symbol: string }) => r.symbol)).toEqual(['LMND', 'NVDA']);
    await http(app, other).put('/holdings/order').send({ symbols: ['TSLA'] }).expect(400);
  });
});
