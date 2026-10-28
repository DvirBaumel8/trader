import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { STUB_EARNINGS, yahooStub } from './yahoo-stub.js';
import { daysBetween, etWeek } from '../src/earnings/week.js';

describe('Earnings week (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const week = etWeek(new Date());
  const [, tue, , thu] = week.days;

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
    await dataSource.query('TRUNCATE holdings, watchlist_items, daily_closes RESTART IDENTITY CASCADE');
    await dataSource.query(
      `UPDATE instruments SET "nextEarningsAt" = NULL, "nextEarningsDate" = NULL, "earningsCheckedAt" = NULL, "nextEarningsEstimated" = false`,
    );
    await dataSource.query(`DELETE FROM users WHERE email = 'earn2@example.com'`);
  });

  afterEach(() => {
    for (const k of Object.keys(STUB_EARNINGS)) delete STUB_EARNINGS[k];
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM users WHERE email = 'earn2@example.com'`);
    await app.close();
  });

  const hold = (t: string, s: string) =>
    http(app, t).put(`/holdings/${s}`).send({ direction: 'LONG' }).expect(200);
  const watch = (t: string, s: string) =>
    http(app, t).post('/watchlist').send({ symbol: s }).expect(201);

  it('empty lists give five empty days and no upcoming rows', async () => {
    const res = await http(app, token).get('/earnings/week').expect(200);
    expect(res.body.days).toHaveLength(5);
    expect(res.body.days.every((d: { entries: unknown[] }) => d.entries.length === 0)).toBe(true);
    expect(res.body.upcoming).toEqual([]);
    expect(res.body.weekStart).toBe(week.weekStart);
  });

  it('places holdings and watchlist on their days, de-duplicated', async () => {
    STUB_EARNINGS.LMND = { at: `${thu}T12:30:00Z`, estimated: false };
    STUB_EARNINGS.NVDA = { at: `${tue}T21:00:00Z`, estimated: true };
    STUB_EARNINGS.AAPL = { at: `${thu}T21:00:00Z`, estimated: false };
    await hold(token, 'LMND');
    await watch(token, 'NVDA');
    await hold(token, 'AAPL');
    await watch(token, 'AAPL');
    await watch(token, 'QQQ');

    const res = await http(app, token).get('/earnings/week').expect(200);
    expect(res.body.days).toHaveLength(5);
    expect(res.body.days[1].entries).toEqual([
      { symbol: 'NVDA', source: 'watchlist', timing: 'after_close', estimated: true },
    ]);
    expect(res.body.days[3].entries).toEqual([
      { symbol: 'LMND', source: 'holding', timing: 'before_open', estimated: false },
      { symbol: 'AAPL', source: 'holding', timing: 'after_close', estimated: false },
    ]);

    const rows = res.body.upcoming as { symbol: string; source: string; date: string | null; daysUntil: number | null }[];
    const bySymbol = (s: string) => rows.find((r) => r.symbol === s)!;
    expect(rows.filter((r) => r.symbol === 'AAPL')).toHaveLength(1);
    expect(bySymbol('AAPL').source).toBe('holding');
    // A date earlier this week than today is not "upcoming".
    for (const [s, d] of [['LMND', thu], ['NVDA', tue], ['AAPL', thu]] as const) {
      if (d >= week.today) {
        expect(bySymbol(s).date).toBe(d);
        expect(bySymbol(s).daysUntil).toBe(daysBetween(week.today, d));
      } else {
        expect(bySymbol(s).date).toBeNull();
      }
    }
    expect(rows[rows.length - 1]).toMatchObject({ symbol: 'QQQ', date: null, daysUntil: null });
  });

  it('is scoped to the signed-in user', async () => {
    STUB_EARNINGS.LMND = { at: `${thu}T12:30:00Z`, estimated: false };
    STUB_EARNINGS.NVDA = { at: `${tue}T21:00:00Z`, estimated: false };
    await hold(token, 'LMND');
    const signup = await http(app)
      .post('/auth/signup')
      .send({ email: 'earn2@example.com', password: 'longenough1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    await watch(other, 'NVDA');

    const mine = await http(app, token).get('/earnings/week').expect(200);
    expect(mine.body.upcoming.map((u: { symbol: string }) => u.symbol)).toEqual(['LMND']);
    const theirs = await http(app, other).get('/earnings/week').expect(200);
    expect(theirs.body.upcoming.map((u: { symbol: string }) => u.symbol)).toEqual(['NVDA']);
    expect(theirs.body.days.flatMap((d: { entries: { symbol: string }[] }) => d.entries.map((e) => e.symbol))).toEqual(['NVDA']);
  });
});
