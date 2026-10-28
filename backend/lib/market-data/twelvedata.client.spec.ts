import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwelveDataClient } from './twelvedata.client.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A fetch stub. No test may reach the network — see CLAUDE.md. */
function httpReturning(body: unknown, ok = true, status = 200) {
  const calls: string[] = [];
  const http = async (url: string | URL) => {
    calls.push(String(url));
    return { ok, status, json: async () => body } as Response;
  };
  return { http: http as unknown as typeof fetch, calls };
}

describe('TwelveDataClient configuration', () => {
  it('is unconfigured, and fetches nothing, without an API key', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', '');
    const { http, calls } = httpReturning({});
    const client = new TwelveDataClient(http);

    expect(client.isConfigured()).toBe(false);
    expect(await client.extendedPrice('META')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('is configured once a key is present', () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    expect(new TwelveDataClient(httpReturning({}).http).isConfigured()).toBe(true);
  });
});

describe('extendedPrice', () => {
  it('reads the extended-hours print and its timestamp from a quote payload', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    // Twelve Data reports numeric fields as strings, and the timestamp as
    // whole seconds since epoch.
    const { http } = httpReturning({
      close: '665.75',
      extended_price: '668.20',
      extended_timestamp: 1789775940,
    });

    expect(await new TwelveDataClient(http).extendedPrice('META')).toEqual({
      price: 668.2,
      timestamp: new Date(1789775940 * 1000),
    });
  });

  it('returns null when the print has no timestamp to judge freshness by', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http } = httpReturning({ extended_price: '668.20' });

    expect(await new TwelveDataClient(http).extendedPrice('META')).toBeNull();
  });

  it('asks for the symbol it was given, with prepost=true and the key', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http, calls } = httpReturning({ extended_price: '668.20' });

    await new TwelveDataClient(http).extendedPrice('META');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('symbol=META');
    expect(calls[0]).toContain('prepost=true');
    expect(calls[0]).toContain('apikey=test-key');
  });

  it('returns null when there is no extended print — the regular session, or a quiet name', () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http } = httpReturning({ close: '665.75' });

    return expect(new TwelveDataClient(http).extendedPrice('META')).resolves.toBeNull();
  });

  it('returns null on the provider\'s own in-body error shape', async () => {
    // Twelve Data returns some errors as 200 with status:"error" in the body.
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http } = httpReturning({
      code: 400,
      message: 'bad request',
      status: 'error',
    });

    expect(await new TwelveDataClient(http).extendedPrice('ZZZZ')).toBeNull();
  });

  it('returns null on a non-OK response rather than parsing an error body', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http } = httpReturning(
      { code: 404, message: 'invalid symbol', status: 'error' },
      false,
      404,
    );

    expect(await new TwelveDataClient(http).extendedPrice('ZZZZNOTREAL')).toBeNull();
  });

  it('returns null instead of throwing when the provider fails', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const http = (async () => {
      throw new Error('twelvedata down');
    }) as unknown as typeof fetch;

    expect(await new TwelveDataClient(http).extendedPrice('META')).toBeNull();
  });

  it('returns null rather than a bogus zero or negative price', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http } = httpReturning({ extended_price: '0' });

    expect(await new TwelveDataClient(http).extendedPrice('META')).toBeNull();
  });
});

describe('extendedPrice rate limiting', () => {
  // Found live: 30+ symbols asked for an extended print on the same poll
  // against an 8/minute plan, and every single one came back HTTP 429. The
  // client must stop asking once its own budget for the window is spent,
  // rather than firing into a guaranteed rejection.
  it('stops calling the provider once 8 requests have gone out within a minute', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http, calls } = httpReturning({ extended_price: '668.20', extended_timestamp: 1 });
    let now = 0;
    const client = new TwelveDataClient(http, () => now);

    for (let i = 0; i < 8; i++) {
      expect(await client.extendedPrice(`SYM${i}`)).not.toBeNull();
    }
    expect(calls).toHaveLength(8);

    // The 9th request in the same window must not reach the network at all.
    expect(await client.extendedPrice('SYM9')).toBeNull();
    expect(calls).toHaveLength(8);
  });

  it('allows new requests once the oldest ones age out of the window', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test-key');
    const { http, calls } = httpReturning({ extended_price: '668.20', extended_timestamp: 1 });
    let now = 0;
    const client = new TwelveDataClient(http, () => now);

    for (let i = 0; i < 8; i++) {
      await client.extendedPrice(`SYM${i}`);
    }
    expect(await client.extendedPrice('BLOCKED')).toBeNull();

    now += 60_000; // a full window later, the earliest 8 calls have aged out

    expect(await client.extendedPrice('ALLOWED')).not.toBeNull();
    expect(calls).toHaveLength(9);
  });

  it('never spends budget on a request skipped for having no API key', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', '');
    const { http, calls } = httpReturning({ extended_price: '668.20', extended_timestamp: 1 });
    const client = new TwelveDataClient(http, () => 0);

    for (let i = 0; i < 20; i++) {
      await client.extendedPrice(`SYM${i}`);
    }
    expect(calls).toEqual([]);
  });
});
