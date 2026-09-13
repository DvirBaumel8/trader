import { Controller, Get, Query } from '@nestjs/common';
import { PerformanceService } from './performance.service.js';
import { RANGES, type Range } from '../common/date-range.js';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  get(@Query('range') range?: string) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    return this.performance.getSeries(valid);
  }
}
