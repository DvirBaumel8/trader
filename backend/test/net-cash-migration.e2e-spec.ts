import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';
import { NetCashExcludesFee1789948800000 } from '../src/database/migrations/1789948800000-NetCashExcludesFee.js';

/**
 * Owner decision 2026-10-08: the broker's net cash is quantity x price; the
 * fee is separate. The migration recalculates the stored price of past trades
 * that carry a reported net cash. Runs only against the disposable trader_test.
 */
describe('NetCashExcludesFee migration (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

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
    await dataSource.query(
      'TRUNCATE stop_levels, stop_executions, transactions, cash_flows, dividends, interest_charges, journal_entries, entry_tags, tags, watchlist_items RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (trade: Record<string, unknown>, day: string) =>
    http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'x',
        occurredAt: `2026-08-${day}T14:30:00.000Z`,
        trade: { symbol: 'NVDA', ...trade },
      })
      .expect(201);

  const prices = async () =>
    (
      await dataSource.query(
        `SELECT side, price::float8 AS price FROM public.transactions ORDER BY "executedAt"`,
      )
    ).map((r: { side: string; price: number }) => [r.side, r.price]);

  const run = async (dir: 'up' | 'down') => {
    const qr = dataSource.createQueryRunner();
    try {
      await new NetCashExcludesFee1789948800000()[dir](qr);
    } finally {
      await qr.release();
    }
  };

  it('reprices past trades with a reported net cash from the old fee-adjusted rule, leaves the rest, and reverts', async () => {
    // Created through the API (new rule), then forced back to the OLD stored
    // prices to emulate production data written before this change.
    await post(
      { quantity: -1000, price: 19.57, fee: 10, reportedNetCash: 19560, reportedBalance: 19550 },
      '01',
    );
    await post(
      { quantity: 100, price: 100.05, fee: 5, reportedNetCash: -10000, reportedBalance: -10005 },
      '02',
    );
    await post({ quantity: 5, price: 12.34, fee: 1 }, '03');
    await dataSource.query(
      `UPDATE public.transactions SET price = 19.57 WHERE side = 'SELL'`,
    );
    await dataSource.query(
      `UPDATE public.transactions SET price = 99.95 WHERE side = 'BUY' AND "reportedNetCash" IS NOT NULL`,
    );
    expect(await prices()).toEqual([['SELL', 19.57], ['BUY', 99.95], ['BUY', 12.34]]);

    await run('up');
    expect(await prices()).toEqual([['SELL', 19.56], ['BUY', 100], ['BUY', 12.34]]);

    // Idempotent.
    await run('up');
    expect(await prices()).toEqual([['SELL', 19.56], ['BUY', 100], ['BUY', 12.34]]);

    // down restores the old fee-adjusted rule: SELL (19560+10)/1000, BUY (10000-5)/100.
    await run('down');
    expect(await prices()).toEqual([['SELL', 19.57], ['BUY', 99.95], ['BUY', 12.34]]);
  });
});
