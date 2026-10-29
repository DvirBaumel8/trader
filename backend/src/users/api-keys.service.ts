import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from './api-key.entity.js';

export const API_KEY_PREFIX = 'kb_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(@InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>) {}

  /** Returns the plaintext key; it is never stored and cannot be shown again. */
  async create(userId: string, name: string): Promise<string> {
    const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
    await this.keys.save(this.keys.create({ userId, name, keyHash: hashApiKey(key), lastUsedAt: null }));
    return key;
  }

  /** The key's owner, or null for anything that is not a known key. */
  async resolve(key: string): Promise<string | null> {
    if (!key.startsWith(API_KEY_PREFIX)) return null;
    const row = await this.keys.findOne({ where: { keyHash: hashApiKey(key) } });
    if (!row) return null;
    await this.keys.update({ id: row.id }, { lastUsedAt: new Date() });
    return row.userId;
  }
}
