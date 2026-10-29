import { describe, expect, it, vi } from 'vitest';
import { legacyApiPrefix } from './legacy-api-prefix.js';

function run(url: string, accept = 'application/json', method = 'GET') {
  const req = { url, method, headers: { accept } };
  const next = vi.fn();
  legacyApiPrefix(req, {}, next);
  expect(next).toHaveBeenCalled();
  return req.url;
}

describe('legacyApiPrefix', () => {
  it('prefixes an unprefixed API call from an old client', () => {
    expect(run('/holdings?sort=symbol')).toBe('/api/holdings?sort=symbol');
    expect(run('/watchlist')).toBe('/api/watchlist');
    expect(run('/earnings/week')).toBe('/api/earnings/week');
    expect(run('/market/moves?symbols=A')).toBe('/api/market/moves?symbols=A');
  });

  it('leaves a browser page load of a screen to the SPA', () => {
    // /holdings and /watchlist are both API paths and screens. Rewriting a
    // navigation served raw JSON on refresh or deep link wherever one
    // server hosts both (root `npm run dev`, the phone on the Mac's :3000).
    const html = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    expect(run('/holdings', html)).toBe('/holdings');
    expect(run('/watchlist/ideas', html)).toBe('/watchlist/ideas');
  });

  it('still prefixes a non-GET even if it claims to accept HTML', () => {
    expect(run('/holdings', 'text/html', 'POST')).toBe('/api/holdings');
  });

  it('maps /api/health onto the unprefixed health route', () => {
    expect(run('/api/health/ping')).toBe('/health/ping');
  });

  it('leaves already-prefixed and unrelated paths alone', () => {
    expect(run('/api/holdings')).toBe('/api/holdings');
    expect(run('/stocks/NVDA', 'text/html')).toBe('/stocks/NVDA');
  });
});
