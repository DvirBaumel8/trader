import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinnhubClient } from './finnhub.client.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A fetch stub. No test may reach the network — see CLAUDE.md. */
function httpReturning(body: unknown, ok = true) {
  const calls: string[] = [];
  const http = async (url: string | URL) => {
    calls.push(String(url));
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
  };
  return { http: http as unknown as typeof fetch, calls };
}

describe('FinnhubClient configuration', () => {
  it('is unconfigured, and fetches nothing, without an API key', async () => {
    vi.stubEnv('FINNHUB_API_KEY', '');
    const { http, calls } = httpReturning({});
    const client = new FinnhubClient(http);

    expect(client.isConfigured()).toBe(false);
    expect(await client.trailingEps('APP')).toBeNull();
    // The point of the guard: no key means no request at all, so an
    // unconfigured deploy costs nothing and behaves exactly as before.
    expect(calls).toEqual([]);
  });

  it('is configured once a key is present', () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    expect(new FinnhubClient(httpReturning({}).http).isConfigured()).toBe(true);
  });
});

describe('trailingEps', () => {
  it('reads trailing EPS from the basic-financials payload', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning({ metric: { epsTTM: 8.42 } });

    expect(await new FinnhubClient(http).trailingEps('APP')).toBe(8.42);
  });

  it('asks for the symbol it was given, and carries the key', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http, calls } = httpReturning({ metric: { epsTTM: 8.42 } });

    await new FinnhubClient(http).trailingEps('AVGO');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('symbol=AVGO');
    expect(calls[0]).toContain('token=test-key');
  });

  it('returns null when the provider reports no trailing EPS', async () => {
    // Common and legitimate: an ETF, or a company with no trailing earnings.
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning({ metric: {} });

    expect(await new FinnhubClient(http).trailingEps('BITX')).toBeNull();
  });

  it('returns null rather than a P/E-breaking zero', async () => {
    // Zero EPS would divide into an infinite P/E downstream.
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning({ metric: { epsTTM: 0 } });

    expect(await new FinnhubClient(http).trailingEps('CRWV')).toBeNull();
  });

  it('returns null instead of throwing when the provider fails', async () => {
    // Fundamentals are a garnish on a price. A Finnhub outage must never take
    // down a quote that Yahoo answered perfectly well.
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const http = (async () => {
      throw new Error('finnhub down');
    }) as unknown as typeof fetch;

    expect(await new FinnhubClient(http).trailingEps('APP')).toBeNull();
  });

  it('returns null on a non-OK response rather than parsing an error body', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning({ error: 'rate limit' }, false);

    expect(await new FinnhubClient(http).trailingEps('APP')).toBeNull();
  });
});
