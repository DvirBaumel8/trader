// backend/src/database/connection-options.spec.ts
import { describe, expect, it } from 'vitest';
import { buildConnectionOptions } from './connection-options.js';

describe('buildConnectionOptions', () => {
  it('uses DATABASE_URL when set, ignoring the discrete vars', () => {
    const opts = buildConnectionOptions({
      DATABASE_URL: 'postgresql://u:p@example.com:5432/neondb',
      DB_HOST: 'localhost',
      DB_NAME: 'trader',
    } as NodeJS.ProcessEnv);
    expect(opts).toEqual({
      url: 'postgresql://u:p@example.com:5432/neondb',
      ssl: false,
    });
  });

  it('falls back to discrete DB_* vars locally', () => {
    const opts = buildConnectionOptions({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'dvir',
      DB_NAME: 'trader',
    } as NodeJS.ProcessEnv);
    expect(opts).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'dvir',
      password: undefined,
      database: 'trader',
      ssl: false,
    });
  });

  it('defaults host/port/database when nothing is set', () => {
    const opts = buildConnectionOptions({} as NodeJS.ProcessEnv);
    expect(opts.host).toBe('localhost');
    expect(opts.port).toBe(5432);
    expect(opts.database).toBe('trader');
  });

  it('lets overrideDatabase win over DB_NAME (the NODE_ENV=test case)', () => {
    const opts = buildConnectionOptions(
      { DB_NAME: 'trader' } as NodeJS.ProcessEnv,
      'trader_test',
    );
    expect(opts.database).toBe('trader_test');
  });

  it('reads DATABASE_SSL=true into the ssl option', () => {
    const opts = buildConnectionOptions({
      DATABASE_URL: 'postgresql://u:p@example.com:5432/neondb',
      DATABASE_SSL: 'true',
    } as NodeJS.ProcessEnv);
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('throws rather than silently discarding overrideDatabase when DATABASE_URL is set', () => {
    expect(() =>
      buildConnectionOptions(
        {
          DATABASE_URL: 'postgresql://u:p@example.com:5432/neondb',
        } as NodeJS.ProcessEnv,
        'trader_test',
      ),
    ).toThrow(/Refusing to redirect a DATABASE_URL connection/);
  });
});
