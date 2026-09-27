import { describe, expect, it } from 'vitest';
import { aiUnavailable } from './aiUnavailable';

describe('aiUnavailable', () => {
  it('names the feature in plain words, with no setup instructions', () => {
    // Shown to any account, not just the developer: an environment-variable
    // name or a "settings" screen that does not exist is noise to a user.
    const text = aiUnavailable('Watchlist ranking');
    expect(text).toBe("Watchlist ranking uses AI, which isn't turned on for this app yet.");
    expect(text).not.toMatch(/API|key|environment|settings|developer/i);
  });
});
