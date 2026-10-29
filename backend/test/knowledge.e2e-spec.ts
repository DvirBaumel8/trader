import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { JSON_BODY_LIMIT } from '../src/body-limit.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';
import { ApiKeysService } from '../src/users/api-keys.service.js';
import { UsersService } from '../src/users/users.service.js';

const node = (id: string, text = `Made-up text for ${id}`) => ({ id, title: `Title ${id}`, text });
const graph = (...ids: string[]) => ({
  nodes: [node('summary'), ...ids.map((id) => node(id))],
  edges: ids.map((id) => ({ from: 'summary', to: id, label: 'link' })),
});
const wait = () => new Promise((r) => setTimeout(r, 10));

describe('Knowledge (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let ownerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>();
    nest.useBodyParser('json', { limit: JSON_BODY_LIMIT });
    app = nest;
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
    ownerId = (await app.get(UsersService).ensureDefaultUser()).id;
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE knowledge_versions, knowledge_graphs, api_keys CASCADE');
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE knowledge_versions, knowledge_graphs, api_keys CASCADE');
    await dataSource.query(`DELETE FROM users WHERE email IS NOT NULL`);
    await app.close();
  });

  const put = (symbol: string, baseVersion: number, body: object, message = 'msg', t = token) =>
    http(app, t).put(`/knowledge/${symbol}`).send({ baseVersion, message, ...body });

  it('starts with an empty list and 404 for an unknown graph', async () => {
    expect((await http(app, token).get('/knowledge').expect(200)).body).toEqual([]);
    await http(app, token).get('/knowledge/NVDA').expect(404);
    await http(app, token).post('/knowledge/NVDA/viewed').expect(404);
    await http(app, token).get('/knowledge/NVDA/versions').expect(404);
  });

  it('creates v1 with stamped nodes, readable by GET', async () => {
    const res = await put('nvda', 0, graph('a'), 'start').expect(200);
    expect(res.body).toMatchObject({ symbol: 'NVDA', version: 1, lastViewedAt: null });
    const got = (await http(app, token).get('/knowledge/NVDA').expect(200)).body;
    expect(got.nodes).toHaveLength(2);
    for (const n of got.nodes) {
      expect(new Date(n.createdAt).toISOString()).toBe(n.createdAt);
      expect(n.updatedAt).toBe(n.createdAt);
    }
    expect(got.edges).toEqual([{ from: 'summary', to: 'a', label: 'link' }]);
  });

  it('lists graphs with a count and a new marker that viewing clears', async () => {
    await put('NVDA', 0, graph('a')).expect(200);
    const row = (await http(app, token).get('/knowledge').expect(200)).body[0];
    expect(row).toMatchObject({ symbol: 'NVDA', nodeCount: 2, hasNew: true });
    await wait();
    expect((await http(app, token).post('/knowledge/NVDA/viewed').expect(201)).body).toEqual({ ok: true });
    expect((await http(app, token).get('/knowledge').expect(200)).body[0].hasNew).toBe(false);
  });

  it('orders the list by most recently updated', async () => {
    await put('NVDA', 0, graph()).expect(200);
    await wait();
    await put('AAPL', 0, graph()).expect(200);
    await wait();
    await put('NVDA', 1, graph('a')).expect(200);
    const symbols = (await http(app, token).get('/knowledge').expect(200)).body.map((r: { symbol: string }) => r.symbol);
    expect(symbols).toEqual(['NVDA', 'AAPL']);
  });

  it('editing one node moves only that node and makes the graph new again', async () => {
    await put('NVDA', 0, graph('a', 'b')).expect(200);
    await wait();
    await http(app, token).post('/knowledge/NVDA/viewed').expect(201);
    await wait();
    const before = (await http(app, token).get('/knowledge/NVDA')).body;
    const edited = { ...graph('a', 'b'), nodes: [node('summary'), node('a', 'new words'), node('b')] };
    const res = await put('NVDA', 1, edited, 'edit a').expect(200);
    expect(res.body.version).toBe(2);
    const at = (body: { nodes: { id: string; updatedAt: string }[] }, id: string) =>
      body.nodes.find((n) => n.id === id)!.updatedAt;
    expect(at(res.body, 'summary')).toBe(at(before, 'summary'));
    expect(at(res.body, 'b')).toBe(at(before, 'b'));
    expect(at(res.body, 'a') > at(before, 'a')).toBe(true);
    expect((await http(app, token).get('/knowledge').expect(200)).body[0].hasNew).toBe(true);
  });

  it('409s on a stale base version and keeps the content', async () => {
    await put('NVDA', 0, graph('a')).expect(200);
    await put('NVDA', 1, graph('a', 'b')).expect(200);
    const stale = await put('NVDA', 1, graph('c')).expect(409);
    expect(stale.body.message).toContain('version 2');
    await put('NVDA', 0, graph('c')).expect(409);
    const got = (await http(app, token).get('/knowledge/NVDA')).body;
    expect(got.version).toBe(2);
    expect(got.nodes.map((n: { id: string }) => n.id)).toEqual(['summary', 'a', 'b']);
  });

  it('lets only one of two concurrent creates win', async () => {
    const results = await Promise.all([put('NVDA', 0, graph('a')), put('NVDA', 0, graph('b'))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('lets only one of two concurrent edits from the same version win', async () => {
    await put('NVDA', 0, graph()).expect(200);
    const results = await Promise.all([put('NVDA', 1, graph('a')), put('NVDA', 1, graph('b'))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    const got = (await http(app, token).get('/knowledge/NVDA').expect(200)).body;
    expect(got.version).toBe(2);
    expect(got.nodes.map((n: { id: string }) => n.id)).toEqual(winner.body.nodes.map((n: { id: string }) => n.id));
  });

  it('rejects an invalid graph with a message naming the problem', async () => {
    const bad = { nodes: [node('summary'), node('revenue')], edges: [{ from: 'summary', to: 'revenue', label: 'x' }, { from: 'revenue', to: 'gaming', label: 'x' }] };
    const res = await put('NVDA', 0, bad).expect(400);
    expect(res.body.message).toContain('edge revenue→gaming: unknown node "gaming"');
    await http(app, token).get('/knowledge/NVDA').expect(404);
  });

  it('rejects a malformed body', async () => {
    await http(app, token).put('/knowledge/NVDA').send({ baseVersion: 0, message: 'x' }).expect(400);
    await http(app, token).put('/knowledge/NVDA').send({ baseVersion: -1, message: 'x', ...graph() }).expect(400);
    await put('NVDA', 0, graph(), '').expect(400);
    await put('NVDA', 0, graph(), 'x'.repeat(121)).expect(400);
  });

  it('404s for an unknown ticker', async () => {
    await put('ZZZZ1', 0, graph()).expect(404);
  });

  it('works for a ticker on no list', async () => {
    expect((await http(app, token).get('/holdings')).body).toEqual([]);
    await put('MSFT', 0, graph()).expect(200);
  });

  it('accepts a 300-node graph of full-length paragraphs', async () => {
    const ids = Array.from({ length: 299 }, (_, i) => `n${i}`);
    const big = {
      nodes: [node('summary', 'x'.repeat(1500)), ...ids.map((id) => node(id, 'y'.repeat(1500)))],
      edges: ids.map((id) => ({ from: 'summary', to: id, label: 'link' })),
    };
    const res = await put('NVDA', 0, big).expect(200);
    expect(res.body.nodes).toHaveLength(300);
  });

  it('lists versions newest first', async () => {
    await put('NVDA', 0, graph(), 'first').expect(200);
    await put('NVDA', 1, graph('a'), 'second').expect(200);
    const list = (await http(app, token).get('/knowledge/NVDA/versions').expect(200)).body;
    expect(list.map((v: { version: number; message: string }) => [v.version, v.message])).toEqual([[2, 'second'], [1, 'first']]);
    expect(new Date(list[0].createdAt).toISOString()).toBe(list[0].createdAt);
  });

  it('reverts to an old version as a new version', async () => {
    await put('NVDA', 0, graph(), 'v1').expect(200);
    await put('NVDA', 1, graph('a'), 'v2').expect(200);
    await put('NVDA', 2, graph('a', 'b'), 'v3').expect(200);
    const res = await http(app, token).post('/knowledge/NVDA/revert').send({ baseVersion: 3, version: 1, message: 'undo' }).expect(201);
    expect(res.body.version).toBe(4);
    expect(res.body.nodes.map((n: { id: string }) => n.id)).toEqual(['summary']);
    expect(res.body.edges).toEqual([]);
    const versions = (await http(app, token).get('/knowledge/NVDA/versions')).body;
    expect(versions).toHaveLength(4);
    await http(app, token).post('/knowledge/NVDA/revert').send({ baseVersion: 3, version: 1, message: 'stale' }).expect(409);
    await http(app, token).post('/knowledge/NVDA/revert').send({ baseVersion: 4, version: 9, message: 'x' }).expect(404);
  });

  it('deletes as a version; revert brings it back', async () => {
    await put('NVDA', 0, graph('a'), 'v1').expect(200);
    await http(app, token).delete('/knowledge/NVDA').send({ baseVersion: 2, message: 'stale' }).expect(409);
    expect((await http(app, token).delete('/knowledge/NVDA').send({ baseVersion: 1, message: 'bye' }).expect(200)).body).toEqual({ ok: true });
    await http(app, token).get('/knowledge/NVDA').expect(404);
    expect((await http(app, token).get('/knowledge').expect(200)).body).toEqual([]);
    expect((await http(app, token).get('/knowledge/NVDA/versions')).body[0]).toMatchObject({ version: 2, message: 'bye' });
    const back = await http(app, token).post('/knowledge/NVDA/revert').send({ baseVersion: 2, version: 1, message: 'back' }).expect(201);
    expect(back.body.version).toBe(3);
    expect((await http(app, token).get('/knowledge/NVDA').expect(200)).body.nodes).toHaveLength(2);
  });

  describe('with an API key', () => {
    let key: string;
    beforeEach(async () => {
      key = await app.get(ApiKeysService).create(ownerId, 'test');
    });

    it('works on every knowledge route', async () => {
      await put('NVDA', 0, graph('a'), 'k1', key).expect(200);
      expect((await http(app, key).get('/knowledge').expect(200)).body).toHaveLength(1);
      await http(app, key).get('/knowledge/NVDA').expect(200);
      await http(app, key).post('/knowledge/NVDA/viewed').expect(201);
      await http(app, key).get('/knowledge/NVDA/versions').expect(200);
      await http(app, key).post('/knowledge/NVDA/revert').send({ baseVersion: 1, version: 1, message: 'r' }).expect(201);
      await http(app, key).delete('/knowledge/NVDA').send({ baseVersion: 2, message: 'd' }).expect(200);
      // It is the owner's graph: his login sees the same data.
      await http(app, token).get('/knowledge/NVDA/versions').expect(200);
    });

    it('is rejected on every other route', async () => {
      for (const path of ['/holdings', '/watchlist', '/earnings/week']) {
        const res = await http(app, key).get(path).expect(401);
        expect(res.body.message).toBe('API key not allowed here');
      }
      await http(app, key).post('/assistant').send({ message: 'hi' }).expect(401);
    });

    it('rejects an unknown kb_ key everywhere', async () => {
      const res = await http(app, 'kb_x').get('/knowledge').expect(401);
      expect(res.body.message).toBe('Invalid API key');
      await http(app, 'kb_x').get('/holdings').expect(401);
    });

    it('stores only a hash of the key', async () => {
      const rows = await dataSource.query('SELECT "keyHash", "lastUsedAt" FROM api_keys');
      expect(JSON.stringify(rows)).not.toContain(key);
      await http(app, key).get('/knowledge').expect(200);
      const after = await dataSource.query('SELECT "lastUsedAt" FROM api_keys');
      expect(after[0].lastUsedAt).not.toBeNull();
    });
  });

  it('keeps users apart: a second user cannot see the first, and has their own NVDA', async () => {
    await put('NVDA', 0, graph('a'), 'owner').expect(200);
    const signup = await http(app)
      .post('/auth/signup')
      .send({ email: 'kb-second@example.com', password: 'longenough1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    await http(app, other).get('/knowledge/NVDA').expect(404);
    expect((await http(app, other).get('/knowledge').expect(200)).body).toEqual([]);
    await http(app, other).get('/knowledge/NVDA/versions').expect(404);
    await http(app, other).delete('/knowledge/NVDA').send({ baseVersion: 1, message: 'x' }).expect(404);
    const mine = await put('NVDA', 0, graph(), 'theirs', other).expect(200);
    expect(mine.body.version).toBe(1);
    const owners = (await http(app, token).get('/knowledge/NVDA').expect(200)).body;
    expect(owners.nodes).toHaveLength(2);
    expect(owners.version).toBe(1);
  });
});
