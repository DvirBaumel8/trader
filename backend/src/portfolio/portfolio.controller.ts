import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PortfolioService } from './portfolio.service.js';
import { StopLevelDto } from '../journal/journal.dto.js';
import { computeRisk } from './risk.js';

/** A plan being typed, not one being saved — see the `stop-risk` route. */
class StopRiskDto {
  @IsNumber()
  avgEntry: number;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsIn(['LONG', 'SHORT'])
  direction?: 'LONG' | 'SHORT';

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StopLevelDto)
  levels: StopLevelDto[];
}

class SeedHoldingDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  avgCost: number;
}

class SeedDto {
  @IsISO8601()
  asOf: string;

  @IsNumber()
  startingCash: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SeedHoldingDto)
  holdings: SeedHoldingDto[];
}

class ReviseStopsDto {
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopLevelDto)
  levels: StopLevelDto[];
}

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  get(@Query('refresh') refresh?: string) {
    // Explicit user-initiated refresh bypasses the quote cache.
    return this.portfolio.getPortfolio({
      refresh: refresh === '1' || refresh === 'true',
    });
  }

  @Get('stats')
  stats() {
    return this.portfolio.getStats();
  }

  /**
   * The id is a `symbol:ISO-timestamp` composite, URL-encoded by the client.
   * Nest gives back the decoded segment, so no manual decode here.
   */
  @Get('trades/:id')
  getTrade(@Param('id') id: string) {
    return this.portfolio.getTrade(id);
  }

  /**
   * Appends a new stop revision against this trade's opening transaction —
   * used by the "reduces a stopped position" prompt in the entry sheet so
   * revising the plan does not require reopening the entry that opened the
   * trade. Never blocks a journal save: this is its own, independent write.
   */
  @Patch('trades/:id/stops')
  reviseStops(@Param('id') id: string, @Body() body: ReviseStopsDto) {
    return this.portfolio.reviseTradeStops(id, body.levels);
  }

  /**
   * Prices a stop plan the owner is still typing. Stateless — it reads
   * nothing and writes nothing.
   *
   * It exists so the risk arithmetic has exactly one implementation. The
   * frontend used to carry its own copy for this, which drifted from the
   * real rule twice: once treating a profit-locking tier as no coverage, and
   * once reporting $1,200 at risk on a plan actually worth $750. The
   * frontend's job is to display the number, not to work it out.
   *
   * POST rather than GET because a plan is a list of tiers, not a query
   * string — and because a URL full of position sizes is not something to
   * leave in logs and history.
   */
  @Post('stop-risk')
  stopRisk(@Body() body: StopRiskDto) {
    return computeRisk({
      avgEntry: body.avgEntry,
      quantity: body.quantity,
      direction: body.direction ?? 'LONG',
      levels: body.levels.map((l) => ({
        kind: l.kind,
        price: l.price ?? null,
        trailPercent: l.trailPercent ?? null,
        quantity: l.quantity,
      })),
    });
  }

  @Get('status')
  async status() {
    return { seeded: await this.portfolio.isSeeded() };
  }

  @Post('seed')
  seed(@Body() body: SeedDto) {
    return this.portfolio.seed(body);
  }

  @Delete('reset')
  async reset() {
    await this.portfolio.reset();
    return { ok: true };
  }
}
