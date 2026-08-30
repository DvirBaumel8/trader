import { clearDraft, loadDraft, saveDraft } from './draftStorage';

const KEY = 'trader.uiState.v1';

/**
 * How long a remembered position stays worth restoring. Long enough to cover
 * checking your broker, reading a message, taking a call; short enough that
 * opening the app the next morning gives you the normal home screen rather
 * than yesterday's half-finished edit.
 */
export const RESTORE_WINDOW_MS = 60 * 60 * 1000;

export interface UiState {
  path: string;
  journalTab: string;
  /** The entry that was open for editing, if any. */
  editingEntryId: string | null;
  /** True when the composer was open for a new entry. */
  composing: boolean;
  savedAt: number;
}

const blank: UiState = {
  path: '/',
  journalTab: 'TRADES',
  editingEntryId: null,
  composing: false,
  savedAt: 0,
};

export function saveUiState(state: Omit<UiState, 'savedAt'>): void {
  saveDraft(KEY, { ...state, savedAt: Date.now() });
}

export function clearUiState(): void {
  clearDraft(KEY);
}

/**
 * Returns what to restore, or null when restoring would be wrong: nothing
 * saved, stale, or a state that carries no information anyway.
 */
export function loadUiState(now: number = Date.now()): UiState | null {
  const saved = loadDraft(KEY, blank);
  if (!saved.savedAt) return null;
  if (now - saved.savedAt > RESTORE_WINDOW_MS) return null;
  // Nothing worth restoring: the default screen with nothing open.
  if (
    saved.path === '/' &&
    !saved.composing &&
    saved.editingEntryId === null
  ) {
    return null;
  }
  return saved;
}
