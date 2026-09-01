import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'not-the-password' })
      .expect(401);
  });

  it('issues a token for the correct password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'e2e-test-password' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('blocks a protected route without a token', async () => {
    await request(app.getHttpServer()).get('/portfolio').expect(401);
  });

  it('blocks a protected route with a garbage token', async () => {
    await request(app.getHttpServer())
      .get('/portfolio')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('allows /health/ping with no token', async () => {
    await request(app.getHttpServer()).get('/health/ping').expect(200);
  });
});
