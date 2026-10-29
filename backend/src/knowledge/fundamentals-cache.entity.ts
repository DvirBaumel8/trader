import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { QuarterEstimate } from '../market-data/alpha-vantage.client.js';
import type { Fundamentals } from './fundamentals.js';

export interface FundamentalsCacheData {
  /** Yahoo says this ticker is not a company; remembered for the day so it is not asked again. */
  notCompany?: true;
  fundamentals?: Fundamentals;
  /** The raw expectations behind `fundamentals`, kept so a failed refresh can carry them forward. */
  estimates?: QuarterEstimate[];
  /** The expectations are missing or carried over from an earlier day; retried on a later open. */
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
