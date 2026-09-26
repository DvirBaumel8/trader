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
    expect(profile).toContain('## How to talk to him');
  });

  it('frames its figures as dated, so the model never presents them as the current book', async () => {
    // The profile quotes snapshot figures from the interview ("29% of the
    // account"), and every prompt tells the model to quote figures it was
    // given. Without this framing, a months-old holding reads as today's.
    const profile = await readTraderProfile(users('owner-id'));
    expect(profile).toMatch(/^Background from an interview/);
    expect(profile).toMatch(/never present one as current/i);
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
