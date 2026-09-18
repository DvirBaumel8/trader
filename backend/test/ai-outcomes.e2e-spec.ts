import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';

/** 220 flat bars, then a run that pushes straight through the target. */
function bars(targetCrossingDate: string) {
  const flat = Array.from({ length: 220 }, (_, i) => {
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
  return [
    ...flat,
    {
      date: targetCrossingDate,
      close: 132,
      adjClose: 132,
      open: 128,
      high: 132,
      low: 127,
      volume: 1_000_000,
    },
  ];
}

describe('AI outcomes (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let dataSource: DataSource;
  let yahooBars: ReturnType<typeof bars>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue({
        quote: async (symbol: string) => ({
          symbol,
          name: `${symbol} Inc`,
          price: 100,
          currency: 'USD',
          session: 'REGULAR',
          extended: false,
          regularPrice: 100,
          peRatio: 30,
        }),
        quoteMany: async () => [],
        dailyBars: async () => yahooBars,
      })
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => true,
        modelName: () => 'stub-model',
        complete: async () => 'Real prose about the trade.\n\nLEVELS\nstop: 90\ntarget: 130',
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    yahooBars = bars('2026-09-05');
    await dataSource.query('TRUNCATE trade_ideas, ai_outcomes RESTART IDENTITY CASCADE');
    await dataSource.query(
      'TRUNCATE stop_levels, stop_executions, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    // This spec is the only one in the suite whose YahooClient stub returns
    // a real price spike (the target-crossing bar) rather than a flat line,
    // and PortfolioService.getPortfolio's fire-and-forget ensureFresh() (see
    // portfolio.service.ts) tops up EVERY instrument in the shared test
    // database on every call, not just the ones this spec created. NVDA
    // already exists as an instrument by the time this file runs (other e2e
    // specs trade it), so that sweep silently upserts this spec's spike bar
    // into the real, shared `daily_closes` rows for NVDA — which then broke
    // ticker-facts.e2e-spec.ts's flat-market assumption for the same symbol,
    // purely because of file execution order. Truncating here, before the
    // next spec runs, restores the shared table to what every other spec
    // already assumes about it.
    await dataSource.query('TRUNCATE daily_closes RESTART IDENTITY CASCADE');
    await app.close();
  });

  it('creates a pending outcome row when a trade idea is generated with readable levels', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    const rows = await dataSource.query(
      `SELECT feature, "entityId", status FROM ai_outcomes`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe('trade_idea');
    expect(rows[0].status).toBe('pending');
  });

  it('resolves a pending trade-idea outcome to target_hit on GET /ai/outcomes', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    const res = await http(app, token).get('/ai/outcomes').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('target_hit');
  });

  it('blocks the route without a token', async () => {
    await request(app.getHttpServer()).get('/ai/outcomes').expect(401);
  });
});
