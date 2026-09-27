/**
 * Routes unprefixed API calls from older clients to `/api/*`, and maps
 * `/api/health` onto the unprefixed health route.
 *
 * Several API paths are also SPA screens (`/journal`, `/watchlist`), so a
 * browser page load — a GET that accepts HTML — is never rewritten: it
 * belongs to the SPA fallback. Rewriting it served raw JSON on refresh or
 * deep link wherever one server hosts both.
 */
const LEGACY_PREFIXES = [
  '/portfolio',
  '/performance',
  '/journal',
  '/watchlist',
  '/auth',
  '/ai',
  '/settings',
  '/instruments',
  '/market-data',
  '/history',
];

interface RewritableRequest {
  url: string;
  method: string;
  headers: { accept?: string };
}

export function legacyApiPrefix(
  req: RewritableRequest,
  _res: unknown,
  next: () => void,
): void {
  if (
    req.url === '/api/health' ||
    req.url.startsWith('/api/health?') ||
    req.url.startsWith('/api/health/')
  ) {
    req.url = req.url.replace(/^\/api\/health/, '/health');
  } else if (
    LEGACY_PREFIXES.some((p) => req.url.startsWith(p)) &&
    !isPageLoad(req)
  ) {
    req.url = '/api' + req.url;
  }
  next();
}

function isPageLoad(req: RewritableRequest): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}
