import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';
import { yahooStub } from './yahoo-stub.js';

const routes: Record<string, unknown> = {
  'bought LMND and NVDA': { action: 'buy', symbols: ['LMND', 'NVDA'] },
  'Bought: 1. TSLA 2. ZZZZ': { action: 'buy', symbols: ['TSLA', 'ZZZZ'] },
  'sold LMND': { action: 'sell', symbols: ['LMND'] },
  'sold AAPL': { action: 'sell', symbols: ['AAPL'] },
  'watch AMD': { action: 'watch', symbols: ['AMD'] },
  'unwatch AMD': { action: 'unwatch', symbols: ['AMD'] },
  'should I buy NVDA?': { action: 'buy', symbols: ['NVDA'] },
};
const llmStub = {
  isConfigured: () => true,
  generateJson: async ({ user }: { user: string }) => {
    if (user === 'model is down') throw new Error('503');
    return routes[user] ?? { action: 'none', symbols: [] };
  },
};

describe('Assistant (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stub = yahooStub();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(stub)
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
    await dataSource.query('TRUNCATE holdings, watchlist_items, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  const say = (text: string) => http(app, token).post('/assistant').send({ text }).expect(201);
  const heldSymbols = async () => (await http(app, token).get('/holdings')).body.map((h: { symbol: string }) => h.symbol);
  const watchedSymbols = async () => (await http(app, token).get('/watchlist')).body.map((w: { symbol: string }) => w.symbol);

  it('buys several tickers, then reports them as already held', async () => {
    expect((await say('bought LMND and NVDA')).body).toEqual({ kind: 'done', message: 'Added: LMND, NVDA' });
    expect((await say('bought LMND and NVDA')).body).toEqual({ kind: 'done', message: 'Already held: LMND, NVDA' });
  });

  it('buys from a numbered list and skips the unknown ticker', async () => {
    expect((await say('Bought: 1. TSLA 2. ZZZZ')).body).toEqual({ kind: 'done', message: "Added: TSLA\nCouldn't find: ZZZZ" });
    expect(await heldSymbols()).toEqual(['TSLA']);
  });

  it('sell removes the holding and moves it to the watchlist', async () => {
    await say('bought LMND and NVDA');
    expect((await say('sold LMND')).body).toEqual({ kind: 'done', message: 'Sold and moved to watchlist: LMND' });
    expect(await heldSymbols()).not.toContain('LMND');
    expect(await watchedSymbols()).toContain('LMND');
  });

  it('selling something not held reports it and does not watch it', async () => {
    expect((await say('sold AAPL')).body).toEqual({ kind: 'done', message: 'Not held: AAPL' });
    expect(await watchedSymbols()).not.toContain('AAPL');
  });

  it('watches and unwatches', async () => {
    expect((await say('watch AMD')).body).toEqual({ kind: 'done', message: 'Watching: AMD' });
    expect((await say('watch AMD')).body).toEqual({ kind: 'done', message: 'Already watching: AMD' });
    expect((await say('unwatch AMD')).body).toEqual({ kind: 'done', message: 'Stopped watching: AMD' });
    expect((await say('unwatch AMD')).body).toEqual({ kind: 'done', message: 'Not on watchlist: AMD' });
  });

  it('a question never acts', async () => {
    expect((await say('should I buy NVDA?')).body.kind).toBe('prompt');
    expect(await heldSymbols()).toEqual([]);
  });

  it('falls back to a prompt with a note when the model is down', async () => {
    const res = await say('model is down');
    expect(res.body.kind).toBe('prompt');
    expect(res.body.note).toBe("Couldn't read that automatically — here's a prompt instead.");
  });

  it('turns anything else into a prompt with holdings and watchlist', async () => {
    await say('bought LMND and NVDA');
    await say('watch AMD');
    const res = await say('what do you think about my portfolio?');
    expect(res.body.kind).toBe('prompt');
    expect(res.body).not.toHaveProperty('note');
    expect(res.body.text).toContain('My holdings: LMND, NVDA');
    expect(res.body.text).toContain('My watchlist: AMD');
    expect(res.body.text).toContain('My question:\nwhat do you think about my portfolio?');
    expect(res.body.text).toMatch(/^Date: [A-Z][a-z]{2} \d{1,2}, \d{4} \(New York time\)/);
  });

  it('rejects an empty or oversized message', async () => {
    await http(app, token).post('/assistant').send({ text: '' }).expect(400);
    await http(app, token).post('/assistant').send({ text: 'x'.repeat(2001) }).expect(400);
  });
});
