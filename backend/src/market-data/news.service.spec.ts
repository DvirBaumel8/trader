import { describe, expect, it, vi } from 'vitest';
import { NewsService } from './news.service.js';
import type { FinnhubClient, RawNewsItem } from './finnhub.client.js';

const item = (over: Partial<RawNewsItem> = {}): RawNewsItem => ({
  headline: 'NVO partners with Anthropic to accelerate medicine development',
  summary: 'The companies announced a multi-year partnership.',
  source: 'Reuters',
  datetime: 1757289600, // 2025-09-08T00:00:00Z
  url: 'https://example.com/1',
  ...over,
});

function serviceWith(news: RawNewsItem[][] | RawNewsItem[]) {
  const batches = Array.isArray(news[0]) ? [...(news as RawNewsItem[][])] : [news as RawNewsItem[]];
  const companyNews = vi.fn(
    async (_symbol: string, _from: Date, _to: Date): Promise<RawNewsItem[]> =>
      batches.length > 1 ? batches.shift()! : batches[0],
  );
  const client = { companyNews } as unknown as FinnhubClient;
  return { service: new NewsService(client), companyNews };
}

describe('recentHeadlines', () => {
  it('maps a raw item to a headline with a plain published date', async () => {
    const { service } = serviceWith([item()]);

    const headlines = await service.recentHeadlines('NVO');

    expect(headlines).toEqual([
      {
        headline: 'NVO partners with Anthropic to accelerate medicine development',
        summary: 'The companies announced a multi-year partnership.',
        source: 'Reuters',
        publishedOn: '2025-09-08',
        url: 'https://example.com/1',
      },
    ]);
  });

  it('asks Finnhub for a window ending now and starting several days back', async () => {
    const { service, companyNews } = serviceWith([]);

    await service.recentHeadlines('NVO');

    expect(companyNews).toHaveBeenCalledTimes(1);
    const [symbol, from, to] = companyNews.mock.calls[0];
    expect(symbol).toBe('NVO');
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
    expect((to as Date).getTime()).toBeGreaterThan((from as Date).getTime());
  });

  it('returns the newest headlines first', async () => {
    const { service } = serviceWith([
      item({ headline: 'older', datetime: 1000 }),
      item({ headline: 'newer', datetime: 2000 }),
    ]);

    const headlines = await service.recentHeadlines('NVO');

    expect(headlines.map((h) => h.headline)).toEqual(['newer', 'older']);
  });

  it('caps the list rather than flooding the prompt with every headline', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item({ headline: `story ${i}`, datetime: i }),
    );
    const { service } = serviceWith(many);

    const headlines = await service.recentHeadlines('NVO');

    expect(headlines.length).toBeLessThanOrEqual(5);
  });

  it('is empty when the provider has nothing', async () => {
    const { service } = serviceWith([]);
    expect(await service.recentHeadlines('NVO')).toEqual([]);
  });

  it('fetches once per symbol within the cache window, not on every call', async () => {
    const { service, companyNews } = serviceWith([item()]);

    await service.recentHeadlines('NVO');
    await service.recentHeadlines('NVO');
    await service.recentHeadlines('NVO');

    expect(companyNews).toHaveBeenCalledTimes(1);
  });

  it('keeps symbols apart', async () => {
    const { service, companyNews } = serviceWith([
      [item({ headline: 'nvo story' })],
      [item({ headline: 'aapl story' })],
    ]);

    const nvo = await service.recentHeadlines('NVO');
    const aapl = await service.recentHeadlines('AAPL');

    expect(nvo[0].headline).toBe('nvo story');
    expect(aapl[0].headline).toBe('aapl story');
    expect(companyNews).toHaveBeenCalledTimes(2);
  });

  it('does not cache an empty result, so a transient outage is not mistaken for a quiet news day', async () => {
    const { service, companyNews } = serviceWith([[], [item()]]);

    expect(await service.recentHeadlines('NVO')).toEqual([]);
    expect(await service.recentHeadlines('NVO')).toHaveLength(1);
    expect(companyNews).toHaveBeenCalledTimes(2);
  });
});
