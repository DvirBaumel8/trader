import { describe, expect, it } from 'vitest';
import { hashApiKey } from './api-key-format.js';
import { ApiKeysService } from './api-keys.service.js';

function setup() {
  const rows: Array<{ id: string; userId: string; name: string; keyHash: string; lastUsedAt: Date | null }> = [];
  const repo = {
    create: (r: object) => r,
    save: async (r: (typeof rows)[number]) => {
      rows.push({ ...r, id: `k${rows.length}` });
      return r;
    },
    findOne: async ({ where }: { where: { keyHash: string } }) => rows.find((r) => r.keyHash === where.keyHash) ?? null,
    update: async ({ id }: { id: string }, patch: Partial<(typeof rows)[number]>) => {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
  };
  return { service: new ApiKeysService(repo as never), rows };
}

describe('ApiKeysService', () => {
  it('creates a kb_ key of 43 base64url characters that resolves to its owner', async () => {
    const { service, rows } = setup();
    const key = await service.create('u1', 'laptop');
    expect(key).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    expect(await service.resolve(key)).toBe('u1');
    expect(rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it('stores the sha256 hex, not the key', async () => {
    const { service, rows } = setup();
    const key = await service.create('u1', 'laptop');
    expect(rows[0].keyHash).toBe(hashApiKey(key));
    expect(rows[0].keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('returns null for a wrong key and for anything without the kb_ prefix', async () => {
    const { service } = setup();
    const key = await service.create('u1', 'laptop');
    expect(await service.resolve(key + 'x')).toBeNull();
    expect(await service.resolve('kb_nope')).toBeNull();
    expect(await service.resolve(key.slice(3))).toBeNull();
    expect(await service.resolve('')).toBeNull();
  });
});
