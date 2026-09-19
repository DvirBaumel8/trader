import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';
import { HistoryService } from '../src/market-data/history.service.js';

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
    const yahooStub = {
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
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub)
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => true,
        modelName: () => 'stub-model',
        complete: async () => 'Real prose about the trade.\n\nLEVELS\nstop: 90\ntarget: 130',
      })
      // HistoryService.ensureFresh() sweeps EVERY instrument in the shared
      // test database and upserts whatever YahooClient.dailyBars() returns
      // for each into the shared daily_closes table (see its doc comment).
      // PortfolioService.getPortfolio() fires it fire-and-forget, and
      // TickerFactsService.resolveBars() awaits it directly — both sit on
      // this spec's own POST /ai/trade-idea path (buildIdeaContext calls
      // both tickerFacts.get() and portfolio.getPortfolio()). Since this
      // spec's YahooClient stub returns the same target-crossing spike for
      // any symbol, a real ensureFresh() here would leak that spike into
      // every other instrument's daily_closes rows (e.g. NVDA, already
      // created by an earlier-running spec file), corrupting whichever spec
      // runs next. Stubbing ensureFresh() as a no-op removes the write at
      // its source instead of racing it. liveDailyBars() is kept real-ish
      // (delegating straight to the same yahooStub.dailyBars(), matching
      // HistoryService's own implementation) because AiOutcomeService.
      // resolveTradeIdea() needs it to grade the trade idea in the GET
      // /ai/outcomes test. No other HistoryService method (ensurePriced,
      // backfill) is reachable from this spec's three tests.
      .overrideProvider(HistoryService)
      .useValue({
        ensureFresh: async () => {},
        liveDailyBars: async () => yahooStub.dailyBars(),
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
      'TRUNCATE stop_levels, stop_executions, transactions, cash_flows, dividends, interest_charges, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    // Defensive hygiene, not a fix in itself: with HistoryService stubbed
    // above, ensureFresh() never writes to daily_closes, so this spec's
    // target-crossing spike can no longer leak into another instrument's
    // rows (that was the actual bug — see the HistoryService override
    // comment in beforeAll). This truncate just restores daily_closes to
    // empty for whatever spec runs next, matching what beforeEach already
    // does before each of this file's own tests.
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
