import { formatQuantity } from '../components/format';

export type StopPlanIssue =
  | 'CLOSED_WITH_STOPS'
  | 'DIRECTION_MISMATCH'
  | 'OVER_COVERED'
  | 'UNRESOLVED_TRAILING';

export interface StopPlanRow {
  symbol: string;
  issue: StopPlanIssue;
  /** Shares the recorded tiers add up to, raw — not capped to what is held. */
  recordedQuantity: number;
  /** Shares actually held right now, unsigned. */
  heldQuantity: number;
}

export interface StopPlanIssueText {
  /** Two or three words, the state itself. */
  label: string;
  /** One line saying what is actually wrong, with real numbers where there are any. */
  detail: string;
}

/**
 * How a drifted stop plan reads on the Stops page. The backend
 * (`evaluateStopPlan` in risk.ts) decides THAT a plan needs attention and
 * deliberately refuses to say which recorded level is stale, so this text
 * describes the discrepancy and never suggests a fix — the owner is the only
 * one who knows which tier he meant to keep.
 *
 * Kept pure and separate from the component so the wording is fixture-tested:
 * these strings are the entire explanation the owner gets for why a position
 * vanished from the tier list, and a vague one would read as a bug.
 */
export function describeStopPlanIssue(row: StopPlanRow): StopPlanIssueText {
  switch (row.issue) {
    case 'CLOSED_WITH_STOPS':
      return {
        label: 'Position closed',
        detail: `Stops on ${formatQuantity(row.recordedQuantity)} sh remain, but nothing is held.`,
      };
    case 'DIRECTION_MISMATCH':
      return {
        label: 'Direction flipped',
        detail: 'Stops were set for the opposite direction and no longer apply.',
      };
    case 'OVER_COVERED':
      return {
        label: 'Covers too much',
        detail: `Stops cover ${formatQuantity(row.recordedQuantity)} sh of ${formatQuantity(row.heldQuantity)} held.`,
      };
    case 'UNRESOLVED_TRAILING':
      return {
        label: 'Trail unpriced',
        detail: 'No price history yet to measure the trail from.',
      };
  }
}
