export type StopKind = 'FIXED' | 'TRAILING';

/**
 * One row of the stop plan editor. Strings, because they mirror exactly what
 * is in the inputs while the owner is still typing — "9", "9." and "9.5" are
 * all valid intermediate states that a number cannot represent.
 *
 * A shape, not a rule. The arithmetic these rows imply is the backend's: see
 * `POST /portfolio/stop-risk` and `useStopRisk`.
 */
export interface StopRow {
  kind: StopKind;
  price: string;
  trailPercent: string;
  quantity: string;
}
