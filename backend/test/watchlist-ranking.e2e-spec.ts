import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';
import { yahooStub } from './yahoo-stub.js';

const TRUNCATE =
  'TRUNCATE watchlist_rankings, watchlist_item_tags, watchlist_items, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE';

/**
 * Every `### SYMBOL — ...` candidate header `watchlist-ranking-prompt.ts`
 * writes, in the order the candidates were given (watchlist creation order).
 * A candidate whose note contains `DROP_ME` is left out of the fake answer —
 * how the "model dropped a ticker" spec is produced without a second prompt
 * format.
 */
function candidateSymbols(userPrompt: string): { symbol: string; dropped: boolean }[] {
  const blocks = userPrompt.split(/(?=^### )/m).filter((b) => b.startsWith('### '));
  return blocks.map((block) => {
    const symbol = (/^### (\S+)/.exec(block)?.[1] ?? '').trim();
    return { symbol, dropped: block.includes('DROP_ME') };
  });
}

/**
 * A fixed [RANK] answer built FROM the actual prompt, so it stays correct
 * whichever tickers a test happens to have watchlisted — reversing the
 * candidates' own order (oldest-added last) is what makes
 * 'ranks the watchlist on refresh and stores it' see PLTR (added second)
 * ranked ahead of NVDA (added first) without hard-coding either symbol here.
 */
function fakeRankingAnswer(userPrompt: string): string {
  const candidates = candidateSymbols(userPrompt);
  const ranked = candidates.filter((c) => !c.dropped).reverse();
  const blocks = ranked
    .map(
      (c) =>
        `[RANK]\nSYMBOL: ${c.symbol}\nVERDICT: Stub verdict for ${c.symbol}.\nCOVERAGE: full\n[/RANK]`,
    )
    .join('\n');
  return `${blocks}\n\nStub reasoning mentioning ${ranked.map((c) => c.symbol).join(', ') || 'nothing'}.`;
}

describe('Watchlist ranking (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const llmStub = {
    isConfigured: () => true,
    modelName: () => 'stub-ranking-model',
    complete: vi.fn(async ({ user }: { user: string }) => fakeRankingAnswer(user)),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // No test reaches the network. See test/yahoo-stub.ts.
      .overrideProvider(YahooClient)
      .useValue(yahooStub({ withBars: true, withConsensus: true }))
      .overrideProvider(LlmClient)
      .useValue(llmStub)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    llmStub.complete.mockClear();
    await dataSource.query(TRUNCATE);
  });

  afterAll(async () => {
    await app.close();
  });

  const add = (body: object) => http(app, token).post('/watchlist').send(body);

  it('has no ranking before one is asked for', async () => {
    const res = await http(app, token).get('/watchlist/ranking').expect(200);
    expect(res.body.rankedAt).toBeNull();
    expect(res.body.order).toEqual([]);
    expect(res.body.configured).toBe(true);
    expect(res.body.stale).toBe(false);
  });

  it('ranks the watchlist on refresh and stores it', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    await add({ symbol: 'PLTR' }).expect(201);
    const res = await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    expect(res.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['PLTR', 'NVDA']);
    expect(res.body.rankedAt).toBeTruthy();
    expect(res.body.model).toBeTruthy();
    expect(res.body.missing).toEqual([]);

    // Exactly one call for the whole watchlist, not one per ticker.
    expect(llmStub.complete.mock.calls.length).toBe(1);
  });

  it('serves the stored ranking without calling the model again', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    const calls = llmStub.complete.mock.calls.length;
    const res = await http(app, token).get('/watchlist/ranking').expect(200);
    expect(res.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['NVDA']);
    expect(llmStub.complete.mock.calls.length).toBe(calls);
  });

  /** Invariant 9: one user's ranking is never another's. */
  it('keeps two users rankings apart', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    await http(app, token).post('/watchlist/ranking/refresh').expect(201);

    const signup = await http(app)
      .post('/auth/signup')
      .send({ email: 'ranking-other@example.com', password: 'longenough1' })
      .expect(201);
    const otherToken = signup.body.accessToken as string;

    const mine = await http(app, token).get('/watchlist/ranking').expect(200);
    expect(mine.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['NVDA']);

    const theirs = await http(app, otherToken).get('/watchlist/ranking').expect(200);
    expect(theirs.body.rankedAt).toBeNull();
    expect(theirs.body.order).toEqual([]);
  });

  it('reports a ticker the model dropped rather than hiding it', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    // The stub answer omits any candidate whose note contains DROP_ME.
    await add({ symbol: 'PLTR', note: 'DROP_ME' }).expect(201);
    const res = await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    expect(res.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['NVDA']);
    expect(res.body.missing).toEqual(['PLTR']);
  });

  /**
   * The whole point of the 503: a failed refresh must not clobber the
   * answer already on file. A successful ranking is stored first, THEN the
   * model is made to fail on the very next call — proving both halves of
   * the guarantee: the failed attempt surfaces as 503 (not a silent 200
   * with stale data), and the row it would have replaced is still exactly
   * what `current()` serves afterwards, unchanged `rankedAt` included.
   */
  it('keeps the previous ranking intact when a refresh call fails', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    const first = await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    const firstRankedAt = first.body.rankedAt;
    expect(firstRankedAt).toBeTruthy();

    llmStub.complete.mockImplementationOnce(async () => {
      throw new Error('provider exploded');
    });
    await http(app, token).post('/watchlist/ranking/refresh').expect(503);

    const res = await http(app, token).get('/watchlist/ranking').expect(200);
    expect(res.body.rankedAt).toBe(firstRankedAt);
    expect(res.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['NVDA']);
  });

  describe('when no model is configured', () => {
    let unconfiguredApp: INestApplication;
    let unconfiguredToken: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(YahooClient)
        .useValue(yahooStub({ withBars: true, withConsensus: true }))
        .overrideProvider(LlmClient)
        .useValue({
          isConfigured: () => false,
          modelName: () => 'unconfigured',
          complete: vi.fn(async () => {
            throw new Error('must never be called when unconfigured');
          }),
        })
        .compile();
      unconfiguredApp = moduleRef.createNestApplication();
      unconfiguredApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await unconfiguredApp.init();
      unconfiguredToken = await login(unconfiguredApp);
    });

    afterAll(async () => {
      await unconfiguredApp.close();
    });

    it('says so plainly when no model is configured, without throwing', async () => {
      await http(unconfiguredApp, unconfiguredToken)
        .post('/watchlist')
        .send({ symbol: 'NVDA' })
        .expect(201);
      const res = await http(unconfiguredApp, unconfiguredToken)
        .post('/watchlist/ranking/refresh')
        .expect(201);
      expect(res.body.configured).toBe(false);
      expect(res.body.rankedAt).toBeNull();
      expect(res.body.order).toEqual([]);
    });
  });
});
