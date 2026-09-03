import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('AI summaries (e2e)', () => {
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
    await dataSource.query('TRUNCATE ai_summaries RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  // No LLM_API_KEY is set for the test environment (see backend/.env) — by
  // design, per the "never call a real model in a test" rule. That makes
  // POST /ai/portfolio-summary deterministically return `configured: false`
  // and persist nothing here, which these tests rely on.

  it('blocks every AI route without a token', async () => {
    await request(app.getHttpServer()).get('/ai/summaries').expect(401);
    await request(app.getHttpServer())
      .get(`/ai/summaries/${randomUUID()}`)
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/ai/summaries/${randomUUID()}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/ai/portfolio-summary')
      .expect(401);
  });

  it('returns an empty history list before any summary exists', async () => {
    const res = await http(app, token).get('/ai/summaries').expect(200);
    expect(res.body).toEqual([]);
  });

  it('404s fetching an unknown summary id', async () => {
    await http(app, token).get(`/ai/summaries/${randomUUID()}`).expect(404);
  });

  it('404s deleting an unknown summary id', async () => {
    await http(app, token).delete(`/ai/summaries/${randomUUID()}`).expect(404);
  });

  it('POST /ai/portfolio-summary reports unconfigured and persists nothing when no provider key is set', async () => {
    const res = await http(app, token).post('/ai/portfolio-summary').expect(201);
    expect(res.body).toEqual({
      configured: false,
      summary: null,
      factsAsOf: null,
      error: null,
      // Null rather than 'setup_problem': having no key at all is the
      // configured:false case, not a misconfigured one.
      errorKind: null,
      id: null,
    });

    const list = await http(app, token).get('/ai/summaries').expect(200);
    expect(list.body).toEqual([]);
  });
});
