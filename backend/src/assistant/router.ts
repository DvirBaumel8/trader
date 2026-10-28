/**
 * Routes one chat message to a predefined action using a free Gemini model
 * (docs/superpowers/specs/2026-10-28-chat-ai-router-design.md).
 *
 * The model only proposes: `toIntent` decides. Anything off-shape, any
 * message with a question mark, and anything with nothing valid to act on
 * is `none`, which the caller turns into a Gemini Pro prompt — so a model
 * mistake costs the owner a copy-paste, never a wrong write.
 *
 * Deliberately free of any AI SDK import: llm.client.ts is the boundary.
 */
export type RouterAction = 'buy' | 'sell' | 'watch' | 'unwatch';

export type RouterIntent =
  | { kind: RouterAction; symbols: string[]; rejected: string[] }
  | { kind: 'none' };

export const MAX_SYMBOLS = 50;

const ACTIONS: readonly RouterAction[] = ['buy', 'sell', 'watch', 'unwatch'];
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

export const ROUTER_SYSTEM = `You route messages from a stock trader's portfolio app to exactly one action. Reply only with JSON matching the schema.

Actions:
- buy: the user records that they bought one or more stocks (e.g. "bought LMND", "I bought: LMND, TSLA", "Bought:" followed by a list).
- sell: the user records that they sold or closed one or more positions (e.g. "sold LMND", "closed TSLA and NVDA").
- watch: the user asks to add one or more stocks to their watchlist.
- unwatch: the user asks to remove one or more stocks from their watchlist.
- none: anything else — questions, opinions, plans or intentions ("should I sell X", "thinking of buying X", "what do you think of NVDA"), market questions, mixed actions, or when unsure.

Rules:
- symbols: US ticker symbols, uppercase, without "$", list numbers or bullets. If the user names a company instead of a ticker, include its primary US ticker only if you are certain; otherwise leave it out.
- For none, symbols is [].
- Never invent symbols that the message does not mention.`;

export const ROUTER_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['buy', 'sell', 'watch', 'unwatch', 'none'] },
    symbols: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['action', 'symbols'],
};

const NONE: RouterIntent = { kind: 'none' };

function normalise(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-•*]\s*/, '')
    .replace(/^\$/, '')
    .trim();
}

export function toIntent(raw: unknown, message: string): RouterIntent {
  if (message.includes('?')) return NONE;
  if (typeof raw !== 'object' || raw === null) return NONE;
  const { action, symbols } = raw as { action?: unknown; symbols?: unknown };
  if (!ACTIONS.includes(action as RouterAction)) return NONE;
  if (!Array.isArray(symbols) || symbols.some((s) => typeof s !== 'string')) return NONE;
  if (symbols.length > MAX_SYMBOLS) return NONE;

  const valid: string[] = [];
  const rejected: string[] = [];
  for (const s of (symbols as string[]).map(normalise)) {
    if (s === '') continue;
    const bucket = TICKER.test(s) ? valid : rejected;
    if (!bucket.includes(s)) bucket.push(s);
  }
  if (valid.length === 0) return NONE;
  return { kind: action as RouterAction, symbols: valid, rejected };
}
