import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { UsersService } from '../users/users.service.js';
import { HealthController } from './health.controller.js';

const controller = () => new HealthController({} as DataSource, {} as UsersService);

describe('HealthController.ping', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports the first 7 characters of RENDER_GIT_COMMIT as the version', () => {
    vi.stubEnv('RENDER_GIT_COMMIT', '1c59fda0123456789abcdef0123456789abcdef0');
    expect(controller().ping()).toEqual({ status: 'ok', version: '1c59fda' });
  });

  it('reports a null version when RENDER_GIT_COMMIT is unset', () => {
    vi.stubEnv('RENDER_GIT_COMMIT', undefined);
    expect(controller().ping()).toEqual({ status: 'ok', version: null });
  });

  it('reports a null version when RENDER_GIT_COMMIT is empty', () => {
    vi.stubEnv('RENDER_GIT_COMMIT', '');
    expect(controller().ping()).toEqual({ status: 'ok', version: null });
  });
});
