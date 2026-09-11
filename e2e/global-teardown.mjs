import { dropDatabase } from './database.mjs';

/**
 * Cleans up after itself, so a laptop does not accumulate a database per
 * branch. The start command recreates it regardless, so a crashed run that
 * never reaches here still leaves the next one empty.
 */
export default async function globalTeardown() {
  await dropDatabase();
}
