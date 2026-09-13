export interface ParsedPatternMeta {
  headline: string;
}

const PATTERN_META_BLOCK = /\[PATTERN_META\]\s*([\s\S]*?)\s*\[\/PATTERN_META\]/i;
const DEFAULT_HEADLINE = 'Pattern read';

/**
 * Extracts the one-line headline from the model's response — the only part
 * that must survive collapsing the card, per the app's own AI-answer
 * convention. Falls back to pattern-matching if the model altered the tags,
 * same as `parseReviewMeta`.
 */
export function parsePatternMeta(text: string): ParsedPatternMeta {
  const block = PATTERN_META_BLOCK.exec(text);
  const source = block ? block[1] : text;
  const headlineMatch = /HEADLINE\s*:\s*([^\n\r]+)/i.exec(source);
  return { headline: headlineMatch?.[1]?.trim() || DEFAULT_HEADLINE };
}

/** Returns the markdown text without the [PATTERN_META] block. */
export function stripPatternMeta(text: string): string {
  return text.replace(PATTERN_META_BLOCK, '').trim();
}
