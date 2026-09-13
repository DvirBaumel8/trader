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
 * absolute origin. Backend API routes live under /api, while health endpoints
 * are mounted at /health.
 *
 * Exported so `streamNdjson` builds the exact same URL for a streamed
 * response instead of growing its own copy of this prefix rule.
 */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const prefix = cleanPath.startsWith('/health') ? '' : '/api';
  return `${BASE_URL}${prefix}${cleanPath}`;
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
