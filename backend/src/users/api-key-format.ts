import { createHash, randomBytes } from 'node:crypto';

// Pure on purpose (no Nest or TypeORM imports): scripts run under tsx import it.
export const API_KEY_PREFIX = 'kb_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** A fresh random key and the hash that gets stored. The one place keys are made. */
export function newApiKey(): { key: string; keyHash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, keyHash: hashApiKey(key) };
}
