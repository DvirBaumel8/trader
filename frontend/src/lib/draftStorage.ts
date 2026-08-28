/**
 * iOS Safari discards backgrounded tabs to reclaim memory, so anything held
 * only in React state is lost the moment the user switches to their broker app
 * to read a number — which is precisely the workflow the seed form requires.
 * Drafts therefore live in localStorage, written on every keystroke.
 *
 * Every access is guarded: localStorage throws outright in some privacy modes,
 * and a failure to save a draft must never break the form itself.
 */
export function loadDraft<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    // A stored draft from an older shape is worse than no draft at all.
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...(parsed as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the form keeps working, it just won't persist.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do; a stale draft is harmless.
  }
}
