import { describe, expect, it, vi } from 'vitest';
import { FundamentalsService } from './fundamentals.service.js';
import type { FinnhubClient } from './finnhub.client.js';

function serviceWith(eps: (number | null)[] | number | null) {
  const values = Array.isArray(eps) ? [...eps] : [eps];
  const trailingEps = vi.fn(async () => (values.length > 1 ? values.shift()! : values[0]));
  const client = { trailingEps } as unknown as FinnhubClient;
  return { service: new FundamentalsService(client), trailingEps };
}

describe('peRatio', () => {
  it('divides the live price by trailing EPS, so it moves with the price', async () => {
    // The whole reason for storing EPS rather than a P/E: the price changes
    // all day, the earnings do not.
    const { service } = serviceWith(8);

    expect(await service.peRatio('APP', 320)).toBe(40);
    expect(await service.peRatio('APP', 400)).toBe(50);
  });

  it('nulls a negative P/E rather than passing it through as real', async () => {
    // An unprofitable name has no meaningful multiple — same rule the Yahoo
    // quote path already applies to a non-positive trailingPE.
    const { service } = serviceWith(-2.5);

    expect(await service.peRatio('CRWV', 89)).toBeNull();
  });

  it('is null when the provider has no EPS for the symbol', async () => {
    const { service } = serviceWith(null);

    expect(await service.peRatio('BITX', 18.25)).toBeNull();
  });

  it('fetches EPS once per symbol rather than on every price refresh', async () => {
    // The dashboard re-prices every 60s; earnings move quarterly. Refetching
    // per request would burn the free tier's quota for nothing.
    const { service, trailingEps } = serviceWith(8);

    await service.peRatio('APP', 320);
    await service.peRatio('APP', 321);
    await service.peRatio('APP', 322);

    expect(trailingEps).toHaveBeenCalledTimes(1);
  });

  it('keeps symbols apart', async () => {
    const { service, trailingEps } = serviceWith([8, 4]);

    expect(await service.peRatio('APP', 320)).toBe(40);
    expect(await service.peRatio('NVDA', 200)).toBe(50);
    expect(trailingEps).toHaveBeenCalledTimes(2);
  });

  it('does not cache a missing EPS as though it were an answer', async () => {
    // A transient outage must not blank the P/E until tomorrow.
    const { service, trailingEps } = serviceWith([null, 8]);

    expect(await service.peRatio('APP', 320)).toBeNull();
    expect(await service.peRatio('APP', 320)).toBe(40);
    expect(trailingEps).toHaveBeenCalledTimes(2);
  });

  it('is null for a price that cannot produce a multiple', async () => {
    const { service } = serviceWith(8);

    expect(await service.peRatio('APP', 0)).toBeNull();
  });
});

describe('fillMissingPeRatios', () => {
  const quote = (symbol: string, price: number, peRatio: number | null) => ({
    symbol,
    price,
    peRatio,
  });

  it('fills the P/E on quotes that arrived without one', async () => {
    const { service } = serviceWith(8);
    const quotes = new Map([['APP', quote('APP', 320, null)]]);

    await service.fillMissingPeRatios(quotes);

    expect(quotes.get('APP')?.peRatio).toBe(40);
  });

  it('leaves a P/E the quote already carried untouched', async () => {
    const { service, trailingEps } = serviceWith(8);
    const quotes = new Map([['APP', quote('APP', 320, 37.4)]]);

    await service.fillMissingPeRatios(quotes);

    expect(quotes.get('APP')?.peRatio).toBe(37.4);
    expect(trailingEps).not.toHaveBeenCalled();
  });

  it('leaves the P/E null when no EPS is available', async () => {
    const { service } = serviceWith(null);
    const quotes = new Map([['BITX', quote('BITX', 18.25, null)]]);

    await service.fillMissingPeRatios(quotes);

    expect(quotes.get('BITX')?.peRatio).toBeNull();
  });

  it('does not let one symbol failing blank the others', async () => {
    const { service } = serviceWith([null, 4]);
    const quotes = new Map([
      ['BROKEN', quote('BROKEN', 100, null)],
      ['NVDA', quote('NVDA', 200, null)],
    ]);

    await service.fillMissingPeRatios(quotes);

    expect(quotes.get('BROKEN')?.peRatio).toBeNull();
    expect(quotes.get('NVDA')?.peRatio).toBe(50);
  });
});
