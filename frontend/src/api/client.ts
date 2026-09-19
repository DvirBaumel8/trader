import { clearToken, getToken } from '../lib/auth';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Relative in local/dev so dev proxies handle it and it works from
 * localhost and the phone alike. In production BASE_URL is the backend's
 * absolute origin.
 *
 * Always under /api, health endpoints included — even though the backend
 * mounts health outside its own global 'api' prefix, it also rewrites
 * '/api/health*' back to '/health*' before routing, precisely so every
 * caller can use one consistent prefix. That rewrite is not optional
 * plumbing: the local Vite dev proxy only forwards paths under /api, so a
 * bare '/health/ping' silently missed it and fell through to Vite's own
 * index.html instead of the backend — a permanent false "Can't reach the
 * server" banner in every local dev session, never seen in production
 * where frontend and backend already sit on different origins.
 *
 * Exported so `streamNdjson` builds the exact same URL for a streamed
 * response instead of growing its own copy of this prefix rule.
 */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}/api${cleanPath}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    if (!cleanPath.startsWith('/auth/login') && !cleanPath.startsWith('/health')) {
      clearToken();
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}
