import { substituteBookPlaceholders, type BookInput } from './trade-idea-context.js';

// A "starts-with" version of trade-idea-parse.ts's own LEVELS_BLOCK pattern
// — that one captures everything to the end of the string for stripping;
// this one only needs to know WHERE the block begins, to freeze the stream
// there. Kept in sync by hand: both must agree on what counts as the start
// of the block.
const LEVELS_START = /(?:^|\n)LEVELS[ \t]*\n/;

// Comfortably longer than "\nLEVELS\n" (8 chars) so a few characters of
// slack (spacing the prompt doesn't ask for but a model could still emit)
// can't slip a partial match past the holdback window.
const LEVELS_HOLDBACK = 20;

/**
 * Wraps a `completeStream()` call for the trade-idea prompt. Two things must
 * never reach the screen raw, and neither sits in one fixed place the way a
 * meta block does:
 *
 * - The trailing `LEVELS` block — unlike `[REVIEW_META]`, this sits at the
 *   END with no closing tag, so "is this the block starting" can only be
 *   answered by holding back a short trailing window and re-checking as
 *   more text arrives, never flushing text within `LEVELS_HOLDBACK`
 *   characters of the tail until it's confirmed safe.
 * - `{{WEIGHT:LMND}}`-style placeholders — unlike a meta block, these can
 *   appear ANYWHERE in the body, potentially more than once, so an unclosed
 *   `{{` found anywhere holds back everything from it onward until the
 *   matching `}}` arrives, then substitutes with the same
 *   `substituteBookPlaceholders` the non-streaming path already uses.
 *
 * Returns the complete raw text (the LEVELS block included) as the
 * generator's own return value, for the existing `parseProposedLevels` to
 * run against exactly as the non-streaming path does.
 */
export async function* streamTradeIdeaBody(
  stream: AsyncIterable<string>,
  book: BookInput,
): AsyncGenerator<string, string> {
  let raw = '';
  let pendingSafe = '';
  let placeholderPending = '';
  let frozen = false;

  // Folds any previously-unclosed placeholder fragment onto `text`, then
  // holds back a new unclosed `{{` (if the combined text now ends inside
  // one) rather than substituting or displaying a truncated token. Also
  // holds back a lone trailing `{` that isn't yet a `{{` — with small
  // enough chunks (a chunk can be a single character), the opening pair
  // itself can arrive split, and a plain `lastIndexOf('{{')` can't see a
  // pair that hasn't fully arrived yet.
  function resolvePlaceholders(text: string): string | null {
    const combined = placeholderPending + text;
    const openIdx = combined.lastIndexOf('{{');
    if (openIdx !== -1 && combined.indexOf('}}', openIdx) === -1) {
      placeholderPending = combined.slice(openIdx);
      const resolved = combined.slice(0, openIdx);
      return resolved ? substituteBookPlaceholders(resolved, book) : null;
    }
    if (combined.endsWith('{') && !combined.endsWith('{{')) {
      placeholderPending = '{';
      const resolved = combined.slice(0, -1);
      return resolved ? substituteBookPlaceholders(resolved, book) : null;
    }
    placeholderPending = '';
    return combined ? substituteBookPlaceholders(combined, book) : null;
  }

  for await (const delta of stream) {
    raw += delta;
    if (frozen) continue;

    pendingSafe += delta;
    const levelsMatch = LEVELS_START.exec(pendingSafe);
    if (levelsMatch) {
      const out = resolvePlaceholders(pendingSafe.slice(0, levelsMatch.index));
      if (out) yield out;
      frozen = true;
      continue;
    }

    const safeLength = Math.max(0, pendingSafe.length - LEVELS_HOLDBACK);
    if (safeLength > 0) {
      const safe = pendingSafe.slice(0, safeLength);
      pendingSafe = pendingSafe.slice(safeLength);
      const out = resolvePlaceholders(safe);
      if (out) yield out;
    }
  }

  if (!frozen) {
    const levelsMatch = LEVELS_START.exec(pendingSafe);
    const finalSafe = levelsMatch ? pendingSafe.slice(0, levelsMatch.index) : pendingSafe;
    const out = resolvePlaceholders(finalSafe);
    if (out) yield out;
    // Never closed by the time the stream ended — nothing left to
    // substitute against, so it's flushed exactly as `substituteBookPlaceholders`
    // itself would leave a malformed token: untouched.
    if (placeholderPending) yield placeholderPending;
  }

  return raw;
}
