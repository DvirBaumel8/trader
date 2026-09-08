export interface ParsedReviewMeta {
  score: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
}

const REVIEW_META_BLOCK = /\[REVIEW_META\]\s*([\s\S]*?)\s*\[\/REVIEW_META\]/i;

function cleanScore(raw: string | undefined): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (!raw) return 'B';
  const char = raw.trim().toUpperCase().charAt(0);
  if (['A', 'B', 'C', 'D', 'F'].includes(char)) {
    return char as 'A' | 'B' | 'C' | 'D' | 'F';
  }
  return 'B';
}

/**
 * Extracts the structured score and headline verdict from the model's response.
 *
 * The model places a small metadata block at the top:
 *
 *     [REVIEW_META]
 *     SCORE: A
 *     VERDICT: Disciplined Cut at Initial Stop
 *     [/REVIEW_META]
 *
 * If the model omitted or altered the tags, falls back gracefully by pattern-matching.
 */
export function parseReviewMeta(text: string): ParsedReviewMeta {
  const block = REVIEW_META_BLOCK.exec(text);
  if (block) {
    const inner = block[1];
    const scoreMatch = /(?:SCORE|GRADE)\s*:\s*([A-Fa-f])/i.exec(inner);
    const verdictMatch = /VERDICT\s*:\s*([^\n\r]+)/i.exec(inner);

    return {
      score: cleanScore(scoreMatch?.[1]),
      verdict: verdictMatch?.[1]?.trim() || 'Execution & Discipline Review',
    };
  }

  // Fallback if tags were omitted
  const scoreMatch = /(?:SCORE|GRADE)\s*:\s*([A-Fa-f])/i.exec(text);
  const verdictMatch = /VERDICT\s*:\s*([^\n\r]+)/i.exec(text);

  return {
    score: cleanScore(scoreMatch?.[1]),
    verdict: verdictMatch?.[1]?.trim() || 'Execution & Discipline Review',
  };
}

/** Returns the markdown text without the [REVIEW_META] block. */
export function stripReviewMeta(text: string): string {
  return text.replace(REVIEW_META_BLOCK, '').trim();
}
