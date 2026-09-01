import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// api/client.ts imports lib/auth, which touches window.localStorage — stub
// it out so this file can test URL construction without a real window.
vi.mock('../lib/auth', () => ({
  getToken: () => null,
  clearToken: () => {},
}));

/**
 * `BASE_URL` (and the `/api` prefix decision derived from it) is computed
 * once, at module load, from `import.meta.env.VITE_API_BASE_URL`. To exercise
 * both the local (unset) and production (set) cases, each test stubs the env
 * var and then re-imports the module fresh via `vi.resetModules()`.
 */
describe('api client URL construction', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fetches /api/<path> when VITE_API_BASE_URL is unset (dev, proxy strips /api)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const { api } = await import('./client');

    await api('/portfolio');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/portfolio');
  });

  it('fetches <base>/<path> with no /api segment when VITE_API_BASE_URL is set (production, no proxy)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://trader-backend.onrender.com');
    const { api } = await import('./client');

    await api('/portfolio');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://trader-backend.onrender.com/portfolio',
    );
  });

  it('merges a caller-supplied init.headers instead of replacing the default headers', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const { api } = await import('./client');

    await api('/portfolio', { headers: { 'X-Extra': 'yes' } });

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Extra']).toBe('yes');
  });
});
