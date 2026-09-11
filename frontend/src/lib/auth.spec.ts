import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearToken,
  forgetUser,
  getRememberedUser,
  getToken,
  rememberUser,
  setToken,
} from './auth';

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('window', { localStorage: impl });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  const store = new Map<string, string>();
  stubStorage({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
});

describe('auth token storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('round-trips a token', () => {
    setToken('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
  });

  it('clears a token', () => {
    setToken('abc.def.ghi');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('survives storage that throws on read', () => {
    stubStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(getToken()).toBeNull();
  });

  it('survives storage that throws on write', () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    });
    expect(() => setToken('x')).not.toThrow();
  });
});

describe('remembering who signed in', () => {
  it('gives back what it was told', () => {
    rememberUser({ id: 'u1', displayName: 'Dvir', email: 'd@x.com', avatarUrl: null });
    expect(getRememberedUser()?.displayName).toBe('Dvir');
  });

  it('has nobody to remember before anyone signs in', () => {
    expect(getRememberedUser()).toBeNull();
  });

  it('forgets on request', () => {
    rememberUser({ id: 'u1', displayName: 'Dvir', email: null, avatarUrl: null });
    forgetUser();
    expect(getRememberedUser()).toBeNull();
  });

  /** A hand-edited or half-written value must not reach the UI as a name. */
  it('treats a malformed stored value as nobody', () => {
    window.localStorage.setItem('trader.identity.v1', '{"nope":true}');
    expect(getRememberedUser()).toBeNull();
  });

  it('treats unparseable JSON as nobody', () => {
    window.localStorage.setItem('trader.identity.v1', 'not json');
    expect(getRememberedUser()).toBeNull();
  });
});
