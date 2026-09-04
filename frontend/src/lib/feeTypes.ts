export type Period = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** One bar of the fees chart, as the backend computes it. */
export interface Bucket {
  key: string;
  label: string;
  total: number;
}

/** `GET /portfolio/fees` — shapes only; the arithmetic is the backend's. */
export interface FeesResponse {
  period: Period;
  buckets: Bucket[];
  total: number;
}
