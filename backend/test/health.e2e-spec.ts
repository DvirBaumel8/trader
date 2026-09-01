import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { http, login } from './http.js';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database is reachable and a default user exists', async () => {
    const res = await http(app, token).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(res.body.userId).toEqual(expect.any(String));
  });

  it('serves /health/ping with no token, touching no database state', async () => {
    const res = await request(app.getHttpServer()).get('/health/ping').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
