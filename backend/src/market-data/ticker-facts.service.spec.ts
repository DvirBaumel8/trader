import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TickerFactsService } from './ticker-facts.service.js';
import type { YahooClient } from './yahoo.client.js';
import type { FundamentalsService } from './fundamentals.service.js';

const QUOTE = {
  symbol: 'NVDA',
  name: 'NVIDIA',
  price: 200,
  currency: 'USD',
  session: 'REGULAR' as const,
  extended: false,
  regularPrice: 200,
  peRatio: 25,
};

const BARS = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  close: 200,
  adjClose: 200,
  open: 200,
  high: 202,
  low: 198,
  volume: 1_000_000,
}));

function makeService(opts: {
  quote?: () => unknown;
  dailyBars?: () => unknown;
}) {
  const yahoo = {
    quote: vi.fn().mockImplementation(opts.quote ?? (async () => QUOTE)),
    dailyBars: vi.fn().mockImplementation(opts.dailyBars ?? (async () => BARS)),
  } as unknown as YahooClient;
  const fundamentals = {
    peRatio: vi.fn().mockResolvedValue(null),
  } as unknown as FundamentalsService;
  return { service: new TickerFactsService(yahoo, fundamentals), yahoo };
}

describe('TickerFactsService.get', () => {
  it('asks for the quote and the history at once, not one after the other', async () => {
    // They need nothing from each other, and the request used to wait
    // through both round trips in series before the model was even called.
    const order: string[] = [];
    const { service } = makeService({
      quote: async () => {
        order.push('quote:start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('quote:end');
        return QUOTE;
      },
      dailyBars: async () => {
        order.push('bars:start');
        return BARS;
      },
    });

    await service.get('NVDA');

    // Bars begin before the quote has come back — impossible if serial.
    expect(order.indexOf('bars:start')).toBeLessThan(order.indexOf('quote:end'));
  });

  it('404s a ticker the provider does not recognise', async () => {
    const { service } = makeService({ quote: async () => null });
    await expect(service.get('ZZZZNOTREAL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('503s when the quote fails, rather than reading as "no such symbol"', async () => {
    const { service } = makeService({
      quote: async () => {
        throw new Error('provider down');
      },
    });
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('503s when only the history fails, rather than answering on half the facts', async () => {
    const { service } = makeService({
      dailyBars: async () => {
        throw new Error('history down');
      },
    });
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports an unknown ticker as unknown even when the history also fails', async () => {
    // Both settle as failures now that they run together; which one the
    // caller is told about must not depend on that race.
    const { service } = makeService({
      quote: async () => null,
      dailyBars: async () => {
        throw new Error('history down');
      },
    });
    await expect(service.get('ZZZZNOTREAL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
