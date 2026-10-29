import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { STUB_BARS, STUB_QUOTES, yahooStub } from './yahoo-stub.js';
import { currentSession, previousTradingDay } from '../src/market-data/session.js';

describe('Market moves (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
  });

  afterEach(() => {
    for (const k of Object.keys(STUB_BARS)) delete STUB_BARS[k];
    for (const k of Object.keys(STUB_QUOTES)) delete STUB_QUOTES[k];
  });

  afterAll(async () => {
    await app.close();
  });

  /** 20 completed sessions ending on the last completed one, whatever day the suite runs. */
  function completedBars() {
    const { live, asOf } = currentSession(new Date());
    const last = live ? previousTradingDay(asOf) : asOf;
    const dates = [last];
    while (dates.length < 20) dates.unshift(previousTradingDay(dates[0]));
    return dates.map((date) => ({ date, open: 100, high: 102, low: 98, close: 100 }));
  }

  it('requires a login', async () => {
    await http(app).get('/market/moves?symbols=AAPL').expect(401);
  });

  it('returns ATR and move per symbol, nulls for an unknown one, in request order', async () => {
    STUB_BARS.AAPL = completedBars();
    STUB_QUOTES.AAPL = { price: 104, previousClose: 100 };
    const res = await http(app, token).get('/market/moves?symbols=aapl, ZZZZ ,AAPL').expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].symbol).toBe('AAPL');
    expect(res.body[0].atrPercent).toBe(4);
    expect(res.body[1]).toMatchObject({ symbol: 'ZZZZ', atrPercent: null, movePercent: null });
    expect(res.body[0].asOf).toBe(currentSession(new Date()).asOf);
    expect(typeof res.body[0].live).toBe('boolean');
  });

  it('rejects an empty list and more than 60 symbols', async () => {
    await http(app, token).get('/market/moves').expect(400);
    await http(app, token).get('/market/moves?symbols=%20,').expect(400);
    const many = Array.from({ length: 61 }, (_, i) => `S${i}`).join(',');
    await http(app, token).get(`/market/moves?symbols=${many}`).expect(400);
    const ok = Array.from({ length: 60 }, (_, i) => `S${i}`).join(',');
    await http(app, token).get(`/market/moves?symbols=${ok}`).expect(200);
  });
});
