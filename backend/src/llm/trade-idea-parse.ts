/**
 * The model ends its answer with a small machine-readable block so the app can
 * do the arithmetic itself:
 *
 *     LEVELS
 *     stop: 41.20
 *     target: 58.00
 *
 * Parsing is deliberately forgiving about presentation ($ signs, commas,
 * whitespace) and completely unforgiving about substance: anything that is not
 * two positive numbers returns null, and the caller then shows the prose with
 * no derived figures at all. A missing risk/reward is honest; one computed
 * from a half-read number is the exact failure this app exists to avoid.
 *
 * The block must sit on its own line. Without that anchor, a sentence like
 * "I would not put a stop: 41.20 here" would be read as a proposal — the model
 * discussing a level it is arguing AGAINST would become the level it set.
 */
export interface ProposedLevels {
  stop: number;
  target: number;
}

const LEVELS_BLOCK = /(?:^|\n)LEVELS[ \t]*\n([\s\S]*)$/i;

function readNumber(source: string, label: 'stop' | 'target'): number | null {
  const match = new RegExp(
    `${label}\\s*:\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)`,
    'i',
  ).exec(source);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseProposedLevels(text: string): ProposedLevels | null {
  const block = LEVELS_BLOCK.exec(text);
  if (!block) return null;
  const stop = readNumber(block[1], 'stop');
  const target = readNumber(block[1], 'target');
  if (stop === null || target === null) return null;
  return { stop, target };
}

/** The prose without the block — what the owner actually reads. */
export function stripLevelsBlock(text: string): string {
  return text.replace(LEVELS_BLOCK, '');
}
