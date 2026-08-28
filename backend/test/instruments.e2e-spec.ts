import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Instruments (e2e)', () => {
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

  it('looks up a real ticker and returns its price', async () => {
    const res = await request(app.getHttpServer())
      .get('/instruments/lookup?symbol=nvda')
      .expect(200);
    expect(res.body.symbol).toBe('NVDA');
    expect(typeof res.body.price).toBe('number');
    expect(res.body.price).toBeGreaterThan(0);
    expect(typeof res.body.name).toBe('string');
  });

  it('404s on a ticker that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/instruments/lookup?symbol=ZZZZNOTREAL')
      .expect(404);
  });

  it('400s when no symbol is supplied', async () => {
    await request(app.getHttpServer()).get('/instruments/lookup').expect(400);
  });
});
