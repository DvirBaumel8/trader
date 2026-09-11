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

/**
 * The signed-in identity, remembered on this device.
 *
 * "Cache for remember users that using the app more than one time", in the
 * owner's words. The token already persists, so this is not about staying
 * signed in — it is about a returning person being recognised rather than
 * greeted by a blank form. It holds a display name, an email and an avatar
 * URL: enough to say "welcome back" and pre-fill the email, and nothing that
 * would matter if the device were lost. Never a password, never a token
 * beyond the one above.
 */
const IDENTITY_KEY = 'trader.identity.v1';

export interface RememberedUser {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export function getRememberedUser(): RememberedUser | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Anything that is not the shape we wrote is treated as absent rather
    // than trusted — a half-written or hand-edited value must not reach the
    // UI as a name.
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as RememberedUser).id === 'string' &&
      typeof (parsed as RememberedUser).displayName === 'string'
    ) {
      return parsed as RememberedUser;
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberUser(user: RememberedUser): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(user));
  } catch {
    // Blocked or full: the app still works, it just won't greet them.
  }
}

export function forgetUser(): void {
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Nothing to do.
  }
}
