import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './draftStorage';

interface Draft {
  asOf: string;
  cashAmount: string;
  rows: string[];
}

const fallback: Draft = { asOf: '2026-01-01', cashAmount: '', rows: [] };

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

describe('draftStorage', () => {
  it('returns the fallback when nothing is stored', () => {
    expect(loadDraft('seed', fallback)).toEqual(fallback);
  });

  it('round-trips a saved draft', () => {
    const draft: Draft = { asOf: '2026-08-28', cashAmount: '250', rows: ['a'] };
    saveDraft('seed', draft);
    expect(loadDraft('seed', fallback)).toEqual(draft);
  });

  it('clears a draft', () => {
    saveDraft('seed', { ...fallback, cashAmount: '5' });
    clearDraft('seed');
    expect(loadDraft('seed', fallback)).toEqual(fallback);
  });

  it('merges over the fallback so a draft missing new fields still loads', () => {
    // Simulates a draft saved before a field was added to the form.
    saveDraft('seed', { cashAmount: '99' });
    expect(loadDraft('seed', fallback)).toEqual({
      asOf: '2026-01-01',
      cashAmount: '99',
      rows: [],
    });
  });

  it('falls back on corrupted JSON rather than throwing', () => {
    stubStorage({
      getItem: () => '{not json',
      setItem: () => {},
      removeItem: () => {},
    });
    expect(loadDraft('seed', fallback)).toEqual(fallback);
  });

  it('falls back when the stored value is not an object', () => {
    stubStorage({
      getItem: () => '"a string"',
      setItem: () => {},
      removeItem: () => {},
    });
    expect(loadDraft('seed', fallback)).toEqual(fallback);
  });

  it('survives storage that throws on read', () => {
    stubStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(loadDraft('seed', fallback)).toEqual(fallback);
  });

  it('survives storage that throws on write', () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    });
    expect(() => saveDraft('seed', fallback)).not.toThrow();
  });

  it('survives storage that throws on remove', () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => clearDraft('seed')).not.toThrow();
  });
});
