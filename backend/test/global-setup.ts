// backend/test/global-setup.ts
import { hashSync } from 'bcryptjs';
import { createTestDatabase } from './setup-database.js';

export default async function globalSetup(): Promise<void> {
  // Must be set before any spec file's beforeAll boots the app —
  // AuthService reads this from process.env on every login call.
  process.env.APP_PASSWORD_HASH = hashSync('e2e-test-password', 10);
  await createTestDatabase();
}
