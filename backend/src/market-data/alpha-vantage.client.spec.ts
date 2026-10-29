import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlphaVantageClient } from './alpha-vantage.client.js';

const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

describe('AlphaVantageClient.quarterEstimates', () => {
  const saved = process.env.ALPHAVANTAGE_API_KEY;
  beforeEach(() => {
    process.env.ALPHAVANTAGE_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
    else process.env.ALPHAVANTAGE_API_KEY = saved;
  });

  it('parses fiscal-quarter rows only, as numbers, oldest first', async () => {
    const fetchFn = vi.fn(async () =>
      reply({
        symbol: 'NVDA',
        estimates: [
          { date: '2026-10-31', horizon: 'fiscal quarter', eps_estimate_average: '2.4712', revenue_estimate_average: '109000000000.00' },
          { date: '2027-01-31', horizon: 'fiscal year', eps_estimate_average: '9.9', revenue_estimate_average: '1' },
          { date: '2026-07-31', horizon: 'fiscal quarter', eps_estimate_average: '2.0916', revenue_estimate_average: '92176624640.00' },
          { date: '2026-04-30', horizon: 'fiscal quarter', eps_estimate_average: 'None', revenue_estimate_average: null },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchFn);
    const out = await new AlphaVantageClient().quarterEstimates('NVDA');
    expect(out).toEqual([
      { periodEnd: '2026-04-30', epsEstimate: null, revenueEstimate: null },
      { periodEnd: '2026-07-31', epsEstimate: 2.0916, revenueEstimate: 92_176_624_640 },
      { periodEnd: '2026-10-31', epsEstimate: 2.4712, revenueEstimate: 109_000_000_000 },
    ]);
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('function=EARNINGS_ESTIMATES');
    expect(url).toContain('symbol=NVDA');
    expect(url).toContain('apikey=test-key');
  });

  it.each([['Information'], ['Note'], ['Error Message']])('throws on a %s reply', async (field) => {
    vi.stubGlobal('fetch', async () => reply({ [field]: 'You have exceeded the daily limit' }));
    await expect(new AlphaVantageClient().quarterEstimates('NVDA')).rejects.toThrow('Alpha Vantage');
  });

  it('throws on an HTTP failure', async () => {
    vi.stubGlobal('fetch', async () => reply({}, false, 500));
    await expect(new AlphaVantageClient().quarterEstimates('NVDA')).rejects.toThrow('500');
  });

  it('throws without a key, before any request', async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await expect(new AlphaVantageClient().quarterEstimates('NVDA')).rejects.toThrow('ALPHAVANTAGE_API_KEY');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
