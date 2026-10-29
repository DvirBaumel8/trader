// Usage: tsx src/database/create-api-key.ts <email> <name>
// Prints a new API key for the user once; only its hash is stored.
import dataSource from './data-source.js';
import { newApiKey } from '../users/api-keys.service.js';

async function main(): Promise<void> {
  const [emailArg, name] = process.argv.slice(2);
  if (!emailArg || !name) {
    console.error('Usage: create-api-key <email> <name>');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  await dataSource.initialize();
  try {
    const users: Array<{ id: string }> = await dataSource.query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    if (users.length === 0) {
      console.error(`No user with email ${email}`);
      process.exitCode = 1;
      return;
    }
    const { key, keyHash } = newApiKey();
    await dataSource.query('INSERT INTO api_keys ("userId", name, "keyHash") VALUES ($1, $2, $3)', [
      users[0].id,
      name,
      keyHash,
    ]);
    console.log(key);
    console.error('Save this key now; it cannot be shown again.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
