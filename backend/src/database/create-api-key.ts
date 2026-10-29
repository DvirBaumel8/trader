// Usage: tsx src/database/create-api-key.ts <email | --owner> <name>
// Prints a new API key for the user once; only its hash is stored.
// --owner is the original account the shared app password signs in to
// (UsersService.ensureDefaultUser: the oldest user); it has no email.
import { newApiKey } from '../users/api-key-format.js';

async function main(): Promise<void> {
  const [emailArg, name] = process.argv.slice(2);
  if (!emailArg || !name) {
    console.error('Usage: create-api-key <email | --owner> <name>');
    process.exit(1);
  }
  const { default: dataSource } = await import('./data-source.js');
  const owner = emailArg === '--owner';
  const email = emailArg.trim().toLowerCase();
  await dataSource.initialize();
  try {
    const users: Array<{ id: string }> = owner
      ? await dataSource.query('SELECT id FROM users ORDER BY "createdAt" ASC LIMIT 1')
      : await dataSource.query('SELECT id FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
    if (users.length === 0) {
      console.error(owner ? 'No users yet' : `No user with email ${email}`);
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
