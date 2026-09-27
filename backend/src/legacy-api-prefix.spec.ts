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
    expect(run('/journal?kind=TRADE')).toBe('/api/journal?kind=TRADE');
    expect(run('/portfolio')).toBe('/api/portfolio');
  });

  it('leaves a browser page load of a screen to the SPA', () => {
    // /journal and /watchlist are both API paths and screens. Rewriting a
    // navigation served raw JSON on refresh or deep link wherever one
    // server hosts both (root `npm run dev`, the phone on the Mac's :3000).
    const html = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    expect(run('/journal', html)).toBe('/journal');
    expect(run('/watchlist/ideas', html)).toBe('/watchlist/ideas');
  });

  it('still prefixes a non-GET even if it claims to accept HTML', () => {
    expect(run('/journal', 'text/html', 'POST')).toBe('/api/journal');
  });

  it('maps /api/health onto the unprefixed health route', () => {
    expect(run('/api/health/ping')).toBe('/health/ping');
  });

  it('leaves already-prefixed and unrelated paths alone', () => {
    expect(run('/api/journal')).toBe('/api/journal');
    expect(run('/stocks/NVDA', 'text/html')).toBe('/stocks/NVDA');
  });
});
