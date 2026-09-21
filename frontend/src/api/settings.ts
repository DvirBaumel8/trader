import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Reason {
  code: string;
  label: string;
}

export interface Settings {
  defaultFee: number;
  /**
   * The reason vocabulary, defined once in `backend/src/journal/reasons.ts`
   * and served from there. The frontend holds no copy of it — the same rule
   * that moved the risk arithmetic out after it drifted twice.
   */
  reasons: { opening: Reason[]; closing: Reason[] };
  /**
   * The raw last-saved snapshot of the broker's "month-to-date interest"
   * figure — see backend/src/users/user.entity.ts. Not month-filtered here;
   * `/portfolio/fees`'s `interestCost` is what drops a stale prior-month
   * value, so that endpoint (not this one) is what the UI displays.
   */
  interestAccrualAmount: number | null;
  interestAccrualAsOf: string | null;
}

/** One definition of the settings fetch, so both callers share a cache entry. */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/settings'),
  });
}
