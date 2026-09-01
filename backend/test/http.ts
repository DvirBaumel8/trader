import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

const TEST_PASSWORD = 'e2e-test-password';

/**
 * Every protected route now requires a bearer token. Logging in once per
 * spec file and reusing the token keeps each test focused on what it's
 * actually checking, instead of repeating a login call in every case.
 */
export async function login(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ password: TEST_PASSWORD })
    .expect(201);
  return res.body.accessToken as string;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * Same call shape as `request(app.getHttpServer())`, with the bearer token
 * already attached — a drop-in replacement so existing spec bodies don't
 * need to change beyond the token being in scope.
 */
export function http(app: INestApplication, token: string) {
  const bound = (method: Method) => (path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  return {
    get: bound('get'),
    post: bound('post'),
    patch: bound('patch'),
    delete: bound('delete'),
  };
}
