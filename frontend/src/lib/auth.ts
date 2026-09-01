/**
 * Guarded the same way lib/draftStorage.ts is: localStorage throws outright
 * in some privacy modes, and a failure here must never break the app —
 * worst case, the user is asked to log in again.
 */
const KEY = 'trader.authToken.v1';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Storage full or blocked — login still works, it just won't persist.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale token left behind is harmless.
  }
}
