import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, TEST_PASSWORD } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';
import { GoogleVerifier } from '../src/auth/google-verifier.js';

/**
 * The verifier is the only thing in auth that talks to the network, so it is
 * the only thing stubbed — the same treatment YahooClient gets, for the same
 * reason (test/offline-guard.ts would otherwise fail the run).
 */
const googleStub = {
  isConfigured: () => true,
  verify: async (idToken: string) =>
    idToken === 'good'
      ? {
          googleId: 'g-123',
          email: 'someone@example.com',
          displayName: 'Someone',
          avatarUrl: 'https://example.com/a.png',
        }
      : idToken === 'unverified-email'
        ? {
            googleId: 'g-456',
            email: null,
            displayName: 'No Email',
            avatarUrl: null,
          }
        : null,
};

describe('Accounts (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .overrideProvider(GoogleVerifier)
      .useValue(googleStub)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    // Keep the owner row: it is the one the app falls back to, and several
    // behaviours here are about not disturbing it.
    await dataSource.query(
      `DELETE FROM users WHERE email IS NOT NULL OR "googleId" IS NOT NULL`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: object) =>
    http(app).post(path).send(body);

  describe('the owner, who predates accounts', () => {
    /**
     * The single most important test here. His account has no email and no
     * password of its own; if this breaks, he is locked out of his own
     * portfolio by a deploy.
     */
    it('still signs in with the shared app password', async () => {
      const res = await post('/auth/login', { password: TEST_PASSWORD }).expect(201);
      expect(res.body.accessToken).toBeTruthy();
    });

    it('refuses the wrong app password', async () => {
      await post('/auth/login', { password: 'nope' }).expect(401);
    });

    it('reaches his own portfolio with the token it returns', async () => {
      const res = await post('/auth/login', { password: TEST_PASSWORD }).expect(201);
      await http(app, res.body.accessToken).get('/portfolio').expect(200);
    });
  });

  describe('email accounts', () => {
    it('signs up and comes back signed in', async () => {
      const res = await post('/auth/signup', {
        email: 'New@Example.com',
        password: 'longenough1',
      }).expect(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.user.email).toBe('new@example.com');
    });

    it('refuses a second account on the same email, whatever its case', async () => {
      await post('/auth/signup', { email: 'a@b.com', password: 'longenough1' }).expect(201);
      await post('/auth/signup', { email: 'A@B.COM', password: 'longenough1' }).expect(409);
    });

    it('refuses a password too short to be worth hashing', async () => {
      await post('/auth/signup', { email: 'x@y.com', password: 'short' }).expect(400);
    });

    it('signs in again afterwards', async () => {
      await post('/auth/signup', { email: 'a@b.com', password: 'longenough1' }).expect(201);
      const res = await post('/auth/signin', {
        email: 'a@b.com',
        password: 'longenough1',
      }).expect(201);
      expect(res.body.user.email).toBe('a@b.com');
    });

    /** Same message either way, so the response cannot enumerate accounts. */
    it('gives the same answer for a wrong password and an unknown email', async () => {
      await post('/auth/signup', { email: 'a@b.com', password: 'longenough1' }).expect(201);
      const wrongPassword = await post('/auth/signin', {
        email: 'a@b.com',
        password: 'wrongwrong',
      }).expect(401);
      const noSuchUser = await post('/auth/signin', {
        email: 'nobody@b.com',
        password: 'longenough1',
      }).expect(401);
      expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
    });
  });

  describe('two users', () => {
    /** The whole point: one person's journal must not be another's. */
    it('keeps their portfolios apart', async () => {
      const one = await post('/auth/signup', {
        email: 'one@b.com',
        password: 'longenough1',
      }).expect(201);
      const two = await post('/auth/signup', {
        email: 'two@b.com',
        password: 'longenough1',
      }).expect(201);

      await http(app, one.body.accessToken)
        .post('/watchlist')
        .send({ symbol: 'NVDA' })
        .expect(201);

      const mine = await http(app, one.body.accessToken)
        .get('/watchlist')
        .expect(200);
      const theirs = await http(app, two.body.accessToken)
        .get('/watchlist')
        .expect(200);

      expect(mine.body).toHaveLength(1);
      expect(theirs.body).toEqual([]);
    });

    /**
     * The watchlist alone proves the seam works; the journal proves it was
     * applied everywhere. It is the main data path, and the one whose leak
     * would matter most.
     */
    it('keeps their journals apart', async () => {
      const one = await post('/auth/signup', {
        email: 'j1@b.com',
        password: 'longenough1',
      }).expect(201);
      const two = await post('/auth/signup', {
        email: 'j2@b.com',
        password: 'longenough1',
      }).expect(201);

      await http(app, one.body.accessToken)
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'mine alone',
          occurredAt: '2026-01-05T12:00:00.000Z',
          trade: { symbol: 'NVDA', quantity: 10, price: 100, fee: 0 },
        })
        .expect(201);

      const mineJournal = await http(app, one.body.accessToken)
        .get('/journal')
        .expect(200);
      const theirJournal = await http(app, two.body.accessToken)
        .get('/journal')
        .expect(200);

      expect(mineJournal.body).toHaveLength(1);
      expect(theirJournal.body).toEqual([]);
    });

    /** A second user's portfolio starts empty rather than showing the owner's. */
    it("does not show one user the other's positions", async () => {
      const two = await post('/auth/signup', {
        email: 'p2@b.com',
        password: 'longenough1',
      }).expect(201);
      const res = await http(app, two.body.accessToken)
        .get('/portfolio')
        .expect(200);
      expect(res.body.positions).toEqual([]);
    });

    /** Settings are per user: one person's default fee is not another's. */
    it('keeps their settings apart', async () => {
      const one = await post('/auth/signup', {
        email: 's1@b.com',
        password: 'longenough1',
      }).expect(201);
      const two = await post('/auth/signup', {
        email: 's2@b.com',
        password: 'longenough1',
      }).expect(201);

      await http(app, one.body.accessToken)
        .patch('/settings')
        .send({ defaultFee: 12 })
        .expect(200);

      const theirs = await http(app, two.body.accessToken)
        .get('/settings')
        .expect(200);
      expect(theirs.body.defaultFee).not.toBe(12);
    });
  });

  describe('google', () => {
    it('advertises whether it is available at all', async () => {
      const res = await http(app).get('/auth/config').expect(200);
      expect(res.body.google).toBe(true);
    });

    it('creates an account on first sign-in', async () => {
      const res = await post('/auth/google', { idToken: 'good' }).expect(201);
      expect(res.body.user.email).toBe('someone@example.com');
      expect(res.body.accessToken).toBeTruthy();
    });

    it('returns to the same account on the second sign-in', async () => {
      const first = await post('/auth/google', { idToken: 'good' }).expect(201);
      const second = await post('/auth/google', { idToken: 'good' }).expect(201);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    /**
     * Signing in with Google to an address you already have a password for
     * should reach your data, not a second empty account.
     */
    it('links to an existing password account with the same verified email', async () => {
      const signedUp = await post('/auth/signup', {
        email: 'someone@example.com',
        password: 'longenough1',
      }).expect(201);
      const viaGoogle = await post('/auth/google', { idToken: 'good' }).expect(201);
      expect(viaGoogle.body.user.id).toBe(signedUp.body.user.id);
    });

    it('rejects a token Google does not vouch for', async () => {
      await post('/auth/google', { idToken: 'forged' }).expect(401);
    });
  });
});
