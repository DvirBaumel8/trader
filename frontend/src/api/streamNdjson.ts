import { apiUrl, ApiError } from './client';
import { clearToken, getToken } from '../lib/auth';

/**
 * Reads a newline-delimited-JSON POST response line by line, calling
 * `onLine` with each parsed object as it arrives.
 *
 * A separate helper from `api()` rather than a mode of it: `api()` reads the
 * whole body as one JSON value, which is a different contract from "the
 * response IS a sequence of values" — forcing both into one function would
 * mean a `stream?: boolean` flag that changes what the return type even
 * means. Everything else about the request — same auth header, same base
 * URL and /api prefix, same 401 handling — is reused via `apiUrl`/`getToken`
 * rather than grown a second time here.
 */
export async function streamNdjson<T>(
  path: string,
  onLine: (line: T) => void,
  body?: unknown,
): Promise<void> {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // A chunk boundary can land mid-line, so only complete ('\n'-terminated)
  // lines are parsed; whatever's left over waits for the next chunk.
  let buffer = '';

  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    buffer += decoder.decode(read.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line) onLine(JSON.parse(line) as T);
    }
  }
  if (buffer) onLine(JSON.parse(buffer) as T);
}
