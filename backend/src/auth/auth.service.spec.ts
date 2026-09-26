import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

function makeService() {
  const jwt = { signAsync: vi.fn().mockResolvedValue('token') };
  const users = {
    ensureDefaultUser: vi
      .fn()
      .mockResolvedValue({ id: 'owner', displayName: 'me', email: null, avatarUrl: null }),
  };
    const repo = { save: vi.fn().mockResolvedValue(undefined) };
  return new AuthService(jwt as never, users as never, {} as never, repo as never);
}

describe('AuthService.loginWithAppPassword', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses the dev passwords in production when no hash is configured', async () => {
    // A production deploy missing APP_PASSWORD_HASH must fail closed, not
    // open the owner's account to "trader".
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_PASSWORD_HASH', '');
    await expect(makeService().loginWithAppPassword('trader')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('still accepts a dev password locally', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('APP_PASSWORD_HASH', '');
    await expect(makeService().loginWithAppPassword('trader')).resolves.toMatchObject({
      user: { id: 'owner' },
    });
  });
});
