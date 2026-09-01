import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { http, login } from './http.js';

describe('Trades (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('404s an unparseable trade id', async () => {
    await http(app, token).get('/portfolio/trades/nonsense').expect(404);
  });

  it('404s a well-formed id that matches no trade', async () => {
    await http(app, token)
      .get(
        `/portfolio/trades/${encodeURIComponent('ZZZZ:2026-08-28T13:30:00.000Z')}`,
      )
      .expect(404);
  });

  it('requires a token', async () => {
    await request(app.getHttpServer())
      .get('/portfolio/trades/anything')
      .expect(401);
  });

  it('returns a seeded trade with its fills, stops, bars and lastBarDate', async () => {
    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'Pullback entry.',
        occurredAt: '2026-08-28T13:30:00.000Z',
        trade: {
          symbol: 'NVDA',
          quantity: 10,
          price: 200,
          fee: 4,
          stopLevels: [{ kind: 'FIXED', price: 190, quantity: 10 }],
        },
      })
      .expect(201);

    await http(app, token)
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'Scaling out.',
        occurredAt: '2026-08-29T13:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: -10, price: 220, fee: 4 },
      })
      .expect(201);

    const stats = await http(app, token).get('/portfolio/stats').expect(200);
    const [trade] = stats.body.trades;
    expect(trade.symbol).toBe('NVDA');
    // The stats payload stays lean: no fills or opening stops on this route.
    expect(trade.fills).toBeUndefined();
    expect(trade.openingStops).toBeUndefined();

    const id = `${trade.symbol}:${trade.enteredAt}`;
    const detail = await http(app, token)
      .get(`/portfolio/trades/${encodeURIComponent(id)}`)
      .expect(200);

    expect(detail.body.trade).toMatchObject({
      symbol: 'NVDA',
      quantity: 10,
      avgEntry: 200,
      avgExit: 220,
    });
    expect(detail.body.fills).toHaveLength(2);
    expect(detail.body.fills[0]).toMatchObject({
      side: 'BUY',
      price: 200,
      quantity: 10,
      fee: 4,
    });
    expect(detail.body.fills[1]).toMatchObject({
      side: 'SELL',
      price: 220,
      quantity: 10,
      fee: 4,
    });
    expect(detail.body.stopLevels).toHaveLength(1);
    expect(detail.body.stopLevels[0]).toMatchObject({
      kind: 'FIXED',
      price: 190,
      quantity: 10,
    });
    expect(Array.isArray(detail.body.bars)).toBe(true);
    expect(
      detail.body.lastBarDate === null ||
        typeof detail.body.lastBarDate === 'string',
    ).toBe(true);
  });
});
