/**
 * Turns one chat message into what Trader should do with it.
 *
 * Deliberately not AI: a small set of plain patterns, each pinned by a test.
 * Anything that does not match exactly is `unknown`, and the caller turns it
 * into a Gemini prompt — so a miss costs the owner a copy-paste, never a
 * wrong write to his holdings.
 */
export type Direction = 'LONG' | 'SHORT';

export type Intent =
  | { kind: 'add-holding'; symbol: string; direction: Direction }
  | { kind: 'remove-holding'; symbol: string }
  | { kind: 'watch'; symbol: string }
  | { kind: 'unwatch'; symbol: string }
  | {
      kind: 'ma-check';
      symbol: string;
      comparator: 'above' | 'below';
      period: number;
      average: 'SMA' | 'EMA';
    }
  | { kind: 'unknown' };

const UNKNOWN: Intent = { kind: 'unknown' };

/** US tickers are at most five letters, plus an optional share-class suffix. */
const TICKER = /^\$?([a-z]{1,5}(?:\.[a-z])?)$/;

const FILLER = new Set(['i', 'just', 'some', 'all', 'my', 'the', 'of', 'more', 'shares', 'a']);

/** Common English words that are never tickers. */
const NOT_TICKERS = new Set(['it', 'out', 'off', 'term', 'today', 'again', 'half', 'both', 'too', 'up', 'down', 'back', 'here', 'there']);

const VERBS: Record<string, (symbol: string) => Intent> = {
  bought: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  buy: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  long: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  short: (s) => ({ kind: 'add-holding', symbol: s, direction: 'SHORT' }),
  shorted: (s) => ({ kind: 'add-holding', symbol: s, direction: 'SHORT' }),
  sold: (s) => ({ kind: 'remove-holding', symbol: s }),
  sell: (s) => ({ kind: 'remove-holding', symbol: s }),
  closed: (s) => ({ kind: 'remove-holding', symbol: s }),
  covered: (s) => ({ kind: 'remove-holding', symbol: s }),
  watch: (s) => ({ kind: 'watch', symbol: s }),
  unwatch: (s) => ({ kind: 'unwatch', symbol: s }),
};

const MA_CHECK =
  /^is \$?([a-z]{1,5}(?:\.[a-z])?) (above|over|below|under) (?:the |its )?(\d{1,4})(?:[ -]?day)? ?(sma|ema|ma)$/;

export function parseMessage(text: string): Intent {
  const trimmed = text.trim();

  // Questions must not become writes (except ma-check).
  // A question is one ending with "?" but not with multi-punctuation like ".?" or "!?".
  const endsWithQuestion = trimmed.endsWith('?');
  const endsWithPunctQuestion = /[.!,;:]\?$/.test(trimmed);
  const isQuestion = endsWithQuestion && !endsWithPunctQuestion;

  // Strip trailing sentence punctuation in one run before other normalisation.
  let normalized = trimmed
    .replace(/[?!.,;:]+$/, '')
    .toLowerCase()
    .replace(/[?!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === '') return UNKNOWN;

  const ma = MA_CHECK.exec(normalized);
  if (ma) {
    const period = Number(ma[3]);
    if (!(period > 0)) return UNKNOWN;
    return {
      kind: 'ma-check',
      symbol: ma[1].toUpperCase(),
      comparator: ma[2] === 'above' || ma[2] === 'over' ? 'above' : 'below',
      period,
      average: ma[4] === 'ema' ? 'EMA' : 'SMA',
    };
  }

  // For non-ma-check intents, questions return unknown.
  if (isQuestion) return UNKNOWN;

  const words = normalized.split(' ').filter((w) => !FILLER.has(w));
  if (words.length !== 2) return UNKNOWN;
  const verb = VERBS[words[0]];
  const ticker = TICKER.exec(words[1]);
  if (!verb || !ticker) return UNKNOWN;

  // Common English words are never tickers.
  if (NOT_TICKERS.has(words[1])) return UNKNOWN;

  return verb(ticker[1].toUpperCase());
}
