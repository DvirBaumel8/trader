// backend/test/global-setup.ts
import { hashSync } from 'bcryptjs';
import { createTestDatabase } from './setup-database.js';

export default async function globalSetup(): Promise<void> {
  // Must be set before any spec file's beforeAll boots the app —
  // AuthService reads this from process.env on every login call.
  process.env.APP_PASSWORD_HASH = hashSync('e2e-test-password', 10);

  // A test must never call a real language model. Without this, a developer
  // with a working LLM_API_KEY in .env runs a live, billable, non-deterministic
  // Gemini request as part of `npm run test:e2e` — and the suite then passes or
  // fails depending on whose machine it runs on. Unsetting it here forces the
  // deterministic unconfigured path, which is what the AI e2e specs assert.
  // Set empty rather than deleted: each spec boots the app, which runs
  // ConfigModule -> dotenv, and dotenv fills in any key NOT already present
  // in process.env. Deleting it therefore just invites the real key straight
  // back from .env; an empty string is "present" and is left alone.
  process.env.LLM_API_KEY = '';
  process.env.LLM_PROVIDER = '';

  // Same reasoning for the fundamentals provider: /portfolio now asks it for
  // any P/E the quote did not carry, so a developer with a real key would have
  // the portfolio e2e specs make live Finnhub calls. Empty rather than
  // deleted, for the dotenv reason above.
  process.env.FINNHUB_API_KEY = '';

  await createTestDatabase();
}
