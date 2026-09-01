import { clearToken, getToken } from '../lib/auth';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Relative locally, so Vite's dev proxy handles it and it works from
 * localhost and the phone alike. In production BASE_URL is the backend's
 * absolute origin, baked in at build time — see
 * docs/superpowers/specs/2026-09-01-deployment-design.md.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (res.status === 401) {
    clearToken();
    if (!path.startsWith('/auth/login')) {
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
