import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('create-api-key script', () => {
  it('prints usage and exits 1 without arguments, without loading entities or a database', () => {
    const r = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), 'src/database/create-api-key.ts'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DATABASE_URL: '' },
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage: create-api-key');
    expect(r.stderr).not.toContain('ColumnTypeUndefinedError');
  });
});
