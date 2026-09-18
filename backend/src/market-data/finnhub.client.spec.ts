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

describe('companyNews', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-08T00:00:00Z');

  it('reads headlines from the company-news payload', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning([
      {
        headline: 'NVO partners with Anthropic to accelerate medicine development',
        summary: 'The companies announced...',
        source: 'Reuters',
        datetime: 1757289600,
        url: 'https://example.com/1',
      },
    ]);

    const news = await new FinnhubClient(http).companyNews('NVO', from, to);

    expect(news).toEqual([
      {
        headline: 'NVO partners with Anthropic to accelerate medicine development',
        summary: 'The companies announced...',
        source: 'Reuters',
        datetime: 1757289600,
        url: 'https://example.com/1',
      },
    ]);
  });

  it('asks for the symbol and date range it was given, as YYYY-MM-DD, and carries the key', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http, calls } = httpReturning([]);

    await new FinnhubClient(http).companyNews('AVGO', from, to);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/company-news?');
    expect(calls[0]).toContain('symbol=AVGO');
    expect(calls[0]).toContain('from=2026-09-01');
    expect(calls[0]).toContain('to=2026-09-08');
    expect(calls[0]).toContain('token=test-key');
  });

  it('returns an empty list without a key, and fetches nothing', async () => {
    vi.stubEnv('FINNHUB_API_KEY', '');
    const { http, calls } = httpReturning([]);

    expect(await new FinnhubClient(http).companyNews('APP', from, to)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('drops an item with no headline rather than passing through a blank one', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning([
      { headline: '', summary: 's', source: 'Reuters', datetime: 1, url: 'u' },
      { headline: 'Real headline', summary: 's', source: 'Reuters', datetime: 2, url: 'u' },
    ]);

    const news = await new FinnhubClient(http).companyNews('APP', from, to);

    expect(news).toHaveLength(1);
    expect(news[0].headline).toBe('Real headline');
  });

  it('returns an empty list rather than throwing when the provider fails', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const http = (async () => {
      throw new Error('finnhub down');
    }) as unknown as typeof fetch;

    expect(await new FinnhubClient(http).companyNews('APP', from, to)).toEqual([]);
  });

  it('returns an empty list on a non-OK response rather than parsing an error body', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    const { http } = httpReturning({ error: 'rate limit' }, false);

    expect(await new FinnhubClient(http).companyNews('APP', from, to)).toEqual([]);
  });

  it('returns an empty list rather than throwing when the payload is not an array', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key');
    // Finnhub's own documented shape for a bad symbol/params.
    const { http } = httpReturning({ error: 'invalid symbol' });

    expect(await new FinnhubClient(http).companyNews('ZZZZ', from, to)).toEqual([]);
  });
});
