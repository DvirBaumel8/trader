import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicCalendarClient } from './economic-calendar.client.js';

const statementUrl = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm';

function htmlResponse(body: string, status = 200): Response {
  return new Response(`<html><body><p>${body}</p></body></html>`, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

describe('EconomicCalendarClient', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes an official 25bp FOMC increase from the statement date', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === statementUrl
        ? htmlResponse('The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.')
        : htmlResponse('', 404));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new EconomicCalendarClient().week('2026-09-14', '2026-09-20');

    expect(result).toEqual({
      available: true,
      events: [{
        kind: 'RATE_DECISION',
        name: 'Federal Reserve rate decision',
        date: '2026-09-16',
        title: 'Fed raised rates 25 bp',
        detail: 'Target range is now 3.75–4.00%.',
      }],
    });
    expect(fetchMock).toHaveBeenCalledWith(statementUrl, expect.anything());
  });

  it('treats 404 as no statement but reports a provider outage', async () => {
    const client = new EconomicCalendarClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('', 404)));
    await expect(client.week('2026-09-14', '2026-09-20')).resolves.toEqual({
      available: true,
      events: [],
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('unavailable', 503)));
    await expect(new EconomicCalendarClient().week('2026-09-14', '2026-09-20')).resolves.toEqual({
      available: false,
      events: [],
    });
  });

  it('caches the weekly result for repeat reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('', 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EconomicCalendarClient();

    await client.week('2026-09-14', '2026-09-20');
    await client.week('2026-09-14', '2026-09-20');

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('reports an unrecognized rate move rather than inventing its size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) =>
      url === statementUrl
        ? htmlResponse('The Committee decided to raise the target range for the federal funds rate at 3-3/4 to 4 percent.')
        : htmlResponse('', 404)));

    await expect(new EconomicCalendarClient().week('2026-09-14', '2026-09-20')).resolves.toEqual({
      available: false,
      events: [],
    });
  });
});
