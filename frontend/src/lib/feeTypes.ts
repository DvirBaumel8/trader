export type Period = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** One bar of the fees chart, as the backend computes it. */
export interface Bucket {
  key: string;
  label: string;
  total: number;
}

/**
 * The broker charges margin interest as one lump sum a month, but accrues it
 * into the live cash balance daily. `posted` is every such charge the app
 * has actually recorded; `accrued` is the owner's manually-entered snapshot
 * of the broker's own running total for the current month, dropped once a
 * new month starts (see backend fee-buckets.ts's `computeInterestCost`).
 */
export interface InterestCost {
  posted: number;
  accrued: number;
  total: number;
  asOf: string | null;
}

/** `GET /portfolio/fees` — shapes only; the arithmetic is the backend's. */
export interface FeesResponse {
  period: Period;
  buckets: Bucket[];
  total: number;
  interestCost: InterestCost;
}
