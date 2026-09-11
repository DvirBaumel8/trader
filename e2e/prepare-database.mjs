import { createFreshDatabase } from './database.mjs';

/**
 * Run as the first half of the test server's own start command.
 *
 * Not a Playwright globalSetup: Playwright starts `webServer` BEFORE
 * globalSetup runs, so a database created there does not exist yet when the
 * server boots — and the server now refuses to start without one, which is
 * exactly the behaviour we want it to keep.
 */
await createFreshDatabase({ cwd: process.cwd() });
