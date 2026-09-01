import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, getToken, setToken } from './auth';

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
