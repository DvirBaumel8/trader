import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';

/** 220 flat bars with strictly increasing dates — enough for every indicator. */
const bars = Array.from({ length: 220 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
  return {
    date: day.toISOString().slice(0, 10),
    close: 100,
    adjClose: 100,
    open: 100,
    high: 101,
    low: 99,
    volume: 1_000_000,
  };
});

const yahooStub = {
  quote: async (symbol: string) =>
    symbol === 'ZZZZNOTREAL'
      ? null
      : {
          symbol,
          name: `${symbol} Inc`,
          price: 110,
          currency: 'USD',
          session: 'REGULAR',
          extended: false,
          regularPrice: 110,
          peRatio: 45.2,
        },
  dailyBars: async () => bars,
  quoteMany: async () => [],
};

describe('Trade idea (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let dataSource: DataSource;
  /** Every prompt the model was actually handed, so the wiring is testable. */
  const prompts: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub)
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => true,
        modelName: () => 'stub-model',
        complete: async ({ user }: { user: string }) => {
          prompts.push(user);
          if (user.includes('BOOM')) throw new Error('provider exploded');
          return user.includes('NOLEVELS')
            ? 'Prose with no block at all.'
            : 'Real prose about the trade.\n\nLEVELS\nstop: 99\ntarget: 130';
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
    dataSource = app.get(DataSource);
  });

  // Every test in this file asks for an opinion, and asking now persists one.
  // Without this, a test counting rows counts the ones its neighbours left
  // behind — and passes or fails depending on what ran before it.
  beforeEach(async () => {
    await dataSource.query('TRUNCATE trade_ideas RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a token', async () => {
    await request(app.getHttpServer())
      .post('/ai/trade-idea')
      .send({ symbol: 'NVDA' })
      .expect(401);
  });

  it('returns the opinion, the parsed levels, and risk the APP computed', async () => {
    const res = await http(app, token)
      .post('/ai/trade-idea')
      .send({ symbol: 'NVDA' })
      .expect(201);

    expect(res.body.symbol).toBe('NVDA');
    expect(res.body.opinion).toContain('Real prose');
    // The machine-readable block is not shown to the owner.
    expect(res.body.opinion).not.toContain('LEVELS');
    expect(res.body.levels).toEqual({ stop: 99, target: 130 });
    // Entry 110, stop 99, target 130 -> risk 11, reward 20.
    expect(res.body.risk.direction).toBe('LONG');
    expect(res.body.risk.riskPerShare).toBeCloseTo(11, 6);
    expect(res.body.risk.rewardPerShare).toBeCloseTo(20, 6);
    expect(res.body.risk.riskReward).toBeCloseTo(20 / 11, 6);
    expect(res.body.levelsUnreadable).toBe(false);
    // The facts the opinion rests on come back with it.
    expect(res.body.facts.indicators.sma20).toBeCloseTo(100, 6);
  });

  it('shows the prose and NO derived numbers when the levels cannot be read', async () => {
    const res = await http(app, token)
      .post('/ai/trade-idea')
      .send({ symbol: 'NOLEVELS' })
      .expect(201);

    expect(res.body.opinion).toBeTruthy();
    expect(res.body.levels).toBeNull();
    expect(res.body.risk).toBeNull();
    expect(res.body.levelsUnreadable).toBe(true);
  });

  it('404s an unknown ticker', async () => {
    await http(app, token)
      .post('/ai/trade-idea')
      .send({ symbol: 'ZZZZNOTREAL' })
      .expect(404);
  });

  it('rejects a malformed symbol before it reaches the provider', async () => {
    await http(app, token)
      .post('/ai/trade-idea')
      .send({ symbol: 'not a ticker!' })
      .expect(400);
  });

  it('hands the model the book, the record and the recent sessions', async () => {
    prompts.length = 0;
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    const [prompt] = prompts;
    expect(prompt).toBeDefined();
    // Formatting is unit-tested; what this proves is that the sections are
    // actually reaching the model rather than being built and dropped.
    expect(prompt).toContain('MY BOOK RIGHT NOW');
    expect(prompt).toContain('MY RECORD');
    expect(prompt).toContain('Last 10 sessions');
    // With an empty test book, it must say so rather than stay silent — the
    // model needs to know this is a new position, not merely be left guessing.
    expect(prompt).toContain('I do NOT currently hold NVDA');
  });

  it('persists the idea, including one whose levels could not be read', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NOLEVELS' }).expect(201);

    const rows = (await dataSource.query(
      `SELECT symbol, "entryPrice", stop, target, "riskReward", opinion, "factsSnapshot", model
         FROM trade_ideas ORDER BY symbol`,
    )) as Array<{
      symbol: string;
      entryPrice: string;
      stop: string | null;
      target: string | null;
      riskReward: string | null;
      opinion: string;
      factsSnapshot: string;
      model: string;
    }>;
    expect(rows).toHaveLength(2);

    const noLevels = rows.find((r) => r.symbol === 'NOLEVELS')!;
    expect(noLevels.stop).toBeNull();
    expect(noLevels.target).toBeNull();
    expect(noLevels.riskReward).toBeNull();
    // The prose is kept even when the numbers were refused — that is the
    // whole reason those three columns are nullable.
    expect(noLevels.opinion).toContain('Prose with no block');

    const nvda = rows.find((r) => r.symbol === 'NVDA')!;
    expect(Number(nvda.stop)).toBeCloseTo(99, 6);
    expect(Number(nvda.target)).toBeCloseTo(130, 6);
    expect(Number(nvda.entryPrice)).toBeCloseTo(110, 6);
    // Entry 110, stop 99, target 130 -> 20/11. Stored as the app computed it.
    expect(Number(nvda.riskReward)).toBeCloseTo(20 / 11, 6);
    expect(nvda.model).toBe('stub-model');
    // The LEVELS block is stripped from what the owner reads, but the facts
    // the model was given are kept verbatim, or the opinion can't be judged.
    expect(nvda.opinion).not.toContain('LEVELS');
    expect(nvda.factsSnapshot).toContain('NVDA');
  });

  it('lists ideas newest first, without the bulky facts snapshot', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'AAPL' }).expect(201);
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    // Two requests can land in the same millisecond, and `ORDER BY createdAt`
    // is then a coin flip — a test that asserts an order must not depend on
    // one it did not set. Backdating AAPL makes "newest first" a real claim
    // about the query rather than an accident of timing.
    await dataSource.query(
      `UPDATE trade_ideas SET "createdAt" = "createdAt" - interval '1 hour' WHERE symbol = 'AAPL'`,
    );

    const res = await http(app, token).get('/ai/trade-ideas').expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].symbol).toBe('NVDA'); // newest first
    expect(res.body[1].symbol).toBe('AAPL');
    // A list row carries what makes it worth opening — the symbol, the
    // numbers, and a taste of the prose — but never the multi-KB snapshot.
    expect(res.body[0].factsSnapshot).toBeUndefined();
    expect(res.body[0].preview).toContain('Real prose');
    expect(res.body[0].riskReward).toBeCloseTo(20 / 11, 6);
  });

  it('serves one idea in full, and 404s an id that is not there', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);
    const [row] = (await http(app, token).get('/ai/trade-ideas').expect(200)).body;

    const res = await http(app, token).get(`/ai/trade-ideas/${row.id}`).expect(200);
    expect(res.body.symbol).toBe('NVDA');
    expect(res.body.opinion).toContain('Real prose');
    // The full record is the one place the snapshot comes back.
    expect(res.body.factsSnapshot).toContain('NVDA');

    await http(app, token)
      .get('/ai/trade-ideas/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('deletes an idea, and 404s an id that is not there', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);
    const [row] = (await http(app, token).get('/ai/trade-ideas').expect(200)).body;

    await http(app, token).delete(`/ai/trade-ideas/${row.id}`).expect(200);
    expect((await http(app, token).get('/ai/trade-ideas').expect(200)).body).toHaveLength(0);

    await http(app, token)
      .delete('/ai/trade-ideas/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('saves nothing when the model call fails', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'BOOM' }).expect(201);

    const rows = (await dataSource.query(
      `SELECT id FROM trade_ideas`,
    )) as Array<{ id: string }>;
    expect(rows).toHaveLength(0);
  });
});

describe('Trade idea with no model key (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    // Yahoo throws if touched, proving the unconfigured path short-circuits
    // before any market data is fetched.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue({
        quote: async () => {
          throw new Error('Yahoo must not be called');
        },
        dailyBars: async () => {
          throw new Error('Yahoo must not be called');
        },
        quoteMany: async () => [],
      })
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => false,
        modelName: () => 'none',
        complete: async () => {
          throw new Error('must not be called');
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports unconfigured without fetching anything', async () => {
    const res = await http(app, token)
      .post('/ai/trade-idea')
      .send({ symbol: 'NVDA' })
      .expect(201);

    expect(res.body.configured).toBe(false);
    expect(res.body.facts).toBeNull();
    expect(res.body.opinion).toBeNull();
  });
});
