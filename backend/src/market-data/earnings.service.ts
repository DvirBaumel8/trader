import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from '../instruments/instrument.entity.js';
import { YahooClient } from './yahoo.client.js';
import { daysUntilEarnings } from './earnings.js';

@Injectable()
export class EarningsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly yahoo: YahooClient,
  ) {}

  async daysUntil(
    rows: Instrument[],
    today = new Date().toISOString().slice(0, 10),
  ): Promise<Map<string, number | null>> {
    const values = await Promise.all(
      rows.map(async (instrument) => {
        const date = await this.ensureCurrent(instrument, today);
        return [instrument.symbol, daysUntilEarnings(date, today)] as const;
      }),
    );
    return new Map(values);
  }

  private async ensureCurrent(instrument: Instrument, today: string): Promise<string | null> {
    if (
      instrument.nextEarningsDate &&
      instrument.nextEarningsDate >= today
    ) {
      return instrument.nextEarningsDate;
    }

    const checkedToday =
      instrument.earningsCheckedAt?.toISOString().slice(0, 10) === today;
    if (checkedToday) return instrument.nextEarningsDate ?? null;

    let nextDate: string | null = null;
    try {
      nextDate = await this.yahoo.nextEarningsDate(instrument.symbol);
    } catch {
      // A provider miss is still a check. Keep the old date as history, but
      // do not hammer Yahoo again on every dashboard poll.
    }
    instrument.nextEarningsDate = nextDate ?? instrument.nextEarningsDate;
    instrument.earningsCheckedAt = new Date(`${today}T00:00:00Z`);
    await this.instruments.save(instrument);
    return instrument.nextEarningsDate ?? null;
  }
}
