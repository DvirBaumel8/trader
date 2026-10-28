import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Assistant (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stub = yahooStub();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(stub)
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

  /** `count` daily closes for `symbol`, each at `close`, ending yesterday. */
  async function seedCloses(symbol: string, count: number, close: number) {
    await http(app, token).post('/watchlist').send({ symbol }).expect(201);
    const [{ id }] = await dataSource.query('SELECT id FROM instruments WHERE symbol = $1', [symbol]);
    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - (count - i) * 86_400_000).toISOString().slice(0, 10);
      await dataSource.query(
        `INSERT INTO daily_closes ("instrumentId", date, close, "adjClose") VALUES ($1, $2, $3, $3)
         ON CONFLICT ("instrumentId", date) DO NOTHING`,
        [id, date, close],
      );
    }
  }

  it('adds, confirms a flip, and removes holdings', async () => {
    expect((await say('bought LMND')).body).toEqual({ kind: 'done', message: 'Added LMND (long) to your holdings.' });
    expect((await say('bought lmnd')).body).toEqual({ kind: 'done', message: 'You already hold LMND long.' });
    expect((await say('short LMND')).body).toEqual({
      kind: 'confirm',
      message: 'You hold LMND long. Flip it to short?',
      action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
    });
    // The confirm did not change anything by itself.
    expect((await http(app, token).get('/holdings')).body[0].direction).toBe('LONG');
    expect((await say('sold LMND')).body).toEqual({ kind: 'done', message: 'Removed LMND from your holdings.' });
    expect((await say('sold LMND')).body).toEqual({ kind: 'error', message: "You don't hold LMND." });
  });

  it('refuses an unknown ticker without saving it', async () => {
    expect((await say('bought ZZZZ')).body).toEqual({ kind: 'error', message: "I couldn't find the ticker ZZZZ. Check the spelling, or try again in a minute." });
    expect((await http(app, token).get('/holdings')).body).toEqual([]);
  });

  it('watches and unwatches', async () => {
    expect((await say('watch NVDA')).body).toEqual({ kind: 'done', message: 'Watching NVDA.' });
    expect((await say('watch nvda')).body).toEqual({ kind: 'done', message: 'NVDA is already on your watchlist.' });
    expect((await say('unwatch NVDA')).body).toEqual({ kind: 'done', message: 'Stopped watching NVDA.' });
    expect((await say('unwatch NVDA')).body).toEqual({ kind: 'error', message: "NVDA isn't on your watchlist." });
  });

  it('answers an SMA check from stored closes', async () => {
    // GOOGL quotes at 180 in the stub; 150 closes at 160 → 12.50% above.
    await seedCloses('GOOGL', 150, 160);
    const res = await say('is GOOGL above 150 SMA?');
    expect(res.body.kind).toBe('answer');
    expect(res.body.message).toBe('Yes. GOOGL ($180.00) is 12.50% above its 150-day SMA ($160.00).');
    expect(res.body.facts).toMatchObject({ symbol: 'GOOGL', price: 180, average: 'SMA', period: 150, value: 160, stale: false, session: null });
    expect(res.body.facts.percentFrom).toBeCloseTo(0.125);
    expect((await say('is googl below 150 sma')).body.message).toBe(
      'No. GOOGL ($180.00) is 12.50% above its 150-day SMA ($160.00).',
    );
  });

  it('says when there is not enough history', async () => {
    await seedCloses('GOOGL', 40, 160);
    expect((await say('is GOOGL above 300 SMA')).body).toEqual({
      kind: 'error',
      message: 'Not enough history for a 300-day SMA on GOOGL.',
    });
  });

  it('deepens short stored history from the provider before answering', async () => {
    // 43 stored closes (as in production) against a 50-day SMA; the provider has 60 bars.
    await seedCloses('MSFT', 43, 100);
    const original = stub.dailyBars;
    stub.dailyBars = async () =>
      Array.from({ length: 60 }, (_, i) => {
        const date = new Date(Date.now() - (60 - i) * 86_400_000 - 100 * 86_400_000).toISOString().slice(0, 10);
        return { date, close: 100, adjClose: 100, open: null, high: null, low: null, volume: null };
      });
    try {
      const res = await say('is MSFT above 50 SMA?');
      expect(res.body.kind).toBe('answer');
      expect(res.body.facts).toMatchObject({ symbol: 'MSFT', period: 50, average: 'SMA' });
    } finally {
      stub.dailyBars = original;
    }
  });

  it('answers with a stale price when the provider fails after a recent quote', async () => {
    await seedCloses('GOOGL', 150, 160);
    await say('is GOOGL above 150 SMA'); // primes the quote cache
    const original = stub.quote;
    stub.quote = async () => {
      throw new Error('provider down');
    };
    try {
      const res = await say('is GOOGL above 150 SMA');
      expect(res.body.kind).toBe('answer');
      expect(res.body.message).toMatch(/ The price is stale\.$/);
      expect(res.body.facts.stale).toBe(true);
    } finally {
      stub.quote = original;
    }
  });

  it('turns anything else into a prompt with holdings and watchlist', async () => {
    await say('bought LMND');
    await say('short TSLA');
    await say('watch NVDA');
    const res = await say('what do you think about my portfolio?');
    expect(res.body.kind).toBe('prompt');
    expect(res.body.text).toContain('My holdings: LMND (long), TSLA (short)');
    expect(res.body.text).toContain('My watchlist: NVDA');
    expect(res.body.text).toContain('My question:\nwhat do you think about my portfolio?');
    expect(res.body.text).toMatch(/^Date: \d{4}-\d{2}-\d{2}/);
  });

  it('rejects an empty or oversized message', async () => {
    await http(app, token).post('/assistant').send({ text: '' }).expect(400);
    await http(app, token).post('/assistant').send({ text: 'x'.repeat(2001) }).expect(400);
  });
});
