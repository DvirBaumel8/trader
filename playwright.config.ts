import { defineConfig, devices } from '@playwright/test';
const E2E_DB = 'trader_e2e';

const PORT = 3010;

/**
 * Browser tests.
 *
 * Deliberately few. Asking which of a day's real bugs a browser test would
 * have caught gave an uncomfortable answer — one and a half of six — so this
 * covers the flows where a break is invisible to every other kind of test
 * (navigation, a screen that renders but does nothing) and leaves everything
 * else to the unit and API suites, which are faster and more precise.
 *
 * One server, serving the built frontend and the API on the same origin, the
 * way production does. The entry point is `main.e2e.ts`, whose only
 * difference is a stubbed market-data client: every write path creates an
 * instrument from a live quote, so without it these tests would reach the
 * network and assert a different price every day.
 */
export default defineConfig({
  testDir: './e2e',
  // The database is shared and created once per run, so specs must not race
  // each other through it. They are cheap; serial is fine and honest.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  globalTeardown: './e2e/global-teardown.mjs',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The owner's device is a phone, and that is where the bugs have been.
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // From `backend/`, because the server resolves the built frontend
    // relative to its own working directory, exactly as production does.
    cwd: 'backend',
    command: 'node ../e2e/prepare-database.mjs && node dist-e2e/src/main.e2e.js',
    url: `http://127.0.0.1:${PORT}/health/ping`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DB_NAME: E2E_DB,
      NODE_ENV: 'e2e',
      // A known password hash so specs can sign in as the owner without
      // knowing his real one. Value: "e2e-password".
      APP_PASSWORD_HASH: '$2b$10$pu5PrlnXbN6b/lMd94meOOe/9o58Wh.9iC6ktiZlC4.6ZSd1uWSie',
    },
  },
});
