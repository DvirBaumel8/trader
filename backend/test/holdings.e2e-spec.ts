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

  it('adds holdings with a direction, sorted by symbol', async () => {
    await http(app, token).put('/holdings/tsla').send({ direction: 'SHORT' }).expect(200);
    const res = await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    expect(res.body).toEqual({ symbol: 'LMND', direction: 'LONG', previous: null });
    expect((await http(app, token).get('/holdings').expect(200)).body).toEqual([
      { symbol: 'LMND', name: 'LMND Inc', direction: 'LONG' },
      { symbol: 'TSLA', name: 'TSLA Inc', direction: 'SHORT' },
    ]);
  });

  it('flips a direction in place, never a second row', async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    const res = await http(app, token).put('/holdings/LMND').send({ direction: 'SHORT' }).expect(200);
    expect(res.body).toEqual({ symbol: 'LMND', direction: 'SHORT', previous: 'LONG' });
    await http(app, token).put('/holdings/LMND').send({ direction: 'SHORT' }).expect(200);
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(1);
  });

  it('rejects an unknown ticker and a bad direction', async () => {
    await http(app, token).put('/holdings/ZZZZ').send({ direction: 'LONG' }).expect(404);
    await http(app, token).put('/holdings/LMND').send({ direction: 'UP' }).expect(400);
  });

  it('removes by symbol, and 404s for one not held', async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    await http(app, token).delete('/holdings/lmnd').expect(200);
    await http(app, token).delete('/holdings/LMND').expect(404);
  });

  it("never shows or removes another user's holdings", async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `other-${Date.now()}@e2e.local`, password: 'other-password-1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    expect((await http(app, other).get('/holdings').expect(200)).body).toEqual([]);
    await http(app, other).delete('/holdings/LMND').expect(404);
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(1);
  });
});
