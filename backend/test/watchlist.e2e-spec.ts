import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Watchlist (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // No test reaches the network. See test/yahoo-stub.ts.
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
      'TRUNCATE watchlist_item_tags, watchlist_items, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const add = (body: object) =>
    http(app, token).post('/watchlist').send(body);

  it('starts empty', async () => {
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });

  it('watches a ticker and prices it', async () => {
    const res = await add({ symbol: 'NVDA' }).expect(201);
    expect(res.body.symbol).toBe('NVDA');
    expect(res.body.price).toBeGreaterThan(0);
    expect(res.body.targetPrice).toBeNull();
  });

  it('refuses a ticker the provider does not know', async () => {
    await add({ symbol: 'ZZZZ' }).expect(404);
  });

  /** Watching the same thing twice is a mistake, not a second row. */
  it('updates in place rather than adding a duplicate', async () => {
    await add({ symbol: 'NVDA', note: 'first' }).expect(201);
    await add({ symbol: 'NVDA', note: 'second' }).expect(201);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].note).toBe('second');
  });

  it('tags an item, and offers those tags back for reuse', async () => {
    await add({ symbol: 'NVDA', tags: ['semis', 'breakout'] }).expect(201);
    const list = await http(app, token).get('/watchlist').expect(200);
    expect(list.body[0].tags.map((t: { label: string }) => t.label).sort()).toEqual([
      'breakout',
      'semis',
    ]);
    const tags = await http(app, token).get('/watchlist/tags').expect(200);
    expect(tags.body.map((t: { label: string }) => t.label).sort()).toEqual([
      'breakout',
      'semis',
    ]);
  });

  /** Watch tags share the tags table but must never reach the journal's list. */
  it('keeps watch tags out of the journal tag list', async () => {
    await add({ symbol: 'NVDA', tags: ['semis'] }).expect(201);
    const res = await http(app, token).get('/journal/tags').expect(200);
    expect(res.body.map((t: { label: string }) => t.label)).not.toContain('semis');
  });

  describe('targets', () => {
    it('waits quietly while an upward target is still out of reach', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      const res = await add({ symbol: 'NVDA', targetPrice: price * 2 }).expect(201);
      expect(res.body.targetDirection).toBe('ABOVE');
      expect(res.body.reached).toBe(false);
      expect(res.body.alerting).toBe(false);
    });

    it('records a target under the price as a wait-for-the-dip watch', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      const res = await add({ symbol: 'NVDA', targetPrice: price * 0.5 }).expect(201);
      expect(res.body.targetDirection).toBe('BELOW');
      expect(res.body.reached).toBe(false);
    });

    it('reports how far the price still has to move', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      const res = await add({ symbol: 'NVDA', targetPrice: price * 1.1 }).expect(201);
      // A fraction, like unrealizedPct — 0.1 means "10% higher from here".
      expect(res.body.distanceToTarget).toBeCloseTo(0.1, 2);
    });

    it('stops alerting once acknowledged, and starts again on a new target', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      // A target at the current price is reached immediately.
      const hit = await add({ symbol: 'NVDA', targetPrice: price }).expect(201);
      expect(hit.body.alerting).toBe(true);

      await http(app, token)
        .post(`/watchlist/${hit.body.id}/acknowledge`)
        .expect(201);
      const after = await http(app, token).get('/watchlist').expect(200);
      expect(after.body[0].alerting).toBe(false);
      expect(after.body[0].reached).toBe(true);

      const retargeted = await add({ symbol: 'NVDA', targetPrice: price }).expect(201);
      expect(retargeted.body.alerting).toBe(true);
    });

    /**
     * The requirement in his own words: tell me if the price reached the
     * target FROM THE MOMENT I SET IT TO NOW. A ticker that touched the level
     * and pulled back has reached it; only-compare-the-live-price said it had
     * not, which is the one answer this feature must never give.
     */
    it('reports a target the price touched earlier and then retreated from', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;

      // A target well above today's price: not reached on the live quote.
      const target = price * 1.5;
      const res = await add({ symbol: 'NVDA', targetPrice: target }).expect(201);
      expect(res.body.reached).toBe(false);

      // But the stock DID trade up there, on a day since the target was set.
      const instrument = await dataSource.query(
        `select id from instruments where symbol = 'NVDA'`,
      );
      await dataSource.query(
        `insert into daily_closes ("instrumentId", date, open, high, low, close, "adjClose")
         values ($1, current_date, $2, $3, $2, $2, $2)`,
        [instrument[0].id, price, target + 1],
      );

      const after = await http(app, token).get('/watchlist').expect(200);
      expect(after.body[0].reached).toBe(true);
      expect(after.body[0].reachedOn).toBeTruthy();
    });

    /** A touch BEFORE he set the target is not a hit — the window starts then. */
    it('ignores a touch that happened before the target existed', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      const instrument = await dataSource.query(
        `select id from instruments where symbol = 'NVDA'`,
      );
      // A spike a week ago, before any target was set.
      await dataSource.query(
        `insert into daily_closes ("instrumentId", date, open, high, low, close, "adjClose")
         values ($1, current_date - 7, $2, $3, $2, $2, $2)`,
        [instrument[0].id, price, price * 3],
      );

      const res = await add({ symbol: 'NVDA', targetPrice: price * 2 }).expect(201);
      expect(res.body.reached).toBe(false);
      expect(res.body.reachedOn).toBeNull();
    });

    /** He asked for it to be optional, and it is. */
    it('watches a ticker with no target at all', async () => {
      const res = await add({ symbol: 'NVDA' }).expect(201);
      expect(res.body.targetPrice).toBeNull();
      expect(res.body.reached).toBe(false);
      expect(res.body.alerting).toBe(false);
      expect(res.body.reachedOn).toBeNull();
    });

    /** Omitted means "leave it"; null means "remove it". */
    it('leaves a target alone when an edit does not mention it', async () => {
      const created = await add({ symbol: 'NVDA' }).expect(201);
      const price = created.body.price as number;
      await add({ symbol: 'NVDA', targetPrice: price * 1.2 }).expect(201);
      const res = await add({ symbol: 'NVDA', note: 'just a note' }).expect(201);
      expect(res.body.targetPrice).toBeCloseTo(price * 1.2, 4);
    });
  });

  it('removes an item', async () => {
    const created = await add({ symbol: 'NVDA' }).expect(201);
    await http(app, token).delete(`/watchlist/${created.body.id}`).expect(200);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });

  it('404s removing something that is not there', async () => {
    await http(app, token)
      .delete('/watchlist/11111111-1111-1111-1111-111111111111')
      .expect(404);
  });

  describe('opinion', () => {
    it('says so plainly when nothing has a target to rank', async () => {
      await add({ symbol: 'NVDA' }).expect(201);
      const res = await http(app, token).post('/watchlist/opinion').expect(201);
      expect(res.body.chosen).toBeNull();
    });

    it('picks the ticker closest to its own target', async () => {
      const nvda = await add({ symbol: 'NVDA' }).expect(201);
      const pltr = await add({ symbol: 'PLTR' }).expect(201);
      // NVDA 50% away, PLTR 2% away.
      await add({ symbol: 'NVDA', targetPrice: nvda.body.price * 1.5 }).expect(201);
      await add({ symbol: 'PLTR', targetPrice: pltr.body.price * 1.02 }).expect(201);

      const res = await http(app, token).post('/watchlist/opinion').expect(201);
      expect(res.body.chosen).toBe('PLTR');
    });
  });
});
