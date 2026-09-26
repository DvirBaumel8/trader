import { describe, expect, it } from 'vitest';
import { readTraderProfile } from './trader-profile.js';

const users = (me: string, owner = 'owner-id') => ({
  currentUser: async () => ({ id: me }),
  ensureDefaultUser: async () => ({ id: owner }),
});

describe('readTraderProfile', () => {
  it("gives the owner his own profile", async () => {
    const profile = await readTraderProfile(users('owner-id'));
    expect(profile).toContain('# Trader Profile');
  });

  it("never gives another account the owner's profile", async () => {
    // The file describes one person's positions, history and weaknesses; in
    // another user's prompt it is both wrong advice and a privacy leak.
    expect(await readTraderProfile(users('someone-else'))).toBeNull();
  });

  it('reads as no profile when the caller cannot say who is asking', async () => {
    expect(await readTraderProfile(undefined)).toBeNull();
  });
});
