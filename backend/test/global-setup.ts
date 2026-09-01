// backend/test/global-setup.ts
import { createTestDatabase } from './setup-database.js';

export default async function globalSetup(): Promise<void> {
  await createTestDatabase();
}
