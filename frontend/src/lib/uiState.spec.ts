import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESTORE_WINDOW_MS,
  clearUiState,
  loadUiState,
  saveUiState,
} from './uiState';

beforeEach(() => {
  vi.unstubAllGlobals();
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  });
});

const state = {
  path: '/journal',
  journalTab: 'ACTIVITIES',
  editingEntryId: 'abc',
  composing: false,
};

describe('loadUiState', () => {
  it('is null when nothing was saved', () => {
    expect(loadUiState()).toBeNull();
  });

  it('restores a recently saved position', () => {
    saveUiState(state);
    expect(loadUiState()).toMatchObject(state);
  });

  it('does not restore after the window has passed', () => {
    // Coming back the next morning should give the normal home screen, not
    // yesterday's half-finished edit.
    saveUiState(state);
    expect(loadUiState(Date.now() + RESTORE_WINDOW_MS + 1)).toBeNull();
  });

  it('restores right up to the edge of the window', () => {
    saveUiState(state);
    expect(loadUiState(Date.now() + RESTORE_WINDOW_MS - 1000)).not.toBeNull();
  });

  it('does not restore the default screen with nothing open', () => {
    // Restoring "/" with no sheet is a no-op that would still trigger a
    // navigation, so it is treated as nothing to restore.
    saveUiState({
      path: '/',
      journalTab: 'TRADES',
      editingEntryId: null,
      composing: false,
    });
    expect(loadUiState()).toBeNull();
  });

  it('restores the home path when the composer was open on it', () => {
    saveUiState({
      path: '/',
      journalTab: 'TRADES',
      editingEntryId: null,
      composing: true,
    });
    expect(loadUiState()?.composing).toBe(true);
  });

  it('restores a non-default path even with nothing open', () => {
    saveUiState({
      path: '/journal',
      journalTab: 'BALANCE',
      editingEntryId: null,
      composing: false,
    });
    expect(loadUiState()?.journalTab).toBe('BALANCE');
  });

  it('clears what was saved', () => {
    saveUiState(state);
    clearUiState();
    expect(loadUiState()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
      },
    });
    expect(() => saveUiState(state)).not.toThrow();
    expect(loadUiState()).toBeNull();
  });
});
