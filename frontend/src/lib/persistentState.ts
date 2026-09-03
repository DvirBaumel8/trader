import { useCallback, useEffect, useRef, useState } from 'react';
import { RESTORE_WINDOW_MS } from './uiState';

/**
 * `useState` that survives the app being discarded.
 *
 * iOS Safari reclaims a backgrounded tab, so switching to a broker app and
 * coming back is a cold start: every `useState` resets. The app already knew
 * this — `EntrySheet` and `Seed` persist their drafts by hand — but the
 * pattern was opt-in per component, and the components written after it
 * simply did not opt in. That cost real work: the stop plan editor reset its
 * typed rows to the server's values, and a trade idea lost the answer it had
 * just paid a model call for.
 *
 * Making it a hook is the fix for the class, not the instance: persistence is
 * now one line at the point of `useState`, so the next interactive surface
 * gets it by default rather than by remembering.
 *
 * Stored as `{ v, savedAt }` rather than the bare value, for two reasons:
 * `savedAt` applies the same one-hour rule as `uiState` (long enough to check
 * your broker; short enough that tomorrow morning is a clean screen), and
 * wrapping keeps `undefined`, `false` and `[]` round-tripping intact — a bare
 * value cannot distinguish "stored false" from "nothing stored", and
 * `loadDraft` cannot carry a primitive or an array at all because it spreads
 * the stored object over the fallback.
 */
interface Envelope<T> {
  v: T;
  savedAt: number;
}

function read<T>(key: string, ttlMs: number, now: number): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<Envelope<T>> | null;
    if (parsed === null || typeof parsed !== 'object') return undefined;
    if (typeof parsed.savedAt !== 'number') return undefined;
    if (now - parsed.savedAt > ttlMs) return undefined;
    return parsed.v as T;
  } catch {
    // Unreadable, unparseable, or localStorage blocked outright: fall back to
    // the initial value. A missing draft is always better than a broken screen.
    return undefined;
  }
}

function write<T>(key: string, value: T): void {
  try {
    const envelope: Envelope<T> = { v: value, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Storage full or blocked — state keeps working, it just won't survive.
  }
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  ttlMs: number = RESTORE_WINDOW_MS,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Read once, on mount: re-reading on every render would let a write from
  // another tab yank the value out from under someone mid-edit.
  const [value, setValue] = useState<T>(() => {
    const stored = read<T>(key, ttlMs, Date.now());
    return stored === undefined ? initial : stored;
  });

  // Held in a ref so `clear` and the persisting effect never need `key` in
  // their dependency lists as a changing value mid-edit.
  const keyRef = useRef(key);
  keyRef.current = key;

  // Deliberately not writing on mount: doing so would refresh `savedAt` for a
  // value nobody touched, so merely opening the app would keep a stale draft
  // alive indefinitely.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    write(keyRef.current, value);
  }, [value]);

  // Accepts the functional form too, so this is a drop-in for `useState` —
  // anything less makes `setOpen((v) => !v)` a silent type error at the call
  // site and invites a stale-closure bug at the next one.
  const set = useCallback((next: T | ((prev: T) => T)) => {
    touched.current = true;
    setValue(next);
  }, []);

  const clear = useCallback(() => {
    touched.current = false;
    try {
      window.localStorage.removeItem(keyRef.current);
    } catch {
      // A stale draft is harmless.
    }
  }, []);

  return [value, set, clear];
}
