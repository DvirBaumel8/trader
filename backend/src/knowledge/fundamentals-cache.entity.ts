import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { Fundamentals } from './fundamentals.js';

export interface FundamentalsCacheData {
  /** Yahoo says this ticker is not a company; remembered for the day so it is not asked again. */
  notCompany?: true;
  fundamentals?: Fundamentals;
  /** The actuals were cached but the expectations call failed; retried on a later open. */
  estimatesMissing?: true;
}

/** Shared across users: fundamentals are public market data. */
@Entity('fundamentals_cache')
export class FundamentalsCache {
  /** Upper-case. */
  @PrimaryColumn()
  symbol: string;

  @Column({ type: 'jsonb' })
  data: FundamentalsCacheData;

  @Column({ type: 'timestamptz' })
  fetchedAt: Date;
}
