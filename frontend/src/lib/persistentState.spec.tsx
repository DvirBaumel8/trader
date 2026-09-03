// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { stubLocalStorage } from '../test/memoryLocalStorage';
import { usePersistentState } from './persistentState';

beforeEach(() => {
  stubLocalStorage();
});

/**
 * The bug this exists to prevent: iOS discards the backgrounded tab, the app
 * cold-starts, and anything held only in React state is gone. Unmounting and
 * mounting again is that cold start.
 */
describe('usePersistentState', () => {
  it('starts from the initial value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('k', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('restores what was set, across a cold start', () => {
    const first = renderHook(() => usePersistentState('k', 'fallback'));
    act(() => first.result.current[1]('typed by the user'));
    first.unmount();

    const second = renderHook(() => usePersistentState('k', 'fallback'));
    expect(second.result.current[0]).toBe('typed by the user');
  });

  it('persists primitives and arrays, not just objects', () => {
    // loadDraft spreads the stored value over the fallback, which silently
    // mangles a boolean, a string or an array. Those are exactly the shapes
    // the collapsed/expanded flags and the stop rows need.
    const bool = renderHook(() => usePersistentState('bool', false));
    act(() => bool.result.current[1](true));
    bool.unmount();
    expect(renderHook(() => usePersistentState('bool', false)).result.current[0]).toBe(true);

    const rows = renderHook(() => usePersistentState<string[]>('rows', []));
    act(() => rows.result.current[1](['a', 'b']));
    rows.unmount();
    expect(renderHook(() => usePersistentState<string[]>('rows', [])).result.current[0]).toEqual([
      'a',
      'b',
    ]);
  });

  it('ignores anything older than the restore window', () => {
    const first = renderHook(() => usePersistentState('k', 'fallback'));
    act(() => first.result.current[1]('yesterday'));
    first.unmount();

    // Opening the app the next morning should give the normal screen, not
    // yesterday's half-finished edit — the rule uiState.ts already applies.
    const later = Date.now() + 61 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect(renderHook(() => usePersistentState('k', 'fallback')).result.current[0]).toBe(
      'fallback',
    );
    vi.restoreAllMocks();
  });

  it('accepts the functional updater form, like useState', () => {
    const { result, unmount } = renderHook(() => usePersistentState('flag', false));
    act(() => result.current[1]((v) => !v));
    expect(result.current[0]).toBe(true);
    unmount();

    expect(renderHook(() => usePersistentState('flag', false)).result.current[0]).toBe(true);
  });

  it('clears back to the initial value', () => {
    const { result, unmount } = renderHook(() => usePersistentState('k', 'fallback'));
    act(() => result.current[1]('something'));
    act(() => result.current[2]());
    unmount();

    expect(renderHook(() => usePersistentState('k', 'fallback')).result.current[0]).toBe(
      'fallback',
    );
  });

  it('keeps working when localStorage throws, as it does in private mode', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const { result } = renderHook(() => usePersistentState('k', 'fallback'));
    act(() => result.current[1]('still works in memory'));
    // The form must keep working; it just will not survive a restart.
    expect(result.current[0]).toBe('still works in memory');
  });
});
