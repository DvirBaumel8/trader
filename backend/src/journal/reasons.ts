/**
 * The one place the reason vocabulary is defined. It is served to the
 * composer on `GET /settings` and validated against on every write, so the
 * frontend never holds a copy — the same rule that moved the risk arithmetic
 * out of `frontend/` after it drifted twice.
 *
 * Codes are stable and stored; labels are cosmetic and may be reworded
 * without rewriting history. The two lists deliberately share no code: both
 * render as "150 SMA", but reclaiming the average and losing it are opposite
 * facts and must never merge into one count.
 *
 * The list is a constant, not a settings screen. Changing it is a code change
 * on purpose — a vocabulary nobody can edit on a whim stays countable.
 */
export interface Reason {
  code: string;
  label: string;
}

/** Shown on a fill that opens or adds to a position. */
export const ENTRY_REASONS: readonly Reason[] = [
  { code: 'ENTRY_BREAKOUT', label: 'Breakout' },
  { code: 'ENTRY_SMA_150', label: '150 SMA' },
  { code: 'ENTRY_VOLUME', label: 'Volume' },
  { code: 'ENTRY_NEWS', label: 'News' },
];

/** Shown on a fill that reduces a position — a sell of a long, a buy of a short. */
export const EXIT_REASONS: readonly Reason[] = [
  { code: 'EXIT_STOP_EXECUTED', label: 'Stop executed' },
  { code: 'EXIT_SMA_150', label: '150 SMA' },
  { code: 'EXIT_THESIS_BROKE', label: 'Thesis broke' },
  { code: 'EXIT_RISK_OFF', label: 'Risk off' },
];

const CODES = new Set(
  [...ENTRY_REASONS, ...EXIT_REASONS].map((reason) => reason.code),
);

export function isReasonCode(value: string): boolean {
  return CODES.has(value);
}

export const REASON_CODES: readonly string[] = [...CODES];

export function reasonVocabulary() {
  return { opening: ENTRY_REASONS, closing: EXIT_REASONS };
}
