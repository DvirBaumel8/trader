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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub)
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => true,
        modelName: () => 'stub-model',
        complete: async ({ user }: { user: string }) => {
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
